import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin, isSuperAdmin } from '@/lib/auth';
import { deleteUserWithCascade, clearCustomToken } from '@/lib/server/bootstrap-utils';

const VALID_TIERS = ['M2', 'M4', 'M6'];
const VALID_ROLES = ['employee', 'admin', 'super_admin'];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const op = await getCurrentUser();
  if (!op || !isAdmin(op)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const client = getSupabaseClient();

  const { data: target } = await client
    .from('users')
    .select('id, name, role, tier, status')
    .eq('id', id)
    .single();
  if (!target) return NextResponse.json({ error: '成员不存在' }, { status: 404 });
  if (target.role !== 'employee' && !isSuperAdmin(op)) return NextResponse.json({ error: '仅超管可管理管理员账户' }, { status: 403 });

  // 管理员一键清空该成员的自定义密令（重置后仅原始密令可用）
  if (body.clearCustom === true) {
    const res = await clearCustomToken(id, op.id);
    if (!res.ok) return NextResponse.json({ error: `重置失败：${res.error ?? '未知错误'}` }, { status: 500 });
    return NextResponse.json({ ok: true, clearedCustom: true });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.status === 'string' && ['active', 'disabled'].includes(body.status)) patch.status = body.status;
  if (VALID_TIERS.includes(body.tier)) patch.tier = body.tier;
  if (typeof body.name === 'string' && body.name.trim() && body.name.trim().length <= 128) patch.name = body.name.trim();
  if (VALID_ROLES.includes(body.role)) patch.role = body.role;

  // 变更 admin/super_admin 角色仅超管
  if (body.role && (body.role === 'admin' || body.role === 'super_admin') && !isSuperAdmin(op)) {
    return NextResponse.json({ error: '仅超管可调整管理员角色' }, { status: 403 });
  }
  // 超管不能把自己降级/停用（防止失去最后控制）
  if (id === op.id && (patch.status === 'disabled' || (patch.role && patch.role !== 'super_admin'))) {
    return NextResponse.json({ error: '不能停用或降级当前超管账户' }, { status: 400 });
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '无有效字段' }, { status: 400 });

  const updated = await client.from('users').update(patch).eq('id', id);
  if (updated.error) return NextResponse.json({ error: '保存成员失败' }, { status: 500 });
  // 停用即失效：删除该用户所有会话
  if (patch.status === 'disabled') await client.from('sessions').delete().eq('user_id', id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const op = await getCurrentUser();
  if (!op || !isAdmin(op)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const { id } = await ctx.params;
  const client = getSupabaseClient();
  const { data: target } = await client.from('users').select('id, role, token_hash').eq('id', id).single();
  if (!target) return NextResponse.json({ error: '成员不存在' }, { status: 404 });

  // 删除 admin/super_admin 仅超管
  if ((target.role === 'admin' || target.role === 'super_admin') && !isSuperAdmin(op)) {
    return NextResponse.json({ error: '仅超管可删除管理员' }, { status: 403 });
  }
  if (id === op.id) return NextResponse.json({ error: '不能删除当前账户' }, { status: 400 });

  // 级联清理全部外键引用 + 删账号 + 记录墓碑（防引导重新补齐）
  const result = await deleteUserWithCascade(client, id, target.token_hash ?? '');
  if (!result.ok) {
    return NextResponse.json({ error: `删除失败：${result.error ?? '未知错误'}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
