import { useEffect } from 'react';
import { useQuiz } from '../../hooks/useQuiz';
import { useApp } from '../../context/AppContext';

const CHOICE_LABELS = ['A', 'B', 'C', 'D', 'E'];

/** 安全なHTMLタグのみレンダリング（sub, sup, br） */
function SafeHtml({ text, className }: { text: string; className?: string }) {
  const ALLOWED = /<\/?(sub|sup|br)\s*\/?>/gi;
  // 許可タグを一時退避 → 全体エスケープ → 復元
  const tokens: string[] = [];
  const escaped = text
    .replace(ALLOWED, (m) => {
      tokens.push(m);
      return `\x00${tokens.length - 1}\x00`;
    })
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\x00(\d+)\x00/g, (_, i) => tokens[Number(i)]!);
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: escaped }}
    />
  );
}

export function QuizScreen() {
  const { dispatch } = useApp();
  const quiz = useQuiz();

  useEffect(() => {
    quiz.startSession(20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <h2 className="text-2xl font-bold mb-4">セッション完了</h2>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <p className="text-slate-400 text-sm">正答���</p>
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
              onClick={() => quiz.startSession(20)}
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
            問題がありません。問題���ータ��読み込んでください。
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
      </div>

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
          text={q.question_text}
          className="text-base leading-relaxed whitespace-pre-wrap block"
        />
        {isMultiSelect && (
          <p className="text-sm text-primary-500 font-bold mt-2">
            ※ 2��選んでください
          </p>
        )}
      </div>

      {/* 選択肢 */}
      <div className="flex-1 space-y-2">
        {q.choices.map((choice, i) => {
          const label = CHOICE_LABELS[i]!;
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

      {/* ��数選択時���回��ボタン */}
      {isMultiSelect && !quiz.showFeedback && (
        <button
          onClick={quiz.confirmAnswer}
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
              {quiz.isCorrect ? '⭕ 正解！' : '❌ 不正解'}
            </p>
            {!quiz.isCorrect && (
              <p className="text-sm text-slate-600">
                正答: {q.correct_answer.join(', ')}
              </p>
            )}
            {q.explanation && (
              <SafeHtml
                text={q.explanation}
                className="text-sm text-slate-600 mt-2 block"
              />
            )}
          </div>
          <button onClick={quiz.nextQuestion} className="btn-primary w-full">
            次の問題へ →
          </button>
        </div>
      )}
    </div>
  );
}
