export type MemberTokenKind = 'original' | 'custom';

const COMMON_WEAK = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890',
  'password', 'qwerty', 'qwerty123', 'abc123', 'abc1234', 'abcdef',
  'abcabc', '111111', '000000', '888888', '123123', '123321',
  'a123456', 'a12345', 'iloveyou', 'admin123', 'passw0rd', '654321',
]);

export function validateNewPassphrase(value: string, name: string): string | null {
  if (!value || value.length < 6 || value.length > 20) return '密令长度需为 6-20 位';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return '密令需同时包含字母和数字';
  const normalized = value.toLowerCase();
  if (COMMON_WEAK.has(normalized)) return '密令过于简单，请更换后再试';
  const userName = name.trim().toLowerCase();
  if (userName && normalized.includes(userName)) return '密令不能过于接近姓名，请更换';
  return null;
}

export function validateMemberToken(value: string, kind: MemberTokenKind, name: string): string | null {
  if (kind === 'custom') return validateNewPassphrase(value, name);
  if (!value.trim()) return '请输入新密令';
  if (value.length > 128) return '原始密令最长128位';
  return null;
}
