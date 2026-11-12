import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin } from '@/lib/auth';

/**
 * 管理员清空某成员的全部考核记录（清理测试数据）。
 * body: { userId }
 * 仅删除该成员的 exam_records 行，返回删除条数；不动用户、tier 与题库。
 */
export async function POST(req: Request) {
  const op = await getCurrentUser();
  if (!op || !isAdmin(op)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const userId: string = body.userId;
  if (!userId) return NextResponse.json({ error: '缺少 userId' }, { status: 400 });

  const client = getSupabaseClient();
  const { data: user } = await client.from('users').select('id,name').eq('id', userId).single();
  if (!user) return NextResponse.json({ error: '成员不存在' }, { status: 404 });

  const { data: rows, error } = await client.from('exam_records').select('id').eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ids = (rows ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0, message: `${user.name} 没有考核记录` });
  }

  const { error: delErr } = await client.from('exam_records').delete().in('id', ids);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, deleted: ids.length, name: user.name });
}
