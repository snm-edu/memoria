# CLAUDE.md — ナースメモリア（Nurse Memoria）

## プロジェクト概要

看護系専門学校の国家試験対策アダプティブラーニングPWAアプリ。
NotebookLMで過去問PDFから問題を抽出→Google Sheets問題バンク→GASバックエンド→React PWAで学生に配信。
間違えた問題をGemini APIが分析し、誤答パターンに応じた類題を自動生成する。

### 参照ドキュメント（必要時に読む）

| ファイル | 内容 |
|---|---|
| `docs/data-schema.md` | Sheets問題バンク3シート定義・GASエンドポイント・SM-2実装・IndexedDBスキーマ |
| `docs/prompts.md` | Gemini誤答分析・類題生成プロンプト全文 |
| `docs/archive-initial-plan.md` | 初期開発計画（Step1〜5）・GAS/Geminiの負荷・コスト試算（歴史資料） |
| `scripts/SKILL-ce-exam-pipeline.md` | 国試問題抽出パイプラインの詳細 |

## 組織情報

- **学校**: 札幌看護医療専門学校（snm.ac.jp）※旧記載「札幌看護医療学院」は誤り（2026-07-03 訂正）
- **星槎大学との連携**: 通信制大学との提携校
- **4学科・規模**: 看護80／臨床工学40／歯科衛生40／視能訓練40名（各1学年）× 3学年 ＝ 計600名。対象は各学科の国家試験

## Google環境・課金（要点）

- **メインアカウント**: Google AI Ultra（個人アカウント・学校購入）。NotebookLM Ultra／GASデプロイ元／Sheets問題バンクのオーナー
- **ファミリーアカウント×4学科**: Ultra特典共有。レートリミットは個人ごと独立・AIクレジット（画像/動画）はグループ共有・問題バンクSheetsは閲覧権限で共有
- **Gemini API は Ultra と別課金**（Ultra の 25,000 クレジットは Flow/Whisk 専用で API には使えない）
- **Paid Tier + 月次 spending cap $10** で運用。モデルは **`gemini-2.5-flash-lite`**（`gas-backend/src/Config.gs` の `GEMINI_MODEL`）。Free Tier は 429 停止リスクがあるため使わない（試算は `docs/archive-initial-plan.md`）
- 学校の Workspace は GAS ブロックの可能性 → 個人アカウントからデプロイで回避
- 学生は個人Googleアカウント or アカウント不要でアクセス。学生側は完全無料

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

- 技術スタック: React 18+ / Vite / TypeScript / Tailwind CSS / Workbox / Dexie.js
- ホスティング: GitHub Pages または Cloudflare Pages（カスタムドメイン可）
- スキーマ・SM-2・オフライン設計の詳細は `docs/data-schema.md`

## 重要: AI呼び出し最適化

全問でGemini APIを呼ぶとコストが膨張するため、以下の条件でのみ呼び出す:
1. **誤答時のみ** — 正答時はAI不要
2. **同一問題3回目の誤答時** — 1-2回目はローカルの解説表示で対応
3. **類題生成は1問につき最大3題** — 生成済みならキャッシュから出題

## コーディング規約

- 言語: TypeScript（strict mode）／日本語コメント推奨
- コンポーネント: 関数コンポーネント + Hooks／状態管理: React Context + useReducer（軽量に保つ）
- API通信: fetch ベース（axios不要）
- テスト: Vitest + React Testing Library
- コミットメッセージ: 日本語OK、Conventional Commits形式

## スクリプト・ツール

### 国試問題抽出パイプライン（`scripts/ce_exam_pipeline.py`）
- 詳細: `scripts/SKILL-ce-exam-pipeline.md`／コマンド: `extract`, `images`, `output`, `verify`, `merge`, `all`
- 分類体系: CE国試data／CO国試data の `classification_tree.json`
- 処理済み: CE（臨床工学技士）1,980問、CO（視能訓練士）1,800問。新学科・新年度はこのパイプラインを使用

### GASバックエンド（`gas-backend/src/`）
- Config.gs, GeminiService.gs, DashboardService.gs 等
- AI分析の差分更新（totalQuestions未変更時はスキップ）

## 追加・更新運用マニュアル

各手順の最後に必ず `npm run validate` を実行して整合性を確認すること。

### データ構造（Single Source of Truth）

| ファイル | 役割 |
|---------|------|
| `pwa-frontend/src/config/departments.ts` | 学科レジストリ（型・ラベル・スタイル全て） |
| `pwa-frontend/public/data/manifest.json` | バージョン管理の中枢 |
| `pwa-frontend/public/data/questions/{dept}.json` | 学科別問題データ |
| `pwa-frontend/public/data/curriculum/{dept}.json` | 学年別出題カリキュラム |

### 1. 新学科追加
1. `departments.ts` の `REGISTRY_DATA` に `enabled: false` で仮エントリ追加（id/label/shortLabel/color/grades/orderIndex）
2. `public/data/questions/new_dept.json`・`public/data/curriculum/new_dept.json` を作成
3. `manifest.json` に新学科エントリを追加（version: 1）
4. `npm run validate` → エラーなしを確認後 `enabled: true` でコミット

### 2. 新年度問題追加
1. 対象 `questions/{dept}.json` に追記（`question_id` は `{DEPT}-{YEAR}-{NNN}` で一意化、`exam_year` 設定）
2. `manifest.json` の該当学科 `version` を +1、`count`・`lastUpdated` を更新
3. `npm run validate`

### 3. 個別問題の訂正・差し替え
1. `questions/{dept}.json` 内で `question_id` 一致レコードを編集
2. `manifest.json` の該当学科 `version` を +1
3. 注意: `cardStates` は `question_id` 参照のみ。id を変えない限り学習履歴は保持される

### 4. 分類体系（カテゴリ）の更新
1. `curriculum/{dept}.json` の `categories` を編集
2. カテゴリ名変更時は `questions/{dept}.json` の `category` も一致させる
3. `npm run validate`

### 5. 模擬試験の追加
1. `question_id`: `{DEPT}-mock{YYYY}-{NNN}` 形式／`exam_year`: `"mock_2025"` 形式の文字列／`source`: `"mock_2025"` 等
2. `questions/{dept}.json` に追記 → `manifest.json` の `version` +1・`count` 更新 → `npm run validate`

### 整合性チェックコマンド

```bash
cd pwa-frontend
npm run validate        # データ整合性（manifest・問題数・重複・画像・カリキュラム）
npm run validate:types  # TypeScript 型チェック（tsc --noEmit）
```

## 既知の注意点

- GAS Webアプリは `script.google.com` ドメインから応答 → CORSは `doGet`/`doPost` 内で `ContentService` を使えば自動対応
- GASの同時実行数上限(30)はピーク時に注意 → PWA側でリクエストキューイング実装
- Gemini APIのレート制限 → GAS側でリトライ + 指数バックオフ
- 看護国試は5択問題あり（choice_eカラムで対応済み）
- 学科ごとに国試形式が異なる場合あり → department別にUI分岐可能な設計を維持

## セキュリティ未対応事項（GAS バックエンド）

2026-04-18 監査でフロントエンド側（XSS/CSP/Zod/npm audit/DebugInfo）は対応済み。GAS 側は High 2件・Medium 2件の既知課題が未対応（studentId認証・プロンプトインジェクション対策・入力バリデーション・レート制限）。

このリポジトリは Public のため、攻撃手順に直結する詳細（対象ファイル・行番号・具体的な条件式）はここには記載しない。詳細は非公開の課題管理（Claude Codeのプロジェクトメモリ）で追跡している。編集・デプロイ権限を持つタイミングで、Highの2件から対応すること。

## Vercel 環境変数運用ポリシー

（2026-04-20 Vercel セキュリティインシデントを受けて策定。**本節が全プロジェクト共通の正本**。`10_ClaudeCode/CLAUDE.md`・ウツセバ CLAUDE.md はここを参照）

### 基本方針

- **secret に該当する環境変数は、Preview / Production では必ず Sensitive Environment Variables として登録する**
- Development 環境でも Sensitive 指定を推奨（Dashboard からの値閲覧を防止）。Development は `vercel env pull` でローカル `.env.local` に降ろして使うため、運用上は secret を置かない（置く場合は `.env.local` のみ・.gitignore 必須）
- secret かどうかの判定は「流出した瞬間に金銭的・情報的被害が出るか」
- 既存の非 Sensitive 値を Sensitive 化するには、一度削除して再登録が必要（Vercel の仕様上、後から Sensitive 化はできない）

### secret 判定基準

| 分類 | 例 | Sensitive 指定 |
|------|-----|---------------|
| 認証情報 | API キー、Token、Deploy Hook Secret、Webhook Secret | **必須** |
| 接続情報（非公開） | 非公開 DB 接続文字列、内部 API の URL | **必須** |
| 公開値 | `VITE_APP_NAME`、`VITE_BASE_PATH` | 不要（Plaintext 可）|
| 半公開値 | `VITE_GAS_API_URL`（bundle 埋込だが Dashboard 閲覧制限は有用）・URL自体を共有秘密として扱うもの | **Sensitive 推奨** |

### 重要: Vite の `VITE_*` 変数の仕様

- `VITE_*` 変数はビルド時にクライアント JS へ inline される → Sensitive 指定しても**真の秘匿にはならない**
- 真に秘匿したい値は: ①Vercel Functions の環境変数（VITE_ なし） ②GAS 側 PropertiesService（本プロジェクトの現状） ③外部 Secret Manager
- **本プロジェクトの実質的な secret はすべて GAS 側にあり、Vercel 側には真の secret を置かない設計を維持する**

### 運用ルール

1. **新規追加時**: secret 判定 → Sensitive 要否決定 → 各環境で設定 → PR に「どの環境に何を追加したか」記載
2. **ローテーション**: 新キー発行 → Dashboard で値更新 → Redeploy → 動作確認後に旧キー revoke。キー値はターミナル経由で転送せず Dashboard UI で完結
3. **Audit**: 四半期ごとに Team Audit Log と Environment Variables を確認。不審な変更・Sensitive 未指定 secret は即ローテ
4. **インシデント時**: 全 token revoke → 再発行 → env 全件再確認 → 該当 secret 全ローテ → Audit Log（`vercel activity --all --since 30d` で `env.*` / `deployment.created` / `token.created` / `member.*`）を精査

---
最終更新: 2026-07-03（棚卸し：スキーマ・プロンプト・初期計画を docs/ へ外出し、校名を「札幌看護医療専門学校」に訂正）
