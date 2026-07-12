import { describe, it, expect } from 'vitest';
import { localDateString, addDays } from './date';

describe('localDateString（JST日付文字列）', () => {
  it('UTC 23:30 は JST では翌日になる', () => {
    // 2026-07-11 23:30 UTC = 2026-07-12 08:30 JST
    expect(localDateString(new Date('2026-07-11T23:30:00Z'))).toBe('2026-07-12');
  });

  it('UTC 11:00（=JST 20:00）は同日', () => {
    expect(localDateString(new Date('2026-07-11T11:00:00Z'))).toBe('2026-07-11');
  });

  it('JST日付境界（UTC 14:59 → 15:00）で日付が切り替わる', () => {
    expect(localDateString(new Date('2026-07-11T14:59:00Z'))).toBe('2026-07-11'); // JST 23:59
    expect(localDateString(new Date('2026-07-11T15:00:00Z'))).toBe('2026-07-12'); // JST 00:00
  });
});

describe('addDays', () => {
  it('指定日数を加算した瞬間のJST日付を返す', () => {
    // base: 2026-07-11 00:00 UTC = 2026-07-11 09:00 JST
    const base = new Date('2026-07-11T00:00:00Z');
    expect(localDateString(addDays(base, 1))).toBe('2026-07-12');
    expect(localDateString(addDays(base, 6))).toBe('2026-07-17');
  });
});
