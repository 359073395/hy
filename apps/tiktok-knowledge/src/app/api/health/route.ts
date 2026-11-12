import { getPool } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const database = await getPool().query("SELECT value FROM app_state WHERE key = 'admin_initialized'");
    if (!database.rowCount) throw new Error('Setup incomplete');
    const base = process.env.POSTGREST_URL;
    if (!base) throw new Error('REST unavailable');
    const response = await fetch(`${base.replace(/\/$/, '')}/users?select=id&limit=0`, {
      cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('REST unavailable');
    return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
