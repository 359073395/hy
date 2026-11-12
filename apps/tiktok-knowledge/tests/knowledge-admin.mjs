import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:8791';
const passed = [];

async function request(route, { cookie, body, method = 'GET', status = 200 } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(data)}`);
  return { data, response };
}

async function login(token) {
  const { response } = await request('/api/auth/login', { method: 'POST', body: { token } });
  return response.headers.get('set-cookie').split(';')[0];
}

function databaseQuery(text, values) {
  const code = `
    const { Client } = require('pg');
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', async () => {
      const input = JSON.parse(Buffer.concat(chunks).toString());
      const db = new Client({ connectionString: process.env.PGDATABASE_URL });
      try { await db.connect(); await db.query(input.text, input.values); }
      catch (error) { console.error(error.message); process.exitCode = 1; }
      finally { await db.end(); }
    });
  `;
  const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'tiktok-knowledge', 'node', '-e', code], {
    input: JSON.stringify({ text, values }), encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
}

const cookie = await login(process.env.ADMIN_TOKEN);
const state = JSON.parse(await readFile('test-results/state.json', 'utf8'));
const employeeCookie = await login(state.retakeToken);
const initial = (await request('/api/admin/knowledge/status', { cookie })).data;
await request('/api/admin/knowledge/status', { cookie: employeeCookie, status: 403 });
assert.ok(initial.chapters >= 2);
assert.ok(initial.exams >= 1);
assert.ok(initial.questions >= 31);
assert.ok(initial.assets >= 2);
passed.push('administrator reads actual knowledge counts and employee access is rejected');
await request('/api/admin/knowledge/loop', { cookie, method: 'PUT', body: { stations: [], revision: initial.loopRevision } });

const station = {
  id: 'engine', name: 'CI loop', kind: 'station', seq: 1, cls: 'lp-s-engine',
  part: 'Goods', sub: 'Store', color: '#5B6CFF', drive: 'Review goods',
  modules: [{ code: 'M1', name: 'Store', color: '#5B6CFF' }],
  points: [{ text: 'Review stock', to: '1.1' }], upstream: 'Plan', downstream: 'Content',
};
const { data: created } = await request('/api/admin/chapters', {
  cookie, method: 'POST', status: 201,
  body: { module: 'M1', sectionNo: '1.99', title: 'CI metadata only', sortOrder: 999, isPublic: false, html: '<p>Temporary fixture</p>' },
});
databaseQuery('DELETE FROM content_blocks WHERE chapter_id = $1', [created.id]);
const beforeManual = (await request('/api/manual', { cookie })).data;
const existing = beforeManual.chapters.find(chapter => chapter.module === 'M1' && chapter.section_no === '1.1');
assert.ok(existing);
const pack = {
  schemaVersion: 1,
  chapters: [
    { module: 'M1', sectionNo: '1.99', title: 'Package title', sortOrder: 500, isPublic: false, html: '<p>Filled missing chapter content</p>' },
    { module: 'M1', sectionNo: '1.1', title: 'Different package title', sortOrder: 500, isPublic: false, html: '<p>Existing content must remain</p>' },
  ],
  loop: [station],
};
const preview = (await request('/api/admin/knowledge', { cookie, method: 'POST', body: { action: 'preview', package: pack } })).data.preview;
assert.equal(preview.loopStations, 1);
const first = (await request('/api/admin/knowledge', { cookie, method: 'POST', body: { action: 'apply', mode: 'add', package: pack } })).data.result;
assert.equal(first.filledChapterContents, 1);
assert.equal(first.skippedChapters, 1);
assert.equal(first.loopStations, 1);
const afterManual = (await request('/api/manual', { cookie })).data;
assert.deepEqual(afterManual.chapters.find(chapter => chapter.id === existing.id), existing);
const filled = afterManual.chapters.find(chapter => chapter.id === created.id);
assert.equal(filled.title, 'CI metadata only');
assert.equal(filled.html, '<p>Filled missing chapter content</p>');
const repeated = (await request('/api/admin/knowledge', { cookie, method: 'POST', body: { action: 'apply', mode: 'add', package: pack } })).data.result;
assert.equal(repeated.filledChapterContents, 0);
assert.equal(repeated.addedChapters, 0);
assert.equal(repeated.skippedChapters, 2);
passed.push('add mode fills missing content, preserves existing content and retries without duplicates');

const imported = (await request('/api/admin/knowledge/status', { cookie })).data;
assert.equal(imported.loopStations, 1);
assert.deepEqual(imported.loop, [station]);
await request('/api/admin/knowledge/loop', {
  cookie: employeeCookie, method: 'PUT', status: 403, body: { stations: [], revision: imported.loopRevision },
});
await request('/api/admin/knowledge/loop', {
  cookie, method: 'PUT', status: 400, body: { stations: [{ ...station, modules: null }], revision: imported.loopRevision },
});
assert.deepEqual((await request('/api/loop', { cookie })).data.stations, [station]);
const edited = { ...station, name: 'CI edited loop', points: [{ text: 'Updated point', to: '1.99' }] };
await request('/api/admin/knowledge/loop', { cookie, method: 'PUT', body: { stations: [edited], revision: imported.loopRevision } });
assert.deepEqual((await request('/api/loop', { cookie })).data.stations, [edited]);
await request('/api/admin/knowledge/loop', { cookie, method: 'PUT', status: 409, body: { stations: [station], revision: imported.loopRevision } });
assert.deepEqual((await request('/api/loop', { cookie })).data.stations, [edited]);
passed.push('administrator edits loop content, invalid data is rejected and stale edits preserve current data');
await request('/api/admin/knowledge', { cookie, method: 'POST', body: { action: 'apply', mode: 'add', package: pack } });
assert.deepEqual((await request('/api/loop', { cookie })).data.stations, [edited]);
passed.push('add import fills an empty loop while preserving an existing edited loop');

// Leave loop data as the integration fixture supplied it for subsequent browser checks.
const latest = (await request('/api/admin/knowledge/status', { cookie })).data;
await request('/api/admin/knowledge/loop', { cookie, method: 'PUT', body: { stations: initial.loop ?? [], revision: latest.loopRevision } });
await writeFile('test-results/knowledge-admin-results.json', JSON.stringify({ passed }, null, 2));
for (const label of passed) console.log(`PASS ${label}`);
