// 考核题库随机抽样工具：以 record.id 为确定性随机种子，保证同一记录始终抽到同一批题，
// 不同记录/不同次考试抽到的题不同。单次考试抽 15 判断 + 15 选择(10 单选 + 5 多选) + 1 简述。

export const EXAM_PICK = { truefalse: 15, choice: 10, multiple: 5, practical: 1 };

// 字符串 → 32位无符号种子（FNV-1a）
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// mulberry32 伪随机
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher–Yates 洗牌
function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 按题型取指定数量；不足则取全部。返回：{ truefalse, choice, practical } 分组数组 */
export function pickExamQuestions<T extends { id: string; qtype: string }>(questions: T[], seedStr: string) {
  const rnd = mulberry32(hashSeed(seedStr));
  const byType: Record<string, T[]> = { truefalse: [], choice: [], multiple: [], practical: [] };
  for (const q of questions || []) {
    if (byType[q.qtype]) byType[q.qtype].push(q);
    else byType[q.qtype] = [q];
  }
  const picked: Record<string, T[]> = {};
  for (const t of ['truefalse', 'choice', 'multiple', 'practical'] as const) {
    const n = EXAM_PICK[t] ?? 0;
    const list = byType[t] || [];
    picked[t] = shuffle(list, rnd).slice(0, Math.min(n, list.length));
  }
  return picked;
}

/** 合并为单一题目数组（按 判断→单选→多选→简述 顺序，保持 sort_order 语义） */
export function flattenPicked<T extends { id: string; qtype: string }>(picked: Record<string, T[]>): T[] {
  return [...(picked.truefalse || []), ...(picked.choice || []), ...(picked.multiple || []), ...(picked.practical || [])];
}

/** 规范化多选答案字符串 → 升序去重的下标数组（如 "3,0,2,0" → [0,2,3]；空串 → []） */
export function normMultiAnswer(v: string | null | undefined): number[] {
  if (!v) return [];
  const set = new Set<number>();
  for (const part of String(v).split(',')) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 0) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * 客观题判分。多选(multiple)采用「全对才得分」：考生所选下标集合与正确答案集合完全一致才计对，
 * 多选/少选/错选均不得分。单选/判断仍为字符串相等。
 */
export function isAnswerCorrect(qtype: string, correct: string | null | undefined, mine: string | null | undefined): boolean {
  if (correct == null) return false;
  if (qtype === 'multiple') {
    const a = normMultiAnswer(correct);
    const b = normMultiAnswer(mine);
    return a.length > 0 && a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return String(mine ?? '') === String(correct);
}

/** 多选/单选答案下标 → 选项文本（多选用「、」连接），供解析区展示 */
export function answerToText(qtype: string, answer: string | null | undefined, options: string[] | null | undefined): string {
  if (answer == null || !Array.isArray(options)) return '';
  if (qtype === 'multiple') {
    return normMultiAnswer(answer).map((i) => options[i] ?? '').filter(Boolean).join('、');
  }
  return options[Number(answer)] ?? '';
}