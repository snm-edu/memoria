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
    // v2: 学籍番号フィールド追加
    this.version(2).stores({
      profile: '++id, studentId, studentNumber, department, grade',
      cardStates: 'questionId, nextReview, [questionId+nextReview]',
      questionCache: 'question_id, department, category, exam_year',
      answerLog: '++id, questionId, timestamp, synced',
      aiCache: '++id, [questionId+selectedAnswer], questionId',
    }).upgrade(tx => {
      // 既存プロフィールに studentNumber を追加（空文字で初期化）
      return tx.table('profile').toCollection().modify(profile => {
        if (!profile.studentNumber) {
          profile.studentNumber = '';
        }
      });
    });
  }
}

export const db = new NurseMemoriaDB();
