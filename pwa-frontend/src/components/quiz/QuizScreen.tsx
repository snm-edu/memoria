import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQuiz } from '../../hooks/useQuiz';
import type { QuizFilters } from '../../hooks/useQuiz';
import { useApp } from '../../context/AppContext';
import { useBgm } from '../../hooks/useBgm';
import { AnalysisCard } from '../ai/AnalysisCard';
import { QuizFilterScreen } from './QuizFilterScreen';
import { highlightKeywords } from '../../services/memoriaStep';
import type { BgmTrack } from '../../services/bgm';
import { sfx } from '../../services/sfx';
import DOMPurify from 'dompurify';

// 通常テキスト用（選択肢・解説など）: style 属性を禁止して CSS Injection リスクを排除
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['sub', 'sup', 'br', 'strong', 'span'],
  ALLOWED_ATTR: [],
} satisfies Parameters<typeof DOMPurify.sanitize>[1];

// 強調・穴埋め用（highlightKeywords / fillInBlank）: style 属性を許可
// DOMPurify は expression() / javascript: 等の危険な CSS 値を自動除去する
const SANITIZE_CONFIG_HIGHLIGHT = {
  ALLOWED_TAGS: ['sub', 'sup', 'br', 'strong', 'span'],
  ALLOWED_ATTR: ['style'],
} satisfies Parameters<typeof DOMPurify.sanitize>[1];

/** 安全なHTMLタグのみレンダリング（DOMPurify によるサニタイズ）
 *  allowStyle: highlightKeywords や fillInBlank の style 属性が必要な箇所のみ true */
function SafeHtml({ text, className, allowStyle }: { text: string; className?: string; allowStyle?: boolean }) {
  const clean = DOMPurify.sanitize(text, allowStyle ? SANITIZE_CONFIG_HIGHLIGHT : SANITIZE_CONFIG);
  return <span className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}

/** メモリアステップのレベルバッジカラー */
function getStepColor(level: number): string {
  if (level <= 1) return 'bg-blue-100 text-blue-700';
  if (level <= 2) return 'bg-orange-100 text-orange-700';
  if (level <= 3) return 'bg-amber-100 text-amber-700';
  if (level <= 4) return 'bg-red-100 text-red-700';
  if (level <= 5) return 'bg-purple-100 text-purple-700';
  return 'bg-slate-100 text-slate-700';
}

/** メモリアステップのプログレスバー色 */
function getStepBarColor(level: number): string {
  if (level <= 1) return 'bg-blue-400';
  if (level <= 2) return 'bg-orange-400';
  if (level <= 3) return 'bg-amber-400';
  if (level <= 4) return 'bg-red-400';
  if (level <= 5) return 'bg-purple-400';
  return 'bg-slate-400';
}

export function QuizScreen() {
  const { state, dispatch } = useApp();
  const quiz = useQuiz();
  const { isMuted, toggleMute, play } = useBgm();
  // graded モードまたはカテゴリ指定ではフィルター画面をスキップ
  const isGraded = state.quizMode === 'graded';
  const hasCategory = !!state.quizCategory;
  const [showFilter, setShowFilter] = useState(!isGraded && !hasCategory);
  const gradedStarted = useRef(false);
  const categoryStarted = useRef(false);

  // レベル5穴埋め用の入力状態
  const [fillInAnswer, setFillInAnswer] = useState('');
  const [fillInSubmitted, setFillInSubmitted] = useState(false);
  const [fillInCorrect, setFillInCorrect] = useState<boolean | null>(null);

  // 問題が変わったら穴埋め状態をリセット
  useEffect(() => {
    setFillInAnswer('');
    setFillInSubmitted(false);
    setFillInCorrect(null);
  }, [quiz.currentIndex]);

  // BGM: ヒントレベルに応じてトラック切り替え
  const bgmTrack: BgmTrack = useMemo(() => {
    if (quiz.isFinished) return 'finish';
    if (quiz.isLoading || showFilter) return 'home'; // フィルター中はホーム曲を維持
    const hl = quiz.hintLevel;
    if (hl <= 2) return 'quiz1';
    if (hl <= 4) return 'quiz2';
    return 'quiz3'; // レベル5-6
  }, [quiz.isFinished, quiz.isLoading, quiz.hintLevel, showFilter]);

  useEffect(() => {
    play(bgmTrack);
  }, [bgmTrack, play]);

  // 回答確定時の効果音: showFeedback が false→true に変化した瞬間に鳴らす
  const prevShowFeedbackRef = useRef(false);
  useEffect(() => {
    if (quiz.showFeedback && !prevShowFeedbackRef.current && quiz.isCorrect !== null) {
      sfx.play(quiz.isCorrect ? 'correct' : 'incorrect');
    }
    prevShowFeedbackRef.current = quiz.showFeedback;
  }, [quiz.showFeedback, quiz.isCorrect]);

  // graded モード: 学年制限付きで自動開始
  useEffect(() => {
    if (isGraded && !gradedStarted.current && state.profile) {
      gradedStarted.current = true;
      void quiz.startSession(20, { gradeLimit: state.profile.grade });
    }
  }, [isGraded, state.profile, quiz.startSession]);

  // カテゴリ指定モード: 苦手分野から直接開始
  useEffect(() => {
    if (hasCategory && !categoryStarted.current) {
      categoryStarted.current = true;
      const filters: QuizFilters = { category: state.quizCategory };
      if (state.quizSubcategory) {
        filters.subcategory = state.quizSubcategory;
      }
      void quiz.startSession(20, filters);
      // カテゴリ指定をクリア（次回は通常モードに戻す）
      dispatch({ type: 'START_CATEGORY_QUIZ', category: '' });
    }
  }, [hasCategory, state.quizCategory, state.quizSubcategory, quiz.startSession, dispatch]);

  const handleFilterStart = useCallback(
    (filters: QuizFilters) => {
      setShowFilter(false);
      void quiz.startSession(20, filters);
    },
    [quiz.startSession]
  );

  const handleFilterCancel = useCallback(() => {
    dispatch({ type: 'SET_SCREEN', screen: 'home' });
  }, [dispatch]);

  // 穴埋め回答の確認ハンドラ
  const handleFillInSubmit = useCallback(() => {
    if (!quiz.fillInBlank || fillInSubmitted) return;
    // 正答判定: 正規化して比較（スペース・全角半角を吸収）
    const normalize = (s: string) => s.trim().replace(/\s+/g, '').toLowerCase();
    const correct = normalize(fillInAnswer) === normalize(quiz.fillInBlank.answer);
    setFillInSubmitted(true);
    setFillInCorrect(correct);
    // SM-2の更新のため通常のconfirmAnswerを呼ぶ
    // 正答ラベルを渡す（穴埋めで正解 → 正答扱い、不正解 → 不正答扱い）
    if (correct) {
      // 正答ラベルを渡して正解判定
      void quiz.confirmAnswer(quiz.currentQuestion?.correct_answer);
    } else {
      // 不正解: 存在しないラベルを渡して不正解判定
      void quiz.confirmAnswer(['__WRONG__']);
    }
  }, [quiz, fillInAnswer, fillInSubmitted]);

  // free モード: フィルター画面を表示
  if (showFilter && !isGraded) {
    return (
      <QuizFilterScreen onStart={handleFilterStart} onCancel={handleFilterCancel} />
    );
  }

  if (quiz.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-400">問題を読み込み中...</p>
      </div>
    );
  }

  if (quiz.isFinished) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        <div className="card w-full max-w-md text-center">
          <div className="flex justify-end mb-2">
            <button
              onClick={toggleMute}
              className="text-slate-400 text-sm"
              title={isMuted ? 'BGMオン' : 'BGMオフ'}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
          </div>
          <h2 className="text-2xl font-bold mb-4">🏆 セッション完了</h2>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <p className="text-slate-400 text-sm">正答数</p>
              <p className="text-3xl font-bold text-green-500">
                {quiz.sessionStats.correct}
              </p>
            </div>
            <div>
              <p className="text-slate-400 text-sm">問題数</p>
              <p className="text-3xl font-bold">{quiz.sessionStats.total}</p>
            </div>
          </div>
          <p className="text-lg font-bold mb-6">
            正答率:{' '}
            {quiz.sessionStats.total > 0
              ? Math.round(
                  (quiz.sessionStats.correct / quiz.sessionStats.total) * 100
                )
              : 0}
            %
          </p>
          <div className="space-y-3">
            <button
              onClick={() => setShowFilter(true)}
              className="btn-primary w-full"
            >
              もう一度
            </button>
            <button
              onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
              className="btn-secondary w-full"
            >
              ホームに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!quiz.currentQuestion) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card text-center">
          <p className="text-slate-500 mb-4">
            問題がありません。問題データを読み込んでください。
          </p>
          <button
            onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
            className="btn-secondary"
          >
            ホームに戻る
          </button>
        </div>
      </div>
    );
  }

  const q = quiz.currentQuestion;
  const isMultiSelect = q.is_multi_select;
  const hintLevel = quiz.hintLevel;

  // レベル3: キーワード強調テキスト
  const displayQuestionText = hintLevel === 3
    ? highlightKeywords(q.question_text)
    : q.question_text;

  return (
    <div className="min-h-screen flex flex-col p-4 pb-6">
      {/* プログレス */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
          className="text-slate-400 text-sm"
        >
          ✕
        </button>
        <div className="flex-1 bg-slate-200 rounded-full h-2">
          <div
            className="bg-primary-500 h-2 rounded-full transition-all"
            style={{
              width: `${((quiz.currentIndex + 1) / quiz.questions.length) * 100}%`,
            }}
          />
        </div>
        <span className="text-sm text-slate-400">
          {quiz.currentIndex + 1}/{quiz.questions.length}
        </span>
        <button
          onClick={toggleMute}
          className="text-slate-400 text-sm"
          title={isMuted ? 'BGMオン' : 'BGMオフ'}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>

      {/* メモリアステップ インジケーター */}
      {hintLevel > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${getStepColor(hintLevel)}`}>
            ステップ {hintLevel}/6
          </span>
          <div className="flex-1 bg-slate-100 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${getStepBarColor(hintLevel)}`}
              style={{ width: `${(hintLevel / 6) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* レベル1: カテゴリヒント */}
      {hintLevel === 1 && (
        <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-700">
            {'\u{1F4A1}'} {q.category}に関する問題です
          </p>
        </div>
      )}

      {/* レベル2: 誤答排除バッジ */}
      {hintLevel === 2 && !q.is_multi_select && (
        <div className="mb-3 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg">
          <p className="text-sm text-orange-700">
            選択肢が1つ排除されました
          </p>
        </div>
      )}

      {/* レベル4: 二択化バッジ */}
      {hintLevel === 4 && !q.is_multi_select && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">
            2択まで絞り込みました
          </p>
        </div>
      )}

      {/* 問題情報 */}
      <div className="flex items-center gap-2 mb-2 text-xs text-slate-400">
        <span>{q.exam_year}年</span>
        <span>·</span>
        <span className="truncate">{q.category}</span>
        {q.has_image && (
          <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
            図あり
          </span>
        )}
      </div>

      {/* 問題文 */}
      <div className="card mb-4 flex-shrink-0">
        <SafeHtml
          text={displayQuestionText}
          className="text-base leading-relaxed whitespace-pre-wrap block"
          allowStyle
        />
        {isMultiSelect && (
          <p className="text-sm text-primary-500 font-bold mt-2">
            ※ 2つ選んでください
          </p>
        )}
        {/* 問題画像（複数画像はセミコロン区切り） */}
        {q.has_image && q.image_url && (
          <div className="mt-3 space-y-2">
            {q.image_url.split(';').map((url, idx) => (
              <img
                key={idx}
                src={`${import.meta.env.BASE_URL}${url.trim()}`}
                alt={idx === 0 ? '問題の図' : `問題の図${idx + 1}`}
                className="w-full rounded-lg border border-slate-200"
                loading="lazy"
              />
            ))}
          </div>
        )}
      </div>

      {/* レベル6: 確認モード */}
      {quiz.confirmationMode && (
        <div className="flex-1 space-y-4">
          {/* 正答選択肢を緑背景で表示 */}
          <div className="space-y-2">
            {q.choices.map((choice, i) => {
              const label = quiz.visibleLabels[i] ?? String.fromCharCode(65 + i);
              const isCorrectChoice = q.correct_answer.includes(label);
              return (
                <div
                  key={label}
                  className={`w-full p-3 rounded-xl text-left flex items-start gap-3 border-2 ${
                    isCorrectChoice
                      ? 'bg-green-50 border-green-300'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                      isCorrectChoice
                        ? 'bg-green-500 text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {label}
                  </span>
                  <SafeHtml text={choice} className="text-sm leading-relaxed pt-0.5" />
                </div>
              );
            })}
          </div>

          {/* 解説を最初から表示 */}
          {q.explanation && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-xs font-bold text-slate-500 mb-1">解説</p>
              <SafeHtml
                text={q.explanation}
                className="text-sm text-slate-600 block"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                ※解説は生成AIの回答なので必ずしも正しいとは限りません。他情報も確認するようにしてください。
              </p>
            </div>
          )}

          {/* 理解度ボタン */}
          <div className="space-y-2">
            <button
              onClick={() => quiz.handleConfirmation(true)}
              className="w-full p-3 rounded-xl bg-green-500 text-white font-bold text-center hover:bg-green-600 transition-colors"
            >
              {'\u2705'} 理解できた
            </button>
            <button
              onClick={() => quiz.handleConfirmation(false)}
              className="w-full p-3 rounded-xl bg-slate-200 text-slate-700 font-bold text-center hover:bg-slate-300 transition-colors"
            >
              {'\u{1F504}'} まだ不安
            </button>
          </div>
        </div>
      )}

      {/* レベル5: 穴埋め変換 */}
      {hintLevel === 5 && quiz.fillInBlank && !quiz.confirmationMode && (
        <div className="flex-1 space-y-4">
          <div className="card bg-purple-50 border border-purple-200">
            <p className="text-xs font-bold text-purple-600 mb-2">穴埋め問題</p>
            <SafeHtml
              text={quiz.fillInBlank.text.replace(
                /\[ __ \]/g,
                '<span style="background-color: #fef08a; padding: 2px 12px; border-radius: 4px; font-weight: bold;">____</span>'
              )}
              className="text-sm leading-relaxed block"
              allowStyle
            />
          </div>

          {!fillInSubmitted ? (
            <div className="space-y-3">
              <input
                type="text"
                value={fillInAnswer}
                onChange={(e) => setFillInAnswer(e.target.value)}
                placeholder="回答を入力してください"
                className="w-full p-3 rounded-xl border-2 border-slate-200 focus:border-primary-500 focus:outline-none text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFillInSubmit();
                }}
              />
              <button
                onClick={handleFillInSubmit}
                disabled={fillInAnswer.trim().length === 0}
                className="btn-primary w-full"
              >
                回答する
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div
                className={`p-4 rounded-xl ${
                  fillInCorrect
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-red-50 border border-red-200'
                }`}
              >
                <p className="font-bold text-lg mb-1">
                  {fillInCorrect ? '\u2B55 正解！' : '\u274C 不正解'}
                </p>
                {!fillInCorrect && (
                  <p className="text-sm text-slate-600">
                    正答: <span className="font-bold text-green-600">{quiz.fillInBlank.answer}</span>
                  </p>
                )}
                <p className="text-sm text-slate-500 mt-1">
                  あなたの回答: <span className="font-bold">{fillInAnswer}</span>
                </p>
              </div>
              <button onClick={quiz.nextQuestion} className="btn-primary w-full">
                次の問題へ →
              </button>
            </div>
          )}
        </div>
      )}

      {/* 通常の選択肢 (レベル0〜4, レベル5以外かつ確認モード以外) */}
      {hintLevel !== 5 && !quiz.confirmationMode && (
        <>
          <div className="flex-1 space-y-2">
            {quiz.visibleChoices.map((choice, i) => {
              const label = quiz.visibleLabels[i] ?? String.fromCharCode(65 + i);
              const isSelected = quiz.selectedAnswers.includes(label);
              const isCorrectChoice = q.correct_answer.includes(label);

              let bgClass = 'bg-white border-2 border-slate-200';
              if (quiz.showFeedback) {
                if (isCorrectChoice) {
                  bgClass = 'bg-green-50 border-2 border-green-500';
                } else if (isSelected && !isCorrectChoice) {
                  bgClass = 'bg-red-50 border-2 border-red-400';
                }
              } else if (isSelected) {
                bgClass = 'bg-primary-50 border-2 border-primary-500';
              }

              return (
                <button
                  key={label}
                  onClick={() => {
                    if (!quiz.showFeedback) {
                      quiz.selectAnswer(label);
                      if (!isMultiSelect) {
                        // 単一選択は即回答確定（選択した回答を直接渡す）
                        setTimeout(() => quiz.confirmAnswer([label]), 200);
                      }
                    }
                  }}
                  disabled={quiz.showFeedback}
                  className={`w-full p-3 rounded-xl text-left flex items-start gap-3 transition-all ${bgClass}`}
                >
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                      isSelected && !quiz.showFeedback
                        ? 'bg-primary-500 text-white'
                        : quiz.showFeedback && isCorrectChoice
                        ? 'bg-green-500 text-white'
                        : quiz.showFeedback && isSelected
                        ? 'bg-red-400 text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {label}
                  </span>
                  <SafeHtml text={choice} className="text-sm leading-relaxed pt-0.5" />
                </button>
              );
            })}
          </div>

          {/* 複数選択時の回答ボタン */}
          {isMultiSelect && !quiz.showFeedback && (
            <button
              onClick={() => quiz.confirmAnswer()}
              disabled={quiz.selectedAnswers.length < 2}
              className="btn-primary w-full mt-4"
            >
              回答する ({quiz.selectedAnswers.length}/2)
            </button>
          )}

          {/* フィードバック */}
          {quiz.showFeedback && (
            <div className="mt-4 space-y-3">
              <div
                className={`p-4 rounded-xl ${
                  quiz.isCorrect
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-red-50 border border-red-200'
                }`}
              >
                <p className="font-bold text-lg mb-1">
                  {quiz.isCorrect ? '\u2B55 正解！' : '\u274C 不正解'}
                </p>
                {!quiz.isCorrect && (
                  <div className="text-sm text-slate-600 space-y-1">
                    <p>
                      あなたの回答: <span className="font-bold text-red-600">{quiz.selectedAnswers.join(', ')}</span>
                    </p>
                    <p>
                      正答: <span className="font-bold text-green-600">{q.correct_answer.join(', ')}</span>
                    </p>
                  </div>
                )}
                {q.explanation ? (
                  <>
                    <SafeHtml
                      text={q.explanation}
                      className="text-sm text-slate-600 mt-2 block"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      ※解説は生成AIの回答なので必ずしも正しいとは限りません。他情報も確認するようにしてください。
                    </p>
                  </>
                ) : (
                  !quiz.isCorrect && (
                    <p className="text-sm text-slate-500 mt-2">
                      正解の選択肢をよく確認し、なぜその答えが正しいのか考えてみましょう。
                    </p>
                  )
                )}
              </div>
              {/* AI分析ローディング */}
              {quiz.aiLoading && (
                <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-center">
                  <p className="text-sm text-blue-600 animate-pulse">
                    {'\u{1F916}'} AI が誤答を分析中...
                  </p>
                </div>
              )}

              {/* AI分析結果 */}
              {quiz.aiAnalysis && (
                <AnalysisCard
                  analysis={quiz.aiAnalysis}
                  onClose={() => {}}
                />
              )}

              {/* 連続誤答の警告 */}
              {!quiz.isCorrect && quiz.consecutiveErrors >= 2 && quiz.consecutiveErrors < 3 && (
                <p className="text-xs text-amber-600 text-center">
                  {'\u26A0\uFE0F'} この問題を{quiz.consecutiveErrors}回連続で間違えています。次に間違えるとAIが分析します。
                </p>
              )}

              <button onClick={quiz.nextQuestion} className="btn-primary w-full">
                次の問題へ →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
