#!/bin/bash
# ナースメモリア（Nurse Memoria）初期セットアップ
# Claude Codeの作業ディレクトリで実行してください

set -e

PROJECT_DIR="nurse-memoria"

echo "=== ナースメモリア プロジェクト初期化 ==="

# ルートディレクトリ
mkdir -p $PROJECT_DIR

# GASバックエンド
mkdir -p $PROJECT_DIR/gas-backend
cat > $PROJECT_DIR/gas-backend/README.md << 'EOF'
# GAS バックエンド

Google Apps Scriptで実装するAPIサーバー。
Ultraアカウントの個人GASからデプロイする。

## ファイル構成
- `Code.gs` — メインエントリ（doGet/doPost）
- `QuestionService.gs` — 問題取得ロジック
- `AnswerService.gs` — 回答記録・SM-2計算
- `GeminiService.gs` — Gemini API連携（誤答分析・類題生成）
- `Config.gs` — 設定値（SheetID, APIキー等）

## デプロイ手順
1. script.google.com で新規プロジェクト作成
2. 各 .gs ファイルをコピー
3. 「デプロイ」→「ウェブアプリ」→「全員がアクセス可能」
4. 生成されたURLをPWAの環境変数に設定
EOF

# PWAフロントエンド（後でVite initで上書き）
mkdir -p $PROJECT_DIR/pwa-frontend/src/{components,hooks,services,types,utils}
mkdir -p $PROJECT_DIR/pwa-frontend/public

# ドキュメント
mkdir -p $PROJECT_DIR/docs
cat > $PROJECT_DIR/docs/sheets-template.md << 'EOF'
# Google Sheets 問題バンク テンプレート設計

## セットアップ手順

1. Ultraアカウントで新規スプレッドシート作成
2. 「ナースメモリア 問題バンク」と命名
3. 以下の3シートを作成:
   - `questions` — 問題マスタ
   - `student_logs` — 学習履歴
   - `ai_generated` — AI生成類題
4. 各シートのヘッダー行をCLAUDE.mdのスキーマ通りに設定
5. 4学科ファミリーアカウントに閲覧権限を共有
6. SpreadsheetIDをメモ（GAS Config.gsに設定）

## シートID取得方法
URLの `https://docs.google.com/spreadsheets/d/{ここがID}/edit` の部分
EOF

# notebooklm-py 関連
mkdir -p $PROJECT_DIR/scripts
cat > $PROJECT_DIR/scripts/README.md << 'EOF'
# スクリプト集

## notebooklm-py セットアップ
```bash
pip install notebooklm
notebooklm auth login
```

## PDF → 問題バンク変換フロー
1. NotebookLMに国試PDFをアップロード
2. notebooklm-pyでクイズJSON出力
3. JSON → Sheets変換スクリプトで問題バンクに投入
EOF

# CLAUDE.md をルートにコピー
echo "CLAUDE.md は既に作成済みです"

echo ""
echo "=== 完了 ==="
echo "プロジェクト構造:"
find $PROJECT_DIR -type f | head -20
echo ""
echo "次のステップ:"
echo "1. このディレクトリをClaude Codeで開く"
echo "2. 'CLAUDE.mdを読んでStep 1から開始して' と指示"
