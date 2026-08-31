# LLM プロバイダ切替（Gemini ⇄ OpenAI GPT-5.6 Luna）

メモリア本体 GAS の AI 呼び出しは `callLLM()` に一本化されている。
プロバイダはスクリプトプロパティで切り替える。全体設定 `LLM_PROVIDER` と、
呼び出し元単位の上書き `LLM_PROVIDER_<caller>` の2段。

> ⚠️ **「再デプロイ不要」が成り立つのは Head 駆動の経路だけ。**
> 日次バッチ（`runDashboardUpdate`）はトリガーが Head を実行するのでプロパティ変更だけで効く。
> 一方 **PWA が叩く Web アプリ `/exec` は、デプロイされたバージョンのコードが動く。**
> デプロイが特定バージョン固定なら、`clasp push` してもデプロイ版に `callLLM` が入らないため、
> `LLM_PROVIDER` をいくら変えても `analyzeError` / `generateSimilar` は旧コードのまま動き続ける。
> このとき `ai_call_log` には `dashboard.*` の行しか出ないので、
> **「切替できた」と誤判定しやすい。** 学生向け経路を切り替えるには新バージョンの発行が要る。

対象は**メモリア本体 GAS のみ**。Zoom 自動予約 GAS 側（チャプター生成 `AutoSegmentGeneration.js`）は
別プロジェクトで、今回は変更していない。

## 構成

| ファイル | 役割 |
|---|---|
| `src/LlmServiceCore.gs` | 純粋関数（ペイロード組立・レスポンス解析・エラー分類）。Node からテスト可能 |
| `src/LlmService.gs` | GAS 依存部（UrlFetchApp / プロパティ読み出し / ログ書き込み / 疎通確認） |
| `src/Config.gs` | `LLM_PROVIDER` / `OPENAI_*` / `SHEETS.AI_CALL_LOG` |
| `tests/llm_service_core.test.js` | 純粋関数のテスト（31件） |
| `tests/llm_service.test.js` | vm でスタブして `callLLM` を実行するテスト（25件） |

呼び出し元は4箇所。いずれも `caller` を渡して `ai_call_log` で識別できるようにしてある。

| 呼び出し元 | caller | 経路 |
|---|---|---|
| `GeminiService.gs:87` `analyzeError` | `analyzeError` | 学生が同期で待つ |
| `GeminiService.gs:161` `generateSimilar` | `generateSimilar` | 学生が同期で待つ |
| `DashboardService.gs:959` 学生向けアドバイス | `dashboard.studentAdvice` | バッチ |
| `DashboardService.gs:1073` 教員向けコメント | `dashboard.teacherComment` | バッチ |

旧名 `callGeminiAPI()` は後方互換エイリアスとして `LlmService.gs` に残してある
（本番プロジェクトにはリポジトリ未収載のファイルが2件あるため）。

## セットアップ手順

### 1. OpenAI API キーを発行する

1. platform.openai.com → API keys → 新規作成。名前は用途がわかるもの（例: `memoria-gas`）にし、
   他用途と鍵を共用しない
2. **Billing → Limits で月次の上限を設定する。** Gemini 側の spending cap $10 と同じ思想。
   最初は $10〜20 で足りる（下の「コスト」参照）
3. キー値はターミナルに貼らない。次の手順で GAS の画面に直接入力する

### 2. スクリプトプロパティを設定する

GAS エディタ → プロジェクトの設定 → スクリプト プロパティ

| プロパティ | 値 | 備考 |
|---|---|---|
| `OPENAI_API_KEY` | 発行したキー | 必須 |
| `LLM_PROVIDER` | `gemini` | **最初は gemini のまま**。疎通確認が通ってから切り替える |

`LLM_PROVIDER_<caller>` は最初は設定しなくてよい（段階切替のときだけ足す）。

### 3. 疎通確認を実行する

GAS エディタで `verifyOpenAIConnectivity` を実行する（課金は4回分＝実質ゼロ）。
4つのプローブを順に投げ、**どこまで通るか**を実行ログに出す。

| プローブ | 確認する内容 |
|---|---|
| `probe1_minimal` | UrlFetchApp から api.openai.com へ到達できるか / キーが有効か |
| `probe2_max_output_tokens` | `max_output_tokens` というパラメータ名が正しいか |
| `probe3_effort_none` | `gpt-5.6-luna` が `reasoning.effort: "none"` を受理するか |
| `probe4_json_format` | `text.format = {type:'json_object'}` が正しいか |

戻り値の `lastPassing` が **`probe4_json_format` なら、そのままの形で本番投入してよい**。
途中で止まった場合は、その1つ手前までが確定した形。止まったプローブの `errorCode` / `body` を見て
`LlmServiceCore.gs` の `llmBuildOpenAIPayload_` を直す。

> ⚠️ GAS エディタの関数セレクタは表示が変わっても内部選択が変わらないことがある。
> 実行後は必ず実行ログの1行目が `probe1_minimal → ...` になっていることを確認する。

### 4. 切り替える

切替は2段階でやる。`LLM_PROVIDER` を一気に `openai` にすると、
学生が同期で待つ `analyzeError` / `generateSimilar` にも同時に効き、
Luna の日本語品質（未検証事項5）が確認前に学生へ出る。

**段階1: 夜間バッチだけ Luna にする**

| プロパティ | 値 |
|---|---|
| `LLM_PROVIDER` | `gemini`（据え置き） |
| `LLM_PROVIDER_dashboard.studentAdvice` | `openai` |
| `LLM_PROVIDER_dashboard.teacherComment` | `openai` |

翌朝の日次バッチ（4時 / `runDashboardUpdate`）の出力＝教員コメント・学生アドバイスを読み、
文体ルールの順守とカテゴリ名の捏造有無を確認する。`ai_call_log` の `reasoning_tokens` も見る。

**段階2: 学生向けも Luna にする**

`LLM_PROVIDER` を `openai` に変更し、段階1で足した2つの `LLM_PROVIDER_*` は削除する
（全体設定と同じ値の上書きが残っていると、次に戻すとき片方だけ残って混乱する）。

**戻すときは値を `gemini` にするだけ。** コードの差し戻しは要らない
（ただし学生向け経路はデプロイ版が新コードを含んでいることが前提。冒頭の警告を参照）。

#### プロバイダ決定の優先順位

`options.provider`（コードでの明示指定） > `LLM_PROVIDER_<caller>` > `LLM_PROVIDER` > `gemini`

不正値・タイプミスは無視して次の候補へ落ちる。`LLM_PROVIDER_analyzeError=openal` と書いても
学生向け経路が止まることはなく、全体設定が使われる。

caller 名は `ai_call_log` の `caller` 列と同じ4種:
`analyzeError` / `generateSimilar` / `dashboard.studentAdvice` / `dashboard.teacherComment`。

### 5. 確認する

`ai_call_log` シート（初回呼び出し時に自動生成）に1行ずつ記録される。

`timestamp / caller / provider / model / http_code / latency_ms / prompt_chars /
input_tokens / output_tokens / reasoning_tokens / attempts / error_reason`

見るべきは **`reasoning_tokens`** と **`latency_ms`**。
`reasoning_tokens` が 0 でなければ effort が効いていない（コストが跳ねる）。

## reasoning effort について

`CONFIG.OPENAI_REASONING_EFFORT` の既定は **`none`**。上げると：

- reasoning tokens が **output tokens として課金される**（$1.20/1M）
- 学生が同期で待つ誤答分析・類題生成の応答時間が伸びる
- `max_output_tokens` の枠を推論が食い、本文が返らないことがある
  （`status: incomplete` / `incomplete_details.reason: max_output_tokens`）

3つ目への対策として、effort が `none` 以外のときは `max_output_tokens` を
自動で 4096 まで引き上げる（`llmResolveMaxOutputTokens_`）。
それでも本文が空の応答は**成功扱いにせずエラーとして返す**（空の解説が学生に出るのを防ぐ）。

## コスト（誤答分析1回 = 入力≈800tok / 可視出力≈250tok と仮定）

| | 1回 | 12,000回/月 |
|---|---|---|
| gemini-2.5-flash-lite | $0.00018 | $2.2 |
| gpt-5.6-luna `effort: none` | $0.00046 | $5.5 |
| gpt-5.6-luna `effort: medium`（reasoning 1,500tok と仮定） | $0.0023 | $27 |

単価出典: https://developers.openai.com/api/docs/models/gpt-5.6-luna （2026-08-24 取得）
入力 $0.20 / 出力 $1.20 per 1M tokens。

## 設計上の判断

- **自動フォールバックは実装していない。** `generateSimilar` の生成物は `ai_generated` シートへ
  永続化され他の学生にも配信される。どちらのモデルが書いたか不明なまま別プロバイダへ
  黙って退避されると出所が追えなくなるため。障害は隠さず `ai_call_log` に残す
- **OpenAI の 429 は2種類ある。** レート制限はバックオフして再試行するが、
  残高切れ（`insufficient_quota`）は待っても通らないので即座に諦める
- **ログの失敗は本処理を落とさない。** `llmLogCall_` は例外を握り潰して Logger にだけ残す

## 併せて直した点: 類題の上限が同時実行で破れる問題

`generateSimilar` の「1問につき最大3題」チェックは **API 呼び出しの前＝ロック外**にしかなく、
`appendRow` の直前で再確認していなかった。同一 `question_id` への同時リクエストや
クライアントの再送があると双方が事前チェックを通過し、4件目以降が積まれる。
生成物は `ai_generated` シートへ永続化され**他の学生にも配信される**ため、これは実害になる。

Luna は推論モデルで応答が伸びるぶんタイムアウト→再送の確率が上がり、この既存バグが
顕在化しやすくなる。プロバイダ切替の前に潰した。

- 上限値は `CONFIG.AI_GENERATED_MAX_PER_QUESTION`（既定 3）に集約
- ロック内で `findGeneratedQuestions` を再確認し、上限に達していれば追記せず既存を返す
- `waitLock` が取れなかった場合は例外を投げず `{ error: '...busy...' }` を返す（部分実行を残さない）

## テスト

```bash
cd gas-backend
node --test tests/llm_service_core.test.js tests/llm_service.test.js tests/gemini_service_generate_similar.test.js
```

※ `node --test tests/` のようにディレクトリを渡すと `.gs` を実行しようとして失敗する。必ずファイルを指定する。

構文チェックは `node --check` が `.gs` 拡張子を受け付けないため、`vm.Script` でのコンパイル確認を使う:

```bash
node -e 'const fs=require("fs"),vm=require("vm"),p=require("path");
for(const f of fs.readdirSync("src").filter(x=>x.endsWith(".gs")))
  new vm.Script(fs.readFileSync(p.join("src",f),"utf8"),{filename:f});
console.log("OK")'
```

## 未検証事項

以下は `verifyOpenAIConnectivity` を実行するまで確定しない（キー発行前のため未実行）。

1. GAS の UrlFetchApp から api.openai.com へ到達できるか
2. `max_output_tokens` というパラメータ名（Responses API のリファレンスでは未確認）
3. `text.format = {type:'json_object'}` というフィールド名（同上）
4. `gpt-5.6-luna` が `effort: "none"` を受理するか（モデルページに記載はあるが実呼び出し未実施）
5. Luna の日本語出力品質（誤答分析の文体ルール順守・JSON 整形）
