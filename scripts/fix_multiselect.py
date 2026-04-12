#!/usr/bin/env python3
"""複数選択問題の正答を元xlsxから再抽出して修正する"""
import openpyxl, re, os, json, glob

# スクリプトの場所からプロジェクトルートを動的に解決（フォルダ移動に対応）
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def extract_correct_answers(data_dir):
    fixes = {}
    files = sorted(glob.glob(f'{data_dir}/*.xlsx'))
    files = [f for f in files if '_questions_' not in os.path.basename(f)]

    for filepath in files:
        try:
            wb = openpyxl.load_workbook(filepath, data_only=True)
            ws = wb['Worksheet']
        except:
            continue

        rows = list(ws.iter_rows(values_only=False))
        i = 0
        while i < len(rows):
            row_vals = [str(c.value) if c.value else '' for c in rows[i]]
            qid = row_vals[6] if len(row_vals) > 6 else ''

            if qid and re.match(r'^20\d{2}_(?:ce|co|nrs|dh|ort)_', qid):
                correct_indices = []
                choice_count = 0
                for j in range(2, 12):
                    if i + j >= len(rows):
                        break
                    c_row = [str(c.value) if c.value else '' for c in rows[i + j]]
                    if len(c_row) > 6 and c_row[6] and re.match(r'^20\d{2}_(?:ce|co|nrs|dh|ort)_', c_row[6]):
                        break
                    choice_num = c_row[2] if len(c_row) > 2 else ''
                    if choice_num and choice_num.strip().isdigit():
                        num = int(choice_num.strip())
                        if 1 <= num <= 5:
                            is_correct = (len(c_row) > 6 and c_row[6] == '正解')
                            choice_count += 1
                            if is_correct:
                                correct_indices.append(choice_count - 1)

                if correct_indices:
                    correct_letters = [chr(ord('A') + idx) for idx in correct_indices]
                    fixes[qid] = correct_letters
            i += 1
    return fixes

print("=== CO再抽出 ===")
co_fixes = extract_correct_answers(f'{BASE}/CO国試data')
multi_co = sum(1 for v in co_fixes.values() if len(v) >= 2)
print(f"  全問: {len(co_fixes)}, 複数正答: {multi_co}")

print("=== CE再抽出 ===")
ce_fixes = extract_correct_answers(f'{BASE}/CE国試data')
multi_ce = sum(1 for v in ce_fixes.values() if len(v) >= 2)
print(f"  全問: {len(ce_fixes)}, 複数正答: {multi_ce}")

print("=== DH再抽出 ===")
dh_fixes = extract_correct_answers(f'{BASE}/DH国試data')
multi_dh = sum(1 for v in dh_fixes.values() if len(v) >= 2)
print(f"  全問: {len(dh_fixes)}, 複数正答: {multi_dh}")

# questions.json修正
json_path = f'{BASE}/pwa-frontend/public/data/questions.json'
with open(json_path) as f:
    data = json.load(f)

all_fixes = {}
all_fixes.update(co_fixes)
all_fixes.update(ce_fixes)
all_fixes.update(dh_fixes)

fixed = 0
for q in data:
    qid = q['question_id']
    if qid in all_fixes:
        new_ca = all_fixes[qid]
        old_ca = q['correct_answer']
        if old_ca != new_ca:
            q['correct_answer'] = new_ca
            q['is_multi_select'] = len(new_ca) >= 2
            fixed += 1

print(f"\n修正件数: {fixed}問")

# 解説の「図を参照」問題: has_imageがfalseで画像URLもない場合は解説から「図を参照」を除去
fig_fixed = 0
for q in data:
    exp = q.get('explanation', '')
    if ('図を参照' in exp or '図参照' in exp) and not q.get('image_url'):
        # 「図を参照。」「図を参照」を除去
        new_exp = exp.replace('図を参照。', '').replace('図を参照', '').replace('図参照。', '').replace('図参照', '')
        new_exp = new_exp.strip()
        if new_exp != exp:
            q['explanation'] = new_exp
            fig_fixed += 1

print(f"「図を参照」除去: {fig_fixed}件")

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
print(f"questions.json更新完了 ({os.path.getsize(json_path):,} bytes)")

# 検証
issues = 0
for q in data:
    text = q.get('question_text', '')
    ca = q.get('correct_answer', [])
    if ('2つ選べ' in text or '２つ選べ' in text) and len(ca) < 2:
        issues += 1
print(f"\n検証「2つ選べ & 正答1つ」: {issues}件")

fig_issues = 0
for q in data:
    exp = q.get('explanation', '')
    if ('図を参照' in exp or '図参照' in exp) and not q.get('image_url'):
        fig_issues += 1
print(f"検証「図を参照 & 画像なし」: {fig_issues}件")
