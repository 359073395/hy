import { MODULES, PUBLIC_MODULES } from './constants';

export interface ModuleReader {
  role: 'super_admin' | 'admin' | 'employee';
  tier: 'M2' | 'M4' | 'M6';
}

const TIER_MODULES: Record<ModuleReader['tier'], string[]> = {
  M2: ['M1', 'M2'],
  M4: ['M1', 'M2', 'M3', 'M4'],
  M6: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
};

/** Shared by server authorization and the manual's module cards. */
export function canReadModule(moduleCode: string, isPublic: boolean, user: ModuleReader | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'super_admin') return true;
  if (isPublic) return true;
  return (TIER_MODULES[user.tier] ?? []).includes(moduleCode);
}

export function getModuleAccess(chapters: readonly { module: string; is_public: boolean }[], user: ModuleReader): Record<string, boolean> {
  return Object.fromEntries(MODULES.map(({ code }) => {
    const entries = chapters.filter(chapter => chapter.module === code);
    const allowed = entries.length > 0
      ? entries.some(chapter => canReadModule(code, chapter.is_public, user))
      : canReadModule(code, PUBLIC_MODULES.has(code), user);
    return [code, allowed];
  }));
}
