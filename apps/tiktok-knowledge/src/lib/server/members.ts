import { z } from 'zod';
import type { PoolClient } from 'pg';
import { generateMemberToken, hashToken } from '@/lib/auth';

export const memberInputSchema = z.object({
  name: z.string().trim().max(128).default(''),
  token: z.string().trim().max(128).optional(),
  role: z.enum(['employee', 'admin', 'super_admin']).default('employee'),
  tier: z.enum(['M2', 'M4', 'M6']).default('M2'),
});

export type MemberInput = z.infer<typeof memberInputSchema>;

interface CreatedMember {
  id: string;
  name: string;
  role: string;
  tier: string;
  status: string;
  created_at: string;
}

/** The caller owns the transaction so account creation and its login token commit together. */
export async function insertMember(db: PoolClient, input: MemberInput) {
  const token = input.token || generateMemberToken();
  const inserted = await db.query<CreatedMember>(
    `INSERT INTO users(name, token_hash, role, tier, status) VALUES($1, $2, $3, $4, 'active')
     ON CONFLICT(token_hash) DO NOTHING RETURNING id, name, role, tier, status, created_at`,
    [input.name || '未命名成员', hashToken(token), input.role, input.tier],
  );
  const user = inserted.rows[0];
  if (user) await db.query('INSERT INTO user_tokens(user_id, token) VALUES($1, $2)', [user.id, token]);
  return { user, token };
}
