/**
 * 文本处理与模糊匹配工具（前后端共用，纯函数、无副作用）。
 * 用于「待重挂素材」场景：正文编辑后，基于旧词/旧句对新正文做候选词推荐与失配原因判定。
 */

/** 把正文 HTML 转成纯文本（去标签、合并空白）。表格单元格用空格连接，行用换行。 */
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\s*(br|tr)[^>]*>/gi, '\n')
    .replace(/<\/\s*(th|td|p|li|div|h[1-6])\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?[a-zA-Z0-9]+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** 从纯文本中切出「句子」片段：按句读标点 / 换行切分，保留短语。 */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  return text
    .split(/[\n。！？!?；;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

/** 从正文 HTML 提取全部句子（保持出现顺序）。 */
export function sentencesFromHtml(html: string): string[] {
  return splitSentences(htmlToText(html));
}

/** 标准化：小写、去多余空白、去句末标点，用于宽松比对。 */
export function normalize(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[，。！？；：、,.!?;:"'’“”（）()\[\]【】]/g, '')
    .trim();
}

/** 切词：英文按空格、中文按字；返回小写 token 数组。 */
function tokenize(s: string): string[] {
  const n = normalize(s);
  if (!n) return [];
  const tokens: string[] = [];
  for (const part of n.split(/\s+/)) {
    if (/[a-z0-9]/.test(part)) {
      tokens.push(part);
    }
    // 中文按字拆，便于编辑后部分命中
    for (const ch of part) {
      if (/[\u4e00-\u9fa5]/.test(ch)) tokens.push(ch);
    }
  }
  return tokens;
}

/** 计算两个词/短语的相似度（0~1）：基于 token 的 Jaccard + 子串包含加成。 */
export function similarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  const jaccard = union === 0 ? 0 : inter / union;
  const na = normalize(a);
  const nb = normalize(b);
  let contain = 0;
  if (na && nb && (na.includes(nb) || nb.includes(na))) contain = 0.3;
  return Math.min(1, jaccard + contain);
}

export interface WordCandidate {
  /** 推荐挂接的新词（当前正文中的原文形态） */
  word: string;
  /** 所在当前句子原文 */
  sentence: string;
  /** 匹配得分 0~1 */
  score: number;
}

/**
 * 在当前正文句子中，为旧锚点（旧词 + 旧句）推荐 1~3 个候选新词。
 * 策略：
 *  1) 旧句若仍能模糊命中某句，优先在该句里找与旧词最相似的短语/词；
 *  2) 否则按旧词相似度在所有句子里找最佳词；
 *  返回按得分降序、去重后的候选。
 */
export function recommendCandidates(oldWord: string, oldSentence: string, currentHtml: string, limit = 3): WordCandidate[] {
  const sentences = sentencesFromHtml(currentHtml);
  if (sentences.length === 0) return [];

  // 句子级排序：与旧句相似度
  const scoredSentences = sentences
    .map((s) => ({ s, score: similarity(oldSentence, s) }))
    .sort((a, b) => b.score - a.score);

  const picked: WordCandidate[] = [];
  const seenWords = new Set<string>();

  const considerSentence = (sentence: string, base: number) => {
    // 在句子中提取候选词：英文连续词组 / 中文 2~6 字片段，取与旧词相似度最高者
    const phrases = extractPhrases(sentence);
    let best: WordCandidate | null = null;
    for (const p of phrases) {
      const wsim = similarity(oldWord, p);
      const score = wsim * 0.7 + base * 0.3;
      if (!best || score > best.score) best = { word: p, sentence, score };
    }
    if (best && best.score >= 0.34 && !seenWords.has(normalize(best.word))) {
      seenWords.add(normalize(best.word));
      picked.push(best);
    }
  };

  // 1) 优先旧句最像的前几句
  for (const { s, score } of scoredSentences.slice(0, 3)) {
    if (picked.length >= limit) break;
    considerSentence(s, score);
  }
  // 2) 兜底：旧词直接出现在某句
  if (picked.length === 0) {
    const nw = normalize(oldWord);
    for (const s of sentences) {
      if (normalize(s).includes(nw)) {
        considerSentence(s, 0.5);
        if (picked.length) break;
      }
    }
  }
  return picked.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 从一句中抽取可供挂接的短语：英文词组（含 Flash Sale 这类）+ 中文 2~6 字片段。 */
function extractPhrases(sentence: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (w: string) => {
    const t = w.trim();
    if (t.length >= 2 && t.length <= 24 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };
  // 英文/数字词组（允许空格、连字符），如 "Seller Flash Sale"、"LIVE Flash Sale"
  const enRe = /[A-Za-z][A-Za-z0-9'\-]*(?:\s+[A-Za-z][A-Za-z0-9'\-]*){0,3}/g;
  let m: RegExpExecArray | null;
  while ((m = enRe.exec(sentence)) !== null) push(m[0]);
  // 中文连续片段切成 2~6 字
  const zhRe = /[\u4e00-\u9fa5]{2,12}/g;
  while ((m = zhRe.exec(sentence)) !== null) {
    const seg = m[0];
    push(seg);
    if (seg.length >= 4) push(seg.slice(0, Math.min(6, seg.length)));
  }
  return out;
}

/** 失配原因判定：旧句是否还在、旧词是否还在。 */
export function mismatchReason(oldWord: string, oldSentence: string, currentHtml: string): string {
  if (!currentHtml || currentHtml.trim() === '') return '该章节正文已被清空';
  const text = htmlToText(currentHtml);
  const nText = normalize(text);
  const hasSentence = nText.includes(normalize(oldSentence).slice(0, 20)) || similarity(oldSentence, text) > 0.6;
  const hasWord = nText.includes(normalize(oldWord));
  if (!hasSentence && !hasWord) return '原词所在句子已被改写或删除';
  if (!hasSentence && hasWord) return '原词仍在，但所在句子已被改写';
  if (hasSentence && !hasWord) return '原句仍在，但原词已删除或改写';
  return '锚点匹配失败，请重新选词';
}

/** 在一句原文中把指定词高亮，返回分段数组（用于前端高亮渲染）。 */
export function splitByWord(sentence: string, word: string): { text: string; hit: boolean }[] {
  if (!word) return [{ text: sentence, hit: false }];
  const idx = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (idx < 0) return [{ text: sentence, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  if (idx > 0) parts.push({ text: sentence.slice(0, idx), hit: false });
  parts.push({ text: sentence.slice(idx, idx + word.length), hit: true });
  if (idx + word.length < sentence.length) parts.push({ text: sentence.slice(idx + word.length), hit: false });
  return parts;
}
