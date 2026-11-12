import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getPool } from '@/lib/server/db';

export async function GET() {
  if (!await getCurrentUser()) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const result = await getPool().query('SELECT value FROM knowledge_settings WHERE key = $1', ['loop']);
  return NextResponse.json({ stations: result.rows[0]?.value ?? [] });
}
