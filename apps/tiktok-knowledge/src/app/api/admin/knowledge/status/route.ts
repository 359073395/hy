import { NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { loopSchema } from '@/lib/knowledge-package';
import { getPool } from '@/lib/server/db';
import { getLoopRevision } from '@/lib/server/knowledge-import';

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: '仅管理员可查看知识库状态' }, { status: 403 });
  const result = await getPool().query<{
    chapters: number; exams: number; questions: number; bodies: string[]; loop: unknown;
  }>(`SELECT
    (SELECT count(*)::int FROM chapters) AS chapters,
    (SELECT count(*)::int FROM exams) AS exams,
    (SELECT count(*)::int FROM questions) AS questions,
    COALESCE((SELECT jsonb_agg(html) FROM content_blocks), '[]'::jsonb) AS bodies,
    (SELECT value FROM knowledge_settings WHERE key='loop') AS loop`);
  const data = result.rows[0];
  const images = new Set(data.bodies.flatMap((html) => [...html.matchAll(/\bsrc=['"](\/api\/files\/[^'"\s]+)['"]/g)].map((match) => match[1])));
  const parsedLoop = loopSchema.safeParse(data.loop ?? []);
  return NextResponse.json({
    chapters: data.chapters, exams: data.exams, questions: data.questions,
    assets: images.size,
    loopStations: Array.isArray(data.loop) ? data.loop.length : 0,
    loop: parsedLoop.success ? parsedLoop.data : null,
    loopError: parsedLoop.success ? null : '已保存的闭环数据格式无效，请导出知识包核对后重新导入。',
    loopRevision: getLoopRevision(data.loop),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
