import Dexie, { type Table } from 'dexie';
import type { StudentProfile, CardState, Question, AnswerLog } from '../types';

// AI分析キャッシュ
export interface AiCacheEntry {
  id?: number;
  questionId: string;
  selectedAnswer: string;
  errorType: string;
  analysis: string;
  keyConcept: string;
  studyHint: string;
  createdAt: string;
}

export class NurseMemoriaDB extends Dexie {
  profile!: Table<StudentProfile>;
  cardStates!: Table<CardState>;
  questionCache!: Table<Question>;
  answerLog!: Table<AnswerLog>;
  aiCache!: Table<AiCacheEntry>;

  constructor() {
    super('NurseMemoria');
    this.version(1).stores({
      profile: '++id, studentId, department, grade',
      cardStates: 'questionId, nextReview, [questionId+nextReview]',
      questionCache: 'question_id, department, category, exam_year',
      answerLog: '++id, questionId, timestamp, synced',
      aiCache: '++id, [questionId+selectedAnswer], questionId',
    });
  }
}

export const db = new NurseMemoriaDB();
