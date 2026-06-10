import { db } from '../db';
import { mergeCardStates } from './cardMerge';
import {
  isSupabaseConfigured,
  pullCardStates,
  pushCardStates,
  resolveToken,
  type ResolvedStudent,
} from './supabaseRpc';

const TOKEN_KEY = 'memoria-restart-token';

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** トークンを検証して学生情報を返す。無効・未設定なら null */
export async function resolveStudent(token: string): Promise<ResolvedStudent | null> {
  if (!isSupabaseConfigured()) return null;
  return resolveToken(token);
}

/**
 * クラウドからカード状態を復元してDexieへマージ保存する。
 * 返り値: マージ後にDexieへ書き込んだ件数
 */
export async function hydrateCardStates(token: string): Promise<number> {
  const cloud = await pullCardStates(token);
  if (cloud.length === 0) return 0;
  const local = await db.cardStates.toArray();
  const merged = mergeCardStates(local, cloud);
  await db.cardStates.bulkPut(merged);
  return merged.length;
}

/**
 * ローカルの全カード状態をクラウドへアップロードする。
 * トークン未保持・Supabase未設定なら何もしない（在校生はここで必ず抜ける）。
 */
export async function pushAllCardStates(): Promise<number> {
  const token = getToken();
  if (!token || !isSupabaseConfigured()) return 0;
  try {
    const local = await db.cardStates.toArray();
    return await pushCardStates(token, local);
  } catch (err) {
    console.error('[restartSync] push失敗:', err);
    return 0;
  }
}
