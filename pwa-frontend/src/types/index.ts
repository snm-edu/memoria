// 学科（departments.ts から re-export）
import type { Department } from '../config/departments';
export type { Department, DepartmentEntry, ColorSet } from '../config/departments';
export { DEPARTMENT_LABELS, DEPARTMENTS, AVAILABLE_DEPARTMENTS, DEPT_STYLES, GRADES, getDepartment, getLabel, DEPARTMENT_REGISTRY } from '../config/departments';

// 問題
export interface Question {
  question_id: string;
  department: Department;
  exam_year: number | string; // 通常は number（年度）、模擬試験は "mock_YYYY" 形式の string
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
  hintLevel: number;               // メモリアステップ: 0〜6（ヒントレベル）
  consecutiveCorrectAtZero: number; // レベル0での連続正答数
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

// 学生区分
// prospective: 入学前（内定者）
// enrolled:    在校生（1-3 年）
// graduate:    卒業生（再受験者）
export type StudentType = 'prospective' | 'enrolled' | 'graduate';

// 学生プロフィール
export interface StudentProfile {
  id?: number;
  studentId: string;
  studentNumber: string;  // 学籍番号（教員が識別に使用）
  department: Department;
  grade: number;              // prospective=0, enrolled=1/2/3, graduate=3
  studentType: StudentType;
  createdAt: string;
}

// AI 誤答分析
export type ErrorType = 'knowledge_gap' | 'misread' | 'confusion';

export interface ErrorAnalysis {
  error_type: ErrorType;
  cheer: string;
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

// ゲーミフィケーション
export interface GamificationState {
  id?: number;
  visitorId: string;        // studentIdと紐づけ
  exp: number;
  level: number;
  streakDays: number;
  lastStudyDate: string;    // "2026-04-06" 形式
  badges: string[];         // 獲得済みバッジID配列
  weeklyQuestions: number;  // 今週の回答数
  weeklyCorrect: number;    // 今週の正答数
  weekStartDate: string;    // 週の開始日
  characterPoints: number;  // キャラクター成長GP
}

// バッジ定義
export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'quantity' | 'streak' | 'accuracy' | 'mastery' | 'challenge';
}

// 画面
export type Screen = 'setup' | 'home' | 'quiz' | 'analysis' | 'weakness' | 'schedule' | 'settings' | 'badges' | 'ai_dashboard';
