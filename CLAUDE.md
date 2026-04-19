# CLAUDE.md — ナースメモリア（Nurse Memoria）

## プロジェクト概要

看護系専門学校の国家試験対策アダプティブラーニングPWAアプリ。
NotebookLMで過去問PDFから問題を抽出→Google Sheets問題バンク→GASバックエンド→React PWAで学生に配信。
間違えた問題をGemini APIが分析し、誤答パターンに応じた類題を自動生成する。

## 組織情報

- **学校**: 札幌看護医療学院（snm.ac.jp）
- **星槎大学との連携**: 通信制大学との提携校

### 4学科・学生規模

| 学科 | 1学年 | 3学年合計 | 対象国家試験 |
|------|--------|-----------|-------------|
| 看護学科 | 80名 | 240名 | 看護師国家試験 |
| 臨床工学科 | 40名 | 120名 | 臨床工学技士国家試験 |
| 歯科衛生学科 | 40名 | 120名 | 歯科衛生士国家試験 |
| 視能訓練学科 | 40名 | 120名 | 視能訓練士国家試験 |
| **合計** | **200名** | **600名** | |

## Google環境

### アカウント構成

- **メインアカウント**: Google AI Ultra（個人アカウント、学校購入）
  - NotebookLM Ultra（ノートブック上限最大、ソース600個/NB）
  - Gemini API（GCPクレジット $100/月）
  - GAS デプロイ元
  - Google Sheets 問題バンクDB オーナー
- **ファミリーアカウント × 4学科**: Ultra特典共有
  - 各学科担当教員が利用
  - レートリミットは個人ごとに独立
  - AIクレジット（画像/動画生成用）はグループ共有枠
  - 各学科独自のNotebookLMノートブックを管理可能
  - 問題バンクSheetsは閲覧権限で共有

### 制約

- 学校のGoogle Workspace環境ではGASがブロックされている可能性あり
  → メインの個人アカウントからGASデプロイで回避
- 学生は個人Googleアカウント or アカウント不要でアクセス
- 学生側は完全無料

## アーキテクチャ

```
[NotebookLM Ultra] → [notebooklm-py] → [Google Sheets 問題バンク]
                                              ↓
                                        [GAS バックエンド]
                                         ├─ 問題取得API
                                         ├─ Gemini誤答分析API
                                         └─ 学習履歴保存API
                                              ↓
                                        [React PWA]（学生用）
                                         ├─ クイズUI（4択タップ）
                                         ├─ SM-2 間隔反復
                                         ├─ 弱点マップ
                                         └─ IndexedDB（端末キャッシュ）
```

## Phase 1: 問題バンク設計（Google Sheets）

### シート構造

#### `questions` シート（問題マスタ）
| カラム | 型 | 説明 |
|--------|-----|------|
| question_id | string | `NRS-001-001` 形式（学科-年度-連番） |
| department | string | nursing / clinical_eng / dental_hyg / orthoptist |
| exam_year | number | 出題年度（例: 2025） |
| exam_number | number | 問題番号 |
| category | string | 分野タグ（例: 基礎看護学、成人看護学） |
| subcategory | string | 小分野（例: 循環器、呼吸器） |
| difficulty | number | 難易度 1-5 |
| question_text | string | 問題文 |
| choice_a | string | 選択肢A |
| choice_b | string | 選択肢B |
| choice_c | string | 選択肢C |
| choice_d | string | 選択肢D |
| choice_e | string | 選択肢E（5択の場合、空欄可） |
| correct_answer | string | 正答（A/B/C/D/E） |
| explanation | string | 解説文 |
| source | string | 出典（NotebookLM抽出 / AI生成 / 手動追加） |
| created_at | string | 作成日時 ISO8601 |

#### `student_logs` シート（学習履歴）
| カラム | 型 | 説明 |
|--------|-----|------|
| log_id | string | UUID |
| student_id | string | 匿名ID（端末生成ハッシュ） |
| department | string | 学科 |
| grade | number | 学年（1/2/3） |
| question_id | string | 問題ID |
| selected_answer | string | 学生の回答 |
| is_correct | boolean | 正誤 |
| response_time_ms | number | 解答時間（ミリ秒） |
| attempt_count | number | この問題の挑戦回数 |
| timestamp | string | 回答日時 ISO8601 |

#### `ai_generated` シート（AI生成類題）
| カラム | 型 | 説明 |
|--------|-----|------|
| gen_id | string | UUID |
| original_question_id | string | 元問題のID |
| error_type | string | knowledge_gap / misread / confusion |
| question_text | string | 生成された類題 |
| choice_a〜e | string | 選択肢 |
| correct_answer | string | 正答 |
| explanation | string | 解説 |
| created_at | string | 生成日時 |

## Phase 2: GASバックエンド

### エンドポイント設計

```
GET  /exec?action=getQuestions&dept=nursing&grade=2&limit=20
GET  /exec?action=getReviewQueue&studentId=xxx
POST /exec?action=submitAnswer  { studentId, questionId, answer, responseTime }
POST /exec?action=analyzeError  { questionId, studentAnswer, correctAnswer }
POST /exec?action=generateSimilar { questionId, errorType }
```

### GAS無料枠と600名の負荷試算

| 制限項目 | 無料上限 | 想定使用量 | 余裕 |
|----------|----------|------------|------|
| 日次URL Fetch呼び出し | 20,000 | 600名×5回AI=3,000 | ◎ |
| 日次スクリプト実行時間 | 6時間 | 推定1-2時間 | ◎ |
| 同時実行数 | 30 | ピーク15-20 | ○ |
| Sheets読み書き | 無制限（レート制限あり） | 600名×20問=12,000 | ○ |

### Gemini APIコスト試算（$100/月GCPクレジット内）

- 誤答分析: 入力〜500トークン + 出力〜300トークン
- 類題生成: 入力〜800トークン + 出力〜600トークン
- Gemini 3.1 Pro 料金: 入力 $1.25/100万トークン, 出力 $5.00/100万トークン
- 1回のAI呼び出しコスト ≈ $0.003
- 600名 × 月20回AI呼び出し = 12,000回 ≈ **$36/月**
- → $100クレジット内で余裕

### 重要: AI呼び出し最適化

全問でGemini APIを呼ぶとコストが膨張するため、以下の条件でのみ呼び出す:
1. **誤答時のみ** — 正答時はAI不要
2. **同一問題3回目の誤答時** — 1-2回目はローカルの解説表示で対応
3. **類題生成は1問につき最大3題** — 生成済みならキャッシュから出題

## Phase 3: React PWA（学生用フロントエンド）

### 技術スタック

- React 18+ / Vite
- TypeScript
- Tailwind CSS（スマホUI最適化）
- Workbox（PWA Service Worker）
- Dexie.js（IndexedDB ラッパー）

### ホスティング

- GitHub Pages（無料）
- または Cloudflare Pages（無料）
- カスタムドメイン設定可能

### 主要画面

1. **初回セットアップ**: 学科・学年選択 → 匿名studentId自動生成
2. **ホーム**: 今日の復習予定数、連続日数、弱点分野サマリー
3. **クイズ画面**: 問題表示 → 4択タップ → 正誤フィードバック → 解説
4. **AI分析画面**（誤答3回目に表示）: 誤答原因の説明 + 類題チャレンジ
5. **弱点マップ**: 分野別正答率ヒートマップ
6. **復習スケジュール**: SM-2に基づく次回出題予定

### SM-2 アルゴリズム実装

```typescript
interface CardState {
  questionId: string;
  easeFactor: number;    // 初期値 2.5
  interval: number;      // 日数
  repetitions: number;   // 連続正答数
  nextReview: Date;
}

function sm2(card: CardState, quality: number): CardState {
  // quality: 0-5 (0=完全忘却, 5=即答)
  // 正答=4以上, 不正解=3以下
  if (quality >= 3) {
    if (card.repetitions === 0) card.interval = 1;
    else if (card.repetitions === 1) card.interval = 6;
    else card.interval = Math.round(card.interval * card.easeFactor);
    card.repetitions++;
  } else {
    card.repetitions = 0;
    card.interval = 1;
  }
  card.easeFactor = Math.max(1.3,
    card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );
  card.nextReview = addDays(new Date(), card.interval);
  return card;
}
```

### IndexedDB スキーマ（Dexie.js）

```typescript
const db = new Dexie('NurseMemoria');
db.version(1).stores({
  profile: '++id, department, grade, studentId, createdAt',
  cardStates: 'questionId, nextReview, department, category',
  questionCache: 'question_id, department, category',
  answerLog: '++id, questionId, timestamp, isCorrect'
});
```

### オフライン対応

- Service Workerで問題データをキャッシュ
- オフライン時はIndexedDBからローカル出題
- オンライン復帰時にGASへログ同期

## Phase 4: Gemini API プロンプト設計

### 誤答分析プロンプト

```
あなたは看護師国家試験の教育専門家です。
学生が以下の問題に間違えました。間違えた原因を分析してください。

【問題】{question_text}
【選択肢】
A: {choice_a}
B: {choice_b}
C: {choice_c}
D: {choice_d}
【正答】{correct_answer}
【学生の回答】{selected_answer}

以下のJSON形式で回答してください:
{
  "error_type": "knowledge_gap | misread | confusion",
  "analysis": "間違えた原因の説明（学生向け、200字以内）",
  "key_concept": "理解すべき重要概念",
  "study_hint": "学習のアドバイス（100字以内）"
}

error_typeの判定基準:
- knowledge_gap: 正答の知識自体が不足している
- misread: 問題文や選択肢の読み違い（否定語の見落とし等）
- confusion: 類似概念との混同（例: 交感神経と副交感神経）
```

### 類題生成プロンプト

```
あなたは看護師国家試験の問題作成者です。
以下の問題で学生が{error_type}のミスをしました。
この弱点を克服するための類題を1問作成してください。

【元の問題】{original_question}
【誤答タイプ】{error_type}
【分析結果】{analysis}

error_typeに応じた出題方針:
- knowledge_gap: 同じ概念のより基礎的な問題を出す
- misread: 設問の言い回しを変え、注意深く読む必要がある問題にする
- confusion: 混同しやすい概念を明確に弁別させる問題にする

以下のJSON形式で回答:
{
  "question_text": "問題文",
  "choice_a": "選択肢A",
  "choice_b": "選択肢B",
  "choice_c": "選択肢C",
  "choice_d": "選択肢D",
  "correct_answer": "A|B|C|D",
  "explanation": "解説文（300字以内）",
  "difficulty": 1-5
}
```

## 開発順序

### Step 1: 問題バンク基盤（優先度: 最高）
- [ ] Google Sheets テンプレート作成
- [ ] notebooklm-pyセットアップ & PDF問題抽出テスト
- [ ] 看護師国試の過去問1年分をSheets投入

### Step 2: GASバックエンド
- [ ] 問題取得API (`getQuestions`, `getReviewQueue`)
- [ ] 回答記録API (`submitAnswer`)
- [ ] Gemini API連携 (`analyzeError`, `generateSimilar`)
- [ ] CORS設定（PWAからのアクセス許可）

### Step 3: PWA フロントエンド
- [ ] Vite + React + TypeScript + Tailwind 初期構築
- [ ] 初回セットアップ画面（学科・学年選択）
- [ ] クイズ画面（問題表示→回答→正誤→解説）
- [ ] SM-2 間隔反復エンジン
- [ ] IndexedDB データ永続化
- [ ] PWA manifest + Service Worker

### Step 4: AI機能統合
- [ ] 誤答分析フロー（3回目誤答時にGemini呼び出し）
- [ ] 類題生成 & キャッシュ
- [ ] AI分析結果の表示UI

### Step 5: ダッシュボード & 仕上げ
- [ ] 弱点マップ（分野別正答率ヒートマップ）
- [ ] 復習スケジュール表示
- [ ] オフライン対応 & Service Worker
- [ ] GitHub Pages デプロイ
- [ ] QRコード生成 & 学生配布

## コーディング規約

- 言語: TypeScript（strict mode）
- 日本語コメント推奨
- コンポーネント: 関数コンポーネント + Hooks
- 状態管理: React Context + useReducer（軽量に保つ）
- API通信: fetch ベース（axios不要）
- テスト: Vitest + React Testing Library
- コミットメッセージ: 日本語OK、Conventional Commits形式

## スクリプト・ツール

### 国試問題抽出パイプライン（`scripts/ce_exam_pipeline.py`）
- 詳細: `scripts/SKILL-ce-exam-pipeline.md`
- 国家試験過去問xlsxから問題を抽出→AI分類・解説生成→画像抽出→xlsx出力
- コマンド: `extract`, `images`, `output`, `verify`, `merge`, `all`
- CE国試data/classification_tree.json に出題基準の分類体系を保持
- CO国試data/classification_tree.json に視能訓練士の分類体系を保持
- 新しい学科や年度の追加時はこのパイプラインを使用
- 処理済み: CE（臨床工学技士）1,980問、CO（視能訓練士）1,800問

### GASバックエンドコード（`gas-backend/src/`）
- Config.gs, GeminiService.gs, DashboardService.gs 等
- Gemini APIモデル: gemini-2.5-flash
- AI分析の差分更新（totalQuestions未変更時はスキップ）

## 追加・更新運用マニュアル

Claude Code への指示で以下のシナリオを実行する際の標準手順。各手順の最後に必ず `npm run validate` を実行して整合性を確認すること。

### データ構造（Single Source of Truth）

| ファイル | 役割 |
|---------|------|
| `pwa-frontend/src/config/departments.ts` | 学科レジストリ（型・ラベル・スタイル全て） |
| `pwa-frontend/public/data/manifest.json` | バージョン管理の中枢 |
| `pwa-frontend/public/data/questions/{dept}.json` | 学科別問題データ |
| `pwa-frontend/public/data/curriculum/{dept}.json` | 学年別出題カリキュラム |

### 1. 新学科追加

1. `departments.ts` の `REGISTRY_DATA` に `enabled: false` で仮エントリ追加
   ```ts
   { id: 'new_dept', label: '新学科', shortLabel: 'ND', enabled: false,
     color: { gradient: '...', border: '#...', text: '#...' },
     grades: [1, 2, 3], orderIndex: 5 }
   ```
2. `public/data/questions/new_dept.json` を作成（問題データ JSON 配列）
3. `public/data/curriculum/new_dept.json` を作成（grades 1/2/3 のカテゴリ定義）
4. `public/data/manifest.json` に新学科エントリを追加（version: 1）
5. `npm run validate` で整合性確認（エラーなし）
6. `enabled: true` に変更してコミット

### 2. 新年度問題追加

1. 対象 `public/data/questions/{dept}.json` に新問題を追記
   - `question_id` は `{DEPT}-{YEAR}-{NNN}` 形式で一意化
   - `exam_year` を新年度の数値に設定
2. `public/data/manifest.json` の該当学科の `version` を +1、`count` と `lastUpdated` を更新
3. `npm run validate` で整合性確認

### 3. 個別問題の訂正・差し替え

1. `public/data/questions/{dept}.json` 内で `question_id` 一致レコードを編集
2. `public/data/manifest.json` の該当学科の `version` を +1
3. 注意: `cardStates` は `question_id` 参照のみのため、id を変えない限りユーザーの学習履歴は保持される

### 4. 分類体系（カテゴリ）の更新

1. `public/data/curriculum/{dept}.json` の `categories` 配列を編集
2. カテゴリ名を変更した場合は、`public/data/questions/{dept}.json` の `category` フィールドも一致させる
3. `npm run validate` で整合性確認

### 5. 模擬試験の追加

1. 問題データに以下の形式で追記:
   - `question_id`: `{DEPT}-mock{YYYY}-{NNN}` 形式（例: `NRS-mock2025-001`）
   - `exam_year`: `"mock_2025"` 形式の文字列
   - `source`: `"mock_2025"` 等（既存フィールドを流用）
2. `public/data/questions/{dept}.json` に追記
3. `public/data/manifest.json` の `version` を +1、`count` を更新
4. `npm run validate` で整合性確認

### 整合性チェックコマンド

```bash
cd pwa-frontend
npm run validate        # データ整合性（manifest・問題数・重複・画像・カリキュラム）
npm run validate:types  # TypeScript 型チェック（tsc --noEmit）
```

## 既知の注意点

- GASのWebアプリは `script.google.com` ドメインからレスポンスを返す
  → CORSは `doGet`/`doPost` 内で `ContentService` を使えば自動的にクロスオリジン対応
- GASの同時実行数上限(30)はピーク時に注意
  → PWA側でリクエストキューイング実装
- Gemini APIのレート制限に注意
  → GAS側でリトライ + 指数バックオフ
- 看護国試は5択問題あり（choice_eカラムで対応済み）
- 学科ごとに国家試験の形式が異なる場合がある
  → department別にUI分岐可能な設計にしておく

## セキュリティ未対応事項（GAS バックエンド）

2026-04-18 のセキュリティ監査でフロントエンド側（XSS/CSP/Zod/npm audit/DebugInfo）は対応済み。
GAS バックエンド側は以下が未対応。GAS の編集・デプロイ権限を持つタイミングで対応すること。

### 優先度: High

1. **studentId の認証欠如**（`gas-backend/src/AnswerService.gs:92-135`）
   - 任意の UUID を偽装して他学生の回答ログを上書きできる
   - **対応方針**: `updateStudentNumber` で `studentId` と `oldStudentNumber` の両方が同一行に紐づくことを検証してから更新する（現在は `||` 条件で片方一致なら全更新）
   - 中期: Google Sign-in（@snm.ac.jp ドメイン限定）導入

2. **Gemini プロンプトインジェクション**（`gas-backend/src/GeminiService.gs`）
   - AI 生成テキストが次の Gemini 呼び出しに混入する経路がある
   - **対応方針**: プロンプトにデリミタ（`<<<USER_INPUT>>>...<<<END>>>`）を追加し、`originalQuestion` は Sheets から lookup する（フロントから受け取るテキストを使わない）

### 優先度: Medium

3. **GAS 入力バリデーション不足**（`gas-backend/src/Code.gs:14-113`）
   - `studentId` の UUID 形式検証なし、文字列長上限なし
   - **対応方針**: UUID バリデーション（`/^[0-9a-f-]{36}$/i`）と文字列長上限を追加

4. **Gemini レート制限の未実装**（`gas-backend/src/Config.gs:20` の定数が未使用）
   - 1 studentId で Gemini を無制限に呼び出してクレジット枯渇攻撃が可能
   - **対応方針**: `PropertiesService` に `gemini_calls_{studentId}_{YYYYMMDD}` を保存してカウント管理
