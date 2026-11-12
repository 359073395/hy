import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:8791';
const results = [];
const uniqueToken = label => `${label}${randomBytes(4).toString('hex')}9`;

async function request(path, { cookie, method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (status !== null) assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
  return { data, status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

const login = (token, status = 200) => request('/api/auth/login', { method: 'POST', body: { token }, status });
const change = (cookie, token, status = 200) => request('/api/auth/passphrase', {
  cookie, method: 'POST', body: { newPass: token, confirm: token }, status,
});
const admin = await login(process.env.ADMIN_TOKEN);

async function createMember(name, token = uniqueToken('Original'), status = 201) {
  const result = await request('/api/admin/users', {
    cookie: admin.cookie, method: 'POST', body: { name, token, role: 'employee', tier: 'M2' }, status,
  });
  return { ...result, token };
}

async function storedMember(id) {
  const members = (await request('/api/admin/users', { cookie: admin.cookie })).data.users;
  const member = members.find(user => user.id === id);
  assert.ok(member);
  const exported = (await request('/api/admin/data?scope=members', { cookie: admin.cookie })).data.find(user => user.id === id);
  assert.equal(exported.token_custom, member.tokenCustom);
  assert.equal(exported.custom_token_hash, member.tokenCustom ? createHash('sha256').update(member.tokenCustom).digest('hex') : null);
  return member;
}

if (process.argv.includes('--after-restart')) {
  const state = JSON.parse(await readFile('test-results/token-sync-state.json', 'utf8'));
  const member = await storedMember(state.userId);
  assert.equal(member.token, state.originalToken);
  assert.equal(member.tokenCustom, state.customToken);
  assert.equal((await login(state.originalToken)).data.user.id, state.userId);
  assert.equal((await login(state.customToken)).data.user.id, state.userId);
  await login(state.retiredToken, 401);
  console.log('PASS custom token login, administrator display and export survive restart and restore');
  process.exit(0);
}

const created = await createMember('CI token sync learner');
const userId = created.data.user.id;
const employee = await login(created.token);
const firstToken = uniqueToken('Custom');
await change(employee.cookie, firstToken);
await change(employee.cookie, firstToken);
assert.equal((await storedMember(userId)).tokenCustom, firstToken);
assert.equal((await login(firstToken)).data.user.id, userId);
assert.equal((await login(created.token)).data.user.id, userId);
results.push('custom token immediately matches administrator list, export and login');

const replacement = uniqueToken('Updated');
await change(employee.cookie, replacement);
await login(firstToken, 401);
assert.equal((await login(replacement)).data.user.id, userId);
await change(employee.cookie, created.token, 400);
await createMember('CI must reject custom token collision', replacement, 409);
const other = await createMember('CI competing token learner');
const otherEmployee = await login(other.token);
await change(employee.cookie, other.token, 409);
results.push('replacement retires only the old custom token and rejects original/custom collisions');

const competing = uniqueToken('Compete');
const competed = await Promise.all([
  change(employee.cookie, competing, null),
  change(otherEmployee.cookie, competing, null),
]);
assert.deepEqual(competed.map(result => result.status).sort(), [200, 409]);
const winnerId = competed[0].status === 200 ? userId : other.data.user.id;
assert.equal((await login(competing)).data.user.id, winnerId);
results.push('concurrent custom token claims resolve to a single account');

const crossToken = uniqueToken('Cross');
const crossed = await Promise.all([
  change(employee.cookie, crossToken, null),
  createMember('CI original token race learner', crossToken, null),
]);
assert.ok((crossed[0].status === 200 && crossed[1].status === 409) || (crossed[0].status === 409 && crossed[1].status === 201));
const crossOwner = crossed[0].status === 200 ? userId : crossed[1].data.user.id;
assert.equal((await login(crossToken)).data.user.id, crossOwner);
results.push('member creation and custom token changes share a single login namespace');

const sameUserTokens = [uniqueToken('ChangeA'), uniqueToken('ChangeB')];
await Promise.all(sameUserTokens.map(token => change(employee.cookie, token)));
const current = await storedMember(userId);
assert.ok(sameUserTokens.includes(current.tokenCustom));
assert.equal((await login(current.tokenCustom)).data.user.id, userId);
await login(sameUserTokens.find(token => token !== current.tokenCustom), 401);
results.push('concurrent changes by one employee keep hash and displayed token consistent');

await request(`/api/admin/users/${userId}`, { cookie: admin.cookie, method: 'PATCH', body: { clearCustom: true } });
assert.equal((await storedMember(userId)).tokenCustom, null);
await login(current.tokenCustom, 401);
assert.equal((await login(created.token)).data.user.id, userId);
const racingResetToken = uniqueToken('ResetRace');
await Promise.all([
  change(employee.cookie, racingResetToken),
  request(`/api/admin/users/${userId}`, { cookie: admin.cookie, method: 'PATCH', body: { clearCustom: true } }),
]);
const resetState = await storedMember(userId);
assert.ok(resetState.tokenCustom === null || resetState.tokenCustom === racingResetToken);
await login(racingResetToken, resetState.tokenCustom ? 200 : 401);
results.push('administrator clear and concurrent employee changes stay consistent');

const finalToken = uniqueToken('Persist');
await change(employee.cookie, finalToken);
await mkdir('test-results', { recursive: true });
await writeFile('test-results/token-sync-state.json', JSON.stringify({ userId, originalToken: created.token, customToken: finalToken, retiredToken: firstToken }));
await writeFile('test-results/token-sync-results.json', JSON.stringify({ passed: results }, null, 2));
for (const result of results) console.log(`PASS ${result}`);
