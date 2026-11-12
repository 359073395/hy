import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:8791';
const adminToken = process.env.ADMIN_TOKEN;
assert.ok(adminToken, 'ADMIN_TOKEN must be supplied');
const results = [];

async function request(url, { cookie, body, method = 'GET', status = 200, headers = {} } = {}) {
  const response = await fetch(base + url, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, status, `${method} ${url}: ${JSON.stringify(data)}`);
  return { data, response };
}

async function login(token) {
  const { data, response } = await request('/api/auth/login', { method: 'POST', body: { token } });
  return { cookie: response.headers.get('set-cookie').split(';')[0], user: data.user };
}

async function check(label, run) {
  await run();
  results.push(label);
  console.log(`PASS ${label}`);
}

const admin = await login(adminToken);
if (process.argv.includes('--after-restart')) {
  const state = JSON.parse(await readFile('test-results/state.json', 'utf8'));
  await check('restart preserves edited content and disabled account', async () => {
    const manual = (await request('/api/manual', { cookie: admin.cookie })).data;
    assert.ok(manual.chapters.some(c => c.title === 'CI updated chapter'));
    const members = (await request('/api/admin/users', { cookie: admin.cookie })).data.users;
    assert.equal(members.find(u => u.id === state.employeeId)?.status, 'disabled');
    const records = (await request('/api/exams/records?all=1', { cookie: admin.cookie })).data;
    assert.ok(JSON.stringify(records).includes(state.recordId));
  });
  process.exit(0);
}

const token = `CI-${randomBytes(18).toString('hex')}`;
const member = (await request('/api/admin/users', {
  cookie: admin.cookie, method: 'POST', status: 201,
  body: { name: 'CI learner', token, role: 'employee', tier: 'M2' },
})).data.user;
const employee = await login(token);
await check('member import is atomic and repeated tokens preserve existing accounts', async () => {
  await request('/api/admin/users/bulk', { cookie: admin.cookie, method: 'POST', status: 400, body: [null] });
  const importedToken = `CI-${randomBytes(18).toString('hex')}`;
  const body = [
    { name: 'CI imported member', token: importedToken, role: 'employee', tier: 'M2' },
    { name: 'CI duplicate', token: importedToken, role: 'employee', tier: 'M6' },
  ];
  const firstImport = (await request('/api/admin/users/bulk', { cookie: admin.cookie, method: 'POST', status: 201, body })).data;
  assert.equal(firstImport.count, 1);
  assert.equal(firstImport.skipped, 1);
  const repeated = (await request('/api/admin/users/bulk', { cookie: admin.cookie, method: 'POST', status: 201, body })).data;
  assert.equal(repeated.count, 0);
  const imported = await login(importedToken);
  assert.equal(imported.user.name, 'CI imported member');
  assert.equal(imported.user.tier, 'M2');
  const stored = (await request('/api/admin/users', { cookie: admin.cookie })).data.users.find(u => u.id === imported.user.id);
  assert.equal(stored.token, importedToken);
});
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=';
const restrictedPng = Buffer.concat([Buffer.from(png, 'base64'), Buffer.from('restricted')]).toString('base64');
const questions = [
  ...Array.from({ length: 15 }, (_, i) => ({ qtype: 'truefalse', question_text: `CI judgment ${i}`, options: null, answer: 'true', explanation: 'CI explanation', sort_order: i })),
  ...Array.from({ length: 10 }, (_, i) => ({ qtype: 'choice', question_text: `CI choice ${i}`, options: ['one', 'two', 'three', 'four'], answer: '0', explanation: 'CI explanation', sort_order: 15 + i })),
  ...Array.from({ length: 5 }, (_, i) => ({ qtype: 'multiple', question_text: `CI multiple ${i}`, options: ['one', 'two', 'three', 'four'], answer: '0,1', explanation: 'CI explanation', sort_order: 25 + i })),
  { qtype: 'practical', question_text: 'CI practical', options: null, answer: null, explanation: 'Explain the workflow', sort_order: 30 },
];
let retakeToken;
let retakeRecordId;
const pack = {
  schemaVersion: 1,
  chapters: [
    { module: 'M1', sectionNo: '1.1', title: 'CI chapter', sortOrder: 1, isPublic: false, html: '<p>CI original content</p><img src="/notes/test.png" alt="test" />' },
    { module: 'M6', sectionNo: '6.1', title: 'CI restricted', sortOrder: 2, isPublic: false, html: '<p>Restricted content</p><img src="/notes/restricted.png" />' },
  ],
  exams: [{ code: 'product_ops', name: 'CI product exam', questions }],
  assets: [
    { path: 'notes/test.png', contentType: 'image/png', base64: png },
    { path: 'notes/restricted.png', contentType: 'image/png', base64: restrictedPng },
  ],
};
await check('employee cannot manage people or import knowledge', async () => {
  await request('/api/admin/users', { cookie: employee.cookie, status: 403 });
  await request('/api/admin/knowledge', { cookie: employee.cookie, method: 'POST', body: { action: 'apply', mode: 'add', package: pack }, status: 403 });
});
await check('cross-origin writes are rejected', async () => {
  await request('/api/auth/logout', { cookie: admin.cookie, method: 'POST', headers: { origin: 'https://unrelated.invalid' }, status: 403 });
});
await check('knowledge preview and first import', async () => {
  const preview = (await request('/api/admin/knowledge', { cookie: admin.cookie, method: 'POST', body: { action: 'preview', package: pack } })).data.preview;
  assert.equal(preview.chapters, 2);
  assert.equal(preview.questions, 31);
  await request('/api/admin/knowledge', { cookie: admin.cookie, method: 'POST', body: { action: 'apply', mode: 'add', package: pack } });
});
const manual = (await request('/api/manual', { cookie: employee.cookie })).data;
const chapter = manual.chapters.find(c => c.title === 'CI chapter');
assert.ok(chapter);
await check('server enforces module visibility and stable image links', async () => {
  assert.equal(manual.chapters.some(c => c.module === 'M6'), false);
  const adminManual = (await request('/api/manual', { cookie: admin.cookie })).data;
  const restrictedUrl = adminManual.chapters.find(c => c.module === 'M6').html.match(/src="([^"]+)"/)[1];
  assert.equal((await fetch(base + restrictedUrl, { headers: { cookie: employee.cookie } })).status, 403);
  assert.equal((await fetch(base + restrictedUrl, { headers: { cookie: admin.cookie } })).status, 200);
  const url = chapter.html.match(/src="([^"]+)"/)[1];
  assert.ok(url.startsWith('/api/files/knowledge-assets/'));
  const unauthorized = await fetch(base + url);
  assert.equal(unauthorized.status, 401);
  const image = await fetch(base + url, { headers: { cookie: employee.cookie } });
  assert.equal(image.status, 200);
  assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'), png);
  const range = await fetch(base + url, { headers: { cookie: employee.cookie, range: 'bytes=0-7' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 8);
});
await check('invalid asset path fails without partial chapter writes', async () => {
  const bad = structuredClone(pack);
  bad.chapters[0].title = 'MUST NOT EXIST';
  bad.assets[0].path = '../escape.png';
  await request('/api/admin/knowledge', { cookie: admin.cookie, method: 'POST', status: 400, body: { action: 'apply', mode: 'update', package: bad } });
  const now = (await request('/api/manual', { cookie: admin.cookie })).data;
  assert.equal(now.chapters.some(c => c.title === 'MUST NOT EXIST'), false);
});
const exam = (await request('/api/exams', { cookie: employee.cookie })).data.exams.find(e => e.code === 'product_ops');
const assigned = (await request(`/api/admin/exams/${exam.id}/assign`, { cookie: admin.cookie, method: 'POST', status: 201, body: { userId: member.id } })).data.record;
const first = (await request(`/api/exams/records/${assigned.id}`, { cookie: employee.cookie })).data;
await check('exam issues 31 stable questions without answers', async () => {
  assert.equal(first.questions.length, 31);
  assert.ok(first.questions.every(q => !Object.hasOwn(q, 'answer') && !Object.hasOwn(q, 'explanation')));
  const again = (await request(`/api/exams/records/${assigned.id}`, { cookie: employee.cookie })).data;
  assert.deepEqual(again.questions.map(q => q.id), first.questions.map(q => q.id));
});
const updated = structuredClone(pack);
updated.chapters[0].title = 'CI updated chapter';
updated.chapters[0].html = '<p>CI content survives restart</p><img src="/notes/test.png" />';
updated.exams[0].questions[0].answer = 'false';
await check('knowledge upgrade preserves active exam snapshot and creates content history', async () => {
  await request('/api/admin/knowledge', { cookie: admin.cookie, method: 'POST', body: { action: 'apply', mode: 'update', package: updated } });
  const old = (await request(`/api/exams/records/${assigned.id}`, { cookie: admin.cookie })).data;
  assert.equal(old.questions.find(q => q.question_text === 'CI judgment 0').answer, 'true');
  const snapshots = (await request(`/api/admin/chapters/${chapter.id}/snapshots`, { cookie: admin.cookie })).data;
  assert.ok(JSON.stringify(snapshots).includes('version'));
});
const answers = Object.fromEntries(first.questions.map(q => [q.id, questions.find(f => f.question_text === q.question_text)?.answer ?? 'CI written answer']));
await check('grading uses snapshot and blocks resubmission', async () => {
  const graded = (await request(`/api/exams/records/${assigned.id}`, { cookie: employee.cookie, method: 'POST', body: { answers } })).data;
  assert.equal(graded.score, 100);
  assert.equal(graded.status, 'obj_passed');
  await request(`/api/exams/records/${assigned.id}`, { cookie: employee.cookie, method: 'POST', status: 409, body: { answers } });
});
await check('human review upgrades access and is idempotent', async () => {
  for (let i = 0; i < 2; i++) await request(`/api/admin/exams/records/${assigned.id}/practical`, { cookie: admin.cookie, method: 'POST', body: { status: 'passed' } });
  const me = (await request('/api/auth/me', { cookie: employee.cookie })).data.user;
  assert.equal(me.tier, 'M4');
});
await check('knowledge export round trips without employee credentials', async () => {
  const exported = (await request('/api/admin/knowledge', { cookie: admin.cookie })).data;
  assert.equal(exported.chapters.length, 2);
  assert.ok(exported.assets.length > 0);
  assert.equal(JSON.stringify(exported).includes(token), false);
  await request('/api/admin/knowledge', { cookie: admin.cookie, method: 'POST', body: { action: 'preview', package: exported } });
});
await check('failed exam supports a new retake with readable questions', async () => {
  const learnerToken = `CI-${randomBytes(18).toString('hex')}`;
  retakeToken = learnerToken;
  const learner = (await request('/api/admin/users', { cookie: admin.cookie, method: 'POST', status: 201, body: { name: 'CI retake', token: learnerToken } })).data.user;
  const session = await login(learnerToken);
  const attempt = (await request(`/api/admin/exams/${exam.id}/assign`, { cookie: admin.cookie, method: 'POST', status: 201, body: { userId: learner.id } })).data.record;
  await request(`/api/exams/records/${attempt.id}`, { cookie: session.cookie, method: 'POST', body: { answers: {} } });
  const retake = (await request(`/api/exams/${exam.id}/retake`, { cookie: session.cookie, method: 'POST', status: 201 })).data.record;
  retakeRecordId = retake.id;
  const detail = (await request(`/api/exams/records/${retake.id}`, { cookie: session.cookie })).data;
  assert.equal(detail.questions.length, 31);
});
await check('disabled member immediately loses access', async () => {
  await request(`/api/admin/users/${member.id}`, { cookie: admin.cookie, method: 'PATCH', body: { status: 'disabled' } });
  await request('/api/manual', { cookie: employee.cookie, status: 401 });
});
await check('only super administrators can export complete data', async () => {
  await request('/api/admin/data?scope=database', { status: 403 });
  await request('/api/admin/data?scope=members', { cookie: employee.cookie, status: 403 });
  const managerToken = `CI-${randomBytes(18).toString('hex')}`;
  await request('/api/admin/users', { cookie: admin.cookie, method: 'POST', status: 201, body: { name: 'CI manager', token: managerToken, role: 'admin' } });
  const manager = await login(managerToken);
  await request('/api/admin/data?scope=members', { cookie: manager.cookie, status: 403 });
  await request('/api/admin/backup', { cookie: manager.cookie, status: 403 });
  await request('/api/admin/data?scope=users;DROP', { cookie: admin.cookie, status: 400 });
  await request('/api/admin/data?scope=database&format=csv', { cookie: admin.cookie, status: 400 });
});
await check('JSON exports preserve people, grades, history and every database table', async () => {
  const { data: members, response } = await request('/api/admin/data?scope=members', { cookie: admin.cookie });
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  const person = members.find(row => row.id === member.id);
  assert.equal(person.token, token);
  assert.equal(person.status, 'disabled');
  assert.equal(person.tier, 'M4');
  assert.ok(Object.hasOwn(person, 'token_custom'));
  const records = (await request('/api/admin/data?scope=exams', { cookie: admin.cookie })).data;
  const passed = records.find(row => row.id === assigned.id);
  assert.equal(passed.score, 100);
  assert.equal(passed.status, 'passed');
  assert.deepEqual(passed.answers, answers);
  assert.equal(passed.question_snapshot.length, 31);
  const knowledge = (await request('/api/admin/data?scope=knowledge', { cookie: admin.cookie })).data;
  assert.equal(knowledge.chapters.length, 2);
  assert.ok(knowledge.content_snapshots.length > 0);
  const bank = (await request('/api/admin/data?scope=questions', { cookie: admin.cookie })).data;
  assert.equal(bank.questions.length, 31);
  const materials = (await request('/api/admin/data?scope=materials', { cookie: admin.cookie })).data;
  assert.ok(Array.isArray(materials.materials));
  const audit = (await request('/api/admin/data?scope=audit', { cookie: admin.cookie })).data;
  assert.ok(audit.audit_logs.length > 0);
  const database = (await request('/api/admin/data?scope=database', { cookie: admin.cookie })).data;
  for (const table of ['users', 'user_tokens', 'sessions', 'exams', 'questions', 'exam_records', 'content_snapshots', 'materials', 'schema_migrations', 'knowledge_settings', 'app_state']) {
    assert.ok(Array.isArray(database[table]), `Missing table ${table}`);
  }
  assert.equal(database.users.length, members.length);
  assert.ok(database.user_tokens.some(row => row.user_id === member.id && row.token === token));
});
await check('CSV exports retain Chinese encoding and full exam answers', async () => {
  for (const scope of ['members', 'exams']) {
    const response = await fetch(base + `/api/admin/data?scope=${scope}&format=csv`, { headers: { cookie: admin.cookie } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/csv/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191]);
    const csv = bytes.toString('utf8');
    assert.ok(csv.includes(scope === 'members' ? token : assigned.id));
    if (scope === 'exams') assert.ok(csv.includes('question_snapshot'));
  }
});
await mkdir('test-results', { recursive: true });
await writeFile('test-results/state.json', JSON.stringify({ employeeId: member.id, recordId: assigned.id, retakeToken, retakeRecordId }));
await writeFile('test-results/api-results.json', JSON.stringify({ passed: results }, null, 2));
