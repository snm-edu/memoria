import type { CardState } from '../../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/** Supabase上のcard_states行（pull_card_states / push_card_states のペイロード） */
export interface CardStateRow {
  question_id: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review: string;
  last_review: string | null;
  hint_level: number;
  consecutive_correct_at_zero: number;
  updated_at?: string;
}

/** resolve_token の戻り値 */
export interface ResolvedStudent {
  student_id: string;
  student_number: string;
  student_name: string;
  department: string;
  grade: number;
  student_type: string;
}

export function rowToCardState(row: CardStateRow): CardState {
  return {
    questionId: row.question_id,
    easeFactor: row.ease_factor,
    interval: row.interval_days,
    repetitions: row.repetitions,
    nextReview: row.next_review,
    lastReview: row.last_review ?? '',
    hintLevel: row.hint_level,
    consecutiveCorrectAtZero: row.consecutive_correct_at_zero,
  };
}

export function cardStateToRow(card: CardState): CardStateRow {
  return {
    question_id: card.questionId,
    ease_factor: card.easeFactor,
    interval_days: card.interval,
    repetitions: card.repetitions,
    next_review: card.nextReview,
    last_review: card.lastReview || null,
    hint_level: card.hintLevel,
    consecutive_correct_at_zero: card.consecutiveCorrectAtZero,
  };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** PostgREST RPC 呼び出し共通部 */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`Supabase RPC ${fn} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** トークン→学生情報。無効トークンなら null */
export async function resolveToken(token: string): Promise<ResolvedStudent | null> {
  const rows = await rpc<ResolvedStudent[]>('resolve_token', { p_token: token });
  return rows.length > 0 ? rows[0]! : null;
}

/** クラウドの全カード状態を取得 */
export async function pullCardStates(token: string): Promise<CardState[]> {
  const rows = await rpc<CardStateRow[]>('pull_card_states', { p_token: token });
  return rows.map(rowToCardState);
}

/** ローカルの全カード状態をアップロード。返り値は更新行数 */
export async function pushCardStates(token: string, cards: CardState[]): Promise<number> {
  if (cards.length === 0) return 0;
  return rpc<number>('push_card_states', {
    p_token: token,
    p_cards: cards.map(cardStateToRow),
  });
}
