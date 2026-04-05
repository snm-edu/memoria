import type { ApiResponse, Question } from '../types';

const GAS_API_URL = import.meta.env.VITE_GAS_API_URL || '';

/**
 * GAS APIリクエスト（GET）
 */
async function apiGet<T>(params: Record<string, string>): Promise<ApiResponse<T>> {
  if (!GAS_API_URL) {
    return { success: false, error: 'API URL not configured' };
  }

  const url = new URL(GAS_API_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * GAS APIリクエスト（POST）
 */
async function apiPost<T>(body: Record<string, unknown>): Promise<ApiResponse<T>> {
  if (!GAS_API_URL) {
    return { success: false, error: 'API URL not configured' };
  }

  try {
    const res = await fetch(GAS_API_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' }, // GASはtext/plainを推奨
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// === API関数 ===

export async function fetchQuestions(params: {
  dept?: string;
  category?: string;
  limit?: number;
  offset?: number;
  year?: number;
}): Promise<ApiResponse<{ questions: Question[]; total: number }>> {
  const queryParams: Record<string, string> = { action: 'getQuestions' };
  if (params.dept) queryParams['dept'] = params.dept;
  if (params.category) queryParams['category'] = params.category;
  if (params.limit) queryParams['limit'] = String(params.limit);
  if (params.offset) queryParams['offset'] = String(params.offset);
  if (params.year) queryParams['year'] = String(params.year);
  return apiGet(queryParams);
}

export async function submitAnswer(body: {
  studentId: string;
  questionId: string;
  answer: string[];
  responseTime: number;
  department: string;
  grade: number;
}): Promise<ApiResponse<{
  is_correct: boolean;
  correct_answer: string[];
  attempt_count: number;
  explanation: string;
  should_analyze: boolean;
}>> {
  return apiPost({ action: 'submitAnswer', ...body });
}

export async function submitAnswerBatch(answers: unknown[]): Promise<ApiResponse<unknown>> {
  return apiPost({ action: 'submitAnswerBatch', answers });
}

export async function analyzeError(body: {
  questionId: string;
  studentAnswer: string[];
  correctAnswer: string[];
  questionText: string;
  choices: string[];
}): Promise<ApiResponse<{
  error_type: string;
  analysis: string;
  key_concept: string;
  study_hint: string;
}>> {
  return apiPost({ action: 'analyzeError', ...body });
}

export async function generateSimilar(body: {
  questionId: string;
  errorType: string;
  originalQuestion: string;
  analysis: string;
}): Promise<ApiResponse<unknown>> {
  return apiPost({ action: 'generateSimilar', ...body });
}

export async function ping(): Promise<boolean> {
  const res = await apiGet<{ status: string }>({ action: 'ping' });
  return res.success === true;
}
