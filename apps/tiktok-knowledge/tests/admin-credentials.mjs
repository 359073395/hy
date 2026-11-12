import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:8791';
const username = process.env.TEST_ADMIN_USERNAME;
const password = process.env.TEST_ADMIN_PASSWORD;
assert.ok(username && password, 'Test administrator credentials must be supplied');

function account(input, succeeds = true) {
  const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'tiktok-knowledge', 'node', 'deploy/admin-account.cjs'], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 30000,
  });
  if (succeeds) assert.equal(result.status, 0, result.stderr);
  else { assert.notEqual(result.status, 0); return null; }
  return JSON.parse(result.stdout);
}

async function login(body, status = 200) {
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return { user: data.user, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

const original = await login({ token: process.env.ADMIN_TOKEN });
async function exportMembers() {
  const response = await fetch(base + '/api/admin/data?scope=members', { headers: { cookie: original.cookie } });
  assert.equal(response.status, 200);
  return response.json();
}
const before = await exportMembers();
const created = account({ action: 'create', username, password });
assert.equal(created.ok, true);
const id = created.user.id;
assert.equal(created.user.username, username);
const signedIn = await login({ username: username.toUpperCase(), password });
assert.equal(signedIn.user.id, id);
assert.equal(signedIn.user.role, 'super_admin');
await login({ username, password: password + '-wrong' }, 401);
account({ action: 'create', username, password }, false);
account({ action: 'reset', userId: before.find(u => u.role === 'employee').id, username: 'invalid-target', password }, false);

const newUsername = username + '-reset';
const newPassword = password + '-updated';
account({ action: 'reset', userId: id, username: newUsername, password: newPassword });
await login({ username, password }, 401);
await login({ username: newUsername, password }, 401);
assert.equal((await login({ username: newUsername, password: newPassword })).user.id, id);
const revoked = await fetch(base + '/api/admin/users', { headers: { cookie: signedIn.cookie } });
assert.equal(revoked.status, 403);
assert.equal((await login({ token: process.env.ADMIN_TOKEN })).user.id, original.user.id);

account({ action: 'reset', userId: id, username, password });
const after = await exportMembers();
for (const member of before) assert.deepEqual(after.find(u => u.id === member.id), member);
assert.equal(after.length, before.length + 1);
const added = after.find(u => u.id === id);
assert.ok(added.password_hash && !added.password_hash.includes(password));
assert.equal((await login({ token: added.token })).user.id, id);
const status = account({ action: 'status' });
assert.equal(status.hasPasswordAdmin, true);
assert.ok(status.admins.some(u => u.id === id && u.username === username && u.hasPassword));
await writeFile('test-results/credentials-results.json', JSON.stringify({ passed: [
  'create independent username/password administrator', 'password authentication', 'duplicate username rejected',
  'employee reset rejected', 'selected administrator reset', 'selected sessions revoked',
  'existing members and tokens retained', 'passwords stored as hashes', 'existing token login',
] }, null, 2));
console.log('PASS administrator password setup and reset, existing people and tokens retained');
