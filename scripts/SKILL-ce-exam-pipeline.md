# 国家試験問題抽出・分類・解説生成パイプライン

## トリガー
ユーザーが以下のいずれかを依頼した場合にこのskillを使用する:
- 「国試問題を抽出して」「過去問を処理して」
- 「問題を分類して」「解説を生成して」
- 「○○年度の問題を追加して」
- 「新しい学科の問題を処理して」

## 概要
看護系専門学校の国家試験過去問xlsxファイルから問題を抽出し、出題基準に基づいて分類（subtopic）、AI解説生成、画像抽出を行い、メモリア問題バンクフォーマットのxlsxに出力する。

## 対応学科
| コード | 学科 | データディレクトリ | プレフィックス | 年間問題数 | 対応年度 | 状態 |
|--------|------|------------------|-------------|----------|---------|------|
| `clinical_eng` | 臨床工学技士 | CE国試data/ | CE | 180問 | 2014-2024 | ✅ 1,980問完了 |
| `orthoptist` | 視能訓練士 | CO国試data/ | CO | 150問 | 2014-2025 | ✅ 1,800問完了 |
| `dental_hyg` | 歯科衛生士 | DH国試data/ | DH | 220問 | 2014-2025 | ✅ 2,640問完了 |
| `nursing` | 看護師 | NRS国試data/ | NRS | — | — | 将来対応 |

### 学科別の注意点
- **CE（臨床工学技士）**: category + subcategory の2階層分類。年180問（午前90+午後90）
- **CO（視能訓練士）**: categoryのみ（subcategory空欄）。年150問（午前75+午後75）。出題基準は「CO国試出題基準.pdf」（略称名）
- **DH（歯科衛生士）**: category + subcategory の2階層分類。年220問（午前110+午後110）。出題基準は「DH国試出題基準.pdf」

## 前提ファイル
- **ソースxlsx**: `{data_dir}/○○_{年度}年_午前.xlsx`, `_午後.xlsx`
- **出題基準分類ツリー**: `{data_dir}/classification_tree.json`（出題基準PDFから構造化）
- **パイプラインスクリプト**: `scripts/ce_exam_pipeline.py`

## 実行手順（Claude Codeが実行すること）

### 手順1: 出題基準のclassification_tree.jsonが存在するか確認
なければ出題基準PDFを読み取り、以下の形式でJSONを作成する:
```json
{
  "科目名（category）": {
    "節名（subcategory）": [
      "大項目1（subtopic）",
      "大項目2",
      ...
    ]
  }
}
```

### 手順2: 問題データ抽出
```bash
python3 scripts/ce_exam_pipeline.py extract --year {年度} --data-dir {data_dir}
```
これにより以下が生成される:
- `{年度}_questions_raw.json` — 全問題データ
- `{年度}_batch_1.json` 〜 `{年度}_batch_6.json` — AI分類用の30問ずつのバッチ

### 手順3: AI分類・解説生成（★最重要ステップ）
**この手順はClaude Codeのサブエージェントで実行する。**
3つのサブエージェントを並列起動し、各60問（2バッチ）を担当させる。

#### サブエージェント起動（3並列）
```
Agent 1: batch_1 + batch_2 → {year}_result_1.json
Agent 2: batch_3 + batch_4 → {year}_result_2.json
Agent 3: batch_5 + batch_6 → {year}_result_3.json
```

#### 各サブエージェントへのプロンプト:
```
あなたは{学科名}国家試験の教育専門家です。

## タスク
{data_dir}/{year}_batch_N.json と {data_dir}/{year}_batch_M.json の問題（合計60問）に対して、
subtopic、explanation、difficultyを判定してJSON出力してください。

## 手順
1. まず {data_dir}/classification_tree.json を読んで分類体系を把握
2. 各バッチファイルを読む
3. 各問題について判定:
   - **subtopic**: classification_tree.jsonの中から、その問題のcategory > subcategoryに
     属するsubtopicを1つ選ぶ。必ずtreeに存在する値を使用すること。
   - **explanation**: 300字以内の日本語解説。正答の根拠と、なぜ他の選択肢が不正解かを
     簡潔に説明。
   - **difficulty**: 1-5の整数（1=基礎知識、2=やや易、3=標準、4=やや難、5=難問）
4. 画像問題(has_image=true)は解説に「図を参照」を含める

## 出力
{data_dir}/{year}_result_N.json に書き出してください:
[{"question_id": "...", "subtopic": "...", "explanation": "...", "difficulty": 3}, ...]

60問すべてを含むこと。
```

#### サブエージェント完了後の統合
3つの結果JSONを統合して `{year}_results_merged.json` を作成:
```python
import json
results = []
for i in range(1, 4):
    with open(f'{data_dir}/{year}_result_{i}.json') as f:
        results.extend(json.load(f))
with open(f'{data_dir}/{year}_results_merged.json', 'w') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
```

#### subtopic検証・自動修正
classification_tree.jsonに存在しないsubtopicが割り当てられた場合、
そのcategory/subcategoryの最初の有効なsubtopicに自動修正する。

### 手順4: 検証エージェント
別のサブエージェントを起動し、ランダム20問をサンプル検証する:
- subtopicが問題内容と合っているか
- explanationが医学的/工学的に正確か
- correct_answerと解説が矛盾していないか
- difficultyが妥当か

問題があれば修正JSONを出力し、merged結果に適用する。

### 手順5: 画像抽出
```bash
python3 scripts/ce_exam_pipeline.py images --year {年度} --data-dir {data_dir}
```

### 手順6: xlsx出力
```bash
python3 scripts/ce_exam_pipeline.py output --year {年度} --data-dir {data_dir} --department {学科コード}
```

### 手順7: 最終検証
```bash
python3 scripts/ce_exam_pipeline.py verify --year {年度} --data-dir {data_dir}
```

### 手順8: 全年度統合（全年度処理完了後に実行）
全年度の年度別xlsxを1つのxlsxにまとめる:
```bash
python3 scripts/ce_exam_pipeline.py merge --data-dir {data_dir} --prefix CE
```
- `CE_questions_all.xlsx` が出力される
- questionsシートに全年度の問題が年度順に結合
- summaryシートに年度別の問題数サマリーが追加
- **複数年度を処理した場合は最後に必ずこのコマンドを実行すること**

### 手順9: 中間ファイルクリーンアップ
以下のファイルを削除:
- `{year}_batch_*.json`
- `{year}_questions_raw.json`
- `{year}_result_*.json`
- `{year}_results_merged.json`
- `{year}_corrections.json`

## 複数年度の処理
複数年度を依頼された場合:
1. 年度ごとに手順2〜8を順次実行
2. AI分類（手順3）は年度内で3並列、年度間では逐次処理
3. 各年度の完了報告後に次年度へ進む

## 出力フォーマット（questionsシート 21列）
| カラム | 説明 |
|--------|------|
| question_id | `{年度}_ce_{年度下2桁}_{am/pm}{連番3桁}` |
| department | 学科コード |
| exam_year | 出題年度 |
| exam_number | 問題番号 |
| category | 科目名（出題基準の章） |
| subcategory | 節名（出題基準の節） |
| subtopic | 大項目（AI分類で判定） |
| difficulty | 難易度 1-5（AI判定） |
| question_text | 問題文 |
| choice_a〜e | 選択肢（5択、4択の場合eは空欄） |
| correct_answer | 正答（A/B/C/D/E） |
| explanation | AI解説（300字以内、AI生成） |
| has_image | 画像有無（True/False） |
| image_url | 画像ファイル名（複数はセミコロン区切り） |
| is_multi_select | 複数選択問題か |
| source | `past_exam` |
| created_at | 作成日時 |

## 新しい学科を追加する場合
1. 出題基準PDFを入手
2. PDFからclassification_tree.jsonを作成（手順1）
3. ソースxlsxの構造を確認
   - 同じ7行ブロック形式なら `ce_exam_pipeline.py` をそのまま使用可能
   - 異なる場合は `extract_questions()` のパース処理を調整
4. `--department` と `--data-dir` を変更して実行

## 精度向上のポイント
- 画像のみの選択肢は `（図参照：選択肢N）` として処理し、解説では「図を参照」と記載
- 不備問題（採点除外）もそのまま含めて処理
- 前回一括処理で誤答が続出した教訓から、**年度ごとに処理→検証→次年度** の段階的アプローチを必ず守る
- AI分類で出題基準に存在しないsubtopicが割り当てられた場合は自動修正
- 検証エージェントは分類・解説担当とは別のエージェントを使い、クロスチェックする
