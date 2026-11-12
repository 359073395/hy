import { NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { sanitizeContentHtml } from '@/lib/security';
import { withTransaction } from '@/lib/server/db';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; snapshotId: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: '无权限' }, { status: 403 });
  const { id, snapshotId } = await ctx.params;
  try {
    const result = await withTransaction(async (db) => {
      await db.query('SELECT id FROM chapters WHERE id=$1 FOR UPDATE', [id]);
      const blocks = await db.query<{ id: string; version: number; html: string }>('SELECT id,version,html FROM content_blocks WHERE chapter_id=$1 FOR UPDATE', [id]);
      const block = blocks.rows[0];
      if (!block) return null;
      const snapshots = await db.query<{ html: string; version: number }>('SELECT html,version FROM content_snapshots WHERE id=$1 AND content_block_id=$2', [snapshotId, block.id]);
      const snapshot = snapshots.rows[0];
      if (!snapshot) return null;
      const html = sanitizeContentHtml(snapshot.html);
      await db.query('INSERT INTO content_snapshots(content_block_id,version,html,created_by) VALUES($1,$2,$3,$4)', [block.id, block.version, block.html, user.id]);
      await db.query('UPDATE content_blocks SET html=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$1', [block.id, html, user.id]);
      await db.query("UPDATE materials SET status='re_pending' WHERE chapter_id=$1 AND status='active' AND position(sentence in $2)=0", [id, html]);
      await db.query("INSERT INTO audit_logs(user_id,action,detail) VALUES($1,'content_rollback',$2)", [user.id, JSON.stringify({ chapter_id: id, from_version: block.version, to_version: block.version + 1, rollback_to: snapshot.version })]);
      return { ok: true, version: block.version + 1 };
    });
    if (!result) return NextResponse.json({ error: '本章节的历史版本不存在' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[content-rollback]', error);
    return NextResponse.json({ error: '恢复历史版本失败，请重试' }, { status: 500 });
  }
}
