import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { normalizeUsername, verifyPassword, DUMMY_PASSWORD_HASH } from '../../../deploy/password.cjs';
import { generateSessionToken, SESSION_TTL_SECONDS, type AuthUser } from '@/lib/auth';
import { getPool, withTransaction } from './db';

type PasswordLoginResult =
  | { status: 200; user: AuthUser; session: string }
  | { status: 401 | 429; error: string; retryAfter?: number };

/** A short per-account/per-network window limits guesses without changing account status. */
export async function loginWithPassword(request: Request, name: unknown, password: unknown): Promise<PasswordLoginResult> {
  const username = normalizeUsername(name);
  if (!username || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return { status: 401, error: '用户名或密码错误' };
  }
  const realAddress = request.headers.get('x-real-ip') ?? '';
  const forwardedAddress = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? '';
  const address = isIP(realAddress) ? realAddress : isIP(forwardedAddress) ? forwardedAddress : 'direct';
  const key = createHash('sha256').update(`${username}\0${address}`).digest('hex');
  const db = getPool();
  await db.query("DELETE FROM auth_login_limits WHERE window_started_at < now() - interval '1 day'");
  const limit = await db.query<{ attempts: number }>(
    `INSERT INTO auth_login_limits(key, attempts) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET
       attempts = CASE WHEN auth_login_limits.window_started_at < now() - interval '90 seconds' THEN 1 ELSE auth_login_limits.attempts + 1 END,
       window_started_at = CASE WHEN auth_login_limits.window_started_at < now() - interval '90 seconds' THEN now() ELSE auth_login_limits.window_started_at END
     RETURNING attempts`, [key],
  );
  if (limit.rows[0].attempts > 20) return { status: 429, error: '尝试次数过多，请稍后再试', retryAfter: 90 };

  return withTransaction(async (client) => {
    const result = await client.query<AuthUser & { password_hash: string | null }>(
      `SELECT id, name, role, tier, status, password_hash FROM users
       WHERE lower(username) = $1 FOR SHARE`, [username],
    );
    const user = result.rows[0];
    const matches = await verifyPassword(password, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (!matches || !user || user.status !== 'active' || !['admin', 'super_admin'].includes(user.role)) {
      return { status: 401, error: '用户名或密码错误' };
    }
    const session = generateSessionToken();
    await client.query('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
      user.id, session.hash, new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    ]);
    await client.query('DELETE FROM auth_login_limits WHERE key = $1', [key]);
    const safeUser = { id: user.id, name: user.name, role: user.role, tier: user.tier, status: user.status };
    return { status: 200, user: safeUser, session: session.raw };
  });
}
