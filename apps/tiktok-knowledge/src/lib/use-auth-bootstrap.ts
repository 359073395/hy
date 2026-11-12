'use client';

import { useEffect, useState } from 'react';
import { login, me, type AuthUser } from '@/lib/client';

// 本次会话最近一次成功登录使用的令牌（仅存在当前 tab 的 sessionStorage，不跨 tab 持久化）
const LAST_TOKEN_KEY = 'manual-last-token';

/**
 * 判断 hash 是否为「章节/资源 id 深链」而非登录令牌。
 * 章节 id 是 supabase 的 32 位 hex UUID（无连字符），如 f0bb950b903c...；
 * 登录令牌是人类可读串（tc-xxxxxx）。
 * 深链 hash 不能当作令牌去登录（否则登录失败后会被清掉，导致章节定位失效）。
 */
export function isResourceDeepLink(hash: string): boolean {
  // 支持纯章节 id，以及「章节 id/锚点词」深链（锚点词可能被 encodeURIComponent 编码，含 % 与非 hex 字符）。
  // 取 '/' 之前的章节 id 段做 UUID 判定即可；整段不能当令牌，否则登录失败后会被 clearHashToken 清掉，
  // 导致 #章节id/词 这类「定位到正文」链接在章节切换前被清空。
  const chapterId = hash.split('/')[0] ?? '';
  if (/^\d+\.\d+$/.test(chapterId) || /^(M[1-8]|APPENDIX)$/i.test(chapterId)) return true;
  return /^[0-9a-f]{32}$/i.test(chapterId) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chapterId);
}

export function readHashToken(): string {
  if (typeof window === 'undefined') return '';
  const h = window.location.hash.replace(/^#/, '').trim();
  // 章节 id 深链不是令牌，交给页面自身的定位逻辑消费
  if (isResourceDeepLink(h)) return '';
  return h;
}

function clearHashToken() {
  if (typeof window === 'undefined') return;
  // 清掉 hash 中的令牌，保留 pathname/search，避免令牌留在历史/截图里
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

function getLastToken(): string {
  try {
    return window.sessionStorage.getItem(LAST_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function setLastToken(t: string) {
  try {
    if (t) window.sessionStorage.setItem(LAST_TOKEN_KEY, t);
    else window.sessionStorage.removeItem(LAST_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

// 模块级标志：防止 React StrictMode 双调用 / 多组件并发时重复登录造成竞态
let bootstrapInFlight = false;

/**
 * 退出登录时调用：清掉本地缓存的令牌标记。
 * 配合硬刷新跳转，保证退出后再打开带 hash 的链接是干净的整页加载。
 */
export function resetLastToken() {
  setLastToken('');
}

export interface AuthBootstrap {
  loading: boolean;
  user: AuthUser | null;
  error: string;
}

/**
 * 尝试恢复登录态：先复用 cookie 会话；cookie 丢失（跨站 iframe 第三方 cookie 被拦 /
 * 会话过期等）时，用本 tab sessionStorage 里最近一次成功登录的令牌静默重登。
 * 全程不依赖 location.hash——hash 被清/SPA 跳转/刷新后编辑权限依旧可用。
 * 返回 null 表示确实无可用登录态。
 */
export async function resumeSession(): Promise<AuthUser | null> {
  let current: AuthUser | null = null;
  try {
    current = (await me()).user;
  } catch {
    current = null;
  }
  if (current) return current;
  const lastToken = getLastToken();
  if (!lastToken) return null;
  try {
    const res = await login(lastToken);
    // 重登成功，刷新缓存令牌（令牌不变，这里幂等）
    setLastToken(lastToken);
    return res.user;
  } catch {
    // 令牌已失效（被禁用/自定义密令重置等），清掉缓存，避免反复无效重登
    setLastToken('');
    return null;
  }
}

/**
 * 任意页面首次加载时的认证引导：
 * 1. 若已有会话 -> 直接采用；
 * 2. 若 URL hash 带令牌，且（未登录 或 hash 令牌与当前会话令牌不一致）-> 自动登录为该令牌身份；
 * 3. 登录成功后用 history.replaceState 清掉 hash 令牌，会话靠 Cookie 保持；
 * 4. 令牌错误 -> error 置位（页面据此回落登录页/提示）。
 *
 * loading=true 期间页面应渲染占位，避免闪登录页或无权限页。
 */
export function useAuthBootstrap(): AuthBootstrap {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 同一时刻只允许一个引导流程（防止 StrictMode/多组件并发重复登录）
      while (bootstrapInFlight) {
        // 等待正在进行的引导完成
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 50));
      }
      bootstrapInFlight = true;
      try {
        // hash 令牌是用户显式打开链接时携带的意图，优先级最高。
        // 注意：必须在 await me() 之前先读取 hash，避免软导航/旧会话竞态下漏读。
        const hashToken = readHashToken();

        // 有 hash 令牌时，直接以其身份登录（覆盖任意旧会话），不依赖 me() 的结果，
        // 这样即使旧 cookie 还没失效或返回 stale 用户，hash 也一定被消费。
        if (hashToken) {
          try {
            const res = await login(hashToken);
            if (cancelled) return;
            setLastToken(hashToken);
            clearHashToken();
            setUser(res.user);
            setError('');
            return;
          } catch (e) {
            if (cancelled) return;
            // 令牌错误：清掉无效 hash，回落会话兜底，并提示
            clearHashToken();
            setLastToken('');
            let existing: AuthUser | null = null;
            try {
              existing = (await me()).user;
            } catch {
              existing = null;
            }
            if (cancelled) return;
            setUser(existing);
            setError(e instanceof Error ? e.message : '令牌无效，请重新登录');
            return;
          }
        }

        // 无 hash 令牌：复用现有会话；cookie 丢失时用 sessionStorage 缓存令牌静默重登，
        // 保证「带 #令牌 直进登录后 hash 被 SPA 清掉」再刷新/跳转仍保持登录与编辑权限。
        const current = await resumeSession();
        if (cancelled) return;
        setUser(current);
      } finally {
        bootstrapInFlight = false;
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, user, error };
}
