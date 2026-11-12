import { PostgrestClient } from '@supabase/postgrest-js';

/** Internal REST connection. Browser clients use the authenticated Next API. */
export function getSupabaseClient() {
  const url = process.env.POSTGREST_URL;
  if (!url) throw new Error('POSTGREST_URL is required');
  return new PostgrestClient(url, {
    schema: 'public',
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  });
}

export type DatabaseClient = ReturnType<typeof getSupabaseClient>;
