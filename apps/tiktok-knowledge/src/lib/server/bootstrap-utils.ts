import type { DatabaseClient } from '@/storage/database/supabase-client';
import { getPool, withTransaction } from './db';
import { validateMemberToken, type MemberTokenKind } from '@/lib/passphrase';

export interface UserTokenRow { token: string; tokenCustom: string | null }

export async function setUserToken(userId: string, token: string): Promise<void> {
  await getPool().query(
    `INSERT INTO user_tokens(user_id, token) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, updated_at = now()`,
    [userId, token],
  );
}

export async function getAllUserTokens(): Promise<Map<string, UserTokenRow>> {
  const result = await getPool().query<{ user_id: string; token: string; token_custom: string | null }>(
    'SELECT user_id, token, token_custom FROM user_tokens',
  );
  return new Map(result.rows.map((row) => [row.user_id, { token: row.token, tokenCustom: row.token_custom }]));
}

type TokenUpdateResult = { ok: true } | { ok: false; error: string; status: 400 | 403 | 404 | 409 | 500 };

export async function setCustomToken(userId: string, token: string, tokenHash: string, ip: string): Promise<TokenUpdateResult> {
  return writeMemberToken(userId, 'custom', token, tokenHash, ip);
}

export async function setMemberToken(userId: string, kind: MemberTokenKind, token: string, tokenHash: string, actorId: string, ip: string): Promise<TokenUpdateResult> {
  return writeMemberToken(userId, kind, token, tokenHash, ip, actorId);
}

async function writeMemberToken(userId: string, kind: MemberTokenKind, token: string, tokenHash: string, ip: string, actorId?: string): Promise<TokenUpdateResult> {
  try {
    return await withTransaction<TokenUpdateResult>(async (client) => {
      // Member creation uses the same lock because original and custom tokens share a login namespace.
      await client.query('SELECT pg_advisory_xact_lock(581927104)');
      if (actorId) {
        const actor = await client.query<{ role: string; status: string }>('SELECT role, status FROM users WHERE id = $1 FOR SHARE', [actorId]);
        if (actor.rows[0]?.role !== 'super_admin' || actor.rows[0]?.status !== 'active') return { ok: false, error: '仅超管可修改成员密令', status: 403 };
      }
      const found = await client.query<{ name: string; role: string; tier: string; status: string; token_hash: string; custom_token_hash: string | null; token: string | null; token_custom: string | null }>(
        `SELECT u.name, u.role, u.tier, u.status, u.token_hash, u.custom_token_hash, t.token, t.token_custom FROM users u
         LEFT JOIN user_tokens t ON t.user_id = u.id WHERE u.id = $1 FOR UPDATE OF u`, [userId],
      );
      const user = found.rows[0];
      if (!user) return { ok: false, error: '成员不存在', status: 404 };
      if (!actorId && user.status !== 'active') return { ok: false, error: '账号已停用', status: 403 };
      const validation = validateMemberToken(token, kind, user.name);
      if (validation) return { ok: false, error: validation, status: 400 };
      if (kind === 'custom' && !user.token) return { ok: false, error: '未找到您的原始密令记录，请联系管理员处理', status: 500 };
      const duplicate = await client.query<{ id: string; token_hash: string }>(
        'SELECT id, token_hash FROM users WHERE token_hash = $1 OR custom_token_hash = $1', [tokenHash],
      );
      if (duplicate.rows.some(row => row.id !== userId)) return { ok: false, error: '该密令已被他人占用，请更换', status: 409 };
      if (kind === 'original') {
        if (user.custom_token_hash === tokenHash) return { ok: false, error: '新原始密令不能与该成员的自定义密令相同', status: 400 };
        if (user.token_hash === tokenHash && user.token === token) return { ok: true };
        await client.query('UPDATE users SET token_hash = $2, updated_at = now() WHERE id = $1', [userId, tokenHash]);
        await client.query(
          `INSERT INTO user_tokens(user_id, token) VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, updated_at = now()`, [userId, token],
        );
      } else {
        if (user.token_hash === tokenHash) return { ok: false, error: '新密令不能与您的原始密令相同，请更换', status: 400 };
        if (user.custom_token_hash === tokenHash && user.token_custom === token) return { ok: true };
        await client.query('UPDATE users SET custom_token_hash = $2, updated_at = now() WHERE id = $1', [userId, tokenHash]);
        await client.query('UPDATE user_tokens SET token_custom = $2, updated_at = now() WHERE user_id = $1', [userId, token]);
      }
      await client.query('INSERT INTO audit_logs(user_id, action, detail) VALUES ($1, $2, $3)', [
        actorId || userId,
        actorId ? 'member_token_changed' : 'passphrase_change',
        JSON.stringify(actorId
          ? { target_user_id: userId, target_name: user.name, token_kind: kind, ip }
          : { name: user.name, role: user.role, tier: user.tier, ip }),
      ]);
      return { ok: true };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, error: '该密令已被他人占用，请更换', status: 409 };
    console.error('[passphrase-change] Failed to update member credentials');
    return { ok: false, error: '密令保存失败，请稍后重试', status: 500 };
  }
}

export async function clearCustomToken(userId: string, actorId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(581927104)');
      const target = await client.query<{ name: string }>('UPDATE users SET custom_token_hash = NULL, updated_at = now() WHERE id = $1 RETURNING name', [userId]);
      await client.query('UPDATE user_tokens SET token_custom = NULL, updated_at = now() WHERE user_id = $1', [userId]);
      await client.query('INSERT INTO audit_logs(user_id, action, detail) VALUES ($1, $2, $3)', [
        actorId, 'custom_passphrase_cleared', JSON.stringify({ target_user_id: userId, target_name: target.rows[0]?.name }),
      ]);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '密令重置失败' };
  }
}

export async function deleteUserWithCascade(_client: DatabaseClient, userId: string, tokenHash: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await withTransaction(async (client) => {
      await client.query('UPDATE audit_logs SET user_id = NULL WHERE user_id = $1', [userId]);
      await client.query('UPDATE content_blocks SET updated_by = NULL WHERE updated_by = $1', [userId]);
      await client.query('UPDATE content_snapshots SET created_by = NULL WHERE created_by = $1', [userId]);
      await client.query('UPDATE materials SET uploader_id = NULL WHERE uploader_id = $1', [userId]);
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
      await client.query('INSERT INTO bootstrap_removals(token_hash) VALUES ($1) ON CONFLICT DO NOTHING', [tokenHash]);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '成员删除失败' };
  }
}
