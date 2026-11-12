import { NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { chapterSchema } from '@/lib/knowledge-package';
import { sanitizeContentHtml } from '@/lib/security';
import { withTransaction } from '@/lib/server/db';

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: '仅管理员可新增章节' }, { status: 403 });
  const parsed = chapterSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '请填写有效的模块、编号、标题和正文' }, { status: 400 });
  const chapter = parsed.data;
  const html = sanitizeContentHtml(chapter.html);
  if (!html.trim()) return NextResponse.json({ error: '正文为空' }, { status: 400 });
  try {
    const id = await withTransaction(async (db) => {
      const created = await db.query<{ id: string }>('INSERT INTO chapters(module,section_no,title,sort_order,is_public) VALUES($1,$2,$3,$4,$5) ON CONFLICT(module,section_no) DO NOTHING RETURNING id', [chapter.module, chapter.sectionNo, chapter.title, chapter.sortOrder, chapter.isPublic]);
      const id = created.rows[0]?.id;
      if (!id) return null;
      await db.query('INSERT INTO content_blocks(chapter_id,html,updated_by) VALUES($1,$2,$3)', [id, html, user.id]);
      await db.query("INSERT INTO audit_logs(user_id,action,detail) VALUES($1,'chapter_create',$2)", [user.id, JSON.stringify({ chapter_id: id, title: chapter.title })]);
      return id;
    });
    if (!id) return NextResponse.json({ error: '该模块已存在相同章节编号' }, { status: 409 });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    console.error('[chapter-create]', error);
    return NextResponse.json({ error: '新增章节失败，请重试' }, { status: 500 });
  }
}
