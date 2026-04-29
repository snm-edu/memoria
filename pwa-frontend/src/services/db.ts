import Dexie, { type Table } from 'dexie';
import type { StudentProfile, CardState, Question, AnswerLog, GamificationState } from '../types';

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

// ツリーマップ表示データのキャッシュ + 楽観更新管理 (Phase C)
export interface TreemapCacheEntry {
  studentId: string; // primary key
  fetchedAt: number; // Unix ms (サーバから最後に取得した時刻)
  payload: unknown; // TreemapResponse (型循環を避けるため unknown で保存)
  pendingSync: boolean; // 楽観更新後・サーバ未同期
  lastQuizAt: number | null; // 最後にクイズで楽観更新した時刻
}

export class NurseMemoriaDB extends Dexie {
  profile!: Table<StudentProfile>;
  cardStates!: Table<CardState>;
  questionCache!: Table<Question>;
  answerLog!: Table<AnswerLog>;
  aiCache!: Table<AiCacheEntry>;
  gamification!: Table<GamificationState>;
  treemapCache!: Table<TreemapCacheEntry>;

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
    // v3: メモリアステップ用フィールド追加
    this.version(3).stores({
      profile: '++id, studentId, studentNumber, department, grade',
      cardStates: 'questionId, nextReview, [questionId+nextReview]',
      questionCache: 'question_id, department, category, exam_year',
      answerLog: '++id, questionId, timestamp, synced',
      aiCache: '++id, [questionId+selectedAnswer], questionId',
    }).upgrade(tx => {
      // 既存カード状態に hintLevel, consecutiveCorrectAtZero を付与
      return tx.table('cardStates').toCollection().modify(card => {
        if (card.hintLevel === undefined) {
          card.hintLevel = 0;
        }
        if (card.consecutiveCorrectAtZero === undefined) {
          card.consecutiveCorrectAtZero = 0;
        }
      });
    });
    // v4: ゲーミフィケーションテーブル追加
    this.version(4).stores({
      profile: '++id, studentId, studentNumber, department, grade',
      cardStates: 'questionId, nextReview, [questionId+nextReview]',
      questionCache: 'question_id, department, category, exam_year',
      answerLog: '++id, questionId, timestamp, synced',
      aiCache: '++id, [questionId+selectedAnswer], questionId',
      gamification: '++id, visitorId',
    });
    // v5: manifest ベース学科別分割対応マイグレーション
    this.version(5).stores({
      profile: '++id, studentId, studentNumber, department, grade',
      cardStates: 'questionId, nextReview, [questionId+nextReview]',
      questionCache: 'question_id, department, category, exam_year',
      answerLog: '++id, questionId, timestamp, synced',
      aiCache: '++id, [questionId+selectedAnswer], questionId',
      gamification: '++id, visitorId',
    }).upgrade(_tx => {
      // 旧バージョンキー（単一questions.json方式）を削除
      // 次回起動で学科別 fetch が走る
      localStorage.removeItem('memoria-data-version');
    });
    // v6: キャラクター成長GP フィールド追加
    this.version(6).stores({
      profile: '++id, studentId, studentNumber, department, grade',
      cardStates: 'questionId, nextReview, [questionId+nextReview]',
      questionCache: 'question_id, department, category, exam_year',
      answerLog: '++id, questionId, timestamp, synced',
      aiCache: '++id, [questionId+selectedAnswer], questionId',
      gamification: '++id, visitorId',
    }).upgrade(tx => {
      return tx.table('gamification').toCollection().modify((g: GamificationState) => {
        if (g.characterPoints === undefined) {
          g.characterPoints = 0;
        }
      });
    });
    // v7: 学生区分（studentType）追加
    this.version(7).stores({
      profile: '++id, studentId, studentNumber, department, grade, studentType',
      cardStates: 'questionId, nextReview, [questionId+nextReview]',
      questionCache: 'question_id, department, category, exam_year',
      answerLog: '++id, questionId, timestamp, synced',
      aiCache: '++id, [questionId+selectedAnswer], questionId',
      gamification: '++id, visitorId',
    }).upgrade(tx => {
      // 既存プロフィールは在校生として補完
      return tx.table('profile').toCollection().modify((profile: StudentProfile) => {
        if (!profile.studentType) {
          profile.studentType = 'enrolled';
        }
      });
    });
    // v8: ツリーマップキャッシュ (Phase C: 楽観更新 + stale-while-revalidate)
    this.version(8).stores({
      profile: '++id, studentId, studentNumber, department, grade, studentType',
      cardStates: 'questionId, nextReview, [questionId+nextReview]',
      questionCache: 'question_id, department, category, exam_year',
      answerLog: '++id, questionId, timestamp, synced',
      aiCache: '++id, [questionId+selectedAnswer], questionId',
      gamification: '++id, visitorId',
      treemapCache: 'studentId',
    });
  }
}

export const db = new NurseMemoriaDB();
