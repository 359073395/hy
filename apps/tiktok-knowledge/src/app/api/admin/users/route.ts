import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin, isSuperAdmin } from '@/lib/auth';
import { getAllUserTokens } from '@/lib/server/bootstrap-utils';
import { withTransaction } from '@/lib/server/db';
import { insertMember, memberInputSchema } from '@/lib/server/members';

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('users')
    .select('id, name, role, tier, status, created_at')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 附加令牌明文（原始+自定义，仅管理员后台可见；员工账号自己看不到他人令牌）
  const tokens = await getAllUserTokens();
  const users = (data ?? []).map((u) => {
    const t = isSuperAdmin(user) || u.role === 'employee' || u.id === user.id ? tokens.get(u.id) : undefined;
    return { ...u, token: t?.token ?? null, tokenCustom: t?.tokenCustom ?? null };
  });

  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const op = await getCurrentUser();
  if (!op || !isAdmin(op)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const parsed = memberInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '成员资料格式无效' }, { status: 400 });
  const input = parsed.data;
  if (!input.name) return NextResponse.json({ error: '姓名不能为空' }, { status: 400 });

  // 创建/管理 admin 仅超管
  if (input.role !== 'employee' && !isSuperAdmin(op)) {
    return NextResponse.json({ error: '仅超管可创建管理员' }, { status: 403 });
  }

  try {
    const result = await withTransaction(async (db) => {
      const created = await insertMember(db, input);
      if (created.user) await db.query("INSERT INTO audit_logs(user_id,action,detail) VALUES($1,'member_created',$2)", [op.id, JSON.stringify({ target_user_id: created.user.id })]);
      return created;
    });
    if (!result.user) return NextResponse.json({ error: '登录令牌已被使用' }, { status: 409 });
    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json({ error: '创建成员失败，请稍后重试' }, { status: 500 });
  }
}
