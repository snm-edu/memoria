export interface CharacterMessage {
  id: string;
  text: string;
  tags: string[];
}

interface StageMessages {
  name: string;
  messages: CharacterMessage[];
}

interface MessagesFile {
  version: number;
  lastUpdated: string;
  stages: Record<string, StageMessages>;
}

export interface MessageContext {
  streakDays: number;
  recentAccuracy: number | null;
  lastStudyDate: string;
  hour: number;
  dayOfWeek: number;
}

const cache: { data: MessagesFile | null } = { data: null };

export async function loadMessages(): Promise<MessagesFile | null> {
  if (cache.data) return cache.data;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}assets/character/messages.json`);
    if (!res.ok) return null;
    const json = (await res.json()) as MessagesFile;
    cache.data = json;
    return json;
  } catch {
    return null;
  }
}

function pickRandom<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)] ?? null;
}

function fillTemplate(text: string, ctx: MessageContext): string {
  return text
    .replace('{streakDays}', String(ctx.streakDays))
    .replace('{recentAcc}', ctx.recentAccuracy !== null ? String(Math.round(ctx.recentAccuracy)) : '');
}

function isComeback(lastStudyDate: string): boolean {
  if (!lastStudyDate) return false;
  const last = new Date(lastStudyDate).getTime();
  const now = Date.now();
  const days = (now - last) / (1000 * 60 * 60 * 24);
  return days >= 3;
}

export function selectMessage(
  stage: number,
  ctx: MessageContext,
  pool: CharacterMessage[],
  excludeId?: string
): CharacterMessage | null {
  const candidates: CharacterMessage[] = [];
  const has = (tag: string) => (m: CharacterMessage) => m.tags.includes(tag);

  if (ctx.hour < 7) candidates.push(...pool.filter(has('early_morning')));
  if (ctx.hour >= 22) candidates.push(...pool.filter(has('night_owl')));
  if (ctx.streakDays >= 14) candidates.push(...pool.filter(has('streak14')));
  else if (ctx.streakDays >= 7) candidates.push(...pool.filter(has('streak7')));
  else if (ctx.streakDays >= 3) candidates.push(...pool.filter(has('streak3')));

  if (isComeback(ctx.lastStudyDate)) candidates.push(...pool.filter(has('comeback')));
  if (ctx.recentAccuracy !== null && ctx.recentAccuracy >= 80) candidates.push(...pool.filter(has('improving')));
  if (ctx.recentAccuracy !== null && ctx.recentAccuracy < 50) candidates.push(...pool.filter(has('struggling')));
  if (ctx.dayOfWeek === 0 || ctx.dayOfWeek === 6) candidates.push(...pool.filter(has('weekend')));

  // 文脈タグに合致するメッセージが少なければ汎用も追加（多様性確保）
  if (candidates.length < 3) candidates.push(...pool.filter(has('generic')));

  const filtered = excludeId ? candidates.filter(m => m.id !== excludeId) : candidates;
  // stage パラメータは将来のステージ別重み付け用に予約（現状は未使用だが API に含める）
  void stage;
  return pickRandom(filtered) ?? pickRandom(pool);
}

export function applyTemplate(msg: CharacterMessage, ctx: MessageContext): string {
  return fillTemplate(msg.text, ctx);
}

export async function getMessagesForStage(stage: number): Promise<CharacterMessage[]> {
  const file = await loadMessages();
  if (!file) return [];
  return file.stages[String(stage)]?.messages ?? [];
}
