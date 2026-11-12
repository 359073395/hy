import { createHash, randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const SESSION_COOKIE = 'manual_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 天

export interface AuthUser {
  id: string;
  name: string;
  role: 'super_admin' | 'admin' | 'employee';
  tier: 'M2' | 'M4' | 'M6';
  status: 'active' | 'disabled';
}

export type Role = AuthUser['role'];
export type Tier = AuthUser['tier'];

/** 将任意明文令牌做不可逆 SHA-256 哈希存储 / 比对 */
export function hashToken(token: string): string {
  return createHash('sha256').update(String(token).trim()).digest('hex');
}

export function generateSessionToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

/** 生成人类可读的成员登录令牌 */
export function generateMemberToken(): string {
  return 'mt-' + randomBytes(6).toString('hex').toUpperCase();
}

const ROLE_RANK: Record<Role, number> = { employee: 0, admin: 1, super_admin: 2 };

export function isAdmin(user: AuthUser | null | undefined): boolean {
  return !!user && ROLE_RANK[user.role] >= 1;
}

export function isSuperAdmin(user: AuthUser | null | undefined): boolean {
  return !!user && user.role === 'super_admin';
}

/** 根据员工级别计算可读模块集合（M7/M8/附录 恒可见，返回 true 于 isPublic 判断） */
const TIER_MODULES: Record<Tier, string[]> = {
  M2: ['M1', 'M2'],
  M4: ['M1', 'M2', 'M3', 'M4'],
  M6: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
};

export function canReadModule(moduleCode: string, isPublic: boolean, user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (isPublic) return true; // M7/M8/附录 全角色可见
  return (TIER_MODULES[user.tier] ?? []).includes(moduleCode);
}

export interface SessionContext {
  user: AuthUser;
  userId: string;
}

/**
 * 读取请求携带的会话并校验：
 * - 解析 httpOnly cookie manual_session
 * - 哈希后查会话表（未过期）
 * - 拉取用户并校验 status=active（停用立即失效）
 */
export async function getSessionUser(): Promise<AuthUser | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(SESSION_COOKIE)?.value;
    if (!raw) return null;

    const client = getSupabaseClient();
    const hash = hashToken(raw);

    const { data: sess, error: sessErr } = await client
      .from('sessions')
      .select('user_id, expires_at')
      .eq('token_hash', hash)
      .maybeSingle();
    if (sessErr) throw new Error(sessErr.message);
    if (!sess) return null;

    // 会话过期
    if (new Date(sess.expires_at).getTime() < Date.now()) {
      await client.from('sessions').delete().eq('token_hash', hash);
      return null;
    }

    const { data: user, error: userErr } = await client
      .from('users')
      .select('id, name, role, tier, status')
      .eq('id', sess.user_id)
      .maybeSingle();
    if (userErr) throw new Error(userErr.message);
    if (!user || user.status !== 'active') return null;

    return { id: user.id, name: user.name, role: user.role, tier: user.tier, status: user.status };
  } catch {
    return null;
  }
}

/** 会话变量注入到生成时。若未登录返回 null（由调用方决定 401） */
export async function getCurrentUser(): Promise<AuthUser | null> {
  return getSessionUser();
}

/** 创建会话，返回明文会话令牌（调用方负责写入 Set-Cookie） */
export async function createSessionForUser(userId: string): Promise<string> {
  const { raw, hash } = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const client = getSupabaseClient();

  const { error } = await client.from('sessions').insert({
    user_id: userId,
    token_hash: hash,
    expires_at: expiresAt,
  });
  if (error) throw new Error(`创建会话失败: ${error.message}`);
  return raw;
}

/** Same-site sessions for the standalone website, with HTTPS controlled by SITE_URL. */
export function sessionCookieOptions(): {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  const domain = process.env.SITE_URL ?? '';
  const isHttpsSite = domain.startsWith('https://');
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsSite,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** 读取当前请求 cookie 中的会话令牌原文（不校验），并销毁对应会话记录 */
export async function destroySession(raw: string | undefined): Promise<void> {
  if (!raw) return;
  const client = getSupabaseClient();
  await client.from('sessions').delete().eq('token_hash', hashToken(raw));
}
