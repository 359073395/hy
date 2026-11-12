import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getPool } from '@/lib/server/db';
import { loopSchema } from '@/lib/knowledge-package';

export async function GET() {
  if (!await getCurrentUser()) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const result = await getPool().query('SELECT value FROM knowledge_settings WHERE key = $1', ['loop']);
  const parsed = loopSchema.safeParse(result.rows[0]?.value ?? []);
  if (!parsed.success) return NextResponse.json({ error: '闭环图数据格式无效，请管理员在知识库管理中核对后重新导入。' }, { status: 500 });
  return NextResponse.json({ stations: parsed.data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
