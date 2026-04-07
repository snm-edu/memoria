import { useState, useCallback, useRef } from 'react';
import { db } from '../services/db';
import { sm2Update, calculateQuality, createCardState } from '../services/sm2';
import { analyzeError as apiAnalyzeError } from '../services/api';
import {
  updateHintLevel,
  getVisibleChoices,
  createFillInBlank,
  getEaseFactorPenalty,
  shouldExtendInterval,
} from '../services/memoriaStep';
import { updateGamification } from '../services/gamification';
import { useApp } from '../context/AppContext';
import { getCategoriesForGrade, getMaxDifficultyForGrade } from '../services/gradeFilter';
import type { Question, ErrorAnalysis, CardState } from '../types';

export interface QuizFilters {
  category?: string;
  subcategory?: string; // サブカテゴリで更に絞り込み
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
  // メモリアステップ
  hintLevel: number;
  visibleChoices: string[];
  visibleLabels: string[];
  fillInBlank: { text: string; answer: string } | null;
  confirmationMode: boolean; // レベル6
}

/** CHOICE_LABELSの定数（選択肢ラベル全体） */
const ALL_CHOICE_LABELS = ['A', 'B', 'C', 'D', 'E'];

/**
 * 問題に対するメモリアステップの状態を計算するヘルパー
 * CardStateのhintLevelと問題データから、表示用の選択肢・ラベル・穴埋め等を算出
 */
function computeMemoriaState(
  question: Question,
  hintLevel: number
): Pick<QuizState, 'hintLevel' | 'visibleChoices' | 'visibleLabels' | 'fillInBlank' | 'confirmationMode'> {
  // 複数選択問題ではレベル2,4の選択肢削減をスキップ → レベル1(カテゴリヒント)にフォールバック
  const effectiveLevel =
    question.is_multi_select && (hintLevel === 2 || hintLevel === 4)
      ? 1
      : hintLevel;

  // レベル5: 穴埋め変換
  if (effectiveLevel === 5) {
    const correctChoiceTexts = question.correct_answer.map((label) => {
      const idx = ALL_CHOICE_LABELS.indexOf(label.toUpperCase());
      return idx >= 0 ? question.choices[idx] ?? '' : '';
    });
    const blank = createFillInBlank(question.explanation, correctChoiceTexts);
    return {
      hintLevel: effectiveLevel,
      visibleChoices: question.choices,
      visibleLabels: ALL_CHOICE_LABELS.slice(0, question.choices.length),
      fillInBlank: blank,
      confirmationMode: false,
    };
  }

  // レベル6: 確認モード
  if (effectiveLevel === 6) {
    return {
      hintLevel: effectiveLevel,
      visibleChoices: question.choices,
      visibleLabels: ALL_CHOICE_LABELS.slice(0, question.choices.length),
      fillInBlank: null,
      confirmationMode: true,
    };
  }

  // レベル2,4: 選択肢削減
  if (effectiveLevel === 2 || effectiveLevel === 4) {
    const result = getVisibleChoices(
      question.choices,
      question.correct_answer,
      effectiveLevel
    );
    return {
      hintLevel: effectiveLevel,
      visibleChoices: result.choices,
      visibleLabels: result.labels,
      fillInBlank: null,
      confirmationMode: false,
    };
  }

  // レベル0,1,3: 全選択肢表示
  return {
    hintLevel: effectiveLevel,
    visibleChoices: question.choices,
    visibleLabels: ALL_CHOICE_LABELS.slice(0, question.choices.length),
    fillInBlank: null,
    confirmationMode: false,
  };
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
    // メモリアステップ初期値
    hintLevel: 0,
    visibleChoices: [],
    visibleLabels: [],
    fillInBlank: null,
    confirmationMode: false,
  });

  const startTimeRef = useRef<number>(Date.now());
  // ゲーミフィケーション用セッション追跡
  const sessionConsecutiveCorrectRef = useRef(0);
  const sessionMaxConsecutiveRef = useRef(0);
  const sessionFastCorrectRef = useRef(0);

  // stale closure対策: stateの最新値を常にrefで追跡
  const stateRef = useRef(state);
  stateRef.current = state;

  // クイズセッションを開始
  const startSession = useCallback(async (limit = 20, filters?: QuizFilters) => {
    setState((s) => ({ ...s, isLoading: true }));

    // 選択肢が画像のみ（&#160;等）の問題を除外する判定
    const hasValidChoices = (q: Question): boolean => {
      if (q.choices.length === 0) return false;
      return q.choices.some(c => c.trim() !== '' && c !== '\u00A0' && !c.match(/^&#\d+;$/));
    };

    // フィルター条件に合致するかチェック
    const matchesFilter = (q: Question): boolean => {
      if (!hasValidChoices(q)) return false; // 選択肢が画像のみの問題を除外
      if (filters?.category && q.category !== filters.category) return false;
      if (filters?.subcategory && q.subcategory !== filters.subcategory) return false;
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

    // 最初の問題のメモリアステップ状態を計算
    let memoriaState: Pick<QuizState, 'hintLevel' | 'visibleChoices' | 'visibleLabels' | 'fillInBlank' | 'confirmationMode'> = {
      hintLevel: 0,
      visibleChoices: [],
      visibleLabels: [],
      fillInBlank: null,
      confirmationMode: false,
    };

    if (questions.length > 0) {
      const firstQ = questions[0]!;
      const card = await db.cardStates.get(firstQ.question_id);
      const hl = card?.hintLevel ?? 0;
      memoriaState = computeMemoriaState(firstQ, hl);
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
      ...memoriaState,
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

  // 回答を確定（stateRefで最新値を参照し、stale closure問題を回避）
  const confirmAnswer = useCallback(async (answers?: string[]) => {
    const s = stateRef.current;
    const finalAnswers = answers ?? s.selectedAnswers;
    const current = s.questions[s.currentIndex];

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
      const sm2Card = sm2Update(card, quality);

      // メモリアステップ処理（SM-2カードにヒントレベルをマージ）
      const hintUpdate = updateHintLevel(sm2Card, isCorrect);
      const memoriaCard: CardState = { ...sm2Card, ...hintUpdate };
      const penalty = getEaseFactorPenalty(memoriaCard.hintLevel);
      memoriaCard.easeFactor = Math.max(1.3, memoriaCard.easeFactor - penalty);

      if (shouldExtendInterval(memoriaCard)) {
        memoriaCard.interval = Math.round(memoriaCard.interval * 1.5);
        const extendedDate = new Date();
        extendedDate.setDate(extendedDate.getDate() + memoriaCard.interval);
        memoriaCard.nextReview = extendedDate.toISOString().split('T')[0]!;
      }

      // DBに保存
      await db.cardStates.put(memoriaCard);

      // 回答ログ記録
      await db.answerLog.add({
        questionId: current.question_id,
        selectedAnswer: finalAnswers,
        isCorrect,
        responseTimeMs,
        timestamp: new Date().toISOString(),
        synced: false,
      });

      // ゲーミフィケーション更新
      if (isCorrect) {
        sessionConsecutiveCorrectRef.current++;
        if (responseTimeMs < 5000) sessionFastCorrectRef.current++;
      } else {
        sessionConsecutiveCorrectRef.current = 0;
      }
      sessionMaxConsecutiveRef.current = Math.max(
        sessionMaxConsecutiveRef.current,
        sessionConsecutiveCorrectRef.current
      );

      const isReview = !!existingCard;
      try {
        const profile = await db.profile.toCollection().first();
        if (profile) {
          await updateGamification(
            profile.studentId,
            isCorrect,
            isReview,
            sessionConsecutiveCorrectRef.current,
          );
        }
      } catch (gErr) {
        console.warn('[confirmAnswer] gamification error:', gErr);
      }
    } catch (err) {
      console.error('[confirmAnswer] DB保存エラー:', err);
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

    // AI分析の発動条件: hintLevel >= 3 に変更（メモリアステップ対応）
    const currentCard = await db.cardStates.get(current.question_id);
    const currentHintLevel = currentCard?.hintLevel ?? 0;
    const shouldAnalyze = !isCorrect && currentHintLevel >= 3;

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 次の問題へ
  const nextQuestion = useCallback(async () => {
    const nextIndex = stateRef.current.currentIndex + 1;
    if (nextIndex >= stateRef.current.questions.length) {
      // クイズ終了時にバッチ同期を実行
      triggerSync();
      // セッション終了時のバッジチェック（パーフェクト、10問連続正解等）
      try {
        const profile = await db.profile.toCollection().first();
        if (profile) {
          const s = stateRef.current;
          await updateGamification(
            profile.studentId,
            true, false, 0,
            {
              correct: s.sessionStats.correct,
              total: s.sessionStats.total,
              consecutiveCorrect: sessionMaxConsecutiveRef.current,
              fastCorrect: sessionFastCorrectRef.current,
            }
          );
        }
      } catch (e) { console.warn('[quiz] session badge check error:', e); }
      // セッションカウンターリセット
      sessionConsecutiveCorrectRef.current = 0;
      sessionMaxConsecutiveRef.current = 0;
      sessionFastCorrectRef.current = 0;
      setState((s) => ({ ...s, isFinished: true }));
      return;
    }

    // 次の問題のメモリアステップ状態を計算
    const nextQ = stateRef.current.questions[nextIndex]!;
    const card = await db.cardStates.get(nextQ.question_id);
    const hl = card?.hintLevel ?? 0;
    const memoriaState = computeMemoriaState(nextQ, hl);

    startTimeRef.current = Date.now();
    setState((s) => ({
      ...s,
      currentIndex: nextIndex,
      selectedAnswers: [],
      showFeedback: false,
      isCorrect: null,
      aiAnalysis: null,
      aiLoading: false,
      consecutiveErrors: 0,
      ...memoriaState,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerSync]);

  // レベル6の確認モード用ハンドラ
  const handleConfirmation = useCallback(async (understood: boolean) => {
    const { questions, currentIndex } = stateRef.current;
    const current = questions[currentIndex];
    if (!current) return;

    try {
      const existingCard = await db.cardStates.get(current.question_id);
      const card = existingCard || createCardState(current.question_id);

      if (understood) {
        // 理解できた: quality=3相当でSM-2更新、hintLevelを3に引き下げ
        const updatedCard = sm2Update(card, 3);
        updatedCard.hintLevel = 3;
        updatedCard.consecutiveCorrectAtZero = 0;
        await db.cardStates.put(updatedCard);
      } else {
        // まだ不安: hintLevel=6のまま、翌日に再出題
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        card.nextReview = tomorrow.toISOString().split('T')[0]!;
        card.lastReview = new Date().toISOString().split('T')[0]!;
        await db.cardStates.put(card);
      }
    } catch (err) {
      console.error('確認モードDB保存エラー:', err);
    }

    // sessionStatsにはカウントしない → 次の問題へ
    await nextQuestion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextQuestion]);

  const currentQuestion = state.questions[state.currentIndex] || null;

  return {
    ...state,
    currentQuestion,
    startSession,
    selectAnswer,
    confirmAnswer,
    nextQuestion,
    handleConfirmation,
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
