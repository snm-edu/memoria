# Gemini API プロンプト設計（CLAUDE.md から外出し 2026-07-03）

CLAUDE.md 棚卸しに伴い、プロンプト全文を本ファイルへ移動。正本はここ（実装は `gas-backend/src/GeminiService.gs`）。

## 誤答分析プロンプト

```
あなたは看護師国家試験の教育専門家です。
学生が以下の問題に間違えました。間違えた原因を分析してください。

【問題】{question_text}
【選択肢】
A: {choice_a}
B: {choice_b}
C: {choice_c}
D: {choice_d}
【正答】{correct_answer}
【学生の回答】{selected_answer}

以下のJSON形式で回答してください:
{
  "error_type": "knowledge_gap | misread | confusion",
  "analysis": "間違えた原因の説明（学生向け、200字以内）",
  "key_concept": "理解すべき重要概念",
  "study_hint": "学習のアドバイス（100字以内）"
}

error_typeの判定基準:
- knowledge_gap: 正答の知識自体が不足している
- misread: 問題文や選択肢の読み違い（否定語の見落とし等）
- confusion: 類似概念との混同（例: 交感神経と副交感神経）
```

## 類題生成プロンプト

```
あなたは看護師国家試験の問題作成者です。
以下の問題で学生が{error_type}のミスをしました。
この弱点を克服するための類題を1問作成してください。

【元の問題】{original_question}
【誤答タイプ】{error_type}
【分析結果】{analysis}

error_typeに応じた出題方針:
- knowledge_gap: 同じ概念のより基礎的な問題を出す
- misread: 設問の言い回しを変え、注意深く読む必要がある問題にする
- confusion: 混同しやすい概念を明確に弁別させる問題にする

以下のJSON形式で回答:
{
  "question_text": "問題文",
  "choice_a": "選択肢A",
  "choice_b": "選択肢B",
  "choice_c": "選択肢C",
  "choice_d": "選択肢D",
  "correct_answer": "A|B|C|D",
  "explanation": "解説文（300字以内）",
  "difficulty": 1-5
}
```
