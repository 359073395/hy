import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin } from '@/lib/auth';

/**
 * 管理员删除单条考核记录（用于清理测试/误考产生的杂乱记录）。
 * 仅删除该 exam_records 行，不改动用户 tier、不影响题库。
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ recordId: string }> }) {
  const op = await getCurrentUser();
  if (!op || !isAdmin(op)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const { recordId } = await ctx.params;
  const client = getSupabaseClient();
  const { data } = await client.from('exam_records').select('id').eq('id', recordId).single();
  if (!data) return NextResponse.json({ error: '记录不存在' }, { status: 404 });

  const { error } = await client.from('exam_records').delete().eq('id', recordId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, deleted: 1 });
}
