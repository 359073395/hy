import { NextRequest, NextResponse } from 'next/server';
import { hashToken, createSessionForUser, SESSION_COOKIE, sessionCookieOptions, type AuthUser } from '@/lib/auth';
import { getPool } from '@/lib/server/db';
import { loginWithPassword } from '@/lib/server/password-auth';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (body && (Object.hasOwn(body, 'username') || Object.hasOwn(body, 'password'))) {
    try {
      const result = await loginWithPassword(req, body.username, body.password);
      if (result.status !== 200) {
        return NextResponse.json({ error: result.error }, {
          status: result.status,
          headers: result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {},
        });
      }
      const response = NextResponse.json({ user: result.user });
      response.cookies.set(SESSION_COOKIE, result.session, sessionCookieOptions());
      return response;
    } catch (error) {
      console.error('[password-login]', error instanceof Error ? error.message : 'Login failed');
      return NextResponse.json({ error: '服务异常，请稍后重试' }, { status: 500 });
    }
  }
  const token: string | undefined = body?.token;
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: '请输入令牌' }, { status: 400 });
  }

  const h = hashToken(token);
  let user: AuthUser | undefined;
  try {
    const result = await getPool().query<AuthUser>(
      'SELECT id, name, role, tier, status FROM users WHERE token_hash = $1 OR custom_token_hash = $1 LIMIT 1', [h],
    );
    user = result.rows[0];
  } catch {
    return NextResponse.json({ error: '服务异常' }, { status: 500 });
  }

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
