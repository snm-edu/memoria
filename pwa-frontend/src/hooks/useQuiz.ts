import { useState, useCallback, useRef } from 'react';
import { db } from '../services/db';
import { createCardState } from '../services/sm2';
import {
  analyzeError as apiAnalyzeError,
  generateSimilar as apiGenerateSimilar,
} from '../services/api';
import {
  normalizeGeneratedResponse,
  generatedToQuestion,
} from '../services/similarQuestion';
import {
  applyAnswer,
  confirmUnderstanding,
  computePresentation,
} from '../services/memoriaStep';
import { localDateString } from '../services/date';
import { rankReviewCards, isWeakCard, NEW_PER_SESSION } from '../services/sessionSelect';
import { updateGamification } from '../services/gamification';
import { useApp } from '../context/AppContext';
import { getCategoriesForGrade, getMaxDifficultyForGrade } from '../services/gradeFilter';
import type { Question, ErrorAnalysis } from '../types';

export type QuizScope = 'all' | 'weak' | 'unstudied';

export interface QuizFilters {
  category?: string;
  subcategory?: string; // サブカテゴリで更に絞り込み
  subtopic?: string; // 小分類で更に絞り込み (ツリーマップ起点)
  scope?: QuizScope; // 'weak'=苦手のみ, 'unstudied'=未着手のみ, 'all'=全問
  year?: number;
  gradeLimit?: number; // 学年に応じた出題範囲制限
  sourceFilter?: 'official' | 'mock' | 'all'; // 過去問 / 模擬試験 / すべて
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
  fillInBlank: { text: string; answer: string; hasBlank: boolean } | null;
  confirmationMode: boolean; // レベル6
  // AI類題: 生成して次の問題として挿入するフローの状態
  similarStatus: 'idle' | 'loading' | 'added' | 'error';
}

/**
 * 問題に対するメモリアステップの表示状態（純関数 computePresentation に委譲。
 * レベル5で穴が作れない問題は確認モードへ自動フォールバックする）
 */
const computeMemoriaState = computePresentation;

export function useQuiz() {
  const { state: appState, triggerSync } = useApp();
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
    similarStatus: 'idle',
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

    // プロフィールの学科でフィルタ（必須）
    const profileDept = appState.profile?.department;

    // curriculum を事前ロード（matchesFilter で同期使用するため）
    let gradeCategoriesCache: string[] | null = null;
    let gradeDifficultyCache: number | null = null;
    if (filters?.gradeLimit && profileDept) {
      gradeCategoriesCache = await getCategoriesForGrade(filters.gradeLimit, profileDept);
      gradeDifficultyCache = await getMaxDifficultyForGrade(filters.gradeLimit, profileDept);
    }

    // フィルター条件に合致するかチェック
    const matchesFilter = (q: Question): boolean => {
      if (!hasValidChoices(q)) return false; // 選択肢が画像のみの問題を除外
      if (profileDept && q.department !== profileDept) return false; // 学科フィルタ
      if (filters?.category && q.category !== filters.category) return false;
      if (filters?.subcategory) {
        // GAS 側で '未分類' に正規化された値も許容
        const subNorm = q.subcategory && q.subcategory !== '' ? q.subcategory : '未分類';
        if (subNorm !== filters.subcategory) return false;
      }
      if (filters?.subtopic) {
        const topNorm = q.subtopic && q.subtopic !== '' ? q.subtopic : '未分類';
        if (topNorm !== filters.subtopic) return false;
      }
      if (filters?.year && q.exam_year !== filters.year) return false;
      // sourceFilter: 過去問 / 模擬試験 フィルター
      if (filters?.sourceFilter && filters.sourceFilter !== 'all') {
        const isMock = typeof q.exam_year === 'string' && q.exam_year.startsWith('mock_');
        if (filters.sourceFilter === 'official' && isMock) return false;
        if (filters.sourceFilter === 'mock' && !isMock) return false;
      }
      // 学年別カリキュラムフィルター（事前ロード済みキャッシュを同期で使用）
      if (filters?.gradeLimit) {
        if (gradeCategoriesCache !== null && !gradeCategoriesCache.includes(q.category)) return false;
        if (gradeDifficultyCache !== null && q.difficulty > gradeDifficultyCache) return false;
      }
      return true;
    };

    // 復習予定の問題を優先取得（期限判定はJST日付基準）
    const today = localDateString();
    const reviewCards = await db.cardStates
      .where('nextReview')
      .belowOrEqual(today)
      .toArray();

    let questions: Question[] = [];

    if (reviewCards.length > 0) {
      // 優先度スコア降順で復習カードを並べ、苦戦カード（期限超過・高hintLevel・低EF）を先に出す
      const reviewIds = rankReviewCards(reviewCards, today).map((c) => c.questionId);
      const reviewQuestions = await db.questionCache
        .where('question_id')
        .anyOf(reviewIds)
        .toArray();
      const qById = new Map(reviewQuestions.map((q) => [q.question_id, q] as const));
      questions = reviewIds
        .map((id) => qById.get(id))
        .filter((q): q is Question => !!q && matchesFilter(q))
        .slice(0, limit);
    }

    // 復習問題が足りない場合、新規問題を追加（1セッションの新規はNEW_PER_SESSIONで上限＝復習負荷の雪だるま防止）
    if (questions.length < limit) {
      const studiedIds = new Set(
        (await db.cardStates.toArray()).map((c) => c.questionId)
      );
      const newQuestions = (await db.questionCache.toArray())
        .filter((q) => !studiedIds.has(q.question_id))
        .filter((q) => q.correct_answer.length > 0) // 正解のある問題のみ
        .filter(matchesFilter);

      const needed = Math.min(limit - questions.length, NEW_PER_SESSION);
      questions = [
        ...questions,
        ...shuffleArray(newQuestions).slice(0, needed),
      ];
    }

    // scope 別選抜 (ツリーマップ起点/時間帯セッション用)
    // weak/unstudied は「確定20問への後段フィルタ」ではなく card_states/questionCache の
    // プールから直接構築する（苦手が数問に痩せる・期限カードで枠が埋まる問題を回避）。
    // 弱点判定は card_states ベース（isWeakCard）なので Supabase 復元だけで端末を跨いで成立する。
    // 0問時は scope='all'（既定選抜）へフォールバック。
    if (filters?.scope === 'unstudied') {
      const studiedIds = new Set(
        (await db.cardStates.toArray()).map((c) => c.questionId)
      );
      const pool = (await db.questionCache.toArray())
        .filter((q) => !studiedIds.has(q.question_id))
        .filter((q) => q.correct_answer.length > 0)
        .filter(matchesFilter);
      if (pool.length > 0) {
        questions = shuffleArray(pool).slice(0, limit);
      } else {
        console.log('[Quiz] scope=unstudied で対象なし → scope=all にフォールバック');
      }
    } else if (filters?.scope === 'weak') {
      const weakCards = rankReviewCards(
        (await db.cardStates.toArray()).filter(isWeakCard),
        today
      );
      const qById = new Map(
        (await db.questionCache.toArray()).map((q) => [q.question_id, q] as const)
      );
      const pool = weakCards
        .map((c) => qById.get(c.questionId))
        .filter((q): q is Question => !!q && matchesFilter(q));
      if (pool.length > 0) {
        questions = pool.slice(0, limit);
      } else {
        console.log('[Quiz] scope=weak で対象なし → scope=all にフォールバック');
      }
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
      similarStatus: 'idle',
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

    // GEN- はAI生成類題（一時問題）: SM-2カードは作らず回答ログのみ記録する
    const isGenerated = current.question_id.startsWith('GEN-');
    let answeredAtFillIn = false;

    try {
      // SM-2 × メモリアステップの合成（applyAnswer に集約・純関数でテスト済み）
      const existingCard = isGenerated ? undefined : await db.cardStates.get(current.question_id);
      const card = existingCard || createCardState(current.question_id);
      answeredAtFillIn = card.hintLevel === 5;
      if (!isGenerated) {
        const memoriaCard = applyAnswer(card, isCorrect, responseTimeMs);
        await db.cardStates.put(memoriaCard);
      }

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

    // AI分析の発動条件: hintLevel >= 3 の誤答時（メモリアステップ対応）。
    // 穴埋め（レベル5）の誤答は selectedAnswer が実選択肢でなく分析品質が出ないためスキップ。
    const currentCard = await db.cardStates.get(current.question_id);
    const currentHintLevel = currentCard?.hintLevel ?? 0;
    const shouldAnalyze =
      !isCorrect && !answeredAtFillIn && !isGenerated && currentHintLevel >= 3;

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

    // AI分析を非同期で実行（同一問題×同一誤答は aiCache から再利用しAPI呼び出しを節約）
    if (shouldAnalyze) {
      const answerKey = [...finalAnswers].sort().join(',');
      try {
        const cached = await db.aiCache
          .where('[questionId+selectedAnswer]')
          .equals([current.question_id, answerKey])
          .first();
        if (cached) {
          setState((s) => ({
            ...s,
            aiAnalysis: {
              error_type: cached.errorType as ErrorAnalysis['error_type'],
              cheer: '',
              analysis: cached.analysis,
              key_concept: cached.keyConcept,
              study_hint: cached.studyHint,
            },
            aiLoading: false,
          }));
          return;
        }
      } catch (cacheErr) {
        console.warn('[confirmAnswer] aiCache read error:', cacheErr);
      }
      try {
        const res = await apiAnalyzeError({
          questionId: current.question_id,
          studentAnswer: finalAnswers,
          correctAnswer: current.correct_answer,
          questionText: current.question_text,
          choices: current.choices,
          department: appState.profile?.department,
          studyHour: new Date().getHours(),
        });
        if (res.success && res.data) {
          const data = res.data as ErrorAnalysis;
          setState((s) => ({
            ...s,
            aiAnalysis: data,
            aiLoading: false,
          }));
          try {
            await db.aiCache.add({
              questionId: current.question_id,
              selectedAnswer: answerKey,
              errorType: data.error_type,
              analysis: data.analysis,
              keyConcept: data.key_concept,
              studyHint: data.study_hint,
              createdAt: new Date().toISOString(),
            });
          } catch (cacheErr) {
            console.warn('[confirmAnswer] aiCache write error:', cacheErr);
          }
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
          const result = await updateGamification(
            profile.studentId,
            false, false, 0,
            {
              correct: s.sessionStats.correct,
              total: s.sessionStats.total,
              consecutiveCorrect: sessionMaxConsecutiveRef.current,
              fastCorrect: sessionFastCorrectRef.current,
            }
          );
          if (result.stageUp) {
            console.log('🎉 キャラクターが進化した！');
          }
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
      similarStatus: 'idle',
      ...memoriaState,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerSync]);

  /**
   * AI分析結果から類題を生成し、セッションの次の問題として挿入する。
   * 生成済み3題到達時はGAS側キャッシュからランダムに1問使う（API消費なし）。
   * GEN- 問題はSM-2カードを作らないため、間隔反復のスケジュールは汚さない。
   */
  const challengeSimilar = useCallback(async () => {
    const s = stateRef.current;
    const current = s.questions[s.currentIndex];
    if (!current || !s.aiAnalysis || s.similarStatus === 'loading') return;
    if (current.question_id.startsWith('GEN-')) return; // 類題からの再生成はしない

    setState((st) => ({ ...st, similarStatus: 'loading' }));
    try {
      const res = await apiGenerateSimilar({
        questionId: current.question_id,
        errorType: s.aiAnalysis.error_type,
        originalQuestion: current.question_text,
        analysis: s.aiAnalysis.analysis,
        department: appState.profile?.department,
      });
      const gen = res.success ? normalizeGeneratedResponse(res.data) : null;
      if (!gen) {
        setState((st) => ({ ...st, similarStatus: 'error' }));
        return;
      }
      const genQuestion = generatedToQuestion(gen, current);
      setState((st) => {
        if (st.questions.some((q) => q.question_id === genQuestion.question_id)) {
          return { ...st, similarStatus: 'added' }; // 同一類題の重複挿入は防ぐ
        }
        const questions = [...st.questions];
        questions.splice(st.currentIndex + 1, 0, genQuestion);
        return { ...st, questions, similarStatus: 'added' };
      });
    } catch (err) {
      console.error('[challengeSimilar] 類題生成エラー:', err);
      setState((st) => ({ ...st, similarStatus: 'error' }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // レベル6の確認モード用ハンドラ
  const handleConfirmation = useCallback(async (understood: boolean) => {
    const { questions, currentIndex } = stateRef.current;
    const current = questions[currentIndex];
    if (!current) return;

    try {
      const existingCard = await db.cardStates.get(current.question_id);
      const card = existingCard || createCardState(current.question_id);
      // 「理解できた」は満額進行させず短期再出題に固定（confirmUnderstanding）
      await db.cardStates.put(confirmUnderstanding(card, understood));
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
    challengeSimilar,
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
