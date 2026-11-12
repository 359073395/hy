import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { getCurrentUser, isSuperAdmin } from '@/lib/auth';
import { createFullBackup } from '@/lib/server/backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!isSuperAdmin(user)) return Response.json({ error: '完整备份仅限超级管理员' }, { status: 403 });
  try {
    const backup = await createFullBackup(request.signal);
    const stream = createReadStream(/* turbopackIgnore: true */ backup.archive, { signal: request.signal });
    stream.once('close', () => { void backup.cleanup().catch((error) => console.error('[backup-cleanup]', error)); });
    const fileName = `tiktok-knowledge-backup-${new Date().toISOString().replaceAll(':', '-')}.tar.gz`;
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(backup.bytes),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    console.error('[backup]', error instanceof Error ? error.message : 'Backup failed');
    return Response.json({ error: error instanceof Error ? error.message : '完整备份失败' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
