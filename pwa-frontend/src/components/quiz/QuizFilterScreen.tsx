import { useState, useEffect } from 'react';
import { db } from '../../services/db';
import { useApp } from '../../context/AppContext';

export interface QuizFilters {
  category?: string;
  year?: number;
  sourceFilter?: 'official' | 'mock' | 'all'; // 過去問 / 模擬試験 / すべて
}

interface Props {
  onStart: (filters: QuizFilters) => void;
  onCancel: () => void;
}

export function QuizFilterScreen({ onStart, onCancel }: Props) {
  const { state: appState } = useApp();
  const profileDept = appState.profile?.department;
  const [categories, setCategories] = useState<string[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedSource, setSelectedSource] = useState<'official' | 'mock' | 'all'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadFilterOptions() {
      try {
        const allQuestions = await db.questionCache.toArray();
        // プロフィールの学科でフィルタ
        const questions = profileDept
          ? allQuestions.filter((q) => q.department === profileDept)
          : allQuestions;

        // ユニークなカテゴリを抽出（空文字を除外）
        const uniqueCategories = [
          ...new Set(questions.map((q) => q.category).filter(Boolean)),
        ].sort();

        // ユニークな年度を抽出（number型かつ0より大きいもののみ。模擬試験の "mock_YYYY" は除外）
        const uniqueYears = [
          ...new Set(
            questions
              .map((q) => q.exam_year)
              .filter((y): y is number => typeof y === 'number' && y > 0)
          ),
        ].sort((a, b) => b - a); // 新しい年度が先

        setCategories(uniqueCategories);
        setYears(uniqueYears);
      } catch (err) {
        console.error('フィルターオプション読み込みエラー:', err);
      } finally {
        setLoading(false);
      }
    }

    void loadFilterOptions();
  }, []);

  const handleStart = () => {
    const filters: QuizFilters = {};
    if (selectedCategory) {
      filters.category = selectedCategory;
    }
    if (selectedYear) {
      filters.year = selectedYear;
    }
    if (selectedSource !== 'all') {
      filters.sourceFilter = selectedSource;
    }
    onStart(filters);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-400">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col p-4 pb-6">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onCancel} className="text-slate-400">
          ← 戻る
        </button>
        <h1 className="text-lg font-bold">クイズ設定</h1>
      </div>

      {/* 問題数 */}
      <div className="card mb-4 text-center">
        <p className="text-sm text-slate-400">出題数</p>
        <p className="text-3xl font-bold text-primary-500">20問</p>
      </div>

      {/* 分野フィルター */}
      <div className="mb-6">
        <h2 className="text-sm font-bold text-slate-500 mb-2">分野</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
              selectedCategory === null
                ? 'bg-primary-500 text-white'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            全分野
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() =>
                setSelectedCategory(selectedCategory === cat ? null : cat)
              }
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                selectedCategory === cat
                  ? 'bg-primary-500 text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* 年度フィルター */}
      <div className="mb-6">
        <h2 className="text-sm font-bold text-slate-500 mb-2">年度</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedYear(null)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
              selectedYear === null
                ? 'bg-primary-500 text-white'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            全年度
          </button>
          {years.map((year) => (
            <button
              key={year}
              onClick={() =>
                setSelectedYear(selectedYear === year ? null : year)
              }
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                selectedYear === year
                  ? 'bg-primary-500 text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {year}年
            </button>
          ))}
        </div>
      </div>

      {/* 問題種別フィルター */}
      <div className="mb-6">
        <h2 className="text-sm font-bold text-slate-500 mb-2">問題種別</h2>
        <div className="flex gap-2">
          {(
            [
              { value: 'all', label: 'すべて' },
              { value: 'official', label: '過去問のみ' },
              { value: 'mock', label: '模擬試験のみ' },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setSelectedSource(value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                selectedSource === value
                  ? 'bg-primary-500 text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* スペーサー */}
      <div className="flex-1" />

      {/* クイズ開始ボタン */}
      <button onClick={handleStart} className="btn-primary w-full text-lg py-3">
        クイズ開始
      </button>
    </div>
  );
}
