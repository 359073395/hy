import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hashToken, createSessionForUser, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token: string | undefined = body?.token;
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: '请输入令牌' }, { status: 400 });
  }

  const client = getSupabaseClient();
  const h = hashToken(token);
  // 双密令登录：原始密令 + 自定义密令任一命中即放行（同一用户可同时保有 1 个原始 + 1 个自定义密令）
  const { data: rows, error } = await client
    .from('users')
    .select('id, name, role, tier, status, token_hash, custom_token_hash');
  if (error) return NextResponse.json({ error: '服务异常' }, { status: 500 });
  const user = rows?.find((r) => r.token_hash === h || r.custom_token_hash === h) ?? null;

  if (!user) return NextResponse.json({ error: '令牌无效' }, { status: 401 });
  if (user.status !== 'active') {
    return NextResponse.json({ error: '账号已停用，请联系管理员' }, { status: 403 });
  }

  const raw = await createSessionForUser(user.id);

  const res = NextResponse.json({
    user: { id: user.id, name: user.name, role: user.role, tier: user.tier },
  });
  res.cookies.set(SESSION_COOKIE, raw, sessionCookieOptions());
  return res;
}