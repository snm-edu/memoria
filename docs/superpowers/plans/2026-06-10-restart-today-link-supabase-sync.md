# 既卒生リスタート: トークンリンク＋Supabase card_states 同期 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teams DMの個人トークン付きリンク（`https://memoria-flame.vercel.app/?t=<48桁hex>`）からPWAを開くと、どのブラウザ（Teams内蔵WebView含む）でも本人のSM-2学習状態が復元され、朝昼夜のセッションが始まる。回答後のカード状態はSupabaseへ自動同期される。

**Architecture:** Supabaseへのアクセスは PostgREST RPC（`resolve_token` / `pull_card_states` / `push_card_states`、`supabase/migrations/0001_restart_foundation.sql` で定義済み）を fetch で直接叩く（SDK追加なし）。IndexedDB（Dexie）は従来通りローカル一次ストアとして残し、クラウドは「復元元＋バックアップ先」。トークンは URL クエリ `?t=` で受け取り localStorage に保存、URLからは即座に除去する。トークンを持つのは既卒生のみなので、在校生の動作には一切影響しない。

**Tech Stack:** React 18 + Vite + TypeScript(strict) + Dexie。テストは Vitest（本タスクで導入、純関数のみ対象）。スタイルは Tailwind。

**前提（既存コードの事実）:**
- ルーターなし。画面は `AppContext` の `state.screen` switch（`App.tsx`）
- プロフィールは Dexie `profile` テーブル。`SetupScreen` が `crypto.randomUUID()` で `studentId` を生成
- SM-2状態は Dexie `cardStates`（PK: `questionId`）。`useQuiz` が回答時に `db.cardStates.put()`
- 既存クイズは `START_CATEGORY_QUIZ` アクション（category=''で全分野、scope: 'all'|'weak'|'unstudied'）で起動でき、期限到来の復習カードを優先する
- 環境変数は `import.meta.env.VITE_*` パターン（`services/api.ts` 参照）
- `npm run validate:types`（tsc --noEmit）と `npm run validate`（データ整合性）が既存チェック

**Dexieスキーマ変更: なし**（トークンはlocalStorage、カードは既存テーブルのまま。マイグレーション事故リスクをゼロにする）

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| Create: `pwa-frontend/src/services/restart/supabaseRpc.ts` | Supabase RPC fetchクライアント＋snake_case⇄camelCase変換 |
| Create: `pwa-frontend/src/services/restart/cardMerge.ts` | クラウド⇄ローカルのカードマージ純関数 |
| Create: `pwa-frontend/src/services/restart/restartSync.ts` | トークン保存・hydrate（pull+merge）・pushAll のオーケストレーション |
| Create: `pwa-frontend/src/components/today/TodayGate.tsx` | トークン入場フロー（解決→プロフィール自動作成→復元→セッション開始／エラー案内） |
| Modify: `pwa-frontend/src/App.tsx` | `?t=` 検出時に TodayGate を表示 |
| Modify: `pwa-frontend/src/context/AppContext.tsx` | `triggerSync` 内にカードpushを追加 |
| Create: `pwa-frontend/src/services/restart/cardMerge.test.ts` | マージ純関数のテスト |
| Create: `pwa-frontend/src/services/restart/supabaseRpc.test.ts` | 変換関数のテスト |
| Modify: `pwa-frontend/package.json` | vitest導入・testスクリプト |
| Modify: `supabase/migrations/0001_restart_foundation.sql` ＋ Supabase上で実行 | v_roster のURLを `/?t=` 形式へ |

---

### Task 1: Vitest 導入

**Files:**
- Modify: `pwa-frontend/package.json`

- [ ] **Step 1: vitest をインストール**

```bash
cd pwa-frontend && npm install --save-dev vitest
```

- [ ] **Step 2: package.json の scripts に test を追加**

```json
"test": "vitest run"
```

- [ ] **Step 3: 動作確認（テスト0件で正常終了すること）**

Run: `npm run test`
Expected: "No test files found" 系メッセージで終了（exit 0 にするため `vitest run --passWithNoTests` をscriptsに使う）

scripts の最終形:
```json
"test": "vitest run --passWithNoTests"
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: Vitest を導入（リスタート同期ロジックのテスト基盤）"
```

---

### Task 2: Supabase RPC クライアント

**Files:**
- Create: `pwa-frontend/src/services/restart/supabaseRpc.ts`
- Test: `pwa-frontend/src/services/restart/supabaseRpc.test.ts`

- [ ] **Step 1: 失敗するテストを書く（snake⇄camel変換）**

`supabaseRpc.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { rowToCardState, cardStateToRow } from './supabaseRpc';

describe('rowToCardState', () => {
  it('Supabase行をCardStateへ変換する', () => {
    const row = {
      question_id: 'CE-2021-001',
      ease_factor: 2.6,
      interval_days: 6,
      repetitions: 2,
      next_review: '2026-06-15',
      last_review: '2026-06-09',
      hint_level: 1,
      consecutive_correct_at_zero: 0,
      updated_at: '2026-06-09T10:00:00Z',
    };
    expect(rowToCardState(row)).toEqual({
      questionId: 'CE-2021-001',
      easeFactor: 2.6,
      interval: 6,
      repetitions: 2,
      nextReview: '2026-06-15',
      lastReview: '2026-06-09',
      hintLevel: 1,
      consecutiveCorrectAtZero: 0,
    });
  });

  it('last_review が null なら空文字にする', () => {
    const row = {
      question_id: 'x', ease_factor: 2.5, interval_days: 0, repetitions: 0,
      next_review: '2026-06-10', last_review: null, hint_level: 0,
      consecutive_correct_at_zero: 0, updated_at: '2026-06-10T00:00:00Z',
    };
    expect(rowToCardState(row).lastReview).toBe('');
  });
});

describe('cardStateToRow', () => {
  it('CardStateをSupabase行へ変換する（lastReview空文字→null）', () => {
    const card = {
      questionId: 'CE-2021-001', easeFactor: 2.5, interval: 0, repetitions: 0,
      nextReview: '2026-06-10', lastReview: '', hintLevel: 0, consecutiveCorrectAtZero: 0,
    };
    expect(cardStateToRow(card)).toEqual({
      question_id: 'CE-2021-001',
      ease_factor: 2.5,
      interval_days: 0,
      repetitions: 0,
      next_review: '2026-06-10',
      last_review: null,
      hint_level: 0,
      consecutive_correct_at_zero: 0,
    });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd pwa-frontend && npx vitest run src/services/restart/supabaseRpc.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装**

`supabaseRpc.ts`:
```typescript
import type { CardState } from '../../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/** Supabase上のcard_states行（pull_card_statesの戻り値） */
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/services/restart/supabaseRpc.test.ts`
Expected: PASS（3テスト）

- [ ] **Step 5: Commit**

```bash
git add src/services/restart/supabaseRpc.ts src/services/restart/supabaseRpc.test.ts
git commit -m "feat: Supabase RPC クライアント（resolve/pull/push）を追加"
```

---

### Task 3: カードマージ純関数

**Files:**
- Create: `pwa-frontend/src/services/restart/cardMerge.ts`
- Test: `pwa-frontend/src/services/restart/cardMerge.test.ts`

マージ規則: 同一 `questionId` がローカルとクラウド両方にある場合、`lastReview`（YYYY-MM-DD文字列）が**新しい方**を採用。同日または比較不能ならローカル優先（その端末で学習中の状態を壊さない）。

- [ ] **Step 1: 失敗するテストを書く**

`cardMerge.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { mergeCardStates } from './cardMerge';
import type { CardState } from '../../types';

function card(questionId: string, lastReview: string, easeFactor = 2.5): CardState {
  return {
    questionId, easeFactor, interval: 1, repetitions: 1,
    nextReview: '2026-06-15', lastReview, hintLevel: 0, consecutiveCorrectAtZero: 0,
  };
}

describe('mergeCardStates', () => {
  it('ローカルにないカードはクラウドから採用される', () => {
    const merged = mergeCardStates([], [card('q1', '2026-06-01')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.questionId).toBe('q1');
  });

  it('クラウドの方が新しければクラウドを採用', () => {
    const merged = mergeCardStates(
      [card('q1', '2026-06-01', 2.5)],
      [card('q1', '2026-06-09', 2.8)],
    );
    expect(merged[0]!.easeFactor).toBe(2.8);
  });

  it('ローカルの方が新しければローカルを維持', () => {
    const merged = mergeCardStates(
      [card('q1', '2026-06-09', 2.5)],
      [card('q1', '2026-06-01', 2.8)],
    );
    expect(merged[0]!.easeFactor).toBe(2.5);
  });

  it('同日はローカル優先', () => {
    const merged = mergeCardStates(
      [card('q1', '2026-06-09', 2.5)],
      [card('q1', '2026-06-09', 2.8)],
    );
    expect(merged[0]!.easeFactor).toBe(2.5);
  });

  it('クラウドにないローカルカードはそのまま残る', () => {
    const merged = mergeCardStates([card('q1', '2026-06-01')], []);
    expect(merged).toHaveLength(1);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/services/restart/cardMerge.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装**

`cardMerge.ts`:
```typescript
import type { CardState } from '../../types';

/**
 * ローカルとクラウドのカード状態をマージする。
 * 規則: lastReview（YYYY-MM-DD）が新しい方を採用。同値・比較不能はローカル優先。
 * 返り値は「Dexieにputすべき全カード」(ローカル既存 + クラウド由来の採用分)。
 */
export function mergeCardStates(local: CardState[], cloud: CardState[]): CardState[] {
  const byId = new Map<string, CardState>();
  for (const c of local) byId.set(c.questionId, c);
  for (const remote of cloud) {
    const mine = byId.get(remote.questionId);
    if (!mine) {
      byId.set(remote.questionId, remote);
    } else if (remote.lastReview > mine.lastReview) {
      // YYYY-MM-DD は辞書順比較で日付比較になる。空文字は常に最古扱い。
      byId.set(remote.questionId, remote);
    }
  }
  return [...byId.values()];
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/services/restart/cardMerge.test.ts`
Expected: PASS（5テスト）

- [ ] **Step 5: Commit**

```bash
git add src/services/restart/cardMerge.ts src/services/restart/cardMerge.test.ts
git commit -m "feat: カード状態のローカル/クラウドマージ純関数を追加"
```

---

### Task 4: 同期オーケストレーション（restartSync）

**Files:**
- Create: `pwa-frontend/src/services/restart/restartSync.ts`

トークンの永続化と、hydrate（pull→merge→Dexie保存）/ push（全カードアップロード）を提供する。テストはDexie/fetchに依存するため書かない（純粋部分はTask 2/3でテスト済み）。

- [ ] **Step 1: 実装**

`restartSync.ts`:
```typescript
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

/** トークンを検証して学生情報を返す。無効なら null */
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
```

- [ ] **Step 2: 型チェック**

Run: `npm run validate:types`
Expected: エラーなし

- [ ] **Step 3: Commit**

```bash
git add src/services/restart/restartSync.ts
git commit -m "feat: リスタート同期オーケストレーション（hydrate/push/トークン保存）"
```

---

### Task 5: TodayGate コンポーネント

**Files:**
- Create: `pwa-frontend/src/components/today/TodayGate.tsx`

トークン付きリンクの入場フロー。状態: `loading`（検証中）→ `error`（無効トークン/通信失敗）or `mismatch`（端末の既存プロフィールと別人）or 完了（クイズ画面へ遷移）。

- [ ] **Step 1: 実装**

`TodayGate.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { db } from '../../services/db';
import {
  saveToken, resolveStudent, hydrateCardStates,
} from '../../services/restart/restartSync';
import type { StudentProfile, Department } from '../../types';

interface Props {
  token: string;
  /** 完了/中断時に通常画面へ戻す */
  onDone: () => void;
}

type GateStatus = 'loading' | 'error' | 'mismatch';

/** 時間帯からセッション種別を決める（JSTはユーザー端末ローカル時刻でよい） */
export function sessionScopeForHour(hour: number): 'all' | 'weak' {
  if (hour >= 11 && hour < 17) return 'weak'; // 昼: 弱点補強
  return 'all'; // 朝・夜: SM-2期限の復習優先（既存クイズの標準動作）
}

export function TodayGate({ token, onDone }: Props) {
  const { dispatch } = useApp();
  const [status, setStatus] = useState<GateStatus>('loading');
  const [studentName, setStudentName] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const student = await resolveStudent(token);
        if (cancelled) return;
        if (!student) {
          setStatus('error');
          return;
        }
        setStudentName(student.student_name);

        // 既存プロフィール確認
        const existing = await db.profile.toCollection().first();
        if (existing && existing.studentNumber &&
            existing.studentNumber !== student.student_number) {
          // 別人のプロフィールが入っている端末（共有端末など）→ 事故防止のため停止
          setStatus('mismatch');
          return;
        }

        if (!existing) {
          // プロフィール自動作成（Teams内蔵ブラウザ等の空ストレージ対策の核心）
          const profile: StudentProfile = {
            studentId: crypto.randomUUID(),
            studentNumber: student.student_number,
            department: student.department as Department,
            grade: student.grade,
            studentType: 'graduate',
            createdAt: new Date().toISOString(),
          };
          await db.profile.add(profile);
          dispatch({ type: 'SET_PROFILE', profile });
        }

        saveToken(token);
        await hydrateCardStates(token);
        if (cancelled) return;

        // 時間帯セッションでクイズ開始
        dispatch({
          type: 'START_CATEGORY_QUIZ',
          category: '',
          scope: sessionScopeForHour(new Date().getHours()),
          origin: 'home',
        });
        onDone();
      } catch (err) {
        console.error('[TodayGate]', err);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token, dispatch, onDone]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent" />
        <p className="text-slate-600 font-medium">
          {studentName ? `${studentName}さんの学習データを準備中…` : '今日の問題を準備中…'}
        </p>
      </div>
    );
  }

  if (status === 'mismatch') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-2xl">⚠️</p>
        <p className="font-bold text-slate-800">このリンクは {studentName} さん専用です</p>
        <p className="text-sm text-slate-600">
          この端末には別の利用者の学習データが入っているため、データ保護のため中断しました。
          自分の端末・ブラウザで開き直してください。
        </p>
        <button onClick={onDone} className="mt-4 px-6 py-2 rounded-lg bg-slate-200 text-slate-700 font-medium">
          通常画面へ
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-2xl">🔗</p>
      <p className="font-bold text-slate-800">リンクを確認できませんでした</p>
      <p className="text-sm text-slate-600">
        通信状態を確認してもう一度開くか、リンクが古い可能性があるため担任の先生に連絡してください。
      </p>
      <button onClick={onDone} className="mt-4 px-6 py-2 rounded-lg bg-slate-200 text-slate-700 font-medium">
        通常画面へ
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 型チェック**

Run: `npm run validate:types`
Expected: エラーなし

- [ ] **Step 3: Commit**

```bash
git add src/components/today/TodayGate.tsx
git commit -m "feat: トークンリンク入場フロー（TodayGate）を追加"
```

---

### Task 6: App.tsx 配線（?t= 検出）

**Files:**
- Modify: `pwa-frontend/src/App.tsx`

- [ ] **Step 1: 実装**

`App.tsx` 全文を以下に置き換え:
```tsx
import { useState, useCallback } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { SetupScreen } from './components/setup/SetupScreen';
import { HomeScreen } from './components/dashboard/HomeScreen';
import { QuizScreen } from './components/quiz/QuizScreen';
import { WeaknessTreemap } from './components/dashboard/WeaknessTreemap';
import { ReviewSchedule } from './components/dashboard/ReviewSchedule';
import { SettingsScreen } from './components/settings/SettingsScreen';
import { BadgesScreen } from './components/dashboard/BadgesScreen';
import { AiDashboard } from './components/dashboard/AiDashboard';
import { PreEnrollmentGamesMenu } from './components/prospective/PreEnrollmentGamesMenu';
import { TodayGate } from './components/today/TodayGate';

/** 起動時に一度だけ ?t= を読み取り、URLから除去する（アドレスバー・履歴にトークンを残さない） */
function consumeTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t');
  if (token) {
    params.delete('t');
    const query = params.toString();
    const newUrl = window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);
  }
  return token;
}

const initialToken = consumeTokenFromUrl();

function AppContent() {
  const { state } = useApp();
  const [gateToken, setGateToken] = useState<string | null>(initialToken);
  const closeGate = useCallback(() => setGateToken(null), []);

  if (gateToken) {
    return <TodayGate token={gateToken} onDone={closeGate} />;
  }

  switch (state.screen) {
    case 'setup':
      return <SetupScreen />;
    case 'home':
      return state.profile?.studentType === 'prospective'
        ? <PreEnrollmentGamesMenu />
        : <HomeScreen />;
    case 'prospective':
      return <PreEnrollmentGamesMenu />;
    case 'quiz':
      return <QuizScreen />;
    case 'weakness':
      return <WeaknessTreemap />;
    case 'schedule':
      return <ReviewSchedule />;
    case 'settings':
      return <SettingsScreen />;
    case 'badges':
      return <BadgesScreen />;
    case 'ai_dashboard':
      return <AiDashboard />;
    default:
      return <HomeScreen />;
  }
}

export default function App() {
  return (
    <AppProvider>
      <div className="max-w-lg mx-auto">
        <AppContent />
      </div>
    </AppProvider>
  );
}
```

注意: `TodayGate` の `onDone` はクイズ開始ディスパッチ後に呼ばれるため、ゲートを閉じると `state.screen === 'quiz'` でそのままクイズ画面が表示される。エラー時は直前の通常画面（setup/home）に戻る。

- [ ] **Step 2: 型チェック**

Run: `npm run validate:types`
Expected: エラーなし

- [ ] **Step 3: 開発サーバで手動確認**

Run: `npm run dev` → ブラウザで `http://localhost:5173/?t=dummy` を開く
Expected: 「リンクを確認できませんでした」画面（Supabase未設定/無効トークンのため）。`http://localhost:5173/` では従来通り setup/home が表示される。

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: 起動時の ?t= トークン検出と TodayGate 表示"
```

---

### Task 7: AppContext に push 統合

**Files:**
- Modify: `pwa-frontend/src/context/AppContext.tsx`

- [ ] **Step 1: 実装（triggerSync にカードpushを追加）**

import に追加:
```typescript
import { pushAllCardStates } from '../services/restart/restartSync';
```

`triggerSync` 内（`syncPendingAnswers` の成功処理の後、catchの前）に追加:
```typescript
      // 既卒生（トークン保持者）のみ: カード状態をSupabaseへバックアップ
      const pushed = await pushAllCardStates();
      if (pushed > 0) {
        console.log(`[restartSync] カード状態 ${pushed}件をクラウドへ同期`);
      }
```

`pushAllCardStates` はトークン未保持なら即returnするため、在校生のフローには影響しない。

- [ ] **Step 2: 型チェック＋全テスト**

Run: `npm run validate:types && npm run test`
Expected: 両方PASS

- [ ] **Step 3: Commit**

```bash
git add src/context/AppContext.tsx
git commit -m "feat: 回答同期時にカード状態をSupabaseへpush（既卒生のみ）"
```

---

### Task 8: v_roster の URL 形式変更（Supabase側）

**Files:**
- Modify: `supabase/migrations/0001_restart_foundation.sql`（リポジトリ記録用）
- Supabase SQL Editor でも同じSQLを実行（ユーザー作業）

`/today?t=` はSPAリライト設定が必要になるため、設定不要の `/?t=` 形式へ変更する。

- [ ] **Step 1: マイグレーションファイルの v_roster 定義を修正**

`0001_restart_foundation.sql` の該当行:
```sql
  'https://memoria-flame.vercel.app/today?t=' || t.token as url
```
を以下へ:
```sql
  'https://memoria-flame.vercel.app/?t=' || t.token as url
```

- [ ] **Step 2: Supabase SQL Editor で実行するSQL（ユーザーへ提示）**

```sql
create or replace view public.v_roster as
select
  s.student_number,
  s.student_name,
  s.teams_email,
  t.token,
  'https://memoria-flame.vercel.app/?t=' || t.token as url
from students s
join access_tokens t on t.student_id = s.id and t.revoked_at is null
where s.is_active
order by s.student_number;

revoke all on public.v_roster from anon, authenticated;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_restart_foundation.sql
git commit -m "fix: v_roster のURLをクエリパラメータ形式（/?t=）へ変更"
```

---

### Task 9: 環境変数・最終検証・デプロイ

**Files:**
- Modify: `supabase/README.md`（環境変数の説明を実態に合わせ確認のみ）

- [ ] **Step 1: ローカル .env に環境変数を追加（ユーザーから値を受領して実施）**

`pwa-frontend/.env` に追記（gitignore済み・コミットしない）:
```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anonキー>
```

- [ ] **Step 2: Vercel 環境変数の設定（ユーザー作業）**

Vercel → memoria-flame → Settings → Environment Variables（Production / Preview 両方）:
- `VITE_SUPABASE_URL` = Project URL
- `VITE_SUPABASE_ANON_KEY` = anon キー（Sensitive推奨だがVITE_のためバンドルには含まれる。RLS deny-all＋RPC設計なので公開可）

- [ ] **Step 3: 全チェック**

Run: `cd pwa-frontend && npm run validate && npm run validate:types && npm run test && npm run build`
Expected: すべて成功

- [ ] **Step 4: ローカルでの実トークンE2E確認**

`.env` 設定後、`npm run dev` → `http://localhost:5173/?t=<福本さんの実トークン>` を開く
Expected: 「準備中…」→ プロフィール自動作成 → クイズ画面が開く。Supabase側 Table Editor で card_states に回答後の行が増える（回答→ホーム遷移時のtriggerSyncでpush）

- [ ] **Step 5: push（=Vercel自動デプロイのテストを兼ねる）**

```bash
git push origin main
```
Expected: GitHub（private）→ Vercel 自動デプロイ成功。`https://memoria-flame.vercel.app/?t=<実トークン>` で本番動作確認

- [ ] **Step 6: 本番E2E＋Teams実機確認（ユーザー作業）**

自分のTeamsに実トークンURLをDMで送り、スマホのTeamsから開く
Expected: Teams内蔵ブラウザでも「準備中…」→クイズが開く（＝当初の最重要課題の解消確認）

---

## Self-Review チェック済み事項

- スコープ: 朝昼夜の出し分けは既存クイズ機構（scope: all/weak）への写像で実現。専用セッションUI・夜の動画推薦は本計画外（次フェーズ）
- 在校生への影響: 全ての新規コードはトークン保持時のみ動作（`pushAllCardStates` の早期return、TodayGateは`?t=`時のみ表示）
- Dexieスキーマ変更なし＝マイグレーションリスクなし
- 型整合: `CardState.interval` ⇄ DB `interval_days`、`lastReview: ''` ⇄ DB `null` の変換はTask 2で固定しテスト済み
