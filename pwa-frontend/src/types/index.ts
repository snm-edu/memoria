// 学科
export type Department = 'nursing' | 'clinical_eng' | 'dental_hyg' | 'orthoptist';

export const DEPARTMENT_LABELS: Record<Department, string> = {
  nursing: '看護学科',
  clinical_eng: '臨床工学科',
  dental_hyg: '歯科衛生学科',
  orthoptist: '視能訓練学科',
};

export const DEPARTMENTS: Department[] = ['nursing', 'clinical_eng', 'dental_hyg', 'orthoptist'];
export const GRADES = [1, 2, 3] as const;

// 問題
export interface Question {
  question_id: string;
  department: Department;
  exam_year: number;
  exam_number: number;
  category: string;
  subcategory: string;
  subtopic: string;
  difficulty: number;
  question_text: string;
  choices: string[];
  correct_answer: string[];
  explanation: string;
  has_image: boolean;
  image_url: string;
  is_multi_select: boolean;
  source: string;
  created_at: string;
}

// SM-2 カード状態
export interface CardState {
  questionId: string;
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReview: string;
  lastReview: string;
}

// 回答ログ
export interface AnswerLog {
  id?: number;
  questionId: string;
  selectedAnswer: string[];
  isCorrect: boolean;
  responseTimeMs: number;
  timestamp: string;
  synced: boolean;
}

// 学生プロフィール
export interface StudentProfile {
  id?: number;
  studentId: string;
  studentNumber: string;  // 学籍番号（教員が識別に使用）
  department: Department;
  grade: number;
  createdAt: string;
}

// AI 誤答分析
export type ErrorType = 'knowledge_gap' | 'misread' | 'confusion';

export interface ErrorAnalysis {
  error_type: ErrorType;
  analysis: string;
  key_concept: string;
  study_hint: string;
}

// AI 生成類題
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

// API レスポンス
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// 画面
export type Screen = 'setup' | 'home' | 'quiz' | 'analysis' | 'weakness' | 'schedule' | 'settings';
