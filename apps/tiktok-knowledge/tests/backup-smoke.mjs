import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:8791';
const denied = await fetch(base + '/api/admin/backup');
assert.equal(denied.status, 403);
const login = await fetch(base + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: process.env.ADMIN_TOKEN }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
const backup = await fetch(base + '/api/admin/backup', { headers: { cookie } });
if (backup.status !== 200) throw new Error(`Backup returned ${backup.status}: ${(await backup.text()).slice(0, 200)}`);
assert.match(backup.headers.get('cache-control'), /no-store/);
assert.match(backup.headers.get('content-disposition'), /attachment.*\.tar\.gz/);
const destination = 'test-results/full-backup.tar.gz';
await pipeline(Readable.fromWeb(backup.body), createWriteStream(destination));
const entries = execFileSync('tar', ['-tzf', destination], { encoding: 'utf8' }).split('\n');
assert.ok(entries.some(entry => /^(\.\/)?database\.dump$/.test(entry)));
const manifestName = entries.find(entry => /^(\.\/)?manifest\.json$/.test(entry));
assert.ok(manifestName);
const manifest = JSON.parse(execFileSync('tar', ['-xOzf', destination, manifestName], { encoding: 'utf8' }));
assert.ok(manifest && typeof manifest === 'object');
assert.equal(manifest.format, 'tiktok-knowledge-backup');
assert.equal(manifest.version, 1);
assert.equal(manifest.postgresMajor, 17);
assert.ok(manifest.files.length > 0);
assert.ok(entries.some(entry => /data\/knowledge-assets\/[\da-f]+\.png$/.test(entry)));
assert.equal(entries.some(entry => /(^|\/)\.env$/.test(entry)), false);
await writeFile('test-results/backup-results.json', JSON.stringify({ passed: ['backup authorization', 'private streaming download', 'database archive', 'attachment archive', 'manifest'], fileCount: entries.filter(Boolean).length }, null, 2));
console.log('PASS full database and attachment backup download');
