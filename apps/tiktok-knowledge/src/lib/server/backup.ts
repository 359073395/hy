import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { PoolClient } from 'pg';
import { dataDirectory, PART_STAGING_PREFIX } from '@/lib/storage';
import { getPool } from './db';

interface BackupFile { path: string; bytes: number; sha256: string }
export interface BackupManifest {
  format: 'tiktok-knowledge-backup';
  version: 1;
  createdAt: string;
  appVersion: string;
  postgresMajor: 17;
  database: { file: 'database.dump'; format: 'custom'; sha256: string; bytes: number };
  data: { directory: 'data'; files: number; bytes: number };
  files: BackupFile[];
}

let backupRunning = false;

export function postgresEnvironment(connectionString: string): NodeJS.ProcessEnv {
  const database = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('数据库连接配置无效');
  return {
    ...process.env,
    PGHOST: database.hostname,
    PGPORT: database.port || '5432',
    PGUSER: decodeURIComponent(database.username),
    PGPASSWORD: decodeURIComponent(database.password),
    PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: '-c statement_timeout=600000 -c lock_timeout=10000',
  };
}

async function runCommand(command: string, args: string[], signal: AbortSignal, env = process.env): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let message = '';
    let forceKill: NodeJS.Timeout | undefined;
    const abort = () => {
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), 3000);
      forceKill.unref();
    };
    signal.addEventListener('abort', abort, { once: true });
    child.stderr.on('data', (chunk: Buffer) => { message = (message + chunk.toString()).slice(-4096); });
    child.once('error', reject);
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort);
      clearTimeout(forceKill);
      if (signal.aborted) reject(new Error('备份已取消或超过10分钟，请稍后重试'));
      else if (code !== 0) reject(new Error(`${command} 执行失败 ${message.trim()}`));
      else resolve();
    });
    if (signal.aborted) abort();
  });
}

export async function hashBackupFile(file: string, signal?: AbortSignal): Promise<{ sha256: string; bytes: number }> {
  const digest = createHash('sha256');
  let bytes = 0;
  const stream = createReadStream(/* turbopackIgnore: true */ file, { signal });
  for await (const chunk of stream) {
    digest.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: digest.digest('hex'), bytes };
}

/** Copies immutable stored objects and rejects symlinks or files changing during the copy. */
export async function copyBackupData(source: string, destination: string, signal: AbortSignal): Promise<BackupFile[]> {
  const files: BackupFile[] = [];
  const root = await lstat(/* turbopackIgnore: true */ source);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('素材根目录无效');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  async function visit(relative: string) {
    signal.throwIfAborted();
    const directory = path.join(/* turbopackIgnore: true */ source, relative);
    const entries = await readdir(/* turbopackIgnore: true */ directory, { withFileTypes: true });
    for (const entry of entries) {
      if ((!relative && entry.name === PART_STAGING_PREFIX) || entry.name.endsWith('.tmp')) continue;
      if (/[\\\u0000-\u001f]/.test(entry.name)) throw new Error('素材文件名含无效字符');
      if (entry.isSymbolicLink()) throw new Error('素材目录中存在符号链接，无法完整备份');
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const input = path.join(/* turbopackIgnore: true */ source, next);
      const output = path.join(destination, next);
      if (entry.isDirectory()) {
        await mkdir(output, { mode: 0o700 });
        await visit(next);
        continue;
      }
      if (!entry.isFile()) throw new Error('素材目录中存在特殊文件');
      const before = await lstat(/* turbopackIgnore: true */ input);
      await pipeline(createReadStream(/* turbopackIgnore: true */ input), createWriteStream(output, { flags: 'wx', mode: 0o600 }), { signal });
      const after = await lstat(/* turbopackIgnore: true */ input);
      if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        throw new Error('备份时素材文件发生变化，请重试');
      }
      files.push({ path: `data/${next}`, ...await hashBackupFile(output, signal) });
    }
  }
  await visit('');
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function checkReferencedFiles(db: PoolClient, files: BackupFile[]) {
  const available = new Set(files.map((file) => file.path));
  const materials = await db.query<{ file_key: string }>('SELECT file_key FROM materials');
  const content = await db.query<{ html: string }>('SELECT html FROM content_blocks UNION ALL SELECT html FROM content_snapshots');
  const required = materials.rows.map((row) => row.file_key);
  for (const row of content.rows) {
    for (const match of row.html.matchAll(/\bsrc=["']\/api\/files\/([^"'?#]+)(?:[?#][^"']*)?["']/gi)) {
      required.push(decodeURIComponent(match[1]));
    }
  }
  if (required.some((key) => !available.has(`data/${key}`))) throw new Error('数据库引用了缺失的素材文件，请补齐文件后备份');
}

export async function createFullBackup(requestSignal?: AbortSignal) {
  if (backupRunning) throw new Error('已有完整备份正在生成，请稍后重试');
  backupRunning = true;
  const timeout = AbortSignal.timeout(10 * 60 * 1000);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
  let temporary: string | undefined;
  try {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'tiktok-backup-'));
    const backupDirectory = temporary;
    const db = await getPool().connect();
    let manifest: BackupManifest;
    try {
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await db.query("SET LOCAL lock_timeout = '10s'; SET LOCAL statement_timeout = '10min'; SET LOCAL idle_in_transaction_session_timeout = '11min'");
      const acquired = await db.query<{ acquired: boolean }>('SELECT pg_try_advisory_xact_lock(581927104) AS acquired');
      if (!acquired.rows[0].acquired) throw new Error('已有完整备份正在生成，请稍后重试');
      const tables = await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
      if (!tables.rows.length) throw new Error('数据库尚未初始化');
      const names = tables.rows.map((row) => `public."${row.tablename.replaceAll('"', '""')}"`);
      await db.query(`LOCK TABLE ${names.join(', ')} IN SHARE MODE`);
      const snapshot = await db.query<{ snapshot: string; version: number }>("SELECT pg_export_snapshot() AS snapshot, current_setting('server_version_num')::integer AS version");
      if (Math.floor(snapshot.rows[0].version / 10000) !== 17) throw new Error('完整备份需要 PostgreSQL 17');
      const databaseFile = path.join(backupDirectory, 'database.dump');
      await runCommand('pg_dump', [
        '--schema=public', '--format=custom', '--encoding=UTF8', '--no-owner', '--no-acl', '--lock-wait-timeout=10000',
        `--snapshot=${snapshot.rows[0].snapshot}`, '--file', databaseFile,
      ], signal, postgresEnvironment(process.env.PGDATABASE_URL || ''));
      const files = await copyBackupData(dataDirectory(), path.join(backupDirectory, 'data'), signal);
      await checkReferencedFiles(db, files);
      manifest = {
        format: 'tiktok-knowledge-backup', version: 1, createdAt: new Date().toISOString(),
        appVersion: (await readFile(path.join(process.cwd(), 'VERSION'), 'utf8')).trim(), postgresMajor: 17,
        database: { file: 'database.dump', format: 'custom', ...await hashBackupFile(databaseFile, signal) },
        data: { directory: 'data', files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }, files,
      };
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
    signal.throwIfAborted();
    await writeFile(path.join(backupDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    const archive = path.join(backupDirectory, 'backup.tar.gz');
    await runCommand('tar', ['--create', '--gzip', '--file', archive, '--directory', backupDirectory, 'manifest.json', 'database.dump', 'data'], signal);
    const info = await stat(/* turbopackIgnore: true */ archive);
    return { archive, bytes: info.size, cleanup: () => rm(backupDirectory, { recursive: true, force: true }) };
  } catch (error) {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    throw error;
  } finally {
    backupRunning = false;
  }
}
