// ナースメモリア 共有型定義
// GASバックエンド・PWAフロントエンドの両方で使用

// === 問題 ===
export interface Question {
  question_id: string;       // "NRS-2014-001" or "2014_nrs_14_pm001"
  department: Department;
  exam_year: number;
  exam_number: number;       // 問題番号
  category: string;          // 大分類（例: "必修問題", "人体の構造と機能"）
  subcategory: string;       // 中分類（例: "B.健康に関する指標"）
  subtopic: string;          // 小分類（例: "出生と死亡の動向"）
  difficulty: number;        // 難易度 1-5
  question_text: string;
  choices: string[];         // 4〜5個の選択肢
  correct_answer: string[];  // ["B"] or ["C","D"]（複数正解対応）
  explanation: string;
  has_image: boolean;        // 図表参照問題フラグ
  image_url: string;         // 図表URL（後から追加可能）
  is_multi_select: boolean;  // 「2つ選べ」フラグ
  source: string;            // "notebooklm" | "ai_generated" | "manual"
  created_at: string;        // ISO8601
}

// === SM-2 カード状態 ===
export interface CardState {
  questionId: string;
  easeFactor: number;    // 初期値 2.5
  interval: number;      // 日数
  repetitions: number;   // 連続正答数
  nextReview: string;    // ISO date (YYYY-MM-DD)
  lastReview: string;    // ISO date
}

// === 回答記録 ===
export interface AnswerSubmission {
  log_id?: string;
  student_id: string;
  department: Department;
  grade: number;            // 1/2/3
  question_id: string;
  selected_answer: string[];
  is_correct: boolean;
  response_time_ms: number;
  attempt_count: number;
  timestamp: string;        // ISO8601
  synced: boolean;          // オフライン同期フラグ
}

// === 学生プロフィール ===
export interface StudentProfile {
  id?: number;
  student_id: string;       // crypto.randomUUID()
  department: Department;
  grade: number;
  created_at: string;
}

// === AI誤答分析 ===
export type ErrorType = 'knowledge_gap' | 'misread' | 'confusion';

export interface ErrorAnalysis {
  error_type: ErrorType;
  analysis: string;         // 間違えた原因（200字以内）
  key_concept: string;      // 理解すべき重要概念
  study_hint: string;       // 学習アドバイス（100字以内）
}

// === AI生成類題 ===
export interface GeneratedQuestion {
  gen_id: string;
  original_question_id: string;
  error_type: ErrorType;
  question_text: string;
  choices: string[];
  correct_answer: string[];
  explanation: string;
  difficulty: number;
  created_at: string;
}

// === API リクエスト/レスポンス ===
export interface GetQuestionsParams {
  action: 'getQuestions';
  dept?: Department;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface GetReviewQueueParams {
  action: 'getReviewQueue';
  studentId: string;
}

export interface SubmitAnswerParams {
  action: 'submitAnswer';
  studentId: string;
  questionId: string;
  answer: string[];
  responseTime: number;
  department: Department;
  grade: number;
}

export interface AnalyzeErrorParams {
  action: 'analyzeError';
  questionId: string;
  studentAnswer: string[];
  correctAnswer: string[];
}

export interface GenerateSimilarParams {
  action: 'generateSimilar';
  questionId: string;
  errorType: ErrorType;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
