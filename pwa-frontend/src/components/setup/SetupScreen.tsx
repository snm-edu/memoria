import { useRef, useState } from 'react';
import { db } from '../../services/db';
import { useApp } from '../../context/AppContext';
import { DEPARTMENTS, DEPARTMENT_LABELS, GRADES, type Department, type StudentType, AVAILABLE_DEPARTMENTS, DEPT_STYLES } from '../../types';
import { validateEnrollment } from '../../services/api';

export function SetupScreen() {
  const { dispatch } = useApp();
  const [department, setDepartment] = useState<Department | null>(null);
  const [grade, setGrade] = useState<number | null>(null);
  const [studentType, setStudentType] = useState<StudentType | null>(null);
  const [studentNumber, setStudentNumber] = useState('');
  const [step, setStep] = useState<'dept' | 'grade' | 'studentNum' | 'confirm'>('dept');
  const [isValidating, setIsValidating] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  // 検証用の仮 studentId。確定時に profile.studentId として再利用する。
  const studentIdRef = useRef<string>(crypto.randomUUID());

  function selectEnrolled(g: number) {
    setGrade(g);
    setStudentType('enrolled');
    setStep('studentNum');
  }

  function selectProspective() {
    setGrade(0);
    setStudentType('prospective');
    setStep('studentNum');
  }

  function selectGraduate() {
    setGrade(3);
    setStudentType('graduate');
    setStep('studentNum');
  }

  async function handleStudentNumNext() {
    const num = studentNumber.trim();
    if (!num || !department || !studentType || isValidating) return;

    setErrorText(null);

    // 入学前はユーザー名なので検証不要
    if (studentType === 'prospective') {
      setStep('confirm');
      return;
    }

    setIsValidating(true);
    try {
      const res = await validateEnrollment({
        studentId: studentIdRef.current,
        studentNumber: num,
        department,
      });

      if (!res.success) {
        const errMsg = String(res.error || '');
        if (errMsg.indexOf('Unknown action') !== -1) {
          setErrorText('システムが最新ではありません。教員に連絡してください。');
        } else {
          setErrorText('通信に失敗しました。電波の良い場所で再度お試しください。');
        }
        return;
      }
      if (!res.data) {
        setErrorText('サーバーから応答がありませんでした。');
        return;
      }
      if (!res.data.valid) {
        if (res.data.reason === 'rate_limited') {
          setErrorText('試行回数が上限に達しました。明日またお試しください。');
        } else {
          setErrorText('この学籍番号は登録されていません。教員に確認してください。');
        }
        return;
      }

      // 区分の整合性チェック
      const serverType = res.data.studentType;
      if (studentType === 'graduate' && serverType !== 'graduate') {
        setErrorText('この学籍番号は卒業生として登録されていません。');
        return;
      }
      if (studentType === 'enrolled' && serverType !== 'enrolled') {
        setErrorText('この学籍番号は在校生として登録されていません。');
        return;
      }

      // 学年の整合性チェック（在校生のみ）
      if (studentType === 'enrolled' && res.data.grade && grade !== null && res.data.grade !== grade) {
        setErrorText(`この学籍番号は${res.data.grade}年として登録されています。学年選択をやり直してください。`);
        return;
      }

      // サーバー値を正として採用
      if (res.data.grade) setGrade(res.data.grade);
      setStep('confirm');
    } catch (err) {
      console.warn('[setup] validation error', err);
      setErrorText('エラーが発生しました。時間を置いて再度お試しください。');
    } finally {
      setIsValidating(false);
    }
  }

  async function handleConfirm() {
    if (!department || grade === null || !studentType || !studentNumber.trim()) return;

    const profile = {
      studentId: studentIdRef.current,
      studentNumber: studentNumber.trim(),
      department,
      grade,
      studentType,
      createdAt: new Date().toISOString(),
    };

    await db.profile.add(profile);
    dispatch({ type: 'SET_PROFILE', profile });
    dispatch({ type: 'SET_SCREEN', screen: 'home' });
  }

  const studentNumHint =
    studentType === 'prospective' ? 'ユーザー名（入学前学習コンテンツのご案内記載）を入力ください'
    : studentType === 'graduate'  ? '在校時の学籍番号を入力ください（学習履歴を引き継ぎます）'
    : '学習記録の管理に使用します。あとから変更もできます。';

  const studentNumPlaceholder =
    studentType === 'prospective' ? '例: P25-001'
    : studentType === 'graduate'  ? '例: 23N001'
    : '例: 25N001';

  const studentNumTitle =
    studentType === 'prospective' ? 'ユーザー名'
    : '学籍番号を入力';

  const typeLabel =
    studentType === 'prospective' ? '入学前'
    : studentType === 'graduate'  ? '卒業生'
    : grade !== null ? `${grade}年` : '';

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* ロゴ・タイトル */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold tracking-tight mb-2"
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #ec4899 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                fontFamily: '"Inter", "Helvetica Neue", sans-serif',
                letterSpacing: '-0.02em',
              }}>
            Memoria
          </h1>
          <p className="text-slate-500 text-sm">
            国家試験対策アダプティブラーニング
          </p>
        </div>

        {/* 学科選択 */}
        {step === 'dept' && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-center mb-4">学科を選択</h2>
            {DEPARTMENTS.map((dept) => {
              const isAvailable = AVAILABLE_DEPARTMENTS.includes(dept);
              const ds = DEPT_STYLES[dept];
              return (
                <button
                  key={dept}
                  onClick={() => { if (isAvailable) { setDepartment(dept); setStep('grade'); } }}
                  disabled={!isAvailable}
                  className={`w-full p-4 rounded-2xl text-center font-semibold transition-all relative
                    ${!isAvailable
                      ? 'bg-slate-100 border-2 border-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                      : 'border shadow-sm hover:shadow-md active:scale-[0.98]'
                    }`}
                  style={isAvailable ? {
                    background: ds.gradient,
                    borderColor: ds.border,
                    color: ds.color,
                  } : undefined}
                >
                  <span>{DEPARTMENT_LABELS[dept]}</span>
                  {!isAvailable && (
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs bg-amber-100 text-amber-600 px-2 py-1 rounded-full font-bold">
                      Coming Soon
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 学年選択 */}
        {step === 'grade' && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-center mb-4">学年を選択</h2>
            {/* 在校生（主） */}
            <div className="grid grid-cols-3 gap-3">
              {GRADES.map((g) => (
                <button
                  key={g}
                  onClick={() => selectEnrolled(g)}
                  className="p-4 rounded-xl text-center font-bold text-xl transition-all
                    bg-white border-2 border-slate-200 active:border-primary-400 shadow-sm
                    hover:shadow-md active:scale-[0.98]"
                >
                  {g}年
                </button>
              ))}
            </div>

            {/* 区切り */}
            <div className="flex items-center gap-3 pt-2 pb-1">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-xs text-slate-400">その他</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            {/* 入学前・卒業生（副） */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={selectProspective}
                className="p-3 rounded-xl text-center font-semibold text-sm transition-all
                  bg-slate-50 border border-slate-200 text-slate-600
                  active:border-slate-400 active:scale-[0.98]"
              >
                入学前
              </button>
              <button
                onClick={selectGraduate}
                className="p-3 rounded-xl text-center font-semibold text-sm transition-all
                  bg-slate-50 border border-slate-200 text-slate-600
                  active:border-slate-400 active:scale-[0.98]"
              >
                卒業生
              </button>
            </div>

            <button
              onClick={() => setStep('dept')}
              className="w-full text-center text-slate-400 mt-4 py-2"
            >
              ← 学科選択に戻る
            </button>
          </div>
        )}

        {/* 学籍番号入力 */}
        {step === 'studentNum' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-center mb-4">{studentNumTitle}</h2>
            <input
              type="text"
              value={studentNumber}
              onChange={(e) => { setStudentNumber(e.target.value); setErrorText(null); }}
              placeholder={studentNumPlaceholder}
              className="w-full p-4 rounded-xl border-2 border-slate-200 text-center text-xl font-bold
                focus:border-primary-400 focus:outline-none transition-all"
              autoFocus
            />
            <p className="text-xs text-slate-400 text-center">
              {studentNumHint}
            </p>
            {errorText && (
              <p className="text-xs text-red-600 text-center font-bold">{errorText}</p>
            )}
            <button
              onClick={handleStudentNumNext}
              disabled={!studentNumber.trim() || isValidating}
              className={`w-full p-4 rounded-xl font-bold text-lg transition-all
                ${studentNumber.trim() && !isValidating
                  ? 'bg-primary-500 text-white shadow-lg active:bg-primary-600'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
            >
              {isValidating ? '確認中...' : '次へ'}
            </button>
            <button
              onClick={() => setStep('grade')}
              className="w-full text-center text-slate-400 py-2"
            >
              ← 学年選択に戻る
            </button>
          </div>
        )}

        {/* 確認 */}
        {step === 'confirm' && department && studentType && studentNumber.trim() && (
          <div className="text-center space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <p className="text-slate-500 text-sm mb-1">学科</p>
              <p className="text-xl font-bold">{DEPARTMENT_LABELS[department]}</p>
              <p className="text-slate-500 text-sm mb-1 mt-4">区分</p>
              <p className="text-xl font-bold">{typeLabel}</p>
              <p className="text-slate-500 text-sm mb-1 mt-4">{studentNumTitle}</p>
              <p className="text-xl font-bold">{studentNumber.trim()}</p>
            </div>
            <p className="text-xs text-slate-400">
              これらの情報はあとから設定画面で変更できます。
            </p>
            <button onClick={handleConfirm} className="btn-primary w-full">
              はじめる
            </button>
            <button
              onClick={() => setStep('studentNum')}
              className="w-full text-center text-slate-400 py-2"
            >
              ← {studentNumTitle}入力に戻る
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
