# Phase D-3 学生・教員双方の体験強化 — 設計と運用メモ

**実装日**: 2026-04-30
**スコープ**: 学生 PWA と教員ダッシュボードの UX を実用的な3機能で強化する。

3つの独立した機能を 1 phase に同梱。共通点は「既存データから新たな価値を引き出す」設計で、新規スキーマや大規模リファクタを伴わない。

## 機能1: 国試までのカウントダウン (学生 PWA)

### 配置

ホーム画面のメイン学習ボタン (今日の復習) カード内、ボタン直下の補足テキスト枠を流用。
- 旧テキスト: `{grade}年生の範囲から出題（{gradeQuestionCount}問）`
- 新テキスト: `🎯 {国試名}まで {残り日数}`

UI 影響: 同じスタイル (`text-xs text-slate-400 mt-2`) で文字を入れ替えるのみ。レイアウト変更なし。

### 国試日推定値 (公示前の暫定)

| 学科 | 推定日 | 根拠 |
|------|------|------|
| 看護師国家試験 | 2/15 | 例年 2月第3日曜日付近 |
| 臨床工学技士国家試験 | 3/3 | 例年 3月第1日曜日付近 |
| 歯科衛生士国家試験 | 3/3 | 例年 3月第1日曜日付近 |
| 視能訓練士国家試験 | 2/22 | 例年 2月最終木曜日付近 |

公式日程は厚労省から前年9月頃に公示される。公示後は `pwa-frontend/src/config/examDates.ts` の `EXAM_DATE_ESTIMATES` を更新する運用。

### 学年→国試年の自動算出

```
academicYear = (現月 >= 4) ? 現年 : 現年 - 1
enrollmentYear = academicYear - (grade - 1)
examYear = enrollmentYear + 3   // 3年制前提
```

例 (2026-04-30 時点):
- grade=3: enrollmentYear=2024 → examYear=2027
- grade=2: enrollmentYear=2025 → examYear=2028
- grade=1: enrollmentYear=2026 → examYear=2029

### 表示フォーマット

| 残日数 | 表示例 |
|------|------|
| 30日以上 | `あと 1年9ヶ月14日` (年月日換算、ゼロパートは省略) |
| 30日未満 | `あと27日` |
| 当日 | `いよいよ本日` |
| 過ぎている | `終了` |

### 実装

- 新規: `pwa-frontend/src/config/examDates.ts`
- 修正: `pwa-frontend/src/components/dashboard/HomeScreen.tsx` (1箇所)

## 機能2: 同学年内の匿名位置表示 (学生 PWA)

### 配置

弱点マップ画面の **TreemapBreadcrumb** と **TreemapLegend** の間にスリムな1行カード。
- Treemap 本体 (`min-h-[55dvh]`) を圧迫しない高さ
- 既存ヘッダー・パンくず・凡例のレイアウト変更なし

### カード構成

```
┌────────────────────────────────────────────────┐
│ 📊 同学年比較 ({deptLabel} {grade}年)    {段階バッジ} │
│  ━━━━━━━━━━●━━━━━━━━━━━━━              │
│   育成中           中位           上位          │
└────────────────────────────────────────────────┘
```

- ●マーカー: 自分のパーセンタイル位置 (right=top)
- 段階バッジ: 🏆トップ層 / ↑上位 / →中位 / 🌱育成中

### 比較指標 (総合学習スコア)

```
score = correctRate × 0.5
      + (totalQuestions / cohort内最大値 × 100) × 0.3
      + (streakDays / cohort内最大値 × 100) × 0.2
```

3 指標バランス:
- **正答率のみ**: 少なく解いて高正答率な学生が有利
- **解答量のみ**: 下手でも量で勝てる
- **3指標合成**: 正確さ・努力量・継続性をバランス評価

### プライバシー設計

| ケース | 挙動 |
|------|------|
| cohort < 5 | カード非表示 (`available: false`) |
| 解答 < 5問 の学生 | cohort から除外 |
| 順位の数値表示 | 一切返さない (パーセンタイルのみ) |
| 段階表現 | 4段階 (top/upper/middle/developing) |
| 下位20%の表現 | "developing" (=育成中) ポジティブ語 |

### 段階区分

| パーセンタイル | rankBand | 表示 |
|------------|---------|------|
| 1〜20 | top | 🏆 トップ層 |
| 21〜40 | upper | ↑ 上位 |
| 41〜60 | middle | → 中位 |
| 61〜100 | developing | 🌱 育成中 |

### バックエンド実装

新規エンドポイント: `GET /exec?action=getMyRanking&studentId=xxx`

ai_dashboard シートから on-demand 集計 (600名×簡単な計算なので軽量、新シート不要)。

```javascript
// gas-backend/src/RankingService.gs
RankingService.getMyRanking(studentId) → {
  cohortName, cohortSize, myPercentile, rankBand, available
}
```

### フロントエンド実装

- 新規: `pwa-frontend/src/services/rankingApi.ts`
- 新規: `pwa-frontend/src/components/dashboard/treemap/ClassRankingCard.tsx`
- 修正: `pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx`

API エラー時はカードを silent hide する設計 (UX を阻害しない)。

## 機能3: 補講ワークシート自動生成 (教員専用)

### ユースケース

教員が補講準備時、学生1名の弱点 Top3 から 20 問の演習問題セットを 1 クリックで生成。
PDF メール送信 + Google Doc URL を返却。

### URL 形式

```
GET /exec?action=getWorksheet&studentId=xxx[&count=20]
```

count: 5〜50 問 (デフォルト 20、範囲外はクランプ)。

### Looker からの起動 (推奨)

教員ダッシュボードの個別学生分析セクションに以下の計算フィールドを追加:

```
worksheet_url = CONCAT(
  "https://script.google.com/macros/s/<DEPLOY_ID>/exec?action=getWorksheet&studentId=",
  学生ID
)
worksheet_label = "📚 補講ワークシート作成"
```

ハイパーリンクとして配置 → 新タブで開いて生成完了。

### 認証

`TeacherCommentService.isAuthorizedTeacher` を再利用 (allow-list 共通)。
学生 PWA からのアクセスは Session.getActiveUser().getEmail() が allow-list 不一致で 403。

### 問題選定ロジック

1. **学科フィルタ**: 学生の `department` に該当する問題のみ抽出
2. **カテゴリ Top3**: `DashboardService.buildCategoryPriorities` 上位 3 件
3. **カテゴリ別配分** (count=20 の場合):
   - 1位カテゴリ: 10 問 (50%)
   - 2位カテゴリ: 6 問 (30%)
   - 3位カテゴリ: 4 問 (20%)
4. **カテゴリ内優先度**:
   - ① 学生未着手 (重要)
   - ② 既解答+不正解 (復習)
   - ③ 既解答+正解 (確認)
   - 各カテゴリで shuffle して配分

### 出力ドキュメント構成

#### Section 1: 表紙
- 学生情報テーブル (氏名・学籍番号・学科・作成日・作成者)
- 補講テーマ (優先カテゴリ Top3 と出題比重・現状)

#### Section 2: 問題編 (改ページ後)
- 問題文 + 選択肢 A〜E (E は5択時のみ)
- 「回答: [   ]」 欄

#### Section 3: 解答一覧 (改ページ後)
- 5問ずつ整列
- 「採点結果: ___ / N問 (___%)」

#### Section 4: 解説編 (改ページ後)
- 「※ 自己採点後にお読みください」 注記
- 各問の正解 + 解説

### ファイル管理

- Google Doc は GAS 実行アカウント (snm) の Drive に作成される
- 教員には Editor 権限を付与 → 自分でメモ追記可能
- PDF はメール添付で配信 (印刷・配布用)
- 命名: `補講ワークシート_{学生氏名}_{YYYYMMDD_HHmm}`

### コスト

- Gemini 呼出なし (問題抽出のみ)
- DocumentApp / MailApp は GAS 標準 (無料枠内)
- 1回の生成あたり実行時間 ~10〜20秒

### 実装

- 新規: `gas-backend/src/WorksheetService.gs`
- 修正: `gas-backend/src/Code.gs` (`getWorksheet` ルーター追加)

## 関連 Phase との位置づけ

- Phase D-1: 教員 Looker グレー領域 (完了)
- Phase D-2a: 教員向け AI コメント / 日次バッチ (完了、別書 `2026-04-30-teacher-ai-comment.md`)
- **Phase D-3 (本書)**: 国試カウントダウン + 同学年比較 + 補講ワークシート

## 運用上の注意

### 国試日が公示されたら

`pwa-frontend/src/config/examDates.ts` の値を更新するだけ。学年×学科の自動計算ロジックは変更不要。

### 同学年比較の実本番化

テスト学生だけだと cohort < 5 で非表示。実学生 5名以上が同学科×学年に登録されてから初めて表示される。

### 補講ワークシート作成 Looker ボタンの再導入

「AI分析実行」ボタンを以前削除した時と同様、計算フィールドとハイパーリンクテーブルを追加する。
教員に対して使い方を周知する際は、メールで PDF が届くことを明示。

## 既知の制約

1. **国試日推定の精度**: 公示前は ±数日のズレが生じる。学生は概算として理解する必要あり
2. **同学年比較の解答数しきい値**: 5問未満の学生は cohort 除外 → 学期初頭は cohort が小さくなりがち
3. **補講ワークシート Drive 蓄積**: snm アカウントの Drive に Doc が累積する。定期的に古いファイルの整理が必要 (将来的に自動アーカイブ機能を検討)
4. **問題シート依存**: questions シートに `difficulty` / `explanation` が空の問題があると、ワークシートが見栄え悪くなる
