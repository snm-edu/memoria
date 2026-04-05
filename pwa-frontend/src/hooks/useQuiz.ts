import { useState, useCallback, useRef } from 'react';
import { db } from '../services/db';
import { sm2Update, calculateQuality, createCardState } from '../services/sm2';
import type { Question } from '../types';

interface QuizState {
  questions: Question[];
  currentIndex: number;
  selectedAnswers: string[];
  showFeedback: boolean;
  isCorrect: boolean | null;
  sessionStats: { correct: number; total: number };
  isLoading: boolean;
  isFinished: boolean;
}

export function useQuiz() {
  const [state, setState] = useState<QuizState>({
    questions: [],
    currentIndex: 0,
    selectedAnswers: [],
    showFeedback: false,
    isCorrect: null,
    sessionStats: { correct: 0, total: 0 },
    isLoading: true,
    isFinished: false,
  });

  const startTimeRef = useRef<number>(Date.now());

  // クイズセッションを開始
  const startSession = useCallback(async (limit = 20) => {
    setState((s) => ({ ...s, isLoading: true }));

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
      questions = shuffleArray(reviewQuestions).slice(0, limit);
    }

    // 復習問題が足りない場合、新��問題を追加
    if (questions.length < limit) {
      const studiedIds = new Set(
        (await db.cardStates.toArray()).map((c) => c.questionId)
      );
      const newQuestions = (await db.questionCache.toArray())
        .filter((q) => !studiedIds.has(q.question_id))
        .filter((q) => q.correct_answer.length > 0); // 正解のある問題のみ

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

  // 回答を確定
  const confirmAnswer = useCallback(async () => {
    const { questions, currentIndex, selectedAnswers } = state;
    const current = questions[currentIndex];
    if (!current || selectedAnswers.length === 0) return;

    const responseTimeMs = Date.now() - startTimeRef.current;
    const isCorrect = arraysEqualIgnoreOrder(
      selectedAnswers,
      current.correct_answer
    );

    // SM-2更新
    const quality = calculateQuality(isCorrect, responseTimeMs);
    const existingCard = await db.cardStates.get(current.question_id);
    const card = existingCard || createCardState(current.question_id);
    const updatedCard = sm2Update(card, quality);
    await db.cardStates.put(updatedCard);

    // 回答ロ���記録
    await db.answerLog.add({
      questionId: current.question_id,
      selectedAnswer: selectedAnswers,
      isCorrect,
      responseTimeMs,
      timestamp: new Date().toISOString(),
      synced: false,
    });

    setState((s) => ({
      ...s,
      showFeedback: true,
      isCorrect,
      sessionStats: {
        correct: s.sessionStats.correct + (isCorrect ? 1 : 0),
        total: s.sessionStats.total + 1,
      },
    }));
  }, [state]);

  // 次の問題へ
  const nextQuestion = useCallback(() => {
    setState((s) => {
      const nextIndex = s.currentIndex + 1;
      if (nextIndex >= s.questions.length) {
        return { ...s, isFinished: true };
      }
      startTimeRef.current = Date.now();
      return {
        ...s,
        currentIndex: nextIndex,
        selectedAnswers: [],
        showFeedback: false,
        isCorrect: null,
      };
    });
  }, []);

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
