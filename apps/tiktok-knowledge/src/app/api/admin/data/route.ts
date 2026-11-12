import { NextResponse } from 'next/server';
import { getCurrentUser, isSuperAdmin } from '@/lib/auth';
import { DATA_SCOPES, rowsToCsv, type DataScope, type ExportRow } from '@/lib/data-export';
import { CSV_COLUMNS, exportData } from '@/lib/server/data-export';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!isSuperAdmin(user)) return NextResponse.json({ error: '仅超级管理员可导出全部数据' }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const scope = params.get('scope') ?? 'database';
  const format = params.get('format') ?? 'json';
  if (!DATA_SCOPES.includes(scope as DataScope) || !['json', 'csv'].includes(format)) {
    return NextResponse.json({ error: '导出范围或格式无效' }, { status: 400 });
  }
  if (format === 'csv' && scope !== 'members' && scope !== 'exams') {
    return NextResponse.json({ error: 'CSV 导出支持人员和考核记录' }, { status: 400 });
  }
  try {
    const data = await exportData(scope as DataScope);
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    const headers = {
      'Content-Disposition': `attachment; filename="tiktok-${scope}-${date}.${format}"`,
      'Cache-Control': 'private, no-store',
    };
    if (format === 'csv') {
      const columns = CSV_COLUMNS[scope as 'members' | 'exams'];
      return new Response(rowsToCsv(data as ExportRow[], columns), {
        headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' },
      });
    }
    return NextResponse.json(data, { headers });
  } catch (error) {
    console.error('[data-export]', error instanceof Error ? error.message : 'Export failed');
    return NextResponse.json({ error: '数据导出失败，请稍后重试或查看服务器日志' }, { status: 500 });
  }
}
