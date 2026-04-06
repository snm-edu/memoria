import { db } from './db';
import type { GamificationState, BadgeDefinition } from '../types';

// === バッジ定義（25種） ===
export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  // 学習量（5種）
  { id: 'first_step', name: 'はじめの一歩', description: '初めて問題を解いた', icon: '👣', category: 'quantity' },
  { id: 'q100', name: '100問突破', description: '累計100問達成', icon: '📋', category: 'quantity' },
  { id: 'q500', name: '500問の壁', description: '累計500問達成', icon: '📖', category: 'quantity' },
  { id: 'q1000', name: '1,000問達成', description: '累計1,000問達成', icon: '📚', category: 'quantity' },
  { id: 'q2000', name: '2,000問の境地', description: '累計2,000問達成', icon: '🏛️', category: 'quantity' },
  // 継続（5種）
  { id: 'streak3', name: '3日連続', description: '3日連続学習', icon: '🔥', category: 'streak' },
  { id: 'streak7', name: '7日連続', description: '7日連続学習', icon: '⭐', category: 'streak' },
  { id: 'streak14', name: '14日連続', description: '14日連続学習', icon: '💫', category: 'streak' },
  { id: 'streak30', name: '30日連続', description: '30日連続学習', icon: '👑', category: 'streak' },
  { id: 'streak60', name: '60日連続', description: '60日連続学習', icon: '🏆', category: 'streak' },
  // 正答率（4種）
  { id: 'acc60', name: '正答率60%', description: '直近100問で60%以上', icon: '🥉', category: 'accuracy' },
  { id: 'acc75', name: '正答率75%', description: '直近100問で75%以上', icon: '🥈', category: 'accuracy' },
  { id: 'acc90', name: '正答率90%', description: '直近100問で90%以上', icon: '🥇', category: 'accuracy' },
  { id: 'perfect', name: 'パーフェクト', description: '1セッション全問正解', icon: '💎', category: 'accuracy' },
  // 分野制覇（4種）
  { id: 'first_mastery', name: '最初の得意分野', description: '1分野で正答率80%超', icon: '🌱', category: 'mastery' },
  { id: 'mastery3', name: '3分野制覇', description: '3分野で正答率80%超', icon: '🌿', category: 'mastery' },
  { id: 'mastery_all', name: '全分野制覇', description: '全分野で正答率80%超', icon: '🌳', category: 'mastery' },
  { id: 'overcome', name: '苦手克服', description: '正答率50%以下→80%超に改善', icon: '🦋', category: 'mastery' },
  // チャレンジ（7種）
  { id: 'revenge', name: 'リベンジ成功', description: '3回間違えた問題に正解', icon: '🛡️', category: 'challenge' },
  { id: 'combo10', name: '10問連続正解', description: '1セッション内で10問連続正解', icon: '⚡', category: 'challenge' },
  { id: 'speed_star', name: 'スピードスター', description: '正答かつ5秒以内×10問', icon: '🚀', category: 'challenge' },
  { id: 'early_bird', name: '早起き学習', description: '午前7時前に学習開始', icon: '🌅', category: 'challenge' },
  { id: 'night_owl', name: '夜の努力家', description: '午後10時以降に学習', icon: '🌙', category: 'challenge' },
  { id: 'weekend', name: '週末も学習', description: '土日両方で学習', icon: '📅', category: 'challenge' },
  { id: 'rapid_growth', name: '急成長', description: '週の正答率が前週+15%以上', icon: '📈', category: 'challenge' },
];

// === レベル定義 ===
export const LEVEL_TITLES: { level: number; title: string; expRequired: number }[] = [
  { level: 1, title: '見学生', expRequired: 0 },
  { level: 5, title: '実習生', expRequired: 500 },
  { level: 10, title: '新人', expRequired: 2000 },
  { level: 15, title: '一人前', expRequired: 5000 },
  { level: 20, title: 'プリセプター', expRequired: 10000 },
  { level: 25, title: '主任', expRequired: 20000 },
  { level: 30, title: '師長', expRequired: 35000 },
  { level: 35, title: '専門家', expRequired: 50000 },
  { level: 40, title: '部長', expRequired: 80000 },
];

/**
 * EXPからレベルを計算
 */
export function calculateLevel(exp: number): number {
  // 簡易レベル計算: level = floor(sqrt(exp / 25)) + 1、最大40
  return Math.min(40, Math.floor(Math.sqrt(exp / 25)) + 1);
}

/**
 * 現在のレベルに必要なEXPと次レベルに必要なEXPを返す
 */
export function getLevelProgress(exp: number): { level: number; currentExp: number; nextLevelExp: number; progress: number } {
  const level = calculateLevel(exp);
  const currentLevelExp = (level - 1) * (level - 1) * 25;
  const nextLevelExp = level * level * 25;
  const progress = nextLevelExp > currentLevelExp
    ? (exp - currentLevelExp) / (nextLevelExp - currentLevelExp)
    : 1;
  return { level, currentExp: exp - currentLevelExp, nextLevelExp: nextLevelExp - currentLevelExp, progress: Math.min(1, progress) };
}

/**
 * レベルに対応する称号を返す
 */
export function getLevelTitle(level: number): string {
  let title = '見学生';
  for (const lt of LEVEL_TITLES) {
    if (level >= lt.level) title = lt.title;
  }
  return title;
}

/**
 * 回答後のEXP計算
 */
export function calculateExpGain(isCorrect: boolean, isReview: boolean, consecutiveCorrect: number): number {
  let exp = isCorrect ? 10 : 3;
  if (isCorrect && isReview) exp = 15; // 復習正答ボーナス
  if (isCorrect && consecutiveCorrect > 1) exp += Math.min(consecutiveCorrect, 10); // 連続正答ボーナス（最大+10）
  return exp;
}

/**
 * ゲーミフィケーション状態を取得または初期化
 */
export async function getOrCreateGamification(studentId: string): Promise<GamificationState> {
  const existing = await db.gamification.where('visitorId').equals(studentId).first();
  if (existing) return existing;

  const today = new Date().toISOString().split('T')[0]!;
  const state: GamificationState = {
    visitorId: studentId,
    exp: 0,
    level: 1,
    streakDays: 0,
    lastStudyDate: '',
    badges: [],
    weeklyQuestions: 0,
    weeklyCorrect: 0,
    weekStartDate: today,
  };
  const id = await db.gamification.add(state);
  return { ...state, id: id as number };
}

/**
 * ストリーク更新
 */
export function updateStreak(state: GamificationState): GamificationState {
  const today = new Date().toISOString().split('T')[0]!;
  const updated = { ...state };

  if (state.lastStudyDate === today) {
    // 今日は既に学習済み → 変更なし
    return updated;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0]!;

  if (state.lastStudyDate === yesterdayStr) {
    // 昨日学習した → ストリーク継続
    updated.streakDays = state.streakDays + 1;
  } else if (state.lastStudyDate === '') {
    // 初回
    updated.streakDays = 1;
  } else {
    // 途切れた → リセット
    updated.streakDays = 1;
  }

  updated.lastStudyDate = today;
  return updated;
}

/**
 * バッジ判定（回答後に呼ぶ）
 * 新しく獲得したバッジIDの配列を返す
 */
export async function checkBadges(
  state: GamificationState,
  sessionStats?: { correct: number; total: number; consecutiveCorrect: number; fastCorrect: number }
): Promise<string[]> {
  const newBadges: string[] = [];
  const has = (id: string) => state.badges.includes(id);

  // 総回答数を取得
  const totalAnswers = await db.answerLog.count();

  // 学習量バッジ
  if (!has('first_step') && totalAnswers >= 1) newBadges.push('first_step');
  if (!has('q100') && totalAnswers >= 100) newBadges.push('q100');
  if (!has('q500') && totalAnswers >= 500) newBadges.push('q500');
  if (!has('q1000') && totalAnswers >= 1000) newBadges.push('q1000');
  if (!has('q2000') && totalAnswers >= 2000) newBadges.push('q2000');

  // 継続バッジ
  if (!has('streak3') && state.streakDays >= 3) newBadges.push('streak3');
  if (!has('streak7') && state.streakDays >= 7) newBadges.push('streak7');
  if (!has('streak14') && state.streakDays >= 14) newBadges.push('streak14');
  if (!has('streak30') && state.streakDays >= 30) newBadges.push('streak30');
  if (!has('streak60') && state.streakDays >= 60) newBadges.push('streak60');

  // 正答率バッジ（直近100問）
  const recentLogs = await db.answerLog.orderBy('timestamp').reverse().limit(100).toArray();
  if (recentLogs.length >= 20) { // 最低20問以上
    const recentAcc = recentLogs.filter(l => l.isCorrect).length / recentLogs.length * 100;
    if (!has('acc60') && recentAcc >= 60) newBadges.push('acc60');
    if (!has('acc75') && recentAcc >= 75) newBadges.push('acc75');
    if (!has('acc90') && recentAcc >= 90) newBadges.push('acc90');
  }

  // パーフェクト（セッション全問正解）
  if (sessionStats && !has('perfect') && sessionStats.total >= 5 && sessionStats.correct === sessionStats.total) {
    newBadges.push('perfect');
  }

  // 分野制覇バッジ
  const allLogs = await db.answerLog.toArray();
  const questions = await db.questionCache.toArray();
  const catMap = new Map(questions.map(q => [q.question_id, q.category]));
  const catStats: Record<string, { correct: number; total: number }> = {};
  for (const log of allLogs) {
    const cat = catMap.get(log.questionId);
    if (!cat) continue;
    if (!catStats[cat]) catStats[cat] = { correct: 0, total: 0 };
    catStats[cat]!.total++;
    if (log.isCorrect) catStats[cat]!.correct++;
  }
  const masteredCount = Object.values(catStats).filter(s => s.total >= 10 && (s.correct / s.total) >= 0.8).length;
  if (!has('first_mastery') && masteredCount >= 1) newBadges.push('first_mastery');
  if (!has('mastery3') && masteredCount >= 3) newBadges.push('mastery3');
  const totalCategories = Object.keys(catStats).length;
  if (!has('mastery_all') && totalCategories >= 5 && masteredCount >= totalCategories) newBadges.push('mastery_all');

  // チャレンジバッジ
  if (sessionStats) {
    if (!has('combo10') && sessionStats.consecutiveCorrect >= 10) newBadges.push('combo10');
    if (!has('speed_star') && sessionStats.fastCorrect >= 10) newBadges.push('speed_star');
  }

  const hour = new Date().getHours();
  if (!has('early_bird') && hour < 7) newBadges.push('early_bird');
  if (!has('night_owl') && hour >= 22) newBadges.push('night_owl');

  const day = new Date().getDay();
  // 週末バッジ: 土曜(6)か日曜(0)に学習し、もう片方も今週学習済みかチェック
  if (!has('weekend') && (day === 0 || day === 6)) {
    // 今週の土日両方のログがあるか
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // 日曜始まり
    const weekLogs = allLogs.filter(l => l.timestamp >= startOfWeek.toISOString().split('T')[0]!);
    const weekDays = new Set(weekLogs.map(l => new Date(l.timestamp).getDay()));
    if (weekDays.has(0) && weekDays.has(6)) newBadges.push('weekend');
  }

  // リベンジ成功
  if (!has('revenge')) {
    // 3回以上間違えた後に正解した問題があるか
    const cardStates = await db.cardStates.toArray();
    for (const card of cardStates) {
      const logs = await db.answerLog.where('questionId').equals(card.questionId).toArray();
      if (logs.length >= 4) {
        const sorted = logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        // 最後が正解で、その前に3回以上不正解
        const lastLog = sorted[sorted.length - 1];
        const wrongsBefore = sorted.slice(0, -1).filter(l => !l.isCorrect).length;
        if (lastLog && lastLog.isCorrect && wrongsBefore >= 3) {
          newBadges.push('revenge');
          break;
        }
      }
    }
  }

  return newBadges;
}

/**
 * 回答後にゲーミフィケーション状態を更新するメイン関数
 */
export async function updateGamification(
  studentId: string,
  isCorrect: boolean,
  isReview: boolean,
  consecutiveCorrect: number,
  sessionStats?: { correct: number; total: number; consecutiveCorrect: number; fastCorrect: number }
): Promise<{ newBadges: string[]; expGained: number; levelUp: boolean; state: GamificationState }> {
  let gState = await getOrCreateGamification(studentId);

  // ストリーク更新
  gState = updateStreak(gState);

  // EXP計算
  const expGained = calculateExpGain(isCorrect, isReview, consecutiveCorrect);
  gState.exp += expGained;

  // レベル更新
  const oldLevel = gState.level;
  gState.level = calculateLevel(gState.exp);
  const levelUp = gState.level > oldLevel;

  // バッジ判定
  const newBadges = await checkBadges(gState, sessionStats);
  gState.badges = [...gState.badges, ...newBadges];

  // DB保存
  await db.gamification.put(gState);

  return { newBadges, expGained, levelUp, state: gState };
}
