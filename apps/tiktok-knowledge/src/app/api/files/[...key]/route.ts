import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { getCurrentUser, isAdmin, canReadModule } from '@/lib/auth';
import { fileUrl, resolveStoragePath } from '@/lib/storage';
import { getPool } from '@/lib/server/db';

export const runtime = 'nodejs';
const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
};

async function serve(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response('请先登录', { status: 401 });
  const { key: segments } = await context.params;
  if (!['materials', 'knowledge-assets'].includes(segments[0])) return new Response('文件不存在', { status: 404 });
  const key = segments.join('/');
  let target: string;
  try { target = await resolveStoragePath(key); } catch { return new Response('文件路径无效', { status: 400 }); }

  if (!isAdmin(user)) {
    const matches = await getPool().query<{ module: string; is_public: boolean }>(
      `SELECT c.module, c.is_public FROM materials m JOIN chapters c ON c.id = m.chapter_id
       WHERE m.file_key = $1 AND m.status = 'active'
       UNION
       SELECT c.module, c.is_public FROM content_blocks b JOIN chapters c ON c.id = b.chapter_id
       WHERE position($2 in b.html) > 0`, [key, fileUrl(key)],
    );
    if (!matches.rows.some((row) => canReadModule(row.module, row.is_public, user))) return new Response('无权查看文件', { status: 403 });
  }

  const contentType = CONTENT_TYPES[path.extname(target).toLowerCase()];
  if (!contentType) return new Response('文件类型不支持', { status: 415 });
  let file;
  try { file = await open(/* turbopackIgnore: true */ target, 'r'); } catch { return new Response('文件不存在', { status: 404 }); }
  const stat = await file.stat();
  if (!stat.isFile()) { await file.close(); return new Response('文件不存在', { status: 404 }); }

  const headers = new Headers({
    'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes', 'Content-Disposition': 'inline',
  });
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
      await file.close();
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    status = 206;
  }
  headers.set('Content-Length', String(Math.max(0, end - start + 1)));
  if (request.method === 'HEAD' || stat.size === 0) {
    await file.close();
    return new Response(null, { status, headers });
  }
  const stream = Readable.toWeb(file.createReadStream({ start, end, autoClose: true })) as ReadableStream<Uint8Array>;
  return new Response(stream, { status, headers });
}

export const GET = serve;
export const HEAD = serve;
