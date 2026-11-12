import { z } from 'zod';

export const KNOWLEDGE_MAX_BYTES = 40 * 1024 * 1024;
const loopColorSchema = z.string().regex(/^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/, '颜色需为十六进制颜色值');
const loopReferenceSchema = z.string().trim().max(64).regex(/^[a-zA-Z0-9_.-]*$/, '章节引用格式无效');

export const loopStationSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, '节点标识格式无效'),
  seq: z.number().int().min(1).max(10000).optional(),
  kind: z.enum(['station', 'cross']).default('station'),
  cls: z.string().max(128).regex(/^[a-zA-Z0-9_ -]*$/).default(''),
  part: z.string().max(255).default(''),
  name: z.string().trim().min(1).max(255),
  sub: z.string().max(1000).default(''),
  color: loopColorSchema.default('#5B6CFF'),
  drive: z.string().max(10000).default(''),
  modules: z.array(z.object({ code: loopReferenceSchema.min(1), name: z.string().trim().min(1).max(1000), color: loopColorSchema })).max(100).default([]),
  points: z.array(z.object({ text: z.string().trim().min(1).max(10000), to: loopReferenceSchema.optional() })).max(100).default([]),
  upstream: z.string().max(10000).default(''),
  downstream: z.string().max(10000).default(''),
}).passthrough();

export const loopSchema = z.array(loopStationSchema).max(20)
  .refine((stations) => new Set(stations.map((station) => station.id)).size === stations.length, '闭环图节点标识重复')
  .refine((stations) => JSON.stringify(stations).length <= 200000, '闭环图数据超过200KB');

export type LoopStation = z.infer<typeof loopStationSchema>;

export const chapterSchema = z.object({
  module: z.enum(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'APPENDIX']),
  moduleTitle: z.string().max(255).optional(),
  sectionNo: z.string().trim().min(1).max(16),
  title: z.string().trim().min(1).max(255),
  sortOrder: z.number().int().min(0).max(100000).default(0),
  isPublic: z.boolean().default(false),
  html: z.string().min(1).max(1000000),
});

export const questionSchema = z.object({
  qtype: z.enum(['truefalse', 'choice', 'multiple', 'practical']),
  question_text: z.string().trim().min(1).max(10000),
  options: z.array(z.string().trim().min(1).max(5000)).max(4).nullable().optional(),
  answer: z.string().max(100).nullable().optional(),
  explanation: z.string().max(20000).nullable().optional(),
  sort_order: z.number().int().min(0).max(100000).optional(),
}).superRefine((q, ctx) => {
  let valid = true;
  if (q.qtype === 'truefalse') valid = q.answer === 'true' || q.answer === 'false';
  if (q.qtype === 'choice') valid = q.options?.length === 4 && /^[0-3]$/.test(q.answer ?? '');
  if (q.qtype === 'multiple') {
    const indices = (q.answer ?? '').split(',');
    valid = q.options?.length === 4 && indices.length >= 2 && indices.length <= 4 &&
      indices.every((i) => /^[0-3]$/.test(i)) && new Set(indices).size === indices.length;
  }
  if (q.qtype === 'practical') valid = !!q.explanation?.trim();
  if (!valid) ctx.addIssue({ code: 'custom', message: '题目选项、答案或简述参考答案无效' });
});

export const knowledgePackageSchema = z.object({
  schemaVersion: z.literal(1),
  loop: loopSchema.optional(),
  chapters: z.array(chapterSchema).max(2000).default([]),
  exams: z.array(z.object({
    code: z.enum(['ops_assistant', 'product_ops', 'content_ops']),
    name: z.string().trim().min(1).max(128),
    questions: z.array(questionSchema).max(5000),
  })).max(3).default([]),
  assets: z.array(z.object({
    path: z.string().regex(/^(?:notes|knowledge-assets)\/[a-zA-Z0-9_.-]+\.(?:png|jpe?g|gif|webp)$/i),
    contentType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
    base64: z.string().min(1).max(28 * 1024 * 1024),
  })).max(500).default([]),
}).superRefine((pack, ctx) => {
  const keys = pack.chapters.map((c) => `${c.module}/${c.sectionNo}`);
  const exams = pack.exams.map((e) => e.code);
  const assets = pack.assets.map((a) => a.path);
  if ([keys, exams, assets].some((list) => new Set(list).size !== list.length)) {
    ctx.addIssue({ code: 'custom', message: '知识包中存在重复章节、考试或资源路径' });
  }
  for (const exam of pack.exams) {
    const texts = exam.questions.map((q) => q.question_text);
    if (new Set(texts).size !== texts.length) ctx.addIssue({ code: 'custom', message: '同一考试存在重复题干' });
  }
});

export type KnowledgePackage = z.infer<typeof knowledgePackageSchema>;

export async function readLimitedJson(req: Request): Promise<unknown> {
  if (Number(req.headers.get('content-length')) > KNOWLEDGE_MAX_BYTES) throw new Error('知识包超过 40MB');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('请求内容为空');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > KNOWLEDGE_MAX_BYTES) { await reader.cancel(); throw new Error('知识包超过 40MB'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
