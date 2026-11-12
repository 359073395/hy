import { NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { sanitizeContentHtml } from '@/lib/security';
import { withTransaction } from '@/lib/server/db';

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: '无权限' }, { status: 403 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null) as { html?: unknown } | null;
  if (typeof body?.html !== 'string' || body.html.length > 1000000) return NextResponse.json({ error: '正文格式或长度无效' }, { status: 400 });
  const html = sanitizeContentHtml(body.html);
  if (!html.trim()) return NextResponse.json({ error: '正文为空' }, { status: 400 });
  try {
    const result = await withTransaction(async (db) => {
      const chapter = await db.query('SELECT id FROM chapters WHERE id=$1 FOR UPDATE', [id]);
      if (!chapter.rows[0]) return null;
      const blocks = await db.query<{ id: string; version: number; html: string }>('SELECT id,version,html FROM content_blocks WHERE chapter_id=$1 FOR UPDATE', [id]);
      const block = blocks.rows[0];
      let snapshotId: string | null = null;
      const version = (block?.version ?? 0) + 1;
      if (block) {
        const snapshot = await db.query<{ id: string }>('INSERT INTO content_snapshots(content_block_id,version,html,created_by) VALUES($1,$2,$3,$4) RETURNING id', [block.id, block.version, block.html, user.id]);
        snapshotId = snapshot.rows[0].id;
        await db.query('UPDATE content_blocks SET html=$2,version=$3,updated_by=$4,updated_at=now() WHERE id=$1', [block.id, html, version, user.id]);
      } else await db.query('INSERT INTO content_blocks(chapter_id,html,version,updated_by) VALUES($1,$2,$3,$4)', [id, html, version, user.id]);
      const rematch = await db.query("UPDATE materials SET status='re_pending' WHERE chapter_id=$1 AND status='active' AND position(sentence in $2)=0", [id, html]);
      await db.query("INSERT INTO audit_logs(user_id,action,detail) VALUES($1,'content_edit',$2)", [user.id, JSON.stringify({ chapter_id: id, from_version: block?.version ?? 0, to_version: version, snapshot_id: snapshotId })]);
      return { ok: true, version, snapshot_id: snapshotId, re_pending: rematch.rowCount ?? 0 };
    });
    if (!result) return NextResponse.json({ error: '章节不存在' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[content-edit]', error);
    return NextResponse.json({ error: '保存失败，请重试' }, { status: 500 });
  }
}
