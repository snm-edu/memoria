# ai_dashboard のゼロログ疑似行

## 何をするものか

`DashboardService.updateAll()` は回答ログを持つ studentId しか反復しないため、一度も問題を
解いていない学生は `ai_dashboard` に1行も書かれず、教員ダッシュボードの「要注意学生リスト」から
不可視だった。これを解消するため、名簿 `students` シートの `report_group` が空でない学生のうち、
回答ログに学籍番号が1度も現れない者について、`student_id = 'zerolog-{student_number}'` の
疑似行を日次バッチ（`runDashboardUpdate`、毎日4時、Head 駆動）で書き出す。

- 疑似行は `total_questions = 0` / `last_study_date = ''` / `ai_comment = ''` /
  `teacher_comment = 固定文言`。Gemini API は呼ばない。
- 疑似行は**毎回ゼロから作り直す**（削除→一括追記）。学生が学習を始めれば翌日の実行で自動的に消える。
  日中に学習を始めた場合は `refreshStudent`（PWAの⟳）が疑似行を実データで上書きする。
- `category_stats` には疑似行を書かない（リーフ単位で行数が爆発するため）。
- 1回の実行で作る疑似行の上限は `ZEROLOG_MAX_ROWS`（40）。超えたら**何も書かずに中止**する。
  `report_group` 列の運用が変わったときに、承認なく全名簿へ拡大するのを防ぐ安全弁。
- 名簿が読めない・0件のときは**既存の疑似行を消さずに中止**する（削除だけ済んで追加0件になると、
  直そうとしている症状に戻るため）。

## 疑似キーについて

`zerolog-` 接頭辞は v4 UUID（16進数字とハイフンのみ）とは原理的に衝突しない。
ただし `ai_dashboard.student_id` はログ由来の任意文字列であり UUID を強制していないので、
**`zerolog-` で始まる student_id を手で入れないこと**（日次バッチが削除対象とみなす）。

## デプロイ手順

**本番 Apps Script にはリポジトリに存在しないファイルが2つある（`ParentReport.js` / `VideoDemo.js`）。**
素の `clasp push` はこの2つを消す。以下のどちらかで更新すること。接続情報は非公開の
プロジェクトメモリ `project_memoria_gas_backend_deploy` を参照。

### 手順A: clasp
1. 一時ディレクトリで `clasp clone <SCRIPT_ID>`
2. `ls -1` で `ParentReport.js` / `VideoDemo.js` の存在を確認
3. `diff -rq` でリポジトリの `gas-backend/src` と突き合わせ、想定外の差分が無いことを確認
   （`src/.claude/` はリポジトリ側にだけあるディレクトリなので差分として出るのが正常）
4. `ParentReport.js` / `VideoDemo.js` に、追加するグローバル識別子と同名の定義が無いことを grep で確認
5. 変更したファイルだけを clone 先へ `cp` して `clasp push`
6. push 結果に `ParentReport.js` / `VideoDemo.js` が含まれることを確認

### 手順B: エディタ手貼り
1. 変更したファイルだけをエディタ上で作成／上書きして保存
2. 保存前に `ParentReport.js` / `VideoDemo.js` を開き、同名のグローバル関数・変数が無いことを確認
3. 保存後に両ファイルがファイル一覧に残っていることを確認

日次トリガー `runDashboardUpdate` は Head 駆動のため、保存だけで翌朝の実行に反映される。
Webアプリのデプロイ版再発行は不要（`/exec` の挙動は変えていない）。

## ロールバック手順

目的に応じて3段階ある。上から順に軽い。

### 1. シート上の疑似行だけを今すぐ消す（コードは残す）

Apps Script エディタに以下を貼って実行する。**実行後、この関数は削除すること。**
次回の日次バッチで疑似行はまた作られるので、恒久停止したい場合は 2 か 3 を行う。

    function removeZeroLogRowsOnce() {
      var ss = getSpreadsheet();
      var sheet = ss.getSheetByName(CONFIG.SHEETS.AI_DASHBOARD);
      if (!sheet) { Logger.log('ai_dashboard が無い'); return; }
      var blocks = groupContiguousDesc_(findZeroLogRowNumbersDesc_(sheet.getDataRange().getValues()));
      var removed = 0;
      for (var i = 0; i < blocks.length; i++) {
        sheet.deleteRows(blocks[i].start, blocks[i].count);
        removed += blocks[i].count;
      }
      Logger.log('疑似行を削除: ' + removed + '行');
    }

関数名の末尾にアンダースコアを付けないこと（Apps Script は `_` で終わる関数を private 扱いし、
エディタの実行対象一覧に出さないため実行できない）。
`DashboardZeroLogCore.gs` を先に消してしまった場合は、スプレッドシート上で `student_id` 列を
`zerolog-` で始まる行だけにフィルタして手で削除する。

### 2. コードを撤回する（疑似行の生成を止める）

    cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
    git log --oneline -- gas-backend/src/DashboardService.gs gas-backend/src/DashboardZeroLogCore.gs
    git revert --no-commit <疑似行ブロック追加のコミット>
    git commit -m "revert: ゼロログ疑似行の生成を一時停止"

その後、上の「デプロイ手順」に従って本番へ反映する。反映後に 1 を実行して残った疑似行を掃除する。

注意: 名簿読み取りの委譲リファクタ・`refreshStudent` の疑似行再利用・LockService の導入は
それぞれ別コミットで、疑似行の生成とは独立している。revert 対象は疑似行ブロックのコミットだけにすること。

### 3. Looker 側の変更を戻す

計算フィールドやフィルタを変更した場合、Looker Studio のレポート編集画面の「バージョン履歴」から
変更前の版に戻せる。数式を手で戻す場合は、本ファイルの「Looker 側の変更記録」に控えた
**変更前の数式**を使う。

## 既知の穴

- **単問回答経路だけで学習した学生は誤判定される。** PWA の `submitAnswer`
  （`pwa-frontend/src/services/api.ts:67-83`）は `studentNumber` をペイロードに含めないため、
  この経路だけで学習した学生は全ログ行の `student_number` が空になり、ゼロログと判定されて
  実データ行とは別に疑似行が出る。その学生が一度でもバッチ同期（`sync.ts:25-34`）した時点で
  翌日の実行から解消する。恒久対処は `submitAnswer` に `studentNumber` を含めること（別issue）。
- **`report_group` が空欄の学生（在校生）は Stage 1 の対象外。** 全名簿への拡張は別途承認が必要。
- **判定の追随粒度は日次。** 日中の遷移は `refreshStudent` が疑似行を上書きすることで吸収する。
- **名簿の `student_number` が重複している行は先勝ちで1件だけ疑似行になる。** 除外件数は実行ログに出る。
- **疑似行から教員向けのリンク（AI分析・補講ワークシート）を開いたときの表示は整っていない。**
  詳細と対処は非公開メモ `project_memoria_dashboard_zerolog_private` を参照（下の「未実装の対処」節も参照）。
- **Looker の計算フィールドのうち `worksheet_url` / `teacher_ai_url` / `象限判定` の3つは、
  疑似行での挙動を未検証。** 検証済みは `学年ラベル` / `未学習日数` / `リスク判定` の3つのみ。

## `withDashboardLock_` を触るときの警告（重要）

`LockService.getScriptLock()` は **Apps Script プロジェクト単位の単一ロック**で、
このプロジェクト内の複数のサービスが同じロックを共有している。

**禁止事項: `withDashboardLock_` のコールバック内に、外部API呼び出し（Gemini・UrlFetchApp）や
全ログ走査などの重い処理を入れてはならない。** 現状の中身は「シートを1回読む → 行を削除 → 1回書く」
だけで保持時間は短い。重い処理を入れると他サービスに波及する。
`generateAiComment` は意図的にロック区間の外に置いてあるので、この配置を崩さないこと。

共有相手の一覧・各所の待ち時間・波及の具体的な影響は、CLAUDE.md の方針
（「このリポジトリは Public のため、攻撃手順に直結する詳細はここには記載しない」）に従い
**非公開のプロジェクトメモリ `project_memoria_dashboard_zerolog_private` に記載**している。

## 未実装の対処と残存リスク（ユーザー判断）

計画書 Task 10「疑似行から『教員向けAI分析』を開いたときのガード」は
**ユーザー判断により未実装（2026-08-23）**。`TeacherCommentService.generateAndDisplay` に
疑似行用の分岐は入っていない。疑似行から教員向けリンクを開いたときの表示は
条件によって整っていない（表示先は認可済みの教員のみ）。

**未実装の内容・発火条件・想定される影響・後日の対処手順は、CLAUDE.md の方針に従い
非公開のプロジェクトメモリ `project_memoria_dashboard_zerolog_private` に記載している。**
実装を再開するときは必ずそちらを読むこと（計画書 Task 10 のコードをそのまま適用してはいけない
理由もそこに書いてある）。

なお計画書 Task 9（`refreshStudent` の疑似行再利用）と Task 11 分岐A（LockService の導入）は
**承認済みで実装している**。Task 11 分岐B（`ImportService` の警告ダイアログ）は分岐A採用のため不要。

## 実機検証記録

**2026-08-23 09:30 に本番で初回実行**（スプレッドシートの `メモリア管理 > 🤖 AIダッシュボード更新` から手動実行）。

実行ログ（Apps Script の実行数画面より原文）:

    9:31:03  ダッシュボード更新完了: 43名（学生AI: 生成 0名 / 再利用 43名、教員AI: 生成 0名 / 再利用 43名）
    9:31:13  category_stats更新: 12685行（学習済=778, 未着手=11907, 学生数=43）
    9:31:13  ゼロログ疑似行: 名簿 138件 / コホート対象 24件 / ログ有りで除外 2件 /
             学籍番号重複で除外 0件 / report_groupがboolean 0件 / 疑似行の対象 22件（うち学科が空 0件）
    9:31:14  ゼロログ疑似行: 削除 0行 / 追加 22行
    9:36:54  エラー 起動時間の最大値を超えました

シート実測: `ai_dashboard` の行45〜66に22行が生成された。`student_id` は `zerolog-{学籍番号}`、
`grade` は数値4、`total_questions`/`correct_rate`/`streak_days` は 0、JSON列は `[]`、
`last_study_date` は空、`teacher_comment` は固定文言。**設計どおり。**

**注意1: 6分の実行時間上限。** 最後の「起動時間の最大値を超えました」は、`updateAllDashboards`
（`ImportService.gs:465`）が `updateAll()` の後に出す `ui.alert()` のモーダルを開いたまま放置したため。
Apps Script はダイアログ表示中も実行を継続扱いにするので、6分放置すると強制終了する。
**疑似行の書き込み自体は 9:31:14 に完了しているので実害は無い。** 日次トリガー
`runDashboardUpdate` はアラートを出さないためこの事象は起きない。手動実行するときは
アラートの OK をすぐ押すこと。

**注意2: シートの反映が数分遅れて見えることがある。** 9:33頃に `ai_dashboard` を開いた時点では
44行目までしか見えなかったが、後で開き直すと22行が存在した。書き込み直後に「行が無い」と
判断しないこと。

**内訳の妥当性**: 既卒生24名のうち2名は回答ログがあるため除外され、残り22名が疑似行になった。
これは別GAS「メモリア週次レポート」の集計（対象24名・実施者は少数）と整合する。

## Looker 側の変更記録

### 変更前の数式（2026-08-23 に `ai_dashboard` データソースの編集画面で読み取り。**まだ何も変更していない**）

データソース `NRSメモリア問題バンク（削除NG） - ai_dashboard`（エイリアス `ds2`・24グラフで使用）の
計算フィールドは `teacher_ai_url` / `worksheet_url` / `リスク判定` / `学科ラベル` / `学年ラベル` /
`象限判定` / `未学習日数` の7つ。ロールバック時はこの控えを使う。

`未学習日数`（フィールドID `calc_j6s7jtwy2d`）:

    DATE_DIFF(CURRENT_DATE(), 最終学習日)

`リスク判定`（フィールドID `calc_knyp78wy2d`）:

    CASE
      WHEN 未学習日数 >= 14 THEN "🔴長期未学習"
      WHEN 未学習日数 >= 7 AND 全体正答率 < 60 THEN "🔴要面談"
      WHEN 未学習日数 >= 7 THEN "🟡未学習"
      WHEN 全体正答率 < 60 THEN "🟡低正答率"
      ELSE "🟢順調"
    END

`学年ラベル`（フィールドID `calc_y9tep1yy2d`）:

    CASE
      WHEN 学年 = 1 THEN "1年"
      WHEN 学年 = 2 THEN "2年"
      WHEN 学年 = 3 THEN "3年"
      WHEN 学年 = 4 THEN "卒業生"
      ELSE CAST(学年 AS TEXT)
    END

### 数式から予測される疑似行の扱い（**未検証。疑似行がまだ存在しないため実測できていない**）

- `学年ラベル`: 名簿の既卒生は全員 `grade=4` なので **「卒業生」と出るはず**。問題なし。
- `未学習日数`: `最終学習日` が空 → NULL → `DATE_DIFF` は **NULL を返すはず**。
- `リスク判定`: 上の NULL により最初の3分岐は成立せず、4番目の `全体正答率 < 60` が
  `correct_rate = 0` で成立する。よって **NULL ではなく「🟡低正答率」になるはず**。
  一度も学習していない学生が「低正答率」と表示されるのは意味的に誤りで、
  最優先で声をかけるべき対象が「🔴長期未学習」より下位に見える。
- 「要注意学生リスト」は `未学習日数` の降順で並んでいる。NULL の行がどこに並ぶかは
  Looker の NULL 順序次第で、**末尾に沈む可能性が高い**。そうなると教員がリスト上部を見ても
  未着手の学生に気づけず、今回直そうとしている症状が別の理由で再発する。

### 実測結果（2026-08-23 09:40 頃・疑似行が生成された後に確認）

**上の予測は3点とも当たっていた。**

- `学年ラベル` → 「卒業生」。問題なし（予測どおり）。
- `未学習日数` → **null**（空欄表示）。
- `リスク判定` → **「🟡低正答率」**。NULL ではなく4番目の分岐に落ちた（予測どおり）。
- 「要注意学生リスト」は `未学習日数` の降順ソートなので、疑似行は**全員リストの最下部**に沈み、
  実施済みの学生（🟢順調）より下に並んだ。一度も学習していない学生が最も見えない位置になる。

### 適用した変更（2026-08-23・ユーザー承認のうえ実施）

データソース `ai_dashboard`（`ds2`）の計算フィールド2つを変更した。**変更前の数式は上に控えてある。**

`未学習日数`（`calc_j6s7jtwy2d`）:

    IFNULL(DATE_DIFF(CURRENT_DATE(), 最終学習日), 9999)

`リスク判定`（`calc_knyp78wy2d`）— **先頭に1分岐を追加しただけ**、既存の5行は無変更:

    CASE
      WHEN 総解答数 = 0 THEN "⚫未着手"
      WHEN 未学習日数 >= 14 THEN "🔴長期未学習"
      WHEN 未学習日数 >= 7 AND 全体正答率 < 60 THEN "🔴要面談"
      WHEN 未学習日数 >= 7 THEN "🟡未学習"
      WHEN 全体正答率 < 60 THEN "🟡低正答率"
      ELSE "🟢順調"
    END

**変更後の実測**:
- 「要注意学生リスト」の1〜22位が `⚫未着手`（未学習日数 9999）になり、**最上位に並ぶ**ようになった。
- 23位以降は従来どおり `🔴長期未学習`（未学習日数 139/138/…）で、**既存行に回帰なし**を目視確認。
- 見出しの「⚠7日以上未学習（人）」が **42 → 64**（+22）に増えた。意味的には正しいが、
  過去の数値と比較するときはこの日を境に定義が変わっている点に注意。

**なぜ 9999 か**: 疑似行は「一度も学習していない」ので日数を計算できない。ソートを最上位にする
ためのセンチネル値であり、実際の日数ではない。`⚫未着手` ラベルと併せて読むこと。
既存行は必ず `最終学習日` を持つので `IFNULL` は発火せず、影響を受けない。

### 追加で見つかった回帰と修正（2026-08-23・初回デプロイの後）

**症状**: 見出しの「平均正答率（%）」が **24.9 → 16.5** に落ちた（総回答数は 769 で不変）。
疑似行22件の `correct_rate` に数値 `0` を書いていたため、Looker の平均の母数に 0% として
混ざったのが原因。一度も解いていない学生の正答率を 0% として平均するのは誤り。

**修正**: `buildZeroLogDashboardRow_` の `correct_rate` を数値 `0` から**空文字**に変更した。
これは `updateCategoryStats:308` が既に採っている「未着手は空値（Looker で null 扱い）」という
**このリポジトリ自身の規約**に揃えたもの。`リスク判定` は先頭の「総解答数 = 0 なら ⚫未着手」で
先に確定するため、`全体正答率` が null になってもラベルは変わらない。

**教訓**: 疑似行に入れる「0」は、それが本当に 0 なのか（`total_questions`・`streak_days` は本当に 0）、
「値が無い」なのか（`correct_rate` は無い）を列ごとに区別すること。前者は 0、後者は空値。

## デプロイ実施記録

**2026-08-23 09:01 に本番へ反映（手順A: clasp push）**

- 反映内容: `DashboardService.gs` 1184→1355行 / `TeacherCommentService.gs` 383→387行 /
  `DashboardZeroLogCore.gs` 326行を新規追加。本番のファイル総数 19→20。
- 本番限定の `ParentReport.js`(12,482 bytes) / `VideoDemo.js`(3,953 bytes) は**保持**（push 後に
  別ディレクトリへ再 clone して diff で確認済み。バイト数も一致）。
- Webアプリのデプロイ版は**再発行していない**（日次トリガー `runDashboardUpdate` は Head 駆動のため不要）。
- push 前の検査（すべて0件）: リポジトリ内の定義重複／`ParentReport.js`・`VideoDemo.js` との
  グローバル名衝突／clone ディレクトリへの `.gs` 混入／basename の重複。

**手順の罠（実施時に判明）:** clone されるファイルは全て `.js` だが `.clasp.json` の
`scriptExtensions` は `[".js", ".gs"]` の**両方**。リポジトリの `.gs` をそのままの名前でコピーすると
同名の `.js` と `.gs` が別ファイルとして両方 push され、`const DashboardService` が二重宣言になって
**本番プロジェクト全体が構文エラーで停止する**。必ず `.js` 名で上書きすること。
