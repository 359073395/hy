import test from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { insertMember, memberInputSchema } from '../src/lib/server/members';

test('member imports reject malformed rows before any database writes', () => {
  const schema = memberInputSchema.array().min(1);
  for (const value of [null, [], [null], ['member'], [{ name: 123 }], [{ name: 'Valid' }, null]]) {
    assert.equal(schema.safeParse(value).success, false);
  }
  assert.deepEqual(schema.parse([{ name: ' Employee ', token: ' token ' }]), [
    { name: 'Employee', token: 'token', role: 'employee', tier: 'M2' },
  ]);
});

test('a member token is attached to the returned account ID and duplicate inserts leave it untouched', async () => {
  const hashes = new Set<string>();
  const tokens = new Map<string, string>();
  const db = {
    async query(sql: string, args: string[]) {
      if (sql.startsWith('INSERT INTO users')) {
        const [name, hash, role, tier] = args;
        if (hashes.has(hash)) return { rows: [] };
        hashes.add(hash);
        return { rows: [{ id: `member-${hashes.size}`, name, role, tier, status: 'active', created_at: '2026-11-12' }] };
      }
      tokens.set(args[0], args[1]);
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const first = await insertMember(db, memberInputSchema.parse({ name: 'First', token: 'same-token' }));
  const duplicate = await insertMember(db, memberInputSchema.parse({ name: 'Replacement', token: 'same-token', tier: 'M6' }));
  const second = await insertMember(db, memberInputSchema.parse({ name: 'Second', token: 'other-token' }));
  assert.equal(first.user?.name, 'First');
  assert.equal(duplicate.user, undefined);
  assert.equal(second.user?.name, 'Second');
  assert.deepEqual([...tokens], [['member-1', 'same-token'], ['member-2', 'other-token']]);
});

test('token persistence failures propagate so the caller can roll back the account transaction', async () => {
  const db = {
    async query(sql: string) {
      if (sql.startsWith('INSERT INTO users')) return { rows: [{ id: 'created-id' }] };
      throw new Error('token persistence failed');
    },
  } as unknown as PoolClient;
  await assert.rejects(insertMember(db, memberInputSchema.parse({ name: 'Member', token: 'token' })), /token persistence failed/);
});
