import type { DatabaseClient } from '@/storage/database/supabase-client';
import { getPool, withTransaction } from './db';

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

export async function setCustomToken(userId: string, token: string, tokenHash: string, originalToken: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await withTransaction(async (client) => {
      await client.query('UPDATE users SET custom_token_hash = $2, updated_at = now() WHERE id = $1', [userId, tokenHash]);
      await client.query(
        `INSERT INTO user_tokens(user_id, token, token_custom) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET token_custom = EXCLUDED.token_custom, updated_at = now()`,
        [userId, originalToken, token],
      );
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '密令保存失败' };
  }
}

export async function clearCustomToken(userId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await withTransaction(async (client) => {
      await client.query('UPDATE users SET custom_token_hash = NULL, updated_at = now() WHERE id = $1', [userId]);
      await client.query('UPDATE user_tokens SET token_custom = NULL, updated_at = now() WHERE user_id = $1', [userId]);
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
