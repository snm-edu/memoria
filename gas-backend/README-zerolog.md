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
- Looker から疑似行の「教員向けAI分析」を開くと、日次バッチから24時間を超えている場合にエラーページ（`対象学生の学習データが見つかりません (studentId=zerolog-…)`）が出る。Task 15 のチェックリストで挙動を確認すること（対処はユーザー判断により見送り）。

## `withDashboardLock_` を触るときの警告（重要）

`LockService.getScriptLock()` は **Apps Script プロジェクト単位の単一ロック**であり、
このプロジェクトでは既に7箇所が同じロックを取っている（2026-08-23 時点の実測）:

| 取得箇所 | 待ち時間 |
|---|---|
| `AnswerService.gs:45`（`submitAnswer`） | `waitLock(10000)` |
| `AnswerService.gs:134` | `waitLock(30000)` |
| `ArchiveService.gs:47` | `waitLock(30000)` |
| `ProspectiveService.gs:27` | `waitLock(10000)` |
| `GeminiService.gs:174` | `waitLock(10000)` |
| `VideoService.gs:117` | `waitLock(10000)` |
| `DashboardService.gs:511`（`withDashboardLock_`・今回追加） | `tryLock(20000)` |

つまり **`withDashboardLock_` の中に置いた処理は、その間ずっと全学生の回答送信
（`submitAnswer`）をブロックする**。現状の中身は「シートを1回読む → 行を削除 → 1回書く」だけで
保持時間は短く、`submitAnswer` の10秒待ちに収まるため実害は無い。

**禁止事項: `withDashboardLock_` のコールバック内に、外部API呼び出し（Gemini・UrlFetchApp）や
全ログ走査などの重い処理を入れてはならない。** 入れると回答送信がロックタイムアウトで
失敗しはじめる。現在 `generateAiComment` は `refreshStudent` の 1102 行（ロック開始の 1140 行より前）に
あり、意図的にロックの外に置いてある。この配置を崩さないこと。

## 未実装の対処と残存リスク（ユーザー判断）

計画書 Task 10「疑似行から『教員向けAI分析』を開いたときのガード」は
**ユーザー判断により未実装（2026-08-23）**。`TeacherCommentService.generateAndDisplay` に
疑似行用の分岐は入っていない。

残るリスクは次のとおり。

> バッチが1日飛んだ状態で疑似行から教員向けAI分析を開くと、`generateFresh` がエラーページを返し
> 内部ID `zerolog-{学籍番号}` が露出する。この内部IDは学籍番号を含むため、露出は学籍番号の露出でもある。
> ユーザー判断により今回はガードを入れていない（2026-08-23）。

補足:
- 日次バッチが正常に回っていれば、`getCachedComment` が24時間以内（`CACHE_HOURS: 24`）の
  固定文言を返すため、この経路は固定文言の表示で済み実害は無い。露出が起きるのは
  **バッチが失敗・停止して24時間を超えた場合**に限られる。
- 露出先はそのリンクを開いた閲覧者（教員）の画面であり、学生や外部には出ない。
- 後日ガードを入れる場合は、計画書 Task 10 Step 2 のコード（`ZEROLOG_ID_PREFIX` で始まる
  studentId を `renderCommentPage` に直接流す分岐）をそのまま適用できる。

なお計画書 Task 9（`refreshStudent` の疑似行再利用）と Task 11 分岐A（LockService の導入）は
**承認済みで実装している**。Task 11 分岐B（`ImportService` の警告ダイアログ）は分岐A採用のため不要。

## 実機検証記録

（Task 14 で追記）

## Looker 側の変更記録

（Task 15 で追記）
