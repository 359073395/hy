export function normalizeUsername(value: unknown): string;
export function validateCredentials(username: unknown, password: unknown): string;
export function hashPassword(password: string): Promise<string>;
export function verifyPassword(password: unknown, encoded: unknown): Promise<boolean>;
export const DUMMY_PASSWORD_HASH: string;
