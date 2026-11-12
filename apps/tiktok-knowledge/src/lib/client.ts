export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// 网络层错误（请求未到达服务端 / 超时）使用 status=0，便于上层与业务 401 等区分
const REQUEST_TIMEOUT_MS = 20_000;

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    // FormData（文件上传）必须让浏览器自行设置 multipart/form-data; boundary=...
    // 若强行写 Content-Type: application/json 会导致服务端 formData() 解析失败报 500。
    const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData;
    res = await fetch(url, {
      ...init,
      headers: isForm ? init?.headers : { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      credentials: 'same-origin',
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError('请求超时，请检查网络后重试', 0);
    }
    throw new ApiError('网络异常，无法连接服务器，请检查网络后重试', 0);
  }
  clearTimeout(timer);
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError((json as { error?: string }).error || `请求失败（${res.status}）`, res.status);
  return json;
}

export interface AuthUser {
  id: string;
  name: string;
  role: 'super_admin' | 'admin' | 'employee';
  tier: 'M2' | 'M4' | 'M6';
  status: 'active' | 'disabled';
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}

export interface ChapterMaterial {
  id: string;
  word: string;
  sentence: string;
  file_type: 'video' | 'image';
  url: string | null;
}

export interface ChapterDTO {
  id: string;
  module: string;
  section_no: string;
  title: string;
  sort_order: number;
  is_public: boolean;
  html: string;
  version: number;
  updated_at: string | null;
  materials: ChapterMaterial[];
}

export interface ManualResult {
  user: AuthUser;
  chapters: ChapterDTO[];
}

export const login = (token: string) => api<{ user: AuthUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ token }) });
export const loginWithPassword = (username: string, password: string) =>
  api<{ user: AuthUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
export const me = () => api<{ user: AuthUser | null }>('/api/auth/me');
export const logout = () => api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
export const getManual = () => api<ManualResult>('/api/manual');
/** 登录用户修改自己的自定义密令（原始密令仍有效） */
export const changePassphrase = (newPass: string, confirm: string) =>
  api<{ ok: boolean; message: string }>('/api/auth/passphrase', { method: 'POST', body: JSON.stringify({ newPass, confirm }) });

/**
 * 退出登录：调用后端销毁会话 -> 清掉本地令牌标记 -> 整页跳回登录页。
 * 用 location.assign（硬刷新）而非 router.replace，确保 SPA 内所有缓存状态被清空，
 * 退出后再打开带 #令牌 的链接是干净的整页加载，hash 自动登录不会被旧状态干扰。
 */
export async function performLogout(destination: '/' | '/admin/login' = '/') {
  try {
    await logout();
  } catch {
    /* 即使后端登出失败也继续本地清理 */
  }
  try {
    window.sessionStorage.removeItem('manual-last-token');
  } catch {
    /* ignore */
  }
  window.location.assign(destination);
}
