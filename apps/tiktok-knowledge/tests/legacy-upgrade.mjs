import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:8791';
const response = await fetch(base + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: process.env.ADMIN_TOKEN }),
});
assert.equal(response.status, 200);
const cookie = response.headers.get('set-cookie').split(';')[0];
const exported = await fetch(base + '/api/admin/data?scope=database', { headers: { cookie } });
assert.equal(exported.status, 200);
const database = await exported.json();
const tables = ['users', 'user_tokens', 'chapters', 'content_blocks', 'content_snapshots', 'materials', 'exams', 'questions', 'exam_records', 'knowledge_settings'];
if (process.argv.includes('--before')) {
  assert.equal(database.schema_migrations.some(row => row.version === '002'), false);
  await writeFile('test-results/legacy-state.json', JSON.stringify(database));
  console.log('PASS 0.1.0 fixture created with people, tokens, knowledge, and exam records');
} else {
  const before = JSON.parse(await readFile('test-results/legacy-state.json', 'utf8'));
  for (const table of tables) {
    const extraAdmin = process.argv.includes('--allow-new-admin') && ['users', 'user_tokens'].includes(table) ? 1 : 0;
    assert.equal(database[table].length, before[table].length + extraAdmin, `${table} count changed`);
    for (const row of before[table]) {
      const current = database[table].find(candidate => candidate.id ? candidate.id === row.id : candidate.user_id ? candidate.user_id === row.user_id : candidate.key === row.key);
      assert.ok(current, `${table} row missing`);
      assert.deepEqual(Object.fromEntries(Object.keys(row).map(key => [key, current[key]])), row, `${table} existing values changed`);
    }
  }
  assert.ok(database.schema_migrations.some(row => row.version === '002'));
  for (const user of database.users.filter(user => before.users.some(old => old.id === user.id))) {
    assert.equal(user.username, null);
    assert.equal(user.password_hash, null);
  }
  const assets = database.content_blocks.flatMap(row => [...row.html.matchAll(/src="(\/api\/files\/[^"\s]+)"/g)].map(match => match[1]));
  for (const url of assets) assert.equal((await fetch(base + url, { headers: { cookie } })).status, 200);
  await writeFile('test-results/upgrade-results.json', JSON.stringify({ passed: ['legacy release additive migration', 'all original row values preserved', 'original admin token still signs in', 'persistent images remain readable'], tables: tables.length }, null, 2));
  console.log('PASS legacy upgrade preserves all original people, tokens, chapters and exams');
}
