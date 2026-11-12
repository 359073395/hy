import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withTransaction } from './db';

/** Serialized schema migration and one-time administrator setup. */
export async function runDataBootstrap(): Promise<void> {
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(581927103)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', ['001']);
    if (applied.rowCount === 0) {
      const sql = await readFile(path.join(process.cwd(), 'deploy/migrations/001.sql'), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', ['001']);
    }
    // pg_restore --no-acl recreates tables without API grants, including when migration 001 is already recorded.
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'knowledge_api') THEN
          CREATE ROLE knowledge_api NOLOGIN;
        END IF;
      END $$;
      GRANT USAGE ON SCHEMA public TO knowledge_api;
      GRANT SELECT, INSERT, UPDATE, DELETE ON
        users, sessions, chapters, content_blocks, content_snapshots, audit_logs,
        materials, exams, questions, exam_records, health_check, knowledge_settings TO knowledge_api;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO knowledge_api;
    `);
    const initialized = await client.query("SELECT 1 FROM app_state WHERE key = 'admin_initialized'");
    if (initialized.rowCount === 0) {
      const existing = await client.query('SELECT 1 FROM users LIMIT 1');
      if (existing.rowCount === 0) {
        const token = process.env.ADMIN_TOKEN?.trim();
        if (!token || token.length < 24) throw new Error('First setup requires a random ADMIN_TOKEN of at least 24 characters');
        const hash = createHash('sha256').update(token).digest('hex');
        const created = await client.query<{ id: string }>(
          `INSERT INTO users(name, token_hash, role, tier, status)
           VALUES ($1, $2, 'super_admin', 'M6', 'active') RETURNING id`,
          [process.env.ADMIN_NAME?.trim() || '管理员', hash],
        );
        await client.query('INSERT INTO user_tokens(user_id, token) VALUES ($1, $2)', [created.rows[0].id, token]);
      }
      await client.query("INSERT INTO app_state(key, value) VALUES ('admin_initialized', 'true'::jsonb)");
    }
    await client.query("NOTIFY pgrst, 'reload schema'");
  });
}
