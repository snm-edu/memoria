# =============================================================
# Memoria 解説生成スクリプト（Google Colab用）
# モデル: gemini-2.5-pro-preview-05-06
#
# 【使い方】
# 1. Google Colabで新しいノートブックを開く
# 2. このコードをセルにコピー&ペースト
# 3. questions.json をColabにアップロード
# 4. GEMINI_API_KEY を設定
# 5. セルを上から順に実行
# =============================================================

# =====================
# セル1: インストール & インポート
# =====================
# !pip install -q google-generativeai

import google.generativeai as genai
import json
import time
import csv
from pathlib import Path
from google.colab import files

# =====================
# セル2: APIキー設定 & モデル確認
# =====================
# ここにAPIキーを入力
GEMINI_API_KEY = "YOUR_API_KEY_HERE"  # ← AI StudioのAPIキーに置き換え

genai.configure(api_key=GEMINI_API_KEY)

# 利用可能なモデル一覧を表示（確認用）
print("利用可能なモデル:")
for m in genai.list_models():
    if 'generateContent' in [method.name for method in m.supported_generation_methods]:
        print(f"  {m.name}")

# =====================
# セル3: questions.json アップロード
# =====================
print("questions.json をアップロードしてください")
uploaded = files.upload()
filename = list(uploaded.keys())[0]
with open(filename, 'r', encoding='utf-8') as f:
    questions = json.load(f)
print(f"読み込み完了: {len(questions)}問")

# =====================
# セル4: モデル設定 & 解説生成関数
# =====================
model = genai.GenerativeModel('gemini-2.5-pro-preview-05-06')

CHOICE_LABELS = ['A', 'B', 'C', 'D', 'E']

def build_prompt(q):
    """1問分の解説生成プロンプトを作成"""
    choices_text = ""
    for i, choice in enumerate(q['choices']):
        label = CHOICE_LABELS[i]
        choices_text += f"  {label}. {choice}\n"

    correct = ', '.join(q['correct_answer'])

    return f"""あなたは看護師国家試験の教育専門家です。
以下の問題について、正答の根拠を中心に簡潔で正確な解説を作成してください。

【問題】{q['question_text']}
【選択肢】
{choices_text}
【正答】{correct}

解説のルール:
- 200〜300字程度で簡潔にまとめる
- なぜ正答が正しいのか、根拠を明確に述べる
- 重要な誤答選択肢についても簡単に触れる
- 医学的に正確な内容にする
- 学生が理解しやすい平易な表現を使う
- 解説のみを出力し、「解説:」などの接頭辞は不要"""


def generate_explanation(q, max_retries=3):
    """1問の解説を生成（リトライ付き）"""
    prompt = build_prompt(q)

    for attempt in range(max_retries):
        try:
            response = model.generate_content(prompt)
            text = response.text.strip()
            # 空でないか確認
            if len(text) > 20:
                return text
            else:
                print(f"  短すぎる応答、リトライ ({attempt+1}/{max_retries})")
        except Exception as e:
            error_msg = str(e)
            if '429' in error_msg or 'quota' in error_msg.lower():
                wait = 30 * (attempt + 1)
                print(f"  レート制限、{wait}秒待機...")
                time.sleep(wait)
            else:
                print(f"  エラー: {error_msg[:100]}")
                if attempt < max_retries - 1:
                    time.sleep(5)

    return ""


# =====================
# セル5: バッチ解説生成（メイン処理）
# =====================
BATCH_SIZE = 10          # 何問ごとに進捗表示するか
DELAY_BETWEEN = 1.5      # 各問題の間隔（秒）- レート制限回避
SAVE_INTERVAL = 50       # 何問ごとに中間保存するか

# 既に生成済みの結果があれば読み込み（中断再開用）
results_file = "explanations_progress.json"
if Path(results_file).exists():
    with open(results_file, 'r', encoding='utf-8') as f:
        results = json.load(f)
    print(f"中断データを読み込み: {len(results)}問生成済み")
else:
    results = {}

total = len(questions)
success_count = len(results)
error_count = 0

print(f"\n===== 解説生成開始 =====")
print(f"総問題数: {total}")
print(f"生成済み: {success_count}")
print(f"残り: {total - success_count}")
print(f"========================\n")

for i, q in enumerate(questions):
    qid = q['question_id']

    # 既に生成済みならスキップ
    if qid in results and results[qid]:
        continue

    # 生成
    explanation = generate_explanation(q)

    if explanation:
        results[qid] = explanation
        success_count += 1
    else:
        results[qid] = ""
        error_count += 1

    # 進捗表示
    done = i + 1
    if done % BATCH_SIZE == 0 or done == total:
        pct = round(done / total * 100, 1)
        print(f"[{done}/{total}] {pct}% 完了  (成功: {success_count}, エラー: {error_count})")

    # 中間保存
    if done % SAVE_INTERVAL == 0:
        with open(results_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"  → 中間保存完了 ({results_file})")

    # レート制限回避
    time.sleep(DELAY_BETWEEN)

# 最終保存
with open(results_file, 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print(f"\n===== 生成完了 =====")
print(f"成功: {success_count}")
print(f"エラー: {error_count}")
print(f"====================")


# =====================
# セル6: questions.json に解説を統合 & ダウンロード
# =====================
# 解説をquestionsに統合
for q in questions:
    qid = q['question_id']
    if qid in results and results[qid]:
        q['explanation'] = results[qid]

# 解説が入った問題数を確認
with_exp = sum(1 for q in questions if q.get('explanation') and len(q['explanation']) > 20)
print(f"解説付き問題: {with_exp}/{len(questions)}")

# questions.json を保存
output_file = "questions_with_gemini_explanations.json"
with open(output_file, 'w', encoding='utf-8') as f:
    json.dump(questions, f, ensure_ascii=False, indent=2)
print(f"\n保存完了: {output_file}")

# CSV版も生成（Google Sheetsインポート用）
csv_file = "questions_with_gemini_explanations.csv"
with open(csv_file, 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    # ヘッダー
    writer.writerow([
        'question_id', 'department', 'exam_year', 'exam_number',
        'category', 'subcategory', 'subtopic', 'difficulty',
        'question_text',
        'choice_a', 'choice_b', 'choice_c', 'choice_d', 'choice_e',
        'correct_answer', 'explanation',
        'has_image', 'image_url', 'is_multi_select', 'source', 'created_at'
    ])
    for q in questions:
        choices = q.get('choices', [])
        writer.writerow([
            q.get('question_id', ''),
            q.get('department', ''),
            q.get('exam_year', ''),
            q.get('exam_number', ''),
            q.get('category', ''),
            q.get('subcategory', ''),
            q.get('subtopic', ''),
            q.get('difficulty', ''),
            q.get('question_text', ''),
            choices[0] if len(choices) > 0 else '',
            choices[1] if len(choices) > 1 else '',
            choices[2] if len(choices) > 2 else '',
            choices[3] if len(choices) > 3 else '',
            choices[4] if len(choices) > 4 else '',
            ','.join(q.get('correct_answer', [])),
            q.get('explanation', ''),
            q.get('has_image', False),
            q.get('image_url', ''),
            q.get('is_multi_select', False),
            q.get('source', ''),
            q.get('created_at', ''),
        ])
print(f"CSV保存完了: {csv_file}")

# ダウンロード
print("\nファイルをダウンロードします...")
files.download(output_file)
files.download(csv_file)
print("完了！")
