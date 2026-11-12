export const MODULES = [
  { code: 'M1', label: '开店与店铺基础' },
  { code: 'M2', label: '商品运营选品上架' },
  { code: 'M3', label: '活动与店铺营销' },
  { code: 'M4', label: '达人营销' },
  { code: 'M5', label: 'TikTok 账号与内容' },
  { code: 'M6', label: '付费广告' },
  { code: 'M7', label: '数据分析与复盘' },
  { code: 'M8', label: '违规处理与申诉' },
  { code: 'APPENDIX', label: '附录' },
];
const PUBLIC_MODULES = new Set(['M7', 'M8', 'APPENDIX']);

export function moduleLabel(code: string): string {
  const found = MODULES.find((m) => m.code === code);
  return found ? found.label : code;
}
export { PUBLIC_MODULES };

export const ROLE_LABEL: Record<string, string> = {
  super_admin: '超管',
  admin: '管理员',
  employee: '员工',
};

// 素材大小上限：视频 200MB，图片 20MB
export const MAX_VIDEO_MB = 200;
export const MAX_IMAGE_MB = 20;

/** 人类可读的文件大小 */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export const TIER_LABEL: Record<string, string> = {
  M2: 'M2（M1–M2）',
  M4: 'M4（M1–M4）',
  M6: 'M6（M1–M6）',
};

export const EXAM_DEFS = [
  { code: 'ops_assistant', name: '运营助理考核', scope: 'M1+M2', passScore: 80, recoveryTier: 'M2' },
  { code: 'product_ops', name: '商品运营考核', scope: 'M3+M4', passScore: 80, recoveryTier: 'M2' },
  { code: 'content_ops', name: '内容运营考核', scope: 'M5+M6', passScore: 80, recoveryTier: 'M2' },
] as const;

/** 每门考核的总作答次数上限（首次正考 + 3 次补考 = 4 次机会） */
export const EXAM_MAX_ATTEMPTS = 4;
/** 除首次正考外允许的补考次数 */
export const EXAM_MAX_RETRIES = EXAM_MAX_ATTEMPTS - 1;