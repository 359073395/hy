interface QueryClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export function manageAdminAccount(db: QueryClient, input: unknown): Promise<unknown>;
