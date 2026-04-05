import { useState, useCallback, useRef } from 'react';
import { db } from '../services/db';
import { sm2Update, calculateQuality, createCardState } from '../services/sm2';
import { analyzeError as apiAnalyzeError } from '../services/api';
import { useApp } from '../context/AppContext';
import { getCategoriesForGrade, getMaxDifficultyForGrade } from '../services/gradeFilter';
import type { Question, ErrorAnalysis } from '../types';

export interface QuizFilters {
  category?: string;
  year?: number;
  gradeLimit?: number; // 学年に応じた出題範囲制限
}

interface QuizState {
  questions: Question[];
  currentIndex: number;
  selectedAnswers: string[];
  showFeedback: boolean;
  isCorrect: boolean | null;
  sessionStats: { correct: number; total: number };
  isLoading: boolean;
  isFinished: boolean;
  // AI分析
  aiAnalysis: ErrorAnalysis | null;
  aiLoading: boolean;
  consecutiveErrors: number;
}

export function useQuiz() {
  const { triggerSync } = useApp();
  const [state, setState] = useState<QuizState>({
    questions: [],
    currentIndex: 0,
    selectedAnswers: [],
    showFeedback: false,
    isCorrect: null,
    sessionStats: { correct: 0, total: 0 },
    isLoading: true,
    isFinished: false,
    aiAnalysis: null,
    aiLoading: false,
    consecutiveErrors: 0,
  });

  const startTimeRef = useRef<number>(Date.now());

  // クイズセッションを開始
  const startSession = useCallback(async (limit = 20, filters?: QuizFilters) => {
    setState((s) => ({ ...s, isLoading: true }));

    // フィルター条件に合致するかチェック
    const matchesFilter = (q: Question): boolean => {
      if (filters?.category && q.category !== filters.category) return false;
      if (filters?.year && q.exam_year !== filters.year) return false;
      // 学年別カリキュラムフィルター
      if (filters?.gradeLimit) {
        const allowedCategories = getCategoriesForGrade(filters.gradeLimit);
        if (!allowedCategories.includes(q.category)) return false;
        const maxDifficulty = getMaxDifficultyForGrade(filters.gradeLimit);
        if (q.difficulty > maxDifficulty) return false;
      }
      return true;
    };

    // 復習予定の問題を優先取得
    const today = new Date().toISOString().split('T')[0]!;
    const reviewCards = await db.cardStates
      .where('nextReview')
      .belowOrEqual(today)
      .toArray();

    let questions: Question[] = [];

    if (reviewCards.length > 0) {
      // 復習問��をキャッシュから取得
      const reviewIds = reviewCards.map((c) => c.questionId);
      const reviewQuestions = await db.questionCache
        .where('question_id')
        .anyOf(reviewIds)
        .toArray();
      questions = shuffleArray(reviewQuestions.filter(matchesFilter)).slice(0, limit);
    }

    // 復習問題が足りない場合、新��問題を追加
    if (questions.length < limit) {
      const studiedIds = new Set(
        (await db.cardStates.toArray()).map((c) => c.questionId)
      );
      const newQuestions = (await db.questionCache.toArray())
        .filter((q) => !studiedIds.has(q.question_id))
        .filter((q) => q.correct_answer.length > 0) // 正解のある問題のみ
        .filter(matchesFilter);

      const needed = limit - questions.length;
      questions = [
        ...questions,
        ...shuffleArray(newQuestions).slice(0, needed),
      ];
    }

    setState({
      questions,
      currentIndex: 0,
      selectedAnswers: [],
      showFeedback: false,
      isCorrect: null,
      sessionStats: { correct: 0, total: 0 },
      isLoading: false,
      isFinished: questions.length === 0,
      aiAnalysis: null,
      aiLoading: false,
      consecutiveErrors: 0,
    });

    startTimeRef.current = Date.now();
  }, []);

  // 選択肢をタップ
  const selectAnswer = useCallback((choiceLetter: string) => {
    setState((s) => {
      const current = s.questions[s.currentIndex];
      if (!current || s.showFeedback) return s;

      if (current.is_multi_select) {
        // 複数選択: トグル
        const updated = s.selectedAnswers.includes(choiceLetter)
          ? s.selectedAnswers.filter((a) => a !== choiceLetter)
          : [...s.selectedAnswers, choiceLetter];
        return { ...s, selectedAnswers: updated };
      }

      // 単一選択: 即座に回答
      return { ...s, selectedAnswers: [choiceLetter] };
    });
  }, []);

  // 回答を確定（answersを直接渡せるようにして、stale closure問題を回避）
  const confirmAnswer = useCallback(async (answers?: string[]) => {
    const { questions, currentIndex, selectedAnswers } = state;
    const finalAnswers = answers ?? selectedAnswers;
    const current = questions[currentIndex];
    if (!current || finalAnswers.length === 0) return;

    const responseTimeMs = Date.now() - startTimeRef.current;
    const isCorrect = arraysEqualIgnoreOrder(
      finalAnswers,
      current.correct_answer
    );

    try {
      // SM-2更新
      const quality = calculateQuality(isCorrect, responseTimeMs);
      const existingCard = await db.cardStates.get(current.question_id);
      const card = existingCard || createCardState(current.question_id);
      const updatedCard = sm2Update(card, quality);
      await db.cardStates.put(updatedCard);

      // 回答ログ記録
      await db.answerLog.add({
        questionId: current.question_id,
        selectedAnswer: finalAnswers,
        isCorrect,
        responseTimeMs,
        timestamp: new Date().toISOString(),
        synced: false,
      });
    } catch (err) {
      console.error('DB保存エラー:', err);
    }

    // 連続誤答数をカウント（IndexedDBの回答ログから計算）
    let consecutiveErrors = 0;
    if (!isCorrect) {
      try {
        const logs = await db.answerLog
          .where('questionId')
          .equals(current.question_id)
          .reverse()
          .sortBy('timestamp');
        // 最新から連続で不正解な回数を数える
        for (const log of logs) {
          if (!log.isCorrect) {
            consecutiveErrors++;
          } else {
            break;
          }
        }
      } catch {
        consecutiveErrors = 1;
      }
    }

    // 3回連続誤答でAI分析を発動
    const shouldAnalyze = !isCorrect && consecutiveErrors >= 3;

    setState((s) => ({
      ...s,
      showFeedback: true,
      isCorrect,
      consecutiveErrors,
      aiAnalysis: null,
      aiLoading: shouldAnalyze,
      sessionStats: {
        correct: s.sessionStats.correct + (isCorrect ? 1 : 0),
        total: s.sessionStats.total + 1,
      },
    }));

    // AI分析を非同期で実行
    if (shouldAnalyze) {
      try {
        const res = await apiAnalyzeError({
          questionId: current.question_id,
          studentAnswer: finalAnswers,
          correctAnswer: current.correct_answer,
          questionText: current.question_text,
          choices: current.choices,
        });
        if (res.success && res.data) {
          setState((s) => ({
            ...s,
            aiAnalysis: res.data as ErrorAnalysis,
            aiLoading: false,
          }));
        } else {
          setState((s) => ({ ...s, aiLoading: false }));
        }
      } catch {
        setState((s) => ({ ...s, aiLoading: false }));
      }
    }
  }, [state]);

  // 次の問題へ
  const nextQuestion = useCallback(() => {
    setState((s) => {
      const nextIndex = s.currentIndex + 1;
      if (nextIndex >= s.questions.length) {
        // クイズ終了時にバッチ同期を実行
        triggerSync();
        return { ...s, isFinished: true };
      }
      startTimeRef.current = Date.now();
      return {
        ...s,
        currentIndex: nextIndex,
        selectedAnswers: [],
        showFeedback: false,
        isCorrect: null,
        aiAnalysis: null,
        aiLoading: false,
        consecutiveErrors: 0,
      };
    });
  }, [triggerSync]);

  const currentQuestion = state.questions[state.currentIndex] || null;

  return {
    ...state,
    currentQuestion,
    startSession,
    selectAnswer,
    confirmAnswer,
    nextQuestion,
  };
}

// ユーティリティ
function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

function arraysEqualIgnoreOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v.toUpperCase() === sortedB[i]?.toUpperCase());
}
