export const DATA_SCOPES = ['members', 'exams', 'questions', 'knowledge', 'materials', 'audit', 'database'] as const;
export type DataScope = typeof DATA_SCOPES[number];
export type ExportRow = Record<string, unknown>;

function csvCell(value: unknown): string {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** UTF-8 BOM keeps Chinese text readable in spreadsheet applications. */
export function rowsToCsv(rows: ExportRow[], columns: string[]): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
