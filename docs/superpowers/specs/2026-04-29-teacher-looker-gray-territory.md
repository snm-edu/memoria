# 教員 Looker ダッシュボード グレー領域追加 — 移行運用メモ

**対象**: 設計書 §6.6 「教員 Looker との整合性」の保留分
**実装日**: 2026-04-29
**関連コミット**: (デプロイ時に追記)

## 何が変わったか

`category_stats` シートのスキーマを拡張し、学生×curriculum マスタ全リーフ(未着手領域も含む)を行として書き出すようにした。

### スキーマ変更

| カラム | 変更 | 説明 |
|--------|------|------|
| 1-12 | 既存 | `student_id` 〜 `last_study_date` (変更なし、列順保持) |
| **13** | **新規** | `confidence` — `high` / `low` / `none` |
| **14** | **新規** | `total_questions_master` — 出題マスタの問題数 |

`accuracy_rate` は未着手行 (total_count=0) で **空値** を書き込む (旧仕様の `0` から変更)。Looker 側で「未着手は色塗りせずグレー」を表現するため。

### 行数の増加

| 項目 | 旧 | 新 (見込み) |
|------|----|-----------|
| 平均行数/学生 | ~30 (解答済のみ) | ~50-150 (curriculum累積範囲) |
| 600名×4学科の総行数 | ~18,000 | ~30,000-90,000 |

Sheets 上限 (1000万セル) からは余裕がある。

## デプロイ手順 (GAS エディタで手動実行)

### 1. 事前準備

学校稼働時間外に実施推奨 (午前4時の自動バッチ前後を避ける)。バックアップ用に `category_stats` シートを別シートにコピーしておく。

### 2. GAS デプロイ

```
gas-backend/src/Config.gs           ← 修正
gas-backend/src/CurriculumService.gs ← 新規
gas-backend/src/DashboardService.gs ← updateCategoryStats 拡張
gas-backend/src/TreemapService.gs   ← recomputeCategoryStats 拡張・テスト関数追加
```

`clasp push` または GAS エディタへ手動コピーペースト。

### 3. curriculum シードを実行

GAS エディタで `seedCurriculumSheet()` を実行。
→ `curriculum` シートに 4 学科 × 各学年のカテゴリ(計 ~600 行)が書き込まれる。
ログ「curriculum シード完了: N 行」を確認。

### 4. 動作確認 (任意)

```
testLoadCurriculum()                       // curriculum 読込確認
testRecomputeCategoryStatsWithUnstudied()  // 1 学生で新スキーマ確認 (snm)
```

### 5. 全件再計算

`runDashboardUpdate()` を手動実行。完了後 `category_stats` シートを開いて確認:
- 列 M (confidence) と 列 N (total_questions_master) が追加されていること
- `confidence='none'` の行が多数存在すること
- 学生 1 名ごとの行数が以前より大幅に増えていること

## Looker Studio 側の更新

### 現状の Looker レポート

教員ダッシュボード (現状の Looker レポート) は `category_stats` をデータソースとし、ツリーマップ + フィルタコントロールで運用。

### 必須の調整

新しい `confidence` フィールドが Looker のスキーマに反映されないため、**データソースの「フィールドを更新」を必ず実行**する。

### 推奨: 計算フィールドの追加

```
# 計算フィールド: rate_for_color
CASE
  WHEN confidence = "none" THEN NULL
  ELSE accuracy_rate
END
```

ツリーマップの色指標を `rate_for_color` に変更すると、未着手リーフが灰色になり「学生がまだ解いていない領域」が視覚的にわかる。

### ツリーマップのサイズ指標

旧: `total_count` の合計 (解答数ベース)
新: `total_questions_master` の合計 (出題マスタベース)

学生がどれだけ解いたかではなく **「出題範囲のうちどこを解いていないか」が見える**ようになる。サイズも `total_questions_master` を SUM すると curriculum 全体マップ表示になる。

### フィルタコントロール追加

`confidence` フィールドを Looker のフィルタコントロールに追加すると、教員が以下の切り替えができる:

| フィルタ値 | 用途 |
|-----------|------|
| `none` | 未着手領域のみ (進捗の遅い学生洗い出し) |
| `low` | 暫定評価のみ (5問未満で確定できない領域) |
| `high` | 信頼できる正答率 (補講判断材料) |
| (全選択) | 旧来表示 |

### 既存ビューを壊さないために

`confidence != "none"` で既定フィルタしたコピービューを 1 枚作っておくと、旧レポート互換ビューとして残せる。教員様への周知時に「従来表示 (互換ビュー) / 新ビュー (グレー領域あり)」の 2 つを案内できる。

## ロールバック手順

万一トラブル発生時:

1. `category_stats` シートを Step 1 で取ったバックアップから復元
2. GAS の DashboardService.gs と TreemapService.gs を 1 つ前のリビジョンに戻す
3. Looker のデータソースを「フィールドを更新」して旧スキーマに戻す

`curriculum` シートと `CurriculumService.gs` は残しておいて問題なし (使われない状態になるだけ)。

## 既存学習履歴への影響

学生 PWA 側の `getStudentTreemap` は `category_stats` を「学習済みマップ (LEFT)」として参照するのみ。マスタは `questions` シートから直接構築するため、`category_stats` の行増加は影響しない。

`buildLearnedMap` は `total_count=0, correct_count=0` の未着手行を読み込むが、`mergeLeafs` の if (l.answered > 0) 等のガードで no-op になる (検証済)。

## 関連 Phase

- 学生用 Phase A/B/C: 完了済
- 教員 AI コメント (Phase D-2): 別途提案予定
- 教員専用 PWA ビュー (Phase E): 中期検討
