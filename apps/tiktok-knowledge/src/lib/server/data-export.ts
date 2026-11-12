import { withTransaction } from './db';
import type { DataScope, ExportRow } from '@/lib/data-export';

const TABLE_GROUPS = {
  questions: ['exams', 'questions'],
  knowledge: ['chapters', 'content_blocks', 'content_snapshots', 'knowledge_settings'],
  materials: ['materials'],
  audit: ['audit_logs'],
} as const;

export const CSV_COLUMNS = {
  members: ['id', 'name', 'role', 'tier', 'status', 'token', 'token_custom', 'token_hash', 'custom_token_hash', 'created_at', 'updated_at'],
  exams: ['id', 'exam_id', 'exam_code', 'exam_name', 'user_id', 'user_name', 'status', 'score', 'official_passed', 'practical_status', 'answers', 'question_snapshot', 'started_at', 'submitted_at', 'created_at'],
};

/** Read every selected table from a single PostgreSQL snapshot, without REST row limits. */
export async function exportData(scope: DataScope): Promise<ExportRow[] | Record<string, ExportRow[]>> {
  return withTransaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    if (scope === 'members') {
      const result = await db.query<ExportRow>(
        `SELECT u.*, t.token, t.token_custom FROM users u
         LEFT JOIN user_tokens t ON t.user_id = u.id ORDER BY u.created_at, u.id`,
      );
      return result.rows;
    }
    if (scope === 'exams') {
      const result = await db.query<ExportRow>(
        `SELECT r.*, u.name AS user_name, e.code AS exam_code, e.name AS exam_name
         FROM exam_records r LEFT JOIN users u ON u.id = r.user_id
         LEFT JOIN exams e ON e.id = r.exam_id ORDER BY r.created_at, r.id`,
      );
      return result.rows;
    }
    const tableNames = scope === 'database'
      ? (await db.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
      )).rows.map((row) => row.tablename)
      : TABLE_GROUPS[scope];
    const tables: Record<string, ExportRow[]> = {};
    for (const tableName of tableNames) {
      // Table names originate in the static list or PostgreSQL catalog and are quoted as identifiers.
      const identifier = `"${tableName.replace(/"/g, '""')}"`;
      tables[tableName] = (await db.query<ExportRow>(`SELECT * FROM public.${identifier}`)).rows;
    }
    return tables;
  });
}
