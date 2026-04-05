/**
 * 学年別カリキュラムに基づく出題範囲フィルター
 *
 * 札幌看護医療学院 2026年度教育課程表に基づき、
 * 各学年で学習済みの分野のみを出題する。
 */

/** 学年ごとに出題可能なカテゴリ */
const GRADE_CATEGORIES: Record<number, string[]> = {
  // 1年生: 解剖生理学、生化学、基礎看護学、疾病論(基礎)、必修問題(基礎)
  1: [
    '人体の構造と機能',
    '基礎看護学',
    '必修問題',
  ],

  // 2年生: 1年の内容 + 疾病論、成人・老年・小児・母性・精神看護学、在宅看護論
  2: [
    '人体の構造と機能',
    '疾病の成り立ちと回復の促進',
    '基礎看護学',
    '成人看護学',
    '老年看護学',
    '小児看護学',
    '母性看護学',
    '精神看護学',
    '在宅看護論',
    '在宅看護学',
    '地域・在宅看護論',
    '必修問題',
  ],

  // 3年生: 全分野（本番同等）
  3: [
    '人体の構造と機能',
    '疾病の成り立ちと回復の促進',
    '基礎看護学',
    '成人看護学',
    '老年看護学',
    '小児看護学',
    '母性看護学',
    '精神看護学',
    '在宅看護論',
    '在宅看護学',
    '地域・在宅看護論',
    '看護の統合と実践',
    '健康支援と社会保障制度',
    '必修問題',
  ],
};

/** 学年ごとの最大難易度 */
const GRADE_MAX_DIFFICULTY: Record<number, number> = {
  1: 3, // 基礎的な問題のみ
  2: 4, // 応用問題含む
  3: 5, // 本番レベル
};

/**
 * 指定学年で出題可能なカテゴリ一覧を返す
 */
export function getCategoriesForGrade(grade: number): string[] {
  return GRADE_CATEGORIES[grade] || GRADE_CATEGORIES[3]!;
}

/**
 * 指定学年の最大難易度を返す
 */
export function getMaxDifficultyForGrade(grade: number): number {
  return GRADE_MAX_DIFFICULTY[grade] || 5;
}

/**
 * 指定カテゴリが学年の出題範囲内かチェック
 */
export function isCategoryAvailableForGrade(category: string, grade: number): boolean {
  const categories = getCategoriesForGrade(grade);
  return categories.includes(category);
}
