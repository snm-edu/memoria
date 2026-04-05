import { useState } from 'react';
import { db } from '../../services/db';
import { useApp } from '../../context/AppContext';
import { DEPARTMENTS, DEPARTMENT_LABELS, GRADES, type Department } from '../../types';

// 現在問題データが用意されている学科
const AVAILABLE_DEPARTMENTS: Department[] = ['nursing'];

export function SetupScreen() {
  const { dispatch } = useApp();
  const [department, setDepartment] = useState<Department | null>(null);
  const [grade, setGrade] = useState<number | null>(null);
  const [step, setStep] = useState<'dept' | 'grade' | 'confirm'>('dept');

  async function handleConfirm() {
    if (!department || !grade) return;

    const studentId = crypto.randomUUID();
    const profile = {
      studentId,
      department,
      grade,
      createdAt: new Date().toISOString(),
    };

    await db.profile.add(profile);
    dispatch({ type: 'SET_PROFILE', profile });
    dispatch({ type: 'SET_SCREEN', screen: 'home' });
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
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
              return (
                <button
                  key={dept}
                  onClick={() => { if (isAvailable) { setDepartment(dept); setStep('grade'); } }}
                  disabled={!isAvailable}
                  className={`w-full p-4 rounded-xl text-left font-medium transition-all relative
                    ${!isAvailable
                      ? 'bg-slate-100 border-2 border-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                      : department === dept
                        ? 'bg-primary-500 text-white shadow-lg'
                        : 'bg-white border-2 border-slate-200 active:border-primary-400'
                    }`}
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
            <div className="grid grid-cols-3 gap-3">
              {GRADES.map((g) => (
                <button
                  key={g}
                  onClick={() => { setGrade(g); setStep('confirm'); }}
                  className={`p-4 rounded-xl text-center font-bold text-xl transition-all
                    ${grade === g
                      ? 'bg-primary-500 text-white shadow-lg'
                      : 'bg-white border-2 border-slate-200 active:border-primary-400'
                    }`}
                >
                  {g}年
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep('dept')}
              className="w-full text-center text-slate-400 mt-4 py-2"
            >
              ← 学科選択に戻る
            </button>
          </div>
        )}

        {/* 確認 */}
        {step === 'confirm' && department && grade && (
          <div className="text-center space-y-6">
            <div className="card">
              <p className="text-slate-500 mb-1">学科</p>
              <p className="text-xl font-bold">{DEPARTMENT_LABELS[department]}</p>
              <p className="text-slate-500 mb-1 mt-4">学年</p>
              <p className="text-xl font-bold">{grade}年</p>
            </div>
            <p className="text-sm text-slate-400">
              端末に匿名IDが自動生成されます。<br />
              アカウント登録は不要です。
            </p>
            <button onClick={handleConfirm} className="btn-primary w-full">
              はじめる
            </button>
            <button
              onClick={() => setStep('grade')}
              className="w-full text-center text-slate-400 py-2"
            >
              ← 学年選択に戻る
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
