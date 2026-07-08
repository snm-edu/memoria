# データスキーマ定義（CLAUDE.md から外出し 2026-07-03）

CLAUDE.md 棚卸しに伴い、参照資料（スキーマ・実装コード）を本ファイルへ移動。正本はここ。

## Phase 1: 問題バンク設計（Google Sheets）

### `questions` シート（問題マスタ）

| カラム | 型 | 説明 |
|--------|-----|------|
| question_id | string | `NRS-001-001` 形式（学科-年度-連番） |
| department | string | nursing / clinical_eng / dental_hyg / orthoptist |
| exam_year | number | 出題年度（例: 2025） |
| exam_number | number | 問題番号 |
| category | string | 分野タグ（例: 基礎看護学、成人看護学） |
| subcategory | string | 小分野（例: 循環器、呼吸器） |
| difficulty | number | 難易度 1-5 |
| question_text | string | 問題文 |
| choice_a | string | 選択肢A |
| choice_b | string | 選択肢B |
| choice_c | string | 選択肢C |
| choice_d | string | 選択肢D |
| choice_e | string | 選択肢E（5択の場合、空欄可） |
| correct_answer | string | 正答（A/B/C/D/E） |
| explanation | string | 解説文 |
| source | string | 出典（NotebookLM抽出 / AI生成 / 手動追加） |
| created_at | string | 作成日時 ISO8601 |

### `student_logs` シート（学習履歴）

| カラム | 型 | 説明 |
|--------|-----|------|
| log_id | string | UUID |
| student_id | string | 匿名ID（端末生成ハッシュ） |
| department | string | 学科 |
| grade | number | 学年（1/2/3） |
| question_id | string | 問題ID |
| selected_answer | string | 学生の回答 |
| is_correct | boolean | 正誤 |
| response_time_ms | number | 解答時間（ミリ秒） |
| attempt_count | number | この問題の挑戦回数 |
| timestamp | string | 回答日時 ISO8601 |

### `ai_generated` シート（AI生成類題）

| カラム | 型 | 説明 |
|--------|-----|------|
| gen_id | string | UUID |
| original_question_id | string | 元問題のID |
| error_type | string | knowledge_gap / misread / confusion |
| question_text | string | 生成された類題 |
| choice_a〜e | string | 選択肢 |
| correct_answer | string | 正答 |
| explanation | string | 解説 |
| created_at | string | 生成日時 |

## GAS エンドポイント設計

```
GET  /exec?action=getQuestions&dept=nursing&grade=2&limit=20
GET  /exec?action=getReviewQueue&studentId=xxx
POST /exec?action=submitAnswer  { studentId, questionId, answer, responseTime }
POST /exec?action=analyzeError  { questionId, studentAnswer, correctAnswer }
POST /exec?action=generateSimilar { questionId, errorType }
```

## SM-2 アルゴリズム実装

```typescript
interface CardState {
  questionId: string;
  easeFactor: number;    // 初期値 2.5
  interval: number;      // 日数
  repetitions: number;   // 連続正答数
  nextReview: Date;
}

function sm2(card: CardState, quality: number): CardState {
  // quality: 0-5 (0=完全忘却, 5=即答)
  // 正答=4以上, 不正解=3以下
  if (quality >= 3) {
    if (card.repetitions === 0) card.interval = 1;
    else if (card.repetitions === 1) card.interval = 6;
    else card.interval = Math.round(card.interval * card.easeFactor);
    card.repetitions++;
  } else {
    card.repetitions = 0;
    card.interval = 1;
  }
  card.easeFactor = Math.max(1.3,
    card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );
  card.nextReview = addDays(new Date(), card.interval);
  return card;
}
```

## IndexedDB スキーマ（Dexie.js）

```typescript
const db = new Dexie('NurseMemoria');
db.version(1).stores({
  profile: '++id, department, grade, studentId, createdAt',
  cardStates: 'questionId, nextReview, department, category',
  questionCache: 'question_id, department, category',
  answerLog: '++id, questionId, timestamp, isCorrect'
});
```

## オフライン対応

- Service Workerで問題データをキャッシュ
- オフライン時はIndexedDBからローカル出題
- オンライン復帰時にGASへログ同期
