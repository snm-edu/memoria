# ナースメモリア（Nurse Memoria）

看護・臨床工学・歯科衛生・視能訓練の4学科（専門学校）向け、国家試験対策アダプティブラーニングPWA。
過去問PDFの抽出から、間違えた問題のAI誤答分析・類題自動生成まで、Google AI Ultra環境だけで完結する設計になっています。

An adaptive-learning PWA that helps nursing and allied-health students in Japan prepare for their national licensing exams, with AI-generated follow-up questions targeted at each student's mistake patterns.

## これは何か

- 対象は札幌看護医療専門学校の4学科（看護／臨床工学／歯科衛生／視能訓練）。各学科の国家試験の過去問をAIで抽出・分類し、問題バンク化しています。
- 学生は4択（学科によっては5択）タップ形式でクイズに回答し、SM-2アルゴリズムによる間隔反復で復習スケジュールが自動化されます。
- 同じ問題を3回目に間違えた時だけ、Gemini APIが誤答パターンを分析し、弱点に合わせた類題を生成します（コスト最適化のため、全問でAIを呼び出す設計にはしていません）。
- 完全オフライン対応（IndexedDB + Service Worker）。学生側はアカウント登録不要・完全無料で利用できます。

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

過去問PDFはNotebookLMで抽出した後、`scripts/ce_exam_pipeline.py` の分類・解説生成パイプラインを通して問題バンク（xlsx）に整形し、Google Sheetsへ投入します。既卒生向けのリスタート支援（クラウド同期）にはSupabaseも併用しています。

## 技術スタック

| 領域 | 技術 |
|---|---|
| フロントエンド | React 18 + Vite + TypeScript（strict） + Tailwind CSS |
| PWA | vite-plugin-pwa（Workbox）+ Dexie.js（IndexedDB） |
| バックエンド | Google Apps Script（`gas-backend/src/`） |
| 問題バンク | Google Sheets |
| AI | Gemini API（`gemini-2.5-flash-lite`） |
| クラウド同期（既卒生向け） | Supabase（Postgres + RLS + RPC） |
| テスト | Vitest + React Testing Library |
| ホスティング | Vercel |

## ディレクトリ構成

```
memoria/
├── CLAUDE.md                  ← プロジェクト定義書
├── docs/                       ← データスキーマ・プロンプト設計・実装計画
├── gas-backend/src/            ← GASバックエンド（問題取得・回答記録・AI連携）
├── pwa-frontend/                ← React PWA本体
│   ├── public/data/             ← 学科別問題データ・カリキュラム・manifest
│   └── src/
│       ├── components/ hooks/ services/ types/ utils/
├── scripts/                     ← 過去問PDF→問題バンク変換パイプライン
├── supabase/                    ← 既卒生リスタート支援のDBスキーマ
└── {CE,CO,DH,NRS}国試data/      ← 学科別・過去問抽出データ（xlsx/PDF/画像）
```

## ローカル開発

```bash
cd pwa-frontend
npm install
npm run dev          # 開発サーバー
npm run validate     # データ整合性チェック（manifest・問題数・重複・画像・カリキュラム）
npm run validate:types
npm run test
```

GASバックエンドは `script.google.com` に個人アカウントからデプロイし、生成されたWebアプリURLを `pwa-frontend` の環境変数（`VITE_GAS_API_URL`）に設定します。詳細な運用ルールは `CLAUDE.md`、データスキーマは `docs/data-schema.md` を参照してください。

## 問題バンクの規模

学科別の問題数・バージョンは `pwa-frontend/public/data/manifest.json` が正本です（頻繁に更新されるため、ここには固定値を書きません）。2026-07-08時点では4学科合計で1万問弱を収録しています（実測値、詳細は同ファイル参照）。

## セキュリティについて

フロントエンド側の対策（XSS対策・CSP・入力検証・依存パッケージ監査）は継続的に実施しています。GASバックエンドの一部エンドポイントには既知の改善課題が残っており、対応を進めています（攻撃手順に直結する詳細は公開リポジトリの性質上ここには記載していません）。脆弱性を発見された場合は Issue ではなく直接ご連絡ください。

## ライセンス

コード（PWA・GASバックエンド・データパイプライン等）は [MIT License](./LICENSE) です。

**適用対象外**: `CE国試data/` / `CO国試data/` / `DH国試data/` / `NRS国試data/` に含まれる過去問データ（xlsx・PDF・画像）、および同内容を収録した `pwa-frontend/public/data/questions/*.json`（学科別問題バンク）は、出典・著作権の扱いが未整理のためMITライセンスの対象に含みません。これらの再利用可否は個別にご確認ください。
