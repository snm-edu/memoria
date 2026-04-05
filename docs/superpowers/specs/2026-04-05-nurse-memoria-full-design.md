# ナースメモリア 全体設計書

## Context

札幌看護医療学院（4学科・600名）向けの国家試験対策アダプティブラーニングPWA。
2014-2024の看護師国試過去問約2,520問をベースに、SM-2間隔反復 + Gemini AI誤答分析で個別最適化学習を提供する。

Google Sheets → GAS → React PWA の完全サーバーレス構成で、学生側は完全無料。

---

## 1. データパイプライン

### 1.1 ソースデータ

| ファイル | 行数 | 内容 |
|---------|------|------|
| `NRS国試まとめ_分類追加版.md` | 17,482行 | 問題文・選択肢・正解（CSV風） |
| `NRS国試分野別まとめ2014-2024（新2）.md` | 2,673行 | 問題ID→分類マスタの対応表 |

### 1.2 データフォーマット

問題ファイルの構造（1問あたり）:
```
行1: 看護師,年度,大分類,,,,問題ID,カテゴリ,サブカテゴリ
行2: ,,問題文,,,,,,
行3: ,,1,選択肢テキスト,,,正解（正答の場合）,,
行4: ,,2,選択肢テキスト,,,,,
...
```

### 1.3 エッジケース

| ケース | 件数 | 対応 |
|--------|------|------|
| 5択問題 | ~220問 | choices配列を可変長に |
| 「2つ選べ」複数正解 | ~220問 | correct_answer: ["C","D"] |
| 図表参照問題 | ~77問 | has_image: true + 注意文表示 |
| 複数行問題文 | 数十件 | ダブルクォート内改行を検出・結合 |
| 2014PM重複 | 120問 | question_idで重複排除 |
| 全角/半角混在（分類） | 全体 | 正規化処理 |

### 1.4 パーサー設計

`scripts/parse-exam-data.ts` — TypeScriptステートマシン

状態遷移:
```
AWAITING_METADATA → AWAITING_QUESTION → COLLECTING_CHOICES → AWAITING_METADATA
```

出力: `scripts/output/questions.json` — Sheetsスキーマ準拠

分類インデックスとのマージ: question_idをキーに大分類マスタ・中分類マスタ・小分類マスタを結合

---

## 2. Google Sheets 問題バンク

### 2.1 シート構造

CLAUDE.mdのスキーマに以下を追加:

**questionsシート 追加カラム:**
- `has_image` (boolean) — 図表参照問題フラグ
- `is_multi_select` (boolean) — 「2つ選べ」フラグ
- `image_url` (string) — 後から画像URLを追加可能

**correct_answer**: 複数正解の場合カンマ区切り（例: "C,D"）

---

## 3. GASバックエンド

### 3.1 開発環境

- @google/clasp でローカル開発 → push デプロイ
- TypeScript + @types/google-apps-script
- Ultraアカウントからデプロイ

### 3.2 ファイル構成

```
gas-backend/src/
├── Code.ts          — doGet/doPost ルーター
├── QuestionService.ts — getQuestions, getReviewQueue
├── AnswerService.ts   — submitAnswer, getStudentStats
├── GeminiService.ts   — analyzeError, generateSimilar
└── Config.ts          — SPREADSHEET_ID, GEMINI_API_KEY, レート制限
```

### 3.3 API設計

| Method | Action | パラメータ | 説明 |
|--------|--------|-----------|------|
| GET | getQuestions | dept, category, limit, offset | 問題取得（フィルタ付き） |
| GET | getReviewQueue | studentId | SM-2の復習予定問題ID一覧 |
| POST | submitAnswer | studentId, questionId, answer, responseTime | 回答記録 |
| POST | analyzeError | questionId, studentAnswer, correctAnswer | Gemini誤答分析 |
| POST | generateSimilar | questionId, errorType | Gemini類題生成 |

### 3.4 同時実行対策

- GAS上限30並列 → PWA側でリクエストキューイング（jittered retry）
- 問題データは20問バッチで取得 → API呼び出し削減
- `LockService.getScriptLock()` で書き込みシリアライズ
- Gemini呼び出し: 3回目誤答時のみ、1学生5回/日上限

---

## 4. React PWA フロントエンド

### 4.1 技術スタック

- React 18 + Vite + TypeScript (strict)
- Tailwind CSS（モバイルファースト）
- Dexie.js + dexie-react-hooks（IndexedDB）
- Workbox（Service Worker）

### 4.2 画面構成

1. **初回セットアップ** — 学科・学年選択 → studentId自動生成
2. **ホーム** — 今日の復習数、連続日数、弱点サマリー
3. **クイズ** — 問題表示 → 選択 → 正誤フィードバック → 解説
4. **AI分析**（3回目誤答時）— 誤答原因 + 類題チャレンジ
5. **弱点マップ** — 分野別正答率ヒートマップ
6. **復習スケジュール** — SM-2ベースのカレンダー表示

### 4.3 状態管理

```
AppContext: { profile, isOnline, syncQueueCount }
QuizContext: { currentQuestion, selectedAnswers, feedback, sessionStats }
```

SM-2カード状態はDexie（IndexedDB）が正のソース。`useLiveQuery`でリアクティブ参照。

### 4.4 IndexedDB スキーマ (Dexie)

```typescript
db.version(1).stores({
  profile: '++id, department, grade, studentId',
  cardStates: 'questionId, nextReview, department, category',
  questionCache: 'question_id, department, category, exam_year',
  answerLog: '++id, questionId, timestamp, synced',
  aiCache: '[questionId+selectedAnswer], questionId'
});
```

### 4.5 SM-2 品質スコアマッピング

| 条件 | quality | 意味 |
|------|---------|------|
| 正答 + 10秒未満 | 5 | 即答 |
| 正答 + 10-30秒 | 4 | 通常正答 |
| 正答 + 30秒超 | 3 | 迷って正答 |
| 不正解 | 1 | 不正解 |

### 4.6 オフライン戦略

| レイヤー | 対象 | 戦略 |
|---------|------|------|
| App Shell | HTML/CSS/JS | Workbox precache |
| 問題データ | questions | Dexie + バックグラウンド更新 |
| 回答送信 | submitAnswer | Dexieキュー → オンライン時同期 |
| AI応答 | analyzeError等 | Dexieキャッシュ（永続） |

### 4.7 「2つ選べ」UI

- 問題文に「2つ選べ」を検出 → 複数選択モード
- 選択肢タップでトグル（単一選択の場合は排他）
- 2つ選択後に「回答する」ボタン活性化
- 部分正解は不正解扱い（国試採点基準準拠）

---

## 5. Gemini AI連携

### 5.1 呼び出し条件

1. **誤答時のみ** — 正答時はAI不要
2. **同一問題3回目の誤答時** — 1-2回目はローカル解説表示
3. **1学生あたり5回/日** — レート制限
4. **類題は1問につき最大3題** — 生成済みならキャッシュ

### 5.2 コスト見積もり

- Gemini 3.1 Pro: 入力$1.25/100万トークン、出力$5.00/100万トークン
- 600名 × 月20回 = 12,000回 ≈ $36/月（$100クレジット内）

### 5.3 プロンプト

CLAUDE.mdのPhase 4に記載のプロンプトをそのまま使用。
JSON出力を`JSON.parse`でパースし、失敗時はリトライ（最大3回）。

---

## 6. デプロイ

- **PWA**: GitHub Pages（Viteの`base`パスを設定）
- **GAS**: clasp deploy → Webアプリとして公開
- **学生配布**: QRコード生成（GitHub PagesのURL）

---

## 7. プロジェクト構造

```
nurse-memoria/
├── CLAUDE.md
├── README.md
├── gas-backend/
│   ├── .clasp.json
│   ├── appsscript.json
│   └── src/
│       ├── Code.ts
│       ├── QuestionService.ts
│       ├── AnswerService.ts
│       ├── GeminiService.ts
│       └── Config.ts
├── pwa-frontend/
│   ├── vite.config.ts
│   ├── index.html
│   ├── public/
│   │   └── manifest.json
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── components/
│       │   ├── quiz/
│       │   ├── setup/
│       │   ├── dashboard/
│       │   └── ai/
│       ├── hooks/
│       ├── services/
│       ├── context/
│       ├── types/
│       └── utils/
├── scripts/
│   ├── parse-exam-data.ts
│   └── output/
├── shared/
│   └── types.ts
└── docs/
```

---

## 8. 検証方法

1. **パーサー**: 出力JSONの問題数 ≈ 2,520問、正解なし問題が0件、重複なし
2. **GAS**: curl で各エンドポイント動作確認
3. **PWA**: `npm run dev` でローカル動作確認 → Lighthouseでスコア計測
4. **オフライン**: DevTools → Network offline → クイズ動作確認
5. **SM-2**: 正答/誤答パターンで間隔が正しく変動するか検証
6. **AI**: 誤答3回目でGemini呼び出し → 分析結果表示確認
