import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { copyBackupData, postgresEnvironment } from '../src/lib/server/backup';

test('backup file inventory verifies copied bytes and excludes unfinished uploads', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'knowledge-backup-test-'));
  try {
    const source = path.join(temporary, 'source');
    const destination = path.join(temporary, 'copied');
    await mkdir(path.join(source, 'materials'), { recursive: true });
    await mkdir(path.join(source, 'knowledge-assets'));
    await mkdir(path.join(source, 'part_uploads'));
    await writeFile(path.join(source, 'materials', 'one.mp4'), 'test-video');
    await writeFile(path.join(source, 'knowledge-assets', 'two.png'), 'test-image');
    await writeFile(path.join(source, 'materials', 'pending.tmp'), 'incomplete');
    await writeFile(path.join(source, 'part_uploads', 'part'), 'incomplete');
    const files = await copyBackupData(source, destination, new AbortController().signal);
    assert.equal(files.length, 2);
    const video = files.find(file => file.path === 'data/materials/one.mp4');
    assert.deepEqual(video, {
      path: 'data/materials/one.mp4', bytes: 10,
      sha256: createHash('sha256').update('test-video').digest('hex'),
    });
    assert.equal(await readFile(path.join(destination, 'materials', 'one.mp4'), 'utf8'), 'test-video');
    await assert.rejects(copyBackupData(source, path.join(temporary, 'aborted'), AbortSignal.abort()));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('backup refuses symbolic links in persistent data', async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'knowledge-backup-link-'));
  try {
    const source = path.join(temporary, 'source');
    await mkdir(source);
    await writeFile(path.join(temporary, 'outside'), 'outside');
    try { await symlink(path.join(temporary, 'outside'), path.join(source, 'linked')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { context.skip('Windows account cannot create symlinks'); return; }
      throw error;
    }
    await assert.rejects(copyBackupData(source, path.join(temporary, 'copied'), new AbortController().signal), /符号链接/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('pg_dump receives URL credentials as environment values', () => {
  const env = postgresEnvironment('postgres://knowledge:p%40ssword@db:5432/knowledge');
  assert.equal(env.PGPASSWORD, 'p@ssword');
  assert.equal(env.PGHOST, 'db');
  assert.equal(env.PGUSER, 'knowledge');
  assert.equal(env.PGDATABASE, 'knowledge');
  assert.throws(() => postgresEnvironment('https://example.com/database'), /配置无效/);
});
