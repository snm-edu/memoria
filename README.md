# ナースメモリア（Nurse Memoria）— Claude Code 引き継ぎガイド

## このプロジェクトについて

看護系専門学校（4学科・600名）向けの国家試験対策アダプティブラーニングPWA。
Google AI Ultra環境で完結する設計。

## Claude Codeでの開始手順

### 1. プロジェクトフォルダを準備

```bash
# Claude Codeの作業ディレクトリにコピー
cp -r nurse-memoria/ /Users/ny/Documents/ClaudeCode/nurse-memoria/
cd /Users/ny/Documents/ClaudeCode/nurse-memoria/
```

### 2. Claude Codeで開く

```bash
claude
# Claude Codeが起動したら:
# > CLAUDE.mdを読んで、Step 1（問題バンク基盤）から開発を開始してください
```

### 3. 推奨する開発の進め方

Claude Codeには以下の順で指示を出す:

#### Round 1: GASバックエンド
```
CLAUDE.mdのPhase 2に基づいて、GASバックエンドの全ファイルを作成してください。
- Code.gs（doGet/doPost ルーター）
- QuestionService.gs（問題取得）
- AnswerService.gs（回答記録）  
- GeminiService.gs（Gemini API連携）
- Config.gs（設定）
```

#### Round 2: PWAフロントエンド初期構築
```
CLAUDE.mdのPhase 3に基づいて、Vite + React + TypeScript + Tailwind の
PWAプロジェクトを初期化してください。
- 初回セットアップ画面（学科・学年選択）
- クイズ画面（4択タップ式）
- SM-2間隔反復エンジン
- IndexedDB（Dexie.js）セットアップ
```

#### Round 3: AI機能統合
```
CLAUDE.mdのPhase 4のプロンプト設計に基づいて、
GASのGeminiService.gsとPWAのAI分析画面を実装してください。
```

#### Round 4: 仕上げ
```
PWA manifest、Service Worker、オフライン対応、
弱点マップ、復習スケジュール画面を実装してください。
```

## ファイル構成

```
nurse-memoria/
├── CLAUDE.md              ← プロジェクト定義書（最重要）
├── README.md              ← この文書
├── setup.sh               ← 初期セットアップスクリプト
├── gas-backend/           ← Google Apps Script
│   └── README.md
├── pwa-frontend/          ← React PWA（Vite）
│   ├── public/
│   └── src/
│       ├── components/    ← UIコンポーネント
│       ├── hooks/         ← カスタムフック
│       ├── services/      ← API通信・SM-2ロジック
│       ├── types/         ← TypeScript型定義
│       └── utils/         ← ユーティリティ
├── scripts/               ← PDF変換・データ投入スクリプト
└── docs/                  ← 設計ドキュメント
    └── sheets-template.md
```

## 環境変数（PWA側 .env）

```env
VITE_GAS_API_URL=https://script.google.com/macros/s/xxxxx/exec
VITE_APP_NAME=ナースメモリア
```

## 環境変数（GAS側 Config.gs）

```javascript
const CONFIG = {
  SPREADSHEET_ID: 'xxxxx',          // 問題バンクSheetsのID
  GEMINI_API_KEY: 'xxxxx',          // AI Studio発行のAPIキー
  GEMINI_MODEL: 'gemini-3.1-pro',   // 使用モデル
  MAX_AI_CALLS_PER_STUDENT_DAY: 5,  // 1学生あたり日次AI呼び出し上限
};
```
