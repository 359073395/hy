import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword, normalizeUsername, validateCredentials } from '../deploy/password.cjs';
import { manageAdminAccount } from '../deploy/admin-account.cjs';

test('password hashes use unique salts and preserve spaces and Unicode', async () => {
  const password = ' 密码 with spaces 2026! ';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$16384\$8\$1\$/);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.trim(), first), false);
  assert.equal(await verifyPassword('wrong-password', first), false);
  assert.equal(await verifyPassword(password, 'scrypt$1073741824$8$1$invalid'), false);
});

test('credential validation normalizes usernames and rejects oversized input', () => {
  assert.equal(normalizeUsername(' Owner.Admin '), 'owner.admin');
  assert.equal(validateCredentials('owner', '12345678'), 'owner');
  assert.throws(() => validateCredentials('a', '12345678'));
  assert.throws(() => validateCredentials('owner', 'short'));
  assert.throws(() => validateCredentials('owner', 'x'.repeat(129)));
  assert.throws(() => validateCredentials('owner<script>', '12345678'));
});

test('create adds a new administrator and token without updating existing users', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      return { rows: sql.includes('RETURNING id') ? [{ id: 'new-id', name: '网站超级管理员', username: 'owner' }] : [] };
    },
  };
  const result = await manageAdminAccount(db, { action: 'create', username: 'Owner', password: 'new-admin-password' });
  assert.deepEqual(result, { ok: true, user: { id: 'new-id', name: '网站超级管理员', username: 'owner' } });
  assert.equal(calls.some(call => /^(UPDATE|DELETE)/.test(call.sql)), false);
  const created = calls.find(call => call.sql.includes('INSERT INTO users'))!;
  assert.equal(created.values[2], 'owner');
  assert.equal(await verifyPassword('new-admin-password', created.values[3]), true);
  const token = calls.find(call => call.sql.includes('INSERT INTO user_tokens'))!;
  assert.equal(token.values[0], 'new-id');
  assert.match(String(token.values[1]), /^[a-f0-9]{48}$/);
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
});

test('reset targets an active super administrator and preserves member tokens', async () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT')) return { rows: [{ id, role: 'super_admin', status: 'active' }] };
      return { rows: sql.startsWith('UPDATE') ? [{ id, name: 'Original name', username: 'owner-new' }] : [] };
    },
  };
  await manageAdminAccount(db, { action: 'reset', userId: id, username: 'owner-new', password: 'replacement-password' });
  const update = calls.find(call => call.sql.startsWith('UPDATE'))!;
  assert.equal(update.values[0], id);
  assert.equal(update.sql.includes('token_hash'), false);
  assert.equal(calls.some(call => call.sql.includes('user_tokens')), false);
  assert.deepEqual(calls.find(call => call.sql.startsWith('DELETE'))?.values, [id]);
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
});

test('duplicate usernames and wrong-role resets roll back without modifying other users', async () => {
  const commands: string[] = [];
  const duplicate = {
    async query(sql: string) {
      commands.push(sql);
      if (sql.includes('INSERT INTO users')) throw Object.assign(new Error('duplicate'), { code: '23505' });
      return { rows: [] };
    },
  };
  await assert.rejects(manageAdminAccount(duplicate, { action: 'create', username: 'taken', password: 'password-123' }), /用户名已被使用/);
  assert.equal(commands.at(-1), 'ROLLBACK');
  commands.length = 0;
  const employee = {
    async query(sql: string) {
      commands.push(sql);
      return { rows: sql.startsWith('SELECT') ? [{ role: 'employee', status: 'active' }] : [] };
    },
  };
  await assert.rejects(manageAdminAccount(employee, {
    action: 'reset', userId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', username: 'owner', password: 'password-123',
  }), /不是超级管理员/);
  assert.equal(commands.some(sql => sql.startsWith('UPDATE')), false);
  assert.equal(commands.at(-1), 'ROLLBACK');
});
