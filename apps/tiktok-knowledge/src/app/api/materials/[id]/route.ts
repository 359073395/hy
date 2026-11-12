import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { deleteObject } from '@/lib/storage';

/** 删除素材：仅 super_admin / admin */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: '无权限，仅管理员可删除素材' }, { status: 403 });

  const { id } = await ctx.params;
  const client = getSupabaseClient();
  const { data: m } = await client.from('materials').select('id, uploader_id, file_key').eq('id', id).single();
  if (!m) return NextResponse.json({ error: '素材不存在' }, { status: 404 });
  const { error: delErr } = await client.from('materials').delete().eq('id', id);
  if (delErr) return NextResponse.json({ error: '删除失败，请重试' }, { status: 500 });
  await deleteObject(m.file_key);
  return NextResponse.json({ ok: true });
}