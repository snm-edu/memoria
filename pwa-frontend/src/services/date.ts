/**
 * SM-2 の期日計算・期限判定で使う日付ユーティリティ。
 *
 * 学習者は日本国内で受験するため、日付境界は必ず JST（Asia/Tokyo）で判定する。
 * 従来は toISOString().split('T')[0]（＝UTC日付）を使っており、JSTでは朝9:00が
 * 日付境界になって「夜に学習した復習が翌朝のセッションで期限未到来になる」1日ずれが
 * 発生していた。日付文字列はすべてこのヘルパー経由で生成すること。
 */

/** Date の瞬間を JST の 'YYYY-MM-DD' 文字列にする（実行環境のTZに依存しない）。 */
export function localDateString(d: Date = new Date()): string {
  // 'sv-SE' ロケールは ISO 8601（YYYY-MM-DD）形式で日付を返す。
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

/** 指定日数を加算した瞬間を返す（UTCミリ秒加算・DST非依存）。 */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
