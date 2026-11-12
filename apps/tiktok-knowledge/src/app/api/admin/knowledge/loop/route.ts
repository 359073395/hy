import { NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { loopSchema, readLimitedJson } from '@/lib/knowledge-package';
import { withTransaction } from '@/lib/server/db';
import { getLoopRevision } from '@/lib/server/knowledge-import';

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: '仅管理员可编辑闭环图' }, { status: 403 });
  try {
    const body = await readLimitedJson(request) as { stations?: unknown; revision?: unknown };
    const parsed = loopSchema.safeParse(body?.stations);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).slice(0, 3).join('；') }, { status: 400 });
    if (typeof body.revision !== 'string') return NextResponse.json({ error: '请重新载入闭环图后保存' }, { status: 400 });
    const saved = await withTransaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(7362841)');
      const current = await db.query<{ value: unknown }>("SELECT value FROM knowledge_settings WHERE key='loop' FOR UPDATE");
      if (getLoopRevision(current.rows[0]?.value) !== body.revision) return false;
      await db.query("INSERT INTO knowledge_settings(key,value) VALUES('loop',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(parsed.data)]);
      await db.query("INSERT INTO audit_logs(user_id,action,detail) VALUES($1,'loop_updated',$2)", [user.id, JSON.stringify({ stations: parsed.data.length })]);
      return true;
    });
    if (!saved) return NextResponse.json({ error: '闭环图已由其他操作更新，请重新载入后合并修改。当前编辑内容仍保留在页面。' }, { status: 409 });
    return NextResponse.json({ ok: true, stations: parsed.data.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '闭环图保存失败' }, { status: 400 });
  }
}
