export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.PGDATABASE_URL) return;
  const { runDataBootstrap } = await import('./lib/server/bootstrap-data');
  await runDataBootstrap();
}
