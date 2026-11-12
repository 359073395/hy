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
const adminChange = (id, tokenKind, token, status = 200, cookie = admin.cookie) => request(`/api/admin/users/${id}`, {
  cookie, method: 'PATCH', body: { tokenKind, newPass: token, confirm: token }, status,
});

async function createMember(name, token = uniqueToken('Original'), status = 201, role = 'employee') {
  const result = await request('/api/admin/users', {
    cookie: admin.cookie, method: 'POST', body: { name, token, role, tier: 'M2' }, status,
  });
  return { ...result, token };
}

async function storedMember(id) {
  const members = (await request('/api/admin/users', { cookie: admin.cookie })).data.users;
  const member = members.find(user => user.id === id);
  assert.ok(member);
  const exported = (await request('/api/admin/data?scope=members', { cookie: admin.cookie })).data.find(user => user.id === id);
  assert.equal(exported.token_custom, member.tokenCustom);
  assert.equal(exported.token, member.token);
  assert.equal(exported.token_hash, createHash('sha256').update(member.token).digest('hex'));
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
  await login(state.retiredOriginalToken, 401);
  const records = (await request('/api/admin/data?scope=exams', { cookie: admin.cookie })).data;
  assert.deepEqual(records.find(row => row.id === state.examRecord.id), state.examRecord);
  const disabled = await storedMember(state.disabledUser.id);
  assert.equal(disabled.status, 'disabled');
  assert.equal(disabled.token, state.disabledUser.token);
  assert.equal(disabled.tokenCustom, state.disabledUser.customToken);
  await login(disabled.token, 403);
  await login(disabled.tokenCustom, 403);
  console.log('PASS administrator original/custom token changes, permissions, exams and disabled state survive restart and restore');
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

const regularAdmin = await createMember('CI regular admin', uniqueToken('Operator'), 201, 'admin');
const regularAdminSession = await login(regularAdmin.token);
for (const kind of ['original', 'custom']) {
  await adminChange(userId, kind, uniqueToken('Denied'), 403, regularAdminSession.cookie);
  await adminChange(userId, kind, uniqueToken('Denied'), 403, employee.cookie);
}
const invalidBodies = [null, [], { tokenKind: null, newPass: 'Valid2026', confirm: 'Valid2026' },
  { tokenKind: 'custom', newPass: null, confirm: null }, { tokenKind: 'custom', newPass: [], confirm: [] },
  { tokenKind: 'custom', newPass: 'Valid2026', confirm: 'Different2026' },
  { tokenKind: 'custom', newPass: '12345678', confirm: '12345678' },
  { tokenKind: 'original', newPass: ' '.repeat(8), confirm: ' '.repeat(8) },
  { tokenKind: 'original', newPass: 'x'.repeat(129), confirm: 'x'.repeat(129) },
  ...['clearCustom', 'role', 'tier', 'status', 'name'].map(field => ({ tokenKind: 'custom', newPass: 'Valid2026', confirm: 'Valid2026', [field]: true })),
];
for (const body of invalidBodies) await request(`/api/admin/users/${userId}`, { cookie: admin.cookie, method: 'PATCH', body, status: 400 });
await adminChange('00000000-0000-0000-0000-000000000000', 'original', 'Valid2026', 404);
results.push('only super administrators can modify member tokens and malformed or mixed updates are rejected');

const exam = (await request('/api/exams', { cookie: admin.cookie })).data.exams[0];
assert.ok(exam);
const assigned = (await request(`/api/admin/exams/${exam.id}/assign`, { cookie: admin.cookie, method: 'POST', body: { userId }, status: 201 })).data.record;
const examRecord = (await request('/api/admin/data?scope=exams', { cookie: admin.cookie })).data.find(row => row.id === assigned.id);
const accountBefore = await storedMember(userId);
const replacementOriginal = randomBytes(32).toString('hex');
await adminChange(userId, 'original', replacementOriginal);
const afterOriginalChange = await storedMember(userId);
await adminChange(userId, 'original', replacementOriginal);
assert.deepEqual(await storedMember(userId), afterOriginalChange);
await login(created.token, 401);
assert.equal((await login(replacementOriginal)).data.user.id, userId);
assert.equal((await login(finalToken)).data.user.id, userId);
for (const field of ['id', 'name', 'role', 'tier', 'status', 'created_at']) assert.equal(afterOriginalChange[field], accountBefore[field]);
await adminChange(userId, 'original', finalToken, 400);
await adminChange(userId, 'custom', other.token, 409);
const adminCustom = uniqueToken('Managed');
await adminChange(userId, 'custom', adminCustom);
const afterCustomChange = await storedMember(userId);
await adminChange(userId, 'custom', adminCustom);
assert.deepEqual(await storedMember(userId), afterCustomChange);
await login(finalToken, 401);
assert.equal((await login(adminCustom)).data.user.id, userId);
assert.equal((await login(replacementOriginal)).data.user.id, userId);
await createMember('CI short original collision', adminCustom, 409);
results.push('super administrator changes original and custom tokens in place with idempotent long-original compatibility');

for (const role of ['admin', 'super_admin']) {
  const target = await createMember(`CI managed ${role}`, uniqueToken('Role'), 201, role);
  const original = uniqueToken('RoleNew');
  const custom = uniqueToken('RoleCustom');
  await adminChange(target.data.user.id, 'original', original);
  await adminChange(target.data.user.id, 'custom', custom);
  await login(target.token, 401);
  assert.equal((await login(original)).data.user.role, role);
  assert.equal((await login(custom)).data.user.id, target.data.user.id);
}
results.push('super administrator can manage administrator and super administrator member tokens');

const disabledTarget = await createMember('CI disabled token target');
const disabledId = disabledTarget.data.user.id;
await request(`/api/admin/users/${disabledId}`, { cookie: admin.cookie, method: 'PATCH', body: { status: 'disabled' } });
const disabledUser = { id: disabledId, token: uniqueToken('Disabled'), customToken: uniqueToken('DisabledC') };
await adminChange(disabledId, 'original', disabledUser.token);
await adminChange(disabledId, 'custom', disabledUser.customToken);
assert.equal((await storedMember(disabledId)).status, 'disabled');
await login(disabledTarget.token, 401);
await login(disabledUser.token, 403);
await login(disabledUser.customToken, 403);
results.push('credential changes preserve a disabled member status');

const sharedClaim = uniqueToken('AdminRace');
const adminRace = await Promise.all([
  adminChange(userId, 'original', sharedClaim, null),
  change(otherEmployee.cookie, sharedClaim, null),
]);
assert.deepEqual(adminRace.map(result => result.status).sort(), [200, 409]);
const sameAccountClaim = uniqueToken('SameRace');
const sameAccountRace = await Promise.all([
  adminChange(userId, 'original', sameAccountClaim, null),
  adminChange(userId, 'custom', sameAccountClaim, null),
]);
assert.deepEqual(sameAccountRace.map(result => result.status).sort(), [200, 400]);
await storedMember(userId);
results.push('administrator original/custom changes and employee changes resolve concurrent token conflicts atomically');

const finalOriginal = randomBytes(32).toString('hex');
const finalCustom = uniqueToken('AdminSaved');
await adminChange(userId, 'original', finalOriginal);
await adminChange(userId, 'custom', finalCustom);
const recordsAfter = (await request('/api/admin/data?scope=exams', { cookie: admin.cookie })).data;
assert.deepEqual(recordsAfter.find(row => row.id === assigned.id), examRecord);
const audit = (await request('/api/admin/data?scope=audit', { cookie: admin.cookie })).data.audit_logs;
const tokenAudit = audit.filter(row => row.action === 'member_token_changed');
assert.ok(tokenAudit.some(row => row.user_id === admin.data.user.id && row.detail.target_user_id === userId && row.detail.token_kind === 'original'));
assert.ok(tokenAudit.some(row => row.user_id === admin.data.user.id && row.detail.target_user_id === userId && row.detail.token_kind === 'custom'));
for (const token of [replacementOriginal, adminCustom, finalOriginal, finalCustom]) assert.equal(JSON.stringify(tokenAudit).includes(token), false);
results.push('member exam records survive credential changes and audit records identify actor and target without credential values');
await mkdir('test-results', { recursive: true });
await writeFile('test-results/token-sync-state.json', JSON.stringify({ userId, originalToken: finalOriginal, customToken: finalCustom, retiredToken: firstToken, retiredOriginalToken: created.token, examRecord, disabledUser }));
await writeFile('test-results/token-sync-results.json', JSON.stringify({ passed: results }, null, 2));
for (const result of results) console.log(`PASS ${result}`);
