import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { KNOWLEDGE_MAX_BYTES, knowledgePackageSchema, type KnowledgePackage } from '@/lib/knowledge-package';
import { sanitizeContentHtml } from '@/lib/security';
import { getPool, withTransaction } from '@/lib/server/db';
import { freezeLegacyExamRecords } from '@/lib/server/exams';

const SCOPES: Record<string, string> = { ops_assistant: 'M1+M2', product_ops: 'M3+M4', content_ops: 'M5+M6' };
const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

function matchesImage(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString());
  return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
}

export function prepareKnowledge(input: unknown) {
  const parsed = knowledgePackageSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).slice(0, 3).join('；'));
  const pack = parsed.data;
  let totalBytes = 0;
  const assets = pack.assets.map((asset) => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64)) throw new Error(`图片编码无效 ${asset.path}`);
    const bytes = Buffer.from(asset.base64, 'base64');
    totalBytes += bytes.length;
    if (bytes.length > 20 * 1024 * 1024 || totalBytes > 32 * 1024 * 1024) throw new Error('图片超过单张20MB或合计32MB限制');
    if (!matchesImage(bytes, asset.contentType)) throw new Error(`图片内容与类型不符 ${asset.path}`);
    const key = createHash('sha256').update(bytes).digest('hex') + '.' + MIME_EXT[asset.contentType];
    return { ...asset, bytes, key, url: `/api/files/knowledge-assets/${key}` };
  });
  const replacements = new Map(assets.map((a) => ['/' + a.path, a.url]));
  const chapters = pack.chapters.map((chapter) => {
    const html = sanitizeContentHtml(chapter.html).replace(/\bsrc=(['"])(.*?)\1/gi, (match, quote: string, url: string) => {
      const next = replacements.get(url) ?? replacements.get(url.replace(/^\/api\/files/, ''));
      if (url.startsWith('/notes/') && !next) throw new Error(`章节 ${chapter.sectionNo} 缺少图片 ${url}`);
      return next ? `src=${quote}${next}${quote}` : match;
    });
    if (!html.trim()) throw new Error(`章节 ${chapter.sectionNo} 正文为空`);
    return { ...chapter, html };
  });
  return { pack: { ...pack, chapters }, assets, totalBytes };
}

export async function previewKnowledge(input: unknown) {
  const prepared = prepareKnowledge(input);
  const { rows } = await getPool().query<{ module: string; section_no: string }>('SELECT module,section_no FROM chapters');
  const existing = new Set(rows.map((c) => `${c.module}/${c.section_no}`));
  const newChapters = prepared.pack.chapters.filter((c) => !existing.has(`${c.module}/${c.sectionNo}`)).length;
  return {
    chapters: prepared.pack.chapters.length,
    newChapters,
    existingChapters: prepared.pack.chapters.length - newChapters,
    exams: prepared.pack.exams.length,
    questions: prepared.pack.exams.reduce((n, e) => n + e.questions.length, 0),
    assets: prepared.assets.length,
    assetBytes: prepared.totalBytes,
    loopStations: prepared.pack.loop?.length ?? 0,
  };
}

export async function importKnowledge(input: unknown, mode: 'add' | 'update', userId: string) {
  const prepared = prepareKnowledge(input);
  const directory = path.join(process.env.DATA_DIR ?? './data', 'knowledge-assets');
  await mkdir(directory, { recursive: true });
  // Content-addressed files are durable before the transaction references them.
  for (const asset of prepared.assets) {
    try { await writeFile(path.join(directory, asset.key), asset.bytes, { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  return withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(7362841)');
    const result = { addedChapters: 0, updatedChapters: 0, skippedChapters: 0, filledChapterContents: 0, addedQuestions: 0, updatedQuestions: 0, loopStations: 0 };
    for (const chapter of prepared.pack.chapters) {
      const found = await db.query<{ id: string }>('SELECT id FROM chapters WHERE module=$1 AND section_no=$2 FOR UPDATE', [chapter.module, chapter.sectionNo]);
      let chapterId = found.rows[0]?.id;
      const existingChapter = !!chapterId;
      if (!chapterId) {
        const created = await db.query<{ id: string }>('INSERT INTO chapters(module,section_no,title,sort_order,is_public) VALUES($1,$2,$3,$4,$5) RETURNING id', [chapter.module, chapter.sectionNo, chapter.title, chapter.sortOrder, chapter.isPublic]);
        chapterId = created.rows[0].id;
        result.addedChapters++;
      } else if (mode === 'update') {
        await db.query('UPDATE chapters SET title=$2,sort_order=$3,is_public=$4,updated_at=now() WHERE id=$1', [chapterId, chapter.title, chapter.sortOrder, chapter.isPublic]);
        result.updatedChapters++;
      }
      const blocks = await db.query<{ id: string; html: string; version: number }>('SELECT id,html,version FROM content_blocks WHERE chapter_id=$1 FOR UPDATE', [chapterId]);
      const block = blocks.rows[0];
      if (existingChapter && mode === 'add') {
        if (block?.html.trim()) { result.skippedChapters++; continue; }
        result.filledChapterContents++;
      }
      if (block && block.html !== chapter.html) {
        await db.query('INSERT INTO content_snapshots(content_block_id,version,html,created_by) VALUES($1,$2,$3,$4)', [block.id, block.version, block.html, userId]);
        await db.query('UPDATE content_blocks SET html=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$1', [block.id, chapter.html, userId]);
        await db.query("UPDATE materials SET status='re_pending' WHERE chapter_id=$1 AND status='active' AND position(sentence in $2)=0", [chapterId, chapter.html]);
      } else if (!block) {
        await db.query('INSERT INTO content_blocks(chapter_id,html,version,updated_by) VALUES($1,$2,1,$3)', [chapterId, chapter.html, userId]);
      }
    }
    for (const exam of prepared.pack.exams) {
      const current = await db.query<{ id: string }>('SELECT id FROM exams WHERE code=$1', [exam.code]);
      let examId = current.rows[0]?.id;
      if (!examId) {
        const inserted = await db.query<{ id: string }>('INSERT INTO exams(code,name,scope,pass_score) VALUES($1,$2,$3,80) RETURNING id', [exam.code, exam.name, SCOPES[exam.code]]);
        examId = inserted.rows[0].id;
      } else if (mode === 'update') await db.query('UPDATE exams SET name=$2 WHERE id=$1', [examId, exam.name]);
      await freezeLegacyExamRecords(db, examId);
      for (const [index, q] of exam.questions.entries()) {
        const currentQuestion = await db.query<{ id: string }>('SELECT id FROM questions WHERE exam_id=$1 AND question_text=$2 ORDER BY sort_order LIMIT 1', [examId, q.question_text]);
        const questionId = currentQuestion.rows[0]?.id;
        if (questionId && mode === 'add') continue;
        const values = [q.qtype, q.options ? JSON.stringify(q.options) : null, q.answer ?? null, q.explanation ?? null, q.sort_order ?? index];
        if (questionId) {
          await db.query('UPDATE questions SET qtype=$2,options=$3,answer=$4,explanation=$5,sort_order=$6 WHERE id=$1', [questionId, ...values]);
          result.updatedQuestions++;
        } else {
          await db.query('INSERT INTO questions(exam_id,question_text,qtype,options,answer,explanation,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)', [examId, q.question_text, ...values]);
          result.addedQuestions++;
        }
      }
    }
    if (prepared.pack.loop) {
      const conflict = mode === 'update'
        ? 'DO UPDATE SET value=EXCLUDED.value'
        : "DO UPDATE SET value=EXCLUDED.value WHERE knowledge_settings.value IN ('[]'::jsonb, 'null'::jsonb)";
      await db.query(`INSERT INTO knowledge_settings(key,value) VALUES('loop',$1) ON CONFLICT(key) ${conflict}`, [JSON.stringify(prepared.pack.loop)]);
    }
    const loop = await db.query<{ value: unknown }>("SELECT value FROM knowledge_settings WHERE key='loop'");
    result.loopStations = Array.isArray(loop.rows[0]?.value) ? loop.rows[0].value.length : 0;
    await db.query("INSERT INTO audit_logs(user_id,action,detail) VALUES($1,'knowledge_import',$2)", [userId, JSON.stringify({ mode, ...result })]);
    return result;
  });
}

export function getLoopRevision(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? [])).digest('hex');
}

export async function exportKnowledge(): Promise<KnowledgePackage> {
  const db = getPool();
  const chapters = await db.query('SELECT c.module,c.section_no AS "sectionNo",c.title,c.sort_order AS "sortOrder",c.is_public AS "isPublic",b.html FROM chapters c JOIN content_blocks b ON b.chapter_id=c.id ORDER BY c.module,c.sort_order');
  const exams = await db.query('SELECT id,code,name FROM exams ORDER BY code');
  const pack: KnowledgePackage = { schemaVersion: 1, chapters: chapters.rows, exams: [], assets: [] };
  for (const exam of exams.rows) {
    const qs = await db.query('SELECT qtype,question_text,options,answer,explanation,sort_order FROM questions WHERE exam_id=$1 ORDER BY sort_order', [exam.id]);
    pack.exams.push({ code: exam.code, name: exam.name, questions: qs.rows });
  }
  const settings = await db.query<{ value: KnowledgePackage['loop'] }>("SELECT value FROM knowledge_settings WHERE key='loop'");
  if (settings.rows[0]) pack.loop = settings.rows[0].value;
  const assetPaths = new Set(pack.chapters.flatMap((c) => [...c.html.matchAll(/\bsrc=['"]\/api\/files\/([a-zA-Z0-9_./-]+)['"]/g)].map((m) => m[1])));
  const dataDir = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? './data');
  let total = 0;
  for (const assetPath of assetPaths) {
    const full = path.resolve(/* turbopackIgnore: true */ dataDir, assetPath);
    if (!full.startsWith(dataDir + path.sep)) throw new Error('正文资源路径无效');
    const bytes = await readFile(/* turbopackIgnore: true */ full);
    total += bytes.length;
    if (total > 32 * 1024 * 1024) throw new Error('正文图片合计超过32MB，请分批整理后导出');
    const mime = Object.keys(MIME_EXT).find((type) => matchesImage(bytes, type));
    if (!mime) throw new Error('正文存在不支持导出的资源格式');
    const key = createHash('sha256').update(bytes).digest('hex') + '.' + MIME_EXT[mime];
    const packagePath = `knowledge-assets/${key}`;
    if (!pack.assets.some((a) => a.path === packagePath)) pack.assets.push({ path: packagePath, contentType: mime as KnowledgePackage['assets'][number]['contentType'], base64: bytes.toString('base64') });
    for (const chapter of pack.chapters) chapter.html = chapter.html.split(`/api/files/${assetPath}`).join('/' + packagePath);
  }
  if (Buffer.byteLength(JSON.stringify(pack), 'utf8') > KNOWLEDGE_MAX_BYTES) throw new Error('导出包超过40MB，请分批整理后导出');
  return pack;
}
