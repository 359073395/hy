'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Watermark from '@/components/watermark';
import MaterialViewer, { ImageLightbox, esc } from '@/components/material-viewer';
import { getManual, performLogout, changePassphrase, api, type ManualResult, type ChapterMaterial, type ChapterDTO } from '@/lib/client';
import { useAuthBootstrap, resumeSession } from '@/lib/use-auth-bootstrap';
import { MAX_VIDEO_MB, MAX_IMAGE_MB, formatSize } from '@/lib/constants';
import { getModuleAccess } from '@/lib/module-access';
import { uploadMaterial, UploadError } from '@/lib/upload';
import { injectWordMarkers, materialChipSvg } from '@/lib/material-marking';
import './manual-theme.css';

// 术语速查词 → 术语弹层 key（与术语表 g-item 的 id="g-xxx" 一致）
const TERM_HL_TARGETS = [
  { word: 'GMV', className: 'term-hl', attr: { 'data-term': 'g-gmv' } },
  { word: 'ROAS', className: 'term-hl', attr: { 'data-term': 'g-roas' } },
  { word: 'ROI', className: 'term-hl', attr: { 'data-term': 'g-roi' } },
  { word: 'CPA', className: 'term-hl', attr: { 'data-term': 'g-cpa' } },
  { word: 'CPC', className: 'term-hl', attr: { 'data-term': 'g-cpc' } },
  { word: 'CPM', className: 'term-hl', attr: { 'data-term': 'g-cpm' } },
  { word: 'CPV', className: 'term-hl', attr: { 'data-term': 'g-cpv' } },
  { word: 'CTR', className: 'term-hl', attr: { 'data-term': 'g-ctr' } },
  { word: 'CVR', className: 'term-hl', attr: { 'data-term': 'g-cvr' } },
  { word: 'CTCVR', className: 'term-hl', attr: { 'data-term': 'g-ctcvr' } },
  { word: 'ECPM', className: 'term-hl', attr: { 'data-term': 'g-ecpm' } },
  { word: 'GPM', className: 'term-hl', attr: { 'data-term': 'g-gpm' } },
  { word: 'OPM', className: 'term-hl', attr: { 'data-term': 'g-opm' } },
  { word: 'ATV', className: 'term-hl', attr: { 'data-term': 'g-atv' } },
  { word: 'PID', className: 'term-hl', attr: { 'data-term': 'g-pid' } },
  { word: 'Shop ID', className: 'term-hl', attr: { 'data-term': 'g-shopcode' } },
  { word: 'Shop Code', className: 'term-hl', attr: { 'data-term': 'g-shopcode' } },
  { word: '店名', className: 'term-hl', attr: { 'data-term': 'g-shopcode' } },
  { word: 'UV', className: 'term-hl', attr: { 'data-term': 'g-uv' } },
  { word: '一手价', className: 'term-hl', attr: { 'data-term': 'g-other' } },
  { word: '达人广场', className: 'term-hl', attr: { 'data-term': 'g-other' } },
];

interface RepinCandidate {
  word: string;
  sentence: string;
  score: number;
}
interface RepinState {
  materialId: string;
  chapterLabel: string;
  oldWord: string;
  oldSentence: string;
  chapterDeleted: boolean;
  candidates: RepinCandidate[];
}

const MODULE_ORDER = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'APPENDIX'] as const;
type ModCode = (typeof MODULE_ORDER)[number];

// 旧版 v0.7.0 模块元信息（编号 / 名称 / 一句话介绍 / pc & m 样式类）
const MODULE_META: { code: ModCode; num: string; name: string; desc: string; pc: string; mc: string; nav: string }[] = [
  { code: 'M1', num: '01', name: '开店与店铺基础', pc: 'pc-1', mc: 'm-1', nav: 'M1 开店', desc: '只做本土店、新店接手 6 步 SOP、后台地图、订单与评价口径、设置速查、<b>岗位分工与考核口径</b>、<b>平台扣点与费用结构</b>' },
  { code: 'M2', num: '02', name: '商品运营', pc: 'pc-2', mc: 'm-2', nav: 'M2 商品', desc: '选品、上架 SOP、主图、标题、详情、定价、商品结构、<b>商品卡优化</b>' },
  { code: 'M3', num: '03', name: '活动与店铺营销', pc: 'pc-3', mc: 'm-3', nav: 'M3 活动', desc: '营销后台地图、常年 50% 折扣 SOP、大促报名、店铺装修、直播选修、<b>GXP/返现/合资券/闪购</b>' },
  { code: 'M4', num: '04', name: '达人营销 Affiliate', pc: 'pc-4', mc: 'm-4', nav: 'M4 达人', desc: '<b>达人全流程</b>：找达人、判断靠谱、邀约话术、寄样催更、视频追踪、ROI 绩效、广告授权' },
  { code: 'M5', num: '05', name: '账号与内容运营', pc: 'pc-5', mc: 'm-5', nav: 'M5 内容', desc: '<b>流量池逻辑打头</b>，再讲刷机养号、爆款脚本拆解、素材挖掘、本地化句式、带货视频、挂车发布、数据迭代、AI 辅助' },
  { code: 'M6', num: '06', name: '付费广告', pc: 'pc-6', mc: 'm-6', nav: 'M6 广告', desc: 'GMV Max 搭建、ROI/预算分级、<b>关键阈值速查</b>、<b>新素材测试与冷启动 SOP</b>、计划类型与进阶开关、数据诊断、素材全生命周期管控、<b>负向操作总清单</b>' },
  { code: 'M7', num: '07', name: '数据分析与复盘', pc: 'pc-7', mc: 'm-7', nav: 'M7 数据', desc: '指标体系、周报九数据源、<b>罗盘测品</b>、商品/内容/广告分析、<b>日周月工作流</b>、复盘闭环' },
  { code: 'M8', num: '08', name: '违规处理与申诉', pc: 'pc-8', mc: 'm-8', nav: 'M8 违规', desc: '<b>高频踩坑 · 背熟保命</b>：AHR 健康分阶梯、申诉两次窗口与 48h 纠正期、差评触发判定、证据清单、500 字符申诉信写法、品牌授权书 9 要素、保流量改品手法、实战案例' },
  { code: 'APPENDIX', num: '附', name: '附录 · 模板与术语', pc: 'pc-appendix', mc: 'm-appendix', nav: '附录 / 术语', desc: '印尼语模板库、检查清单合集、工具与账号清单、违规规则索引、表格模板、<b>指标术语表（GMV / ROAS / CTR / CVR 等）</b>' },
];
const metaOf = (code: string) => MODULE_META.find((m) => m.code === code) ?? MODULE_META[MODULE_META.length - 1];

interface SearchItem { id: string; module: string; no: string; title: string; text: string; big: string; sub: string; ctx: string; }
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|tr|td|th|blockquote)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
// 命中片段高亮（旧版 snippet → <mark>）
const makeCtx = (title: string, text: string, q: string): string => {
  const lowQ = q.toLowerCase();
  let src = title || text;
  if (text && text.toLowerCase().includes(lowQ)) src = text;
  const idx = src.toLowerCase().indexOf(lowQ);
  const from = Math.max(0, idx - 24);
  const part = (from > 0 ? '…' : '') + src.slice(from, from + 96) + (from + 96 < src.length ? '…' : '');
  return part.replace(new RegExp(`(${escapeRegExp(q)})`, 'gi'), '<mark>$1</mark>');
};
const buildSearchIndex = (data: ManualResult | null): SearchItem[] =>
  !data?.chapters
    ? []
    : data.chapters.map((c) => ({ id: c.id, module: c.module, no: c.section_no, title: c.title, sub: c.title, text: stripHtml(c.html), big: metaOf(c.module).name, ctx: '' }));

// 模块主题色（旧版视觉）
const MOD_COLOR: Record<string, string> = { M1: '#5B6CFF', M2: '#55C59D', M3: '#FF9F5B', M4: '#FF7AB6', M5: '#2BB5C9', M6: '#9B7BFF', M7: '#3D4DB8', M8: '#CB9125', APPENDIX: '#8490A7' };

interface MenuState {
  x: number;
  y: number;
  word: string;
  sentence: string;
  chapterId: string;
}
interface SnapshotDTO {
  id: string;
  version: number;
  html: string;
  created_at: string;
}

// 锁图标 SVG（内联，避免 emoji 在 Windows 下渲染为方块）
const LockIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9z" />
  </svg>
);

function ManualPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ManualResult | null>(null);
  const [repin, setRepin] = useState<RepinState | null>(null);
  const [activeModule, setActiveModule] = useState<string | 'ALL' | null>('ALL'); // 'ALL'=连续瀑布流(默认)；null/''=仅首页；模块code=单模块
  const [showToc, setShowToc] = useState(false);
  const [showFab, setShowFab] = useState(false);
  const [currentSection, setCurrentSection] = useState<string>(''); // 滚动时当前模块
  const [activeLesson, setActiveLesson] = useState<string | null>(null); // 滚动时当前小节(id)，用于目录定位
  const tocBodyRef = useRef<HTMLDivElement>(null);
  const [editChapterId, setEditChapterId] = useState<string | null>(null);
  // 编辑草稿提升到顶层：key=chapterId，value=未保存的正文 HTML。滚动/重渲染/切模块都不丢
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // 每个小节正文对应的「已落库原文」快照，用于判断草稿是否被改动
  const savedHtmlRef = useRef<Record<string, string>>({});
  const [progress, setProgress] = useState(0);
  const [searchQ, setSearchQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const searchDockRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchFabInputRef = useRef<HTMLInputElement>(null);
  // 16.3 搜索浮层（右下角放大镜点开）；顶部搜索条向下滚动后收缩为 FAB 放大镜
  const [searchFabOpen, setSearchFabOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [viewer, setViewer] = useState<{ word: string; materials: ChapterMaterial[]; canDelete: boolean } | null>(null);
  const [lightbox, setLightbox] = useState<{ list: string[]; index: number } | null>(null);
  const insertImgRef = useRef<HTMLInputElement>(null);
  const [imgUp, setImgUp] = useState<{ state: 'idle' | 'uploading' | 'error'; err: string }>({ state: 'idle', err: '' });
  const [termPop, setTermPop] = useState<{ title: string; en: string; html: string } | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotDTO[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [toast, setToast] = useState('');
  const [passOpen, setPassOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flashLessonId, setFlashLessonId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ file: File; fileName: string; sizeMB: number; percent: number; progressText?: string; error: string | null } | null>(null);
  const lessonRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lessonBodyRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const boot = useAuthBootstrap();

  const load = useCallback(async () => {
    try {
      const res = await getManual();
      setData(res);
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        // cookie 会话丢失（跨站 iframe 第三方 cookie 被拦/过期）：优先用 sessionStorage
        // 缓存令牌静默重登并刷新 cookie，再重试一次；重登失败才回登录页。
        // 全程不读 location.hash，hash 丢失不影响登录态与编辑权限。
        const restored = await resumeSession();
        if (restored) {
          try {
            const res = await getManual();
            setData(res);
            return;
          } catch (e2) {
            if ((e2 as { status?: number }).status !== 401) {
              setToast((e2 as Error).message);
              return;
            }
          }
        }
        router.replace('/?reason=session');
      } else {
        setToast((e as Error).message);
      }
    }
  }, [router]);

  useEffect(() => {
    if (boot.loading) return;
    if (boot.error || !boot.user) {
      router.replace('/?reason=session');
      return;
    }
    load();
  }, [boot.loading, boot.error, boot.user, load, router]);

  // 编辑态水合：进入编辑/重挂载时，把草稿（或原文）写入可编辑 DOM；之后随输入由 onInput→drafts 维护，
  // React 其余重渲染（滚动进度等）不再覆盖 contentEditable 内容。
  useEffect(() => {
    if (!editChapterId) return;
    const body = lessonBodyRefs.current[editChapterId];
    if (!body) return;
    const desired = drafts[editChapterId] ?? (data?.chapters.find((c) => c.id === editChapterId)?.html ?? '');
    // 仅当 DOM 内容与期望不一致时才写入，避免打断光标
    if (body.innerHTML !== desired) body.innerHTML = desired;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editChapterId]);

  // 关闭页面/刷新时未保存提示
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // 实时读取：当前编辑章 DOM 内容 vs 原文
      if (editChapterId) {
        const body = lessonBodyRefs.current[editChapterId];
        const cur = body?.innerHTML;
        const saved = savedHtmlRef.current[editChapterId];
        const draft = drafts[editChapterId];
        if ((cur != null && saved != null && cur !== saved) || (draft != null && saved != null && draft !== saved)) {
          e.preventDefault();
          e.returnValue = '';
        }
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editChapterId, drafts]);

  useEffect(() => {
    const onScroll = () => {
      const el = document.scrollingElement || document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      setProgress(max > 0 ? Math.min(100, Math.max(0, (el.scrollTop || 0) / max * 100)) : 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [data]);

  const searchIndex = useMemo(() => buildSearchIndex(data), [data]);

  // 防抖搜索：标题/正文命中 + mark 高亮片段
  useEffect(() => {
    const q = searchQ.trim();
    if (!q) { setSearchResults([]); return; }
    const h = setTimeout(() => {
      const lowQ = q.toLowerCase();
      const matched = searchIndex.filter((it) => it.title.toLowerCase().includes(lowQ) || it.text.toLowerCase().includes(lowQ));
      setSearchResults(matched.slice(0, 30).map((it) => ({ ...it, ctx: makeCtx(it.title, it.text, q) })));
    }, 160);
    return () => clearTimeout(h);
  }, [searchQ, searchIndex]);

  // 点击外部 / ESC 关闭搜索面板
  useEffect(() => {
    const out = (e: MouseEvent) => {
      const el = searchDockRef.current;
      if (el && !el.contains(e.target as Node)) { setSearchOpen(false); setShowSearchInput(false); (e.target as HTMLElement)?.blur?.(); }
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSearchOpen(false); setShowSearchInput(false); (e.target as HTMLElement)?.blur?.(); } };
    document.addEventListener('mousedown', out);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key); };
  }, []);

  const user = data?.user ?? boot.user;
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const editMode = editChapterId !== null;

  // 按模块分组小节（小节 = chapters，按 sort_order 升序）
  const groups = useMemo(() => {
    const g = new Map<string, ChapterDTO[]>();
    for (const mod of MODULE_ORDER) g.set(mod, []);
    for (const c of data?.chapters ?? []) {
      const arr = g.get(c.module) ?? [];
      arr.push(c);
      g.set(c.module, arr);
    }
    for (const arr of g.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    return Array.from(g.entries()).filter(([, arr]) => arr.length > 0);
  }, [data]);

  const chapterById = useCallback((id: string) => data?.chapters.find((c) => c.id === id) ?? null, [data]);

  // 术语表字典：从「术语表」小节的 g-item（id="g-xxx"）抽取，供 term-link 点击弹层
  const termDict = useMemo(() => {
    const map = new Map<string, { title: string; en: string; html: string }>();
    const gloss = data?.chapters.find((c) => c.module === 'APPENDIX' && c.section_no === '术语表');
    if (!gloss) return map;
    // g-item 内含 g-case 子 div，不能用嵌套正则；按 g-item 起始切分
    const parts = gloss.html.split(/<div class="g-item" id="/).slice(1);
    for (const part of parts) {
      const q = part.indexOf('"');
      if (q < 0) continue;
      const id = part.slice(0, q).toLowerCase();
      // 该 g-item 内容到下一个 g-item 之前（parts 已切分，part 即完整 item 主体）
      const inner = `<div class="g-item"${part}`;
      const titleMatch = part.match(/<h4>([\s\S]*?)<\/h4>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '术语';
      // 英文名（h4 内的 en span，若无则取标题中第一个英文词）
      let en = '';
      if (titleMatch) {
        const enSpan = titleMatch[1].match(/class="en"[^>]*>([^<]+)</i);
        if (enSpan) en = enSpan[1].trim();
        else {
          const enw = titleMatch[1].match(/\b[A-Za-z][A-Za-z .&/-]{1,40}\b/);
          if (enw) en = enw[0].trim();
        }
      }
      map.set(id, { title, en, html: inner });
    }
    return map;
  }, [data]);

  // The API returns readable chapters. An empty module still has its own permission state.
  const visibleModules = useMemo(() => new Set(groups.map(([m]) => m)), [groups]);

  // 某模块的可见小节列表
  const moduleChapters = useCallback(
    (code: string) => data?.chapters.filter((c) => c.module === code) ?? [],
    [data],
  );

  // 是否存在未保存改动（当前编辑章草稿与原文不同）
  const hasUnsaved = useCallback(() => {
    if (!editChapterId) return false;
    const draft = drafts[editChapterId];
    const saved = savedHtmlRef.current[editChapterId];
    return draft != null && saved != null && draft !== saved;
  }, [editChapterId, drafts]);

  // 导航/切换前确认；返回 true 表示用户放弃并继续
  const confirmDiscard = useCallback((): boolean => {
    if (!hasUnsaved()) return true;
    return window.confirm('当前小节有未保存的修改，离开将丢弃这些内容。是否放弃？');
  }, [hasUnsaved]);

  const gotoModule = useCallback((code: string) => {
    // 先同步当前编辑内容到 drafts（用户可能尚未触发 onInput 兜底）
    if (editChapterId) {
      const body = lessonBodyRefs.current[editChapterId];
      if (body) setDrafts((d) => ({ ...d, [editChapterId]: body.innerHTML }));
    }
    if (!confirmDiscard()) return;
    setActiveModule(code);
    setRepin(null);
    setEditChapterId(null);
    setShowSnapshots(false);
    window.scrollTo({ top: 0 });
  }, [confirmDiscard, editChapterId]);

  // 连续阅读模式下跳转到某模块起始位置（不切独立视图）
  const jumpToModule = useCallback((code: string) => {
    if (editChapterId) {
      const body = lessonBodyRefs.current[editChapterId];
      if (body) setDrafts((d) => ({ ...d, [editChapterId]: body.innerHTML }));
    }
    if (!confirmDiscard()) return;
    setActiveModule('ALL');
    setRepin(null);
    setEditChapterId(null);
    setShowSnapshots(false);
    requestAnimationFrame(() => {
      if (code === '') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const el = document.getElementById(`mod-${code}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [confirmDiscard, editChapterId]);

  // 滚动监听：显示/隐藏 FAB、标记当前模块（滚动高亮）、16.3 顶部搜索条收缩
  useEffect(() => {
    const onScroll = () => {
      const sy = window.scrollY;
      setShowFab(sy > window.innerHeight * 0.6);
      // 顶部搜索条：滚过一定距离即收缩（淡出顶部条，放大镜并入右下 FAB 组）
      setScrolled(sy > 120);
      // 当前小节（用于目录自动定位）：取视口内上方最近的一个 .lesson
      const lessons = Array.from(document.querySelectorAll<HTMLElement>('.manager-mod .lesson[data-chapter]'));
      let curLesson = '';
      for (const l of lessons) {
        const r = l.getBoundingClientRect();
        if (r.top <= window.innerHeight * 0.4) curLesson = l.getAttribute('data-chapter') ?? '';
        else break;
      }
      setActiveLesson(curLesson || null);
      // 当前模块高亮：取可视区域内最近的 .module
      const mods = Array.from(document.querySelectorAll<HTMLElement>('.manager-mod'));
      let cur = '';
      for (const m of mods) {
        const r = m.getBoundingClientRect();
        if (r.top <= window.innerHeight * 0.35) cur = m.dataset.code ?? '';
        else break;
      }
      setCurrentSection(cur);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 目录自动定位：滚动浏览到某小节时，让右策目录自动滚动使该小节项可见并高亮
  useEffect(() => {
    if (!showToc || !activeLesson) return;
    const body = tocBodyRef.current;
    if (!body) return;
    const item = body.querySelector<HTMLElement>(`.toc-mod li[data-chapter="${activeLesson}"]`);
    if (!item) return;
    // 计算 item 相对 toc-body 的顶部偏移，滚动到面板可视区中部
    const bodyRect = body.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const targetScroll = body.scrollTop + (itemRect.top - bodyRect.top) - body.clientHeight / 2 + itemRect.height / 2;
    body.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
  }, [showToc, activeLesson]);

  const scrollToTop = useCallback(() => window.scrollTo({ top: 0, behavior: 'smooth' }), []);

  // 目录跳转到某小节并短暂高亮
  const jumpToChapter = useCallback((chapterId: string, moduleCode: string) => {
    setActiveModule('ALL');
    setShowToc(false);
    requestAnimationFrame(() => {
      const el = lessonRefs.current[chapterId];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setFlashLessonId(chapterId);
        setTimeout(() => setFlashLessonId(null), 2000);
      }
    });
  }, []);

  // 搜索结果跳转：滚动定位到小节水并复用 is-flash 高亮
  const goSearchResult = useCallback((m: SearchItem) => {
    setSearchQ('');
    setSearchResults([]);
    setSearchOpen(false);
    setShowSearchInput(false);
    jumpToChapter(m.id, m.module);
  }, [jumpToChapter]);

  // —— 术语速查：跳到「术语表」小节 ——
  const scrollToGlossary = useCallback(() => {
    setActiveModule('ALL');
    setRepin(null);
    setEditChapterId(null);
    requestAnimationFrame(() => {
      // 先跳转到附录模块，再精确定位术语表小节
      const mod = document.getElementById('mod-APPENDIX');
      const gloss = document.getElementById('term-glossary');
      if (gloss) gloss.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (mod) mod.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // —— 深链：/manual#<chapterId>、#<chapterId>/<word>、#<sectionNo>、#<模块码> ——
  useEffect(() => {
    if (!data) return;
    if (typeof window === 'undefined') return;
    const apply = () => {
      const raw = window.location.hash.replace(/^#/, '');
      if (!raw) return;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    // 1) UUID 小节深链 #<chapterId> 或 #<chapterId>/<word>
    if (raw[0] !== 'm' && raw[0] !== 'M' && /^[0-9a-f-]{32,36}$/i.test(raw.split('/')[0])) {
      const [chapterId, word] = raw.split('/');
      if (/^[0-9a-f-]{32,36}$/i.test(chapterId)) {
        const target = data.chapters.find((c) => c.id === chapterId);
        if (!target) return;
        setActiveModule(target.module);
        setEditChapterId(null);
        if (word) setFlashLessonId(chapterId);
        deepLinkWord.current = word ? decodeURIComponent(word) : '';
        setTimeout(() => {
          const el = lessonRefs.current[chapterId];
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => setFlashLessonId(null), 2200);
        }, 500);
        return;
      }
    }
    // 2) 模块码 #M1..#M8 / #APPENDIX 直接落位到模块
    const modCode = raw.toUpperCase();
    if (/^M[1-8]$/.test(modCode) || modCode === 'APPENDIX') {
      setActiveModule(modCode); // 过滤到该模块视图，滚动可靠
      setRepin(null);
      setEditChapterId(null);
      const tryScrollMod = function (n = 0) {
        const el = document.getElementById(`mod-${modCode}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else if (n <= 20) setTimeout(() => tryScrollMod(n + 1), 80);
      };
      tryScrollMod();
      return;
    }
    // 3) 小节号 #2.12 定位到对应小节（跨模块取首个匹配）
    if (/^\d+\.\d+$/.test(raw)) {
      const target = data.chapters.find((c) => c.section_no === raw);
      if (!target) return;
      setActiveModule(target.module);
      setEditChapterId(null);
      setRepin(null);
      const tryScrollLesson = function (n = 0) {
        const el = lessonRefs.current[target.id];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setFlashLessonId(target.id);
          setTimeout(() => setFlashLessonId(null), 2200);
        } else if (n <= 20) {
          setTimeout(() => tryScrollLesson(n + 1), 80);
        }
      };
      tryScrollLesson();
    }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [data, jumpToModule]);
  const deepLinkWord = useRef<string>('');

  // 深链锚点词：在标记就绪后高亮定位
  useEffect(() => {
    if (!deepLinkWord.current || !activeModule || !flashLessonId) return;
    const t = setTimeout(() => {
      const word = deepLinkWord.current;
      const root = lessonRefs.current[flashLessonId];
      const el = Array.from(root?.querySelectorAll<HTMLElement>('.mat-anchor, [data-word]') ?? []).find((e) =>
        (e.getAttribute('data-word') ?? '').toLowerCase().includes(word.toLowerCase().slice(0, 4)),
      );
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      deepLinkWord.current = '';
    }, 800);
    return () => clearTimeout(t);
  }, [activeModule, data, flashLessonId]);

  // 保存成功后的柔和高亮：用户滚动即自然消失（15.3）
  useEffect(() => {
    if (!flashLessonId) return;
    const clear = () => setFlashLessonId(null);
    const opts = { passive: true } as AddEventListenerOptions;
    const hopts = { passive: true } as EventListenerOptions;
    window.addEventListener('wheel', clear as EventListener, opts);
    window.addEventListener('touchmove', clear as EventListener, opts);
    window.addEventListener('scroll', clear as EventListener, opts);
    const t = setTimeout(clear, 3200); // 兜底
    return () => {
      window.removeEventListener('wheel', clear as EventListener, hopts);
      window.removeEventListener('touchmove', clear as EventListener, hopts);
      window.removeEventListener('scroll', clear as EventListener, hopts);
      clearTimeout(t);
    };
  }, [flashLessonId]);

  // 待重挂素材
  const [repinFallbackId, setRepinFallbackId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return sessionStorage.getItem('manual-repin-id');
    } catch {
      return null;
    }
  });
  const repinMaterialId = searchParams?.get('repin') ?? repinFallbackId;
  const clearRepinTarget = useCallback(() => {
    setRepinFallbackId(null);
    try {
      sessionStorage.removeItem('manual-repin-id');
    } catch {
      /* ignore */
    }
  }, []);
  const startRepin = useCallback(async (materialId: string) => {
    clearRepinTarget();
    try {
      const res = await api<{
        chapter_deleted: boolean;
        chapter_id: string;
        chapter_label?: string;
        old_word: string;
        old_sentence: string;
        candidates: RepinCandidate[];
      }>(`/api/admin/materials/re-pending/${materialId}/candidates`);
      setRepin({
        materialId,
        chapterLabel: res.chapter_label ?? '其他章节',
        oldWord: res.old_word,
        oldSentence: res.old_sentence,
        chapterDeleted: res.chapter_deleted,
        candidates: res.candidates ?? [],
      });
      setEditChapterId(null);
      setShowSnapshots(false);
      if (!res.chapter_deleted && res.chapter_id) {
        const ch = chapterById(res.chapter_id);
        if (ch) {
          setActiveModule(ch.module);
          setFlashLessonId(ch.id);
          setTimeout(() => {
            const root = lessonRefs.current[ch.id]?.closest('.module') as HTMLElement | null;
            const first = root?.querySelector('.repin-cand') as HTMLElement | null;
            (first ?? lessonRefs.current[ch.id])?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => setFlashLessonId(null), 2200);
          }, 700);
        }
      }
      if (res.chapter_deleted) {
        setToast('原章节已删除：请进入某模块小节，右键/长按正文选词挂接');
      } else if ((res.candidates ?? []).length === 0) {
        setToast('未找到推荐词，请自行右键/长按正文选词挂接');
      } else {
        setToast(`请点击正文里高亮的 ${res.candidates.length} 个推荐词之一，或自行右键/长按选词挂接`);
      }
      setTimeout(() => setToast(''), 4000);
    } catch (e) {
      setToast((e as Error).message);
    }
  }, [chapterById, clearRepinTarget]);

  useEffect(() => {
    if (boot.loading || !boot.user || !repinMaterialId) return;
    startRepin(repinMaterialId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repinMaterialId, boot.loading, boot.user]);

  const exitRepin = useCallback(() => {
    setRepin(null);
    router.replace('/manual');
  }, [router]);

  const logoutHandler = async () => {
    if (editChapterId) {
      const body = lessonBodyRefs.current[editChapterId];
      if (body) setDrafts((d) => ({ ...d, [editChapterId]: body.innerHTML }));
    }
    if (!confirmDiscard()) return;
    await performLogout();
  };

  // —— 每个小节的字符串级标记 HTML（React 管，重渲染/播放/翻章/刷新后稳定） ——
  const lessonHtml = useCallback(
    (c: ChapterDTO): string => {
      if (editChapterId === c.id) return c.html; // 编辑态用原始 html
      if (typeof document === 'undefined') return c.html;
      try {
        if (repin) {
          return injectWordMarkers(
            c.html,
            repin.candidates.map((cd) => ({ word: cd.word, className: 'repin-cand' })),
          );
        }
        return injectWordMarkers(
          c.html,
          [
            ...c.materials.map((m) => ({
              word: m.word,
              className: 'mat-anchor',
              chip: materialChipSvg(m.file_type === 'image' ? 'image' : 'video'),
            })),
            ...TERM_HL_TARGETS,
          ],
        );
      } catch {
        return c.html;
      }
    },
    [editChapterId, repin],
  );

  // —— 重挂挂接 ——
  const doRepin = useCallback(
    async (word: string, sentence: string, chapterId?: string) => {
      if (!repin) return;
      setBusy(true);
      try {
        await api(`/api/admin/materials/re-pending/${repin.materialId}`, {
          method: 'PUT',
          body: JSON.stringify({ word, sentence, chapterId }),
        });
        setToast('挂接成功，素材已回到阅读页');
        setRepin(null);
        router.replace('/manual');
        setTimeout(() => setToast(''), 2500);
      } catch (e) {
        setToast((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [repin, router],
  );

  // —— 右键 / 长按选词 ——
  const openMenu = (e: React.MouseEvent | React.TouchEvent, x: number, y: number, chapterId: string) => {
    if (editChapterId === chapterId) return;
    const sel = window.getSelection();
    if (repin) {
      const text = sel?.toString().trim();
      if (text) {
        const word = text.replace(/\s+/g, ' ').slice(0, 60);
        const anchorNode = sel?.anchorNode;
        const block = anchorNode?.nodeType === 3 ? (anchorNode.parentElement?.closest('p,li,td,th,h1,h2,h3,h4,blockquote,dd,div') as HTMLElement | null) : null;
        const sentence = (block?.innerText ?? word).replace(/\s+/g, ' ').trim().slice(0, 300);
        e.preventDefault();
        if (word && sentence) doRepin(word, sentence, chapterId);
      }
      return;
    }
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;
    e.preventDefault();
    const word = text.replace(/\s+/g, ' ').slice(0, 60);
    const anchorNode = sel.anchorNode;
    const block = anchorNode?.nodeType === 3 ? (anchorNode.parentElement?.closest('p,li,td,th,h1,h2,h3,h4,blockquote,dd,div') as HTMLElement | null) : null;
    const sentence = (block?.innerText ?? sel.focusNode?.textContent ?? text).replace(/\s+/g, ' ').trim().slice(0, 300);
    const menuW = 220;
    const clampedX = Math.max(8, Math.min(x, window.innerWidth - menuW - 8));
    const clampedY = Math.max(8, Math.min(y, window.innerHeight - 140));
    setMenu({ x: clampedX, y: clampedY, word, sentence, chapterId });
  };

  const onContext = (e: React.MouseEvent) => {
    if (!isAdmin) return; // employee 纯只读：右键不出现上传注入
    const target = e.target as HTMLElement;
    if (target.closest('.mat-anchor, .mat-chip')) return;
    const lesson = target.closest('.lesson') as HTMLElement | null;
    const chapterId = lesson?.getAttribute('data-chapter') ?? '';
    if (chapterId) openMenu(e, e.clientX, e.clientY, chapterId);
  };
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (!isAdmin) return;
    const lesson = (e.target as HTMLElement).closest('.lesson') as HTMLElement | null;
    const chapterId = lesson?.getAttribute('data-chapter');
    if (!chapterId) return;
    if (editChapterId === chapterId) return;
    const t = e.touches[0];
    touchTimer.current = setTimeout(() => openMenu(e as unknown as React.MouseEvent, t.clientX, t.clientY, chapterId), 550);
  };
  const onTouchMove = () => {
    if (touchTimer.current) clearTimeout(touchTimer.current);
  };
  const clearTimer = () => {
    if (touchTimer.current) clearTimeout(touchTimer.current);
  };

  // —— 上传 ——
  const runUpload = async (file: File) => {
    if (!menu) return;
    const chapterId = menu.chapterId;
    setUploading({ file, fileName: file.name, sizeMB: file.size / 1048576, percent: 0, error: null });
    setToast('');
    try {
      const created = await uploadMaterial({
        chapterId,
        sentence: menu.sentence,
        word: menu.word,
        file,
        onProgress: (p) => setUploading((u) => (u ? { ...u, percent: p.percent, progressText: p.phase } : u)),
      });
      const mat = created as ChapterMaterial;
      setData((d) =>
        d
          ? { ...d, chapters: d.chapters.map((c) => (c.id === chapterId ? { ...c, materials: [...c.materials, mat] } : c)) }
          : d,
      );
      setUploading(null);
      setMenu(null);
      setToast('素材上传成功');
      setTimeout(() => setToast(''), 2000);
    } catch (e) {
      const msg = e instanceof UploadError ? e.message : e instanceof Error ? e.message : '上传失败，请重试';
      setUploading((u) => (u ? { ...u, error: msg } : u));
    }
  };
  const startUpload = (file: File) => {
    const isVideo = file.type.startsWith('video') || /\.(mp4|mov|m4v)$/i.test(file.name);
    const isImg = file.type.startsWith('image');
    const sizeMB = file.size / 1048576;
    if (!isVideo && !isImg) {
      setUploading({ file, fileName: file.name, sizeMB, percent: 0, error: '仅支持 MP4/MOV 视频或图片' });
      return;
    }
    if (isVideo && sizeMB > MAX_VIDEO_MB) {
      setUploading({ file, fileName: file.name, sizeMB, percent: 0, error: `视频不能超过 ${MAX_VIDEO_MB}MB，建议压缩后上传` });
      return;
    }
    if (isImg && sizeMB > MAX_IMAGE_MB) {
      setUploading({ file, fileName: file.name, sizeMB, percent: 0, error: `图片不能超过 ${MAX_IMAGE_MB}MB` });
      return;
    }
    runUpload(file);
  };

  // —— 点击：术语弹层 / 素材查看 / 重挂候选挂接 ——
  const openViewer = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    // 15.2/16.2 正文图片点击 → 全屏 lightbox（最优先；仅非编辑态；编辑态鼠标拖选不拦截）。
    // 用 closest('img') 命中正文 <img>，并 stopPropagation 防止被术语/锚点逻辑吃掉。
    const clickedImg = t.closest('img') as HTMLImageElement | null;
    if (clickedImg && !editChapterId && clickedImg.src) {
      const lesson = t.closest('.lesson') as HTMLElement | null;
      const body = t.closest('.lesson-body') as HTMLElement | null;
      const scope = body ?? lesson;
      if (scope) {
        const imgs = Array.from(scope.querySelectorAll('img'))
          .map((n) => (n as HTMLImageElement).currentSrc || (n as HTMLImageElement).src)
          .filter(Boolean);
        const idx = Math.max(0, imgs.indexOf(clickedImg.currentSrc || clickedImg.src));
        if (imgs.length) {
          e.preventDefault();
          e.stopPropagation();
          setLightbox({ list: imgs, index: idx });
          return;
        }
      }
    }
    // 术语链接：拦截，弹术语层（不跳转）
    const termLink = t.closest('a.term-link') as HTMLAnchorElement | null;
    const termHl = t.closest('[data-term]') as HTMLElement | null;
    const termSrc = termLink ?? termHl;
    if (termSrc) {
      const rawKey = termLink ? (termLink.getAttribute('href') ?? '') : (termHl?.getAttribute('data-term') ?? '');
      const key = rawKey.replace('#', '').toLowerCase();
      const entry = termDict.get(key);
      if (entry) {
        setTermPop(entry);
        e.preventDefault();
        return;
      }
      // #glossary 等分类锚点：跳到附录术语表
      if (key === 'glossary') {
        e.preventDefault();
        gotoModule('APPENDIX');
        return;
      }
    }
    const lesson = t.closest('.lesson') as HTMLElement | null;
    const chapterId = lesson?.getAttribute('data-chapter') ?? '';
    const chapter = chapterById(chapterId);
    if (repin) {
      const cand = t.closest('.repin-cand');
      if (cand && chapter) {
        const word = cand.getAttribute('data-word') ?? cand.textContent ?? '';
        const block = cand.closest('p,li,td,th,h1,h2,h3,h4,blockquote,dd,div') as HTMLElement | null;
        const sentence = (block?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (word && sentence) doRepin(word, sentence, chapter.id);
      }
      return;
    }
    const word = t.closest('.mat-anchor')?.getAttribute('data-word');
    if (!word || !chapter) return;
    const mats = chapter.materials.filter((m) => m.word === word);
    if (mats.length > 0) setViewer({ word, materials: mats, canDelete: isAdmin });
  };

  // —— 编辑：进入/保存/取消某小节（草稿提升到顶层 drafts，滚动/重渲染/切模块不丢字） ——
  // 把当前编辑 DOM 的 innerHTML 写入 drafts（onInput 时调用）
  const syncDraft = (chapterId: string) => {
    const body = lessonBodyRefs.current[chapterId];
    if (!body) return;
    const html = body.innerHTML;
    setDrafts((d) => (d[chapterId] === html ? d : { ...d, [chapterId]: html }));
  };

  // 进入编辑：记录原文快照，若已有草稿则沿用
  const enterEdit = (chapterId: string) => {
    if (editChapterId === chapterId) return;
    // 先把正在编辑的其它小节内容落 drafts
    if (editChapterId) {
      const body = lessonBodyRefs.current[editChapterId];
      if (body) setDrafts((d) => ({ ...d, [editChapterId]: body.innerHTML }));
    }
    if (!confirmDiscard()) return; // 别处有未保存草稿，用户选择不放弃
    const chapter = data?.chapters.find((c) => c.id === chapterId);
    if (chapter) savedHtmlRef.current[chapterId] = chapter.html;
    setEditChapterId(chapterId);
    setShowSnapshots(false);
    requestAnimationFrame(() => {
      const el = lessonRefs.current[chapterId];
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    });
  };

  // 退出编辑：discardDraft=true 时清掉草稿（取消/保存成功后）；否则保留
  const leaveEdit = (discardDraft: boolean) => {
    setEditChapterId((prev) => {
      if (discardDraft && prev) {
        setDrafts((d) => {
          if (!(prev in d)) return d;
          const next = { ...d };
          delete next[prev];
          return next;
        });
      }
      return null;
    });
    setShowSnapshots(false);
  };

  const cancelEdit = () => {
    if (!confirmDiscard()) return; // 有改动且用户不放弃
    leaveEdit(true);
  };

  const saveEdit = async () => {
    if (!editChapterId) return;
    const body = lessonBodyRefs.current[editChapterId];
    if (!body) return;
    const html = body.innerHTML;
    setBusy(true);
    setToast('');
    try {
      const res = await api<{ version: number; re_pending: number }>(`/api/admin/chapters/${editChapterId}/content`, {
        method: 'PUT',
        body: JSON.stringify({ html }),
      });
      // 保存成功：留在原地、不退出编辑态、不重载页面（保持滚动位置不动，15.3）
      savedHtmlRef.current[editChapterId] = html;
      const savedId = editChapterId;
      setDrafts((d) => {
        if (!(savedId in d)) return d;
        const next = { ...d };
        delete next[savedId];
        return next;
      });
      // 同步本地 data，使离开编辑态也能看到已保存内容（避免整页 load 导致滚动跳走）
      setData((d) => (d ? { ...d, chapters: d.chapters.map((c) => (c.id === savedId ? { ...c, html } : c)) } : d));
      setShowSnapshots(false);
      setFlashLessonId(savedId); // 保存区块柔和高亮闪烁，滚动后自然消失
      setToast(`已保存 v${res.version}${res.re_pending > 0 ? `，${res.re_pending} 条素材待重挂` : ''}`);
      setTimeout(() => setToast(''), 2500);
    } catch (err) {
      // 保存失败：草稿保留，提示
      setDrafts((d) => ({ ...d, [editChapterId]: html }));
      setToast(`保存失败：${(err as Error).message}（草稿已保留，可重试）`);
    } finally {
      setBusy(false);
    }
  };
  const onInsertImage = async (file: File) => {
    if (!editChapterId || !isAdmin) return;
    // 前端预校验：非图片 / 超大直接提示，不发请求
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(file.type) || !/\.(png|jpe?g|gif|webp)$/i.test(file.name)) {
      const msg = '仅支持 PNG / JPG / JPEG / GIF / WebP 图片文件';
      setImgUp({ state: 'error', err: msg });
      setToast(msg);
      setTimeout(() => setToast(''), 3000);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      const msg = `图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），单张不能超过 20MB`;
      setImgUp({ state: 'error', err: msg });
      setToast(msg);
      setTimeout(() => setToast(''), 3000);
      return;
    }
    setImgUp({ state: 'uploading', err: '' });
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api<{ url: string }>(`/api/chapters/${editChapterId}/inline-image`, { method: 'POST', body: fd });
      const url = res.url;
      const el = lessonBodyRefs.current[editChapterId];
      if (!el) throw new Error('未找到编辑区');
      let okInsert = false;
      const sel = window.getSelection?.();
      if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
        const r = sel.getRangeAt(0);
        r.deleteContents();
        const img = document.createElement('img');
        img.src = url;
        img.setAttribute('style', 'max-width:100%;border-radius:10px;display:block;margin:12px auto;');
        r.insertNode(img);
        r.setStartAfter(img);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        okInsert = true;
      }
      if (!okInsert) {
        el.insertAdjacentHTML('beforeend', `<img src="${url}" style="max-width:100%;border-radius:10px;display:block;margin:12px auto"/>`);
      }
      setDrafts((d) => ({ ...d, [editChapterId]: el.innerHTML }));
      setImgUp({ state: 'idle', err: '' });
      setToast('图片已插入，记得点「保存」生效');
      setTimeout(() => setToast(''), 2500);
    } catch (err) {
      const msg = (err as Error).message || '图片上传失败，请重试';
      setImgUp({ state: 'error', err: msg });
      setToast(`插图失败：${msg}`);
      setTimeout(() => setToast(''), 4000);
    }
  };
  const loadSnapshots = async () => {
    if (!editChapterId) return;
    try {
      const res = await api<{ snapshots: SnapshotDTO[] }>(`/api/admin/chapters/${editChapterId}/snapshots`);
      setSnapshots(res.snapshots);
      setShowSnapshots(true);
    } catch (err) {
      setToast((err as Error).message);
    }
  };
  const rollback = async (snapId: string) => {
    if (!editChapterId) return;
    setBusy(true);
    try {
      await api(`/api/admin/chapters/${editChapterId}/snapshots/${snapId}/restore`, { method: 'POST' });
      setToast('已回滚，重新加载中…');
      const rbId = editChapterId;
      setDrafts((d) => {
        if (!(rbId in d)) return d;
        const next = { ...d };
        delete next[rbId];
        return next;
      });
      setEditChapterId(null);
      await load();
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return <main className="mx-auto max-w-xl px-6 py-16 text-center text-sm">
      <h1 className="font-semibold text-slate-700">{toast ? '手册读取失败' : '加载手册中…'}</h1>
      {toast && <>
        <p role="alert" className="my-4 text-rose-700">{toast}</p>
        <button type="button" onClick={() => { setToast(''); void load(); }} className="mr-5 text-indigo-700 underline">重新加载</button>
        {isAdmin && <a href="/admin/knowledge" className="text-indigo-700 underline">知识库管理</a>}
      </>}
    </main>;
  }

  const moduleAccess = data.moduleAccess ?? getModuleAccess(data.chapters, data.user);
  const isContinuous = activeModule === 'ALL';
  // 连续阅读：按模块顺序拼出全部可见模块；单模块视图则只取该模块
  const readingList = isContinuous
    ? MODULE_META.filter((m) => visibleModules.has(m.code)).map((m) => m.code)
    : activeModule
      ? [activeModule]
      : [];

  return (
    <div className="manual-v2">
      <Watermark name={data.user.name} />

      {/* ===== 顶部导航 nav.topbar ===== */}
      <div id="progress-bar-proxy" className="progress-bar" style={{ width: `${progress}%`, display: progress > 0 && progress < 100 ? 'block' : 'none' }} />
      <nav className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => gotoModule('')} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
            <span className="dot">
              {/* TikTok 音符黑底图标 */}
              <img src="/tiktok-note-black.png" alt="" width={22} height={22} />
            </span>
            <span className="brand-text">印尼 TK Shop 运营指南</span>
          </button>
          <div className="nav-scroll">
            <div className="nav-links">
              <button type="button" className={`navpill ${!activeModule ? 'active' : ''}`} onClick={() => gotoModule('')}>
                首页
              </button>
              {MODULE_META.map((m) =>
                visibleModules.has(m.code) ? (
                  <button
                    key={m.code}
                    type="button"
                    className={`navpill ${currentSection === m.code ? 'active' : ''} ${isContinuous && !currentSection && m.code === 'M1' ? 'active' : ''}`}
                    onClick={() => jumpToModule(m.code)}
                  >
                    {m.code === 'APPENDIX' ? '附录·术语' : m.nav}
                  </button>
                ) : null,
              )}
              {isContinuous && (
                <button type="button" className="navpill" onClick={scrollToGlossary}>
                  术语速查
                </button>
              )}
              <span className="nav-sep" />
              <a href="/loop" className="navpill">
                带货闭环图
              </a>
              {isAdmin && (
                <a href="/admin" className="navpill">
                  管理后台
                </a>
              )}
              <a href="/exams" className="navpill">
                我的考核
              </a>
              <button type="button" className="navpill" onClick={() => setPassOpen(true)}>
                修改密令
              </button>
              <button type="button" className="navpill" onClick={logoutHandler}>
                退出
              </button>
            </div>
          </div>
        </div>
      </nav>

      {toast && <div className="v2-toast">{toast}</div>}
      {passOpen && (
        <PassphraseModal
          onDone={(msg) => {
            setToast(msg);
            window.setTimeout(() => setToast(''), 2600);
          }}
          onClose={() => setPassOpen(false)}
        />
      )}

      {/* ===== 全站搜索（旧版 search-dock 停靠搜索条；向下滚动后收缩为右下 FAB 放大镜，16.3） ===== */}
      <div
        className={`search-dock${searchOpen ? ' open' : ''}${showSearchInput ? ' expanded' : ''}${scrolled && !searchFabOpen ? ' dock-collapsed' : ''}`}
        ref={searchDockRef}
      >
        <svg className="s-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={searchInputRef}
          id="guide-search"
          className="guide-search"
          placeholder="搜索关键词，如：冷启动、ROI、商品卡…"
          value={searchQ}
          onChange={(e) => { setSearchQ(e.target.value); setSearchOpen(true); }}
          onFocus={() => { setSearchOpen(true); setShowSearchInput(true); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setSearchOpen(false); setShowSearchInput(false); (e.target as HTMLInputElement).blur(); } }}
        />
        {searchQ ? (
          <button className="search-clear" type="button" aria-label="清空" onClick={() => { setSearchQ(''); setSearchResults([]); setSearchOpen(true); searchInputRef.current?.focus(); }}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        ) : null}
        {searchOpen && searchQ.trim() ? (
          <div className="search-panel">
            {searchResults.length === 0 ? (
              <div className="s-empty">未找到「{searchQ}」相关内容</div>
            ) : (
              <>
                <div className="s-count">共 {searchResults.length} 条结果</div>
                {searchResults.map((it) => (
                  <button type="button" key={it.id} className="s-item" onClick={() => goSearchResult(it)}>
                    <span className="s-badge" style={{ background: metaOf(it.module)?.mc ? 'var(--primary-soft)' : '#eef0ff', color: metaOf(it.module)?.mc ? 'var(--primary-dark)' : '#5b6cffc0' }}>{it.no}</span>
                    <span className="s-body">
                      <span className="s-path">{it.big} · {it.sub}</span>
                      <span className="s-ctx" dangerouslySetInnerHTML={{ __html: it.ctx }} />
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        ) : null}
        <button type="button" className="s-fab" aria-label="搜索" onClick={() => { setSearchOpen(true); setShowSearchInput(true); setTimeout(() => searchInputRef.current?.focus(), 30); }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        </button>
      </div>

      {/* ============ 首页：Hero + 学习路径卡片（首页态 或 连续瀑布流顶部） ============ */}
      {(!activeModule || isContinuous) && (
        <>
          <header className="hero">
            <div className="hero-badges">
              <span className="hbadge v">v0.7.0</span>
              <span className="hbadge s">内部培训 · SOP 手册</span>
              <span className="hbadge t">站点：印尼站 · seller-id.tokopedia.com</span>
            </div>
            <h1>
              印尼 TikTok Shop
              <br />
              <span className="hl">电商运营从 0 到 1 实战指南</span>
            </h1>
            <p className="sub">
              从开店、选品、上架、内容、达人、广告到数据复盘的全链路操作手册。每一章都按「能直接照着做」的标准写 SOP，配套检查清单、印尼语模板和考核标准，边做边迭代。
            </p>
            <div className="hero-meta">
              <div className="meta-card">
                <div className="k">面向谁</div>
                <div className="v">
                  运营新人 & 团队在岗成员
                  <small>新人按路径学习，老人当 SOP 字典查</small>
                </div>
              </div>
              <div className="meta-card">
                <div className="k">覆盖范围</div>
                <div className="v">
                  {data.chapters.length} 个小节 · {visibleModules.size} 个模块
                  <small>店铺 / 商品 / 活动 / 内容 / 达人 / 广告 / 数据 / 考核</small>
                </div>
              </div>
              <div className="meta-card">
                <div className="k">当前账号</div>
                <div className="v">
                  {esc(data.user.name)} · {data.user.role === 'super_admin' ? '超级管理员' : data.user.role === 'admin' ? '管理员' : `在岗成员（${data.user.tier}）`}
                  <small>{isAdmin ? '可访问全部知识模块，并在管理后台维护内容' : '点击已有内容的模块进入学习，权限按岗位等级开放'}</small>
                </div>
              </div>
            </div>
          </header>

          <main className="v2-main">
            <section>
              <div className="sec-head">
                <h2>学习路径总览</h2>
                <span className="tag">8 大模块 + 附录</span>
              </div>
              <p className="sec-intro">
                模块顺序按「开店 → 有货卖 → 拿到流量 → 放大流量 → 管好数据 → 管好团队」的实战推进逻辑排列。M1-M3 解决「店铺和货」，M4-M6 解决「流量和成交」，M7 解决「复盘」，<b>M8 违规处理单列、高频踩坑保命章</b>。
              </p>
              {data.chapters.length === 0 && (
                <div role="status" className="mb-6 rounded-xl border border-indigo-200 bg-white p-5 text-sm leading-7">
                  <h3 className="font-bold">当前手册暂无章节</h3>
                  <p>{isAdmin ? '请导入原知识包，载入章节正文、题库、图片和带货闭环图。' : '请联系管理员补充当前可阅读的知识内容。'}</p>
                  {isAdmin && <a href="/admin/knowledge" className="font-semibold text-indigo-700 underline">导入原知识包</a>}
                </div>
              )}
              <div className="path-grid">
                {MODULE_META.map((m) => {
                  const chs = moduleChapters(m.code);
                  const unlocked = moduleAccess[m.code];
                  const canOpen = unlocked && (chs.length > 0 || isAdmin);
                  return (
                    <button
                      key={m.code}
                      type="button"
                      className={`path-card ${m.pc} ${unlocked ? '' : 'locked'}`}
                      onClick={() => chs.length > 0 ? jumpToModule(m.code) : router.push('/admin/knowledge')}
                      disabled={!canOpen}
                      aria-disabled={!canOpen}
                    >
                      {!unlocked && (
                        <span className="lock-badge">
                          <LockIcon />
                        </span>
                      )}
                      <div className="num">{m.num}</div>
                      <h3>{m.name}</h3>
                      <p dangerouslySetInnerHTML={{ __html: m.desc }} />
                      {unlocked ? (
                        <div className="lessons">{chs.length > 0 ? `${chs.length} 小节` : isAdmin ? '暂无章节 · 点击导入或新增' : '暂无章节 · 等待管理员补充'}</div>
                      ) : (
                        <div className="lock-note">
                          <LockIcon size={12} /> 暂未解锁（按岗位权限开放）
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="path-flow">
                推进逻辑：<b>M1 开店</b> → <b>M2 铺货</b> → <b>M4/M5 免费流量</b> → <b>M6 付费放大</b> → <b>M7 复盘</b>，M3 活动贯穿全程；<b>M8 违规处理随时翻查</b>
              </p>
            </section>
            <p style={{ textAlign: 'center', marginTop: 56, color: 'var(--ink-3)', fontSize: 13, fontWeight: 700 }}>公司内部培训资料 · 禁止外发截图</p>
          </main>
        </>
      )}

      {/* ============ 模块阅读：大白卡片 .module 包裹各 .lesson（连续瀑布流） ============ */}
      {activeModule && readingList.map((modCode) => {
        const meta = metaOf(modCode);
        if (!meta) return null;
        const chs = moduleChapters(modCode);
        return (
          <main key={modCode} className="v2-main">
            <section className={`module ${meta.mc} manager-mod`} id={`mod-${modCode}`} data-code={modCode} data-num={modCode === 'APPENDIX' ? '附' : modCode.replace('M', '')}>
            <div className="m-head">
              <span className="m-chip">{meta.num}</span>
              <h3>{meta.name}</h3>
              <button type="button" className="m-back" onClick={() => jumpToModule('')}>
                ← 返回顶部
              </button>
            </div>

            {chs.length === 0 && (
              <div role="status" className="px-5 py-8 text-sm leading-7 text-slate-600">
                <p>{moduleAccess[modCode] ? '此模块暂无章节。' : '此模块暂未开放，请联系管理员核对岗位等级。'}</p>
                {isAdmin && <a href="/admin/knowledge" className="font-semibold text-indigo-700 underline">导入或新增章节</a>}
              </div>
            )}

            {/* 重挂横幅 */}
            {repin && (
              <div className="repin-banner">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900 }}>🔗 重新挂接素材{repin.chapterDeleted ? '（原章节已删除）' : ''}</div>
                    <div style={{ marginTop: 4 }}>
                      原锚点：<b>「{esc(repin.oldWord)}」</b> · {esc(repin.chapterLabel)}
                    </div>
                    {repin.chapterDeleted ? (
                      <div style={{ marginTop: 4 }}>
                        请在当前模块小节中<b>右键 / 长按</b>正文中的词挂接。
                      </div>
                    ) : repin.candidates.length > 0 ? (
                      <div style={{ marginTop: 4 }}>
                        已高亮 {repin.candidates.length} 个推荐词，<b>点击即可挂接</b>；也可右键/长按自行选词。
                      </div>
                    ) : (
                      <div style={{ marginTop: 4 }}>
                        未找到推荐词，请在正文里<b>右键 / 长按</b>选择新词挂接。
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={exitRepin} style={{ flexShrink: 0, borderRadius: 99, border: '1px solid var(--line)', background: '#fff', padding: '4px 12px', fontWeight: 800, cursor: 'pointer' }}>
                    取消
                  </button>
                </div>
              </div>
            )}

            {/* 编辑态工具条 + 版本面板 */}
            {editMode && editChapterId && (
              <>
                <div className="snap-panel" style={{ borderColor: '#34d399' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h4 style={{ margin: 0 }}>编辑小节（点击正文就地修改）</h4>
                    <button type="button" className="l-tool-btn primary" onClick={saveEdit} disabled={busy} style={{ marginLeft: 'auto' }}>
                      {busy ? '保存中…' : '保存'}
                    </button>
                    <button type="button" className="l-tool-btn" onClick={loadSnapshots} disabled={busy}>
                      历史版本
                    </button>
                    <button type="button" className="l-tool-btn danger" onClick={cancelEdit} disabled={busy}>
                      取消
                    </button>
                  </div>
                </div>
                {showSnapshots && (
                  <div className="snap-panel">
                    <h4>历史版本</h4>
                    {snapshots.length === 0 ? (
                      <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>暂无历史版本</p>
                    ) : (
                      snapshots.map((s) => (
                        <div key={s.id} className="snap-item">
                          <span>
                            v{s.version} · {new Date(s.created_at).toLocaleString('zh-CN')}
                          </span>
                          <button type="button" onClick={() => rollback(s.id)} disabled={busy}>
                            回滚到此版
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </>
            )}

            {/* 附录模块介绍卡片：把散落在 M1–M8 的模板/清单/工具/违规索引/表格汇总为可速查的五个附录 */}
            {modCode === 'APPENDIX' && (
              <div className="lesson" style={{ cursor: 'default' }}>
                <div className="lesson-body">
                  <div className="note" style={{ marginTop: 0 }}>
                    <b>本模块是全手册的「随用随查」工具箱：</b>
                    把分散在 M1–M8 的印尼语话术模板、检查清单、工具账号、违规规则索引和常用表格汇总到一处，
                    实战中直接复制套用。每份附录都标注了来源章节，需要完整 SOP 时可回到对应模块查看。
                  </div>
                  <div className="appendix-grid">
                    {[
                      { tag: '附录A', name: '印尼语模板库', desc: '申诉信 / 达人邀约 / 催更 / 爆款钩子 / 标题公式' },
                      { tag: '附录B', name: '检查清单合集', desc: '上架前自查、发货核对、申诉证据清单等' },
                      { tag: '附录C', name: '工具与账号清单', desc: '选品/数据/投流工具与后台账号入口' },
                      { tag: '附录D', name: '违规规则索引', desc: '违规词库与 M8 违规处理速查导航' },
                      { tag: '附录E', name: '表格模板', desc: '复盘表、预算表、进度表等可复制表格' },
                    ].map((a) => (
                      <div key={a.tag} className="ap-card">
                        <span className="a-tag">{a.tag}</span>
                        <h3>{a.name}</h3>
                        <p>{a.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 小节列表 */}
            {chs.map((c) => {
              const isEditing = editChapterId === c.id;
              return (
                <div
                  key={c.id}
                  ref={(el) => {
                    lessonRefs.current[c.id] = el;
                  }}
                  data-chapter={c.id}
                  id={c.section_no === '术语表' ? 'term-glossary' : undefined}
                  className={`lesson ${isEditing ? 'editing' : ''} ${flashLessonId === c.id ? 'is-flash' : ''}`}
                >
                  <div className="lesson-title">
                    <span className="lno">{esc(c.section_no)}</span>
                    <span>{esc(c.title)}</span>
                    {isAdmin && !isEditing && !repin && (
                      <span className="l-tools">
                        <button type="button" className="l-tool-btn" onClick={() => enterEdit(c.id)}>
                          编辑
                        </button>
                      </span>
                    )}
                    {c.materials.length > 0 && !isEditing && (
                      <span className="l-tools" style={{ color: 'var(--primary)', fontSize: 12, fontWeight: 800 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <span dangerouslySetInnerHTML={{ __html: materialChipSvg(c.materials.some((m) => m.file_type === 'video') ? 'video' : 'image') }} />
                          {c.materials.length} 素材
                        </span>
                      </span>
                    )}
                  </div>
                  <div
                    className="lesson-body"
                    contentEditable={isEditing}
                    suppressContentEditableWarning
                    data-placeholder="正文"
                    ref={(el) => {
                      lessonBodyRefs.current[c.id] = el;
                    }}
                    onClick={isEditing ? undefined : openViewer}
                    onContextMenu={isEditing ? undefined : onContext}
                    onTouchStart={isEditing ? undefined : onTouchStart}
                    onTouchMove={isEditing ? undefined : onTouchMove}
                    onTouchEnd={isEditing ? undefined : clearTimer}
                    onInput={isEditing ? () => syncDraft(c.id) : undefined}
                    {...(isEditing ? {} : { dangerouslySetInnerHTML: { __html: lessonHtml(c) } })}
                  />
                </div>
              );
            })}
          </section>
            <p style={{ textAlign: 'center', marginTop: 40, color: 'var(--ink-3)', fontSize: 13, fontWeight: 700 }}>公司内部培训资料 · 禁止外发截图</p>
          </main>
        );
      })}

      {/* 选词上传菜单 */}
      {menu && (
        <div className="word-menu" style={{ left: menu.x, top: menu.y, transform: 'translate(0, 8px)' }}>
          <div className="wm-word">「{esc(menu.word)}」</div>
          <button type="button" className="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ verticalAlign: -2, marginRight: 4 }} aria-hidden="true">
              <path d="M8 5.14v14l11-7-11-7z" />
            </svg>
            上传素材（视频 MP4/MOV≤{MAX_VIDEO_MB}MB / 图片≤{MAX_IMAGE_MB}MB）
          </button>
          <button type="button" className="muted" onClick={() => setMenu(null)}>
            取消
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov,image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) startUpload(f);
          e.target.value = '';
        }}
      />

      {uploading && (
        <div className="upload-card">
          <div className="uc-head">
            <span className="uc-name">{uploading.fileName}</span>
            <span className="uc-size">{formatSize(uploading.sizeMB * 1048576)}</span>
          </div>
          <div className="uc-bar">
            <div style={{ width: `${uploading.error ? 100 : uploading.percent}%`, opacity: uploading.error ? 0.25 : 1 }} />
          </div>
          {uploading.error ? (
            <div className="uc-error">
              {uploading.error}
              <button
                type="button"
                onClick={() => setUploading(null)}
                style={{ float: 'right', border: 0, background: 'transparent', color: 'var(--ink-3)', fontWeight: 800, cursor: 'pointer' }}
              >
                关闭
              </button>
            </div>
          ) : (
            <div className="uc-phase">
              {uploading.progressText || '上传中'} {uploading.percent}%
            </div>
          )}
        </div>
      )}

      {showToc && (
        <div className="toc-drawer" onClick={() => setShowToc(false)}>
          <div className="toc-panel" onClick={(e) => e.stopPropagation()}>
            <div className="toc-head">
              <span>章节目录</span>
              <button type="button" className="toc-close" onClick={() => setShowToc(false)} aria-label="关闭目录">✕</button>
            </div>
            <div className="toc-body" ref={tocBodyRef}>
              {MODULE_META.filter((m) => visibleModules.has(m.code)).map((m) => (
                <div key={m.code} className="toc-mod">
                  <div className={`toc-mod-name ${currentSection === m.code ? 'active' : ''}`} onClick={() => { setShowToc(false); jumpToModule(m.code); }}>
                    <span className="toc-dot" style={{ background: MOD_COLOR[m.code] ?? '#5B6CFF' }} />
                    {m.code === 'APPENDIX' ? '附录' : `${m.code}`} · {m.name}
                  </div>
                  <ul>
                    {moduleChapters(m.code).map((c) => (
                      <li key={c.id} data-chapter={c.id} className={(flashLessonId === c.id || activeLesson === c.id) ? 'active' : ''} onClick={() => jumpToChapter(c.id, m.code)}>
                        <span className="toc-no">{c.section_no}</span>
                        {c.title}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showFab && (
        <div className="fab fab-group">
          <button
            type="button"
            className="fab-btn fab-search"
            title="搜索"
            aria-label="搜索"
            onClick={() => { setSearchFabOpen(true); setSearchOpen(true); setShowSearchInput(true); setTimeout(() => searchFabInputRef.current?.focus(), 90); }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          </button>
          <button type="button" className="fab-btn" onClick={() => setShowToc(true)} title="打开目录" aria-label="打开目录">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          </button>
          <button type="button" className="fab-btn" onClick={scrollToTop} title="回到顶部" aria-label="回到顶部">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
        </div>
      )}

      {/* ===== 16.3 搜索浮层抽屉（点右下放大镜展开） ===== */}
      {searchFabOpen && (
        <div className="s-sheet-mask" onClick={() => setSearchFabOpen(false)}>
          <div className="s-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="s-sheet-bar">
              <svg className="s-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchFabInputRef}
                className="guide-search"
                placeholder="搜索关键词，如：冷启动、ROI、商品卡…"
                value={searchQ}
                onChange={(e) => { setSearchQ(e.target.value); setSearchOpen(true); }}
                onKeyDown={(e) => { if (e.key === 'Escape') setSearchFabOpen(false); }}
              />
              <button className="search-clear" type="button" aria-label="关闭" onClick={() => setSearchFabOpen(false)}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="s-sheet-results">
              {searchQ.trim() ? (
                searchResults.length === 0 ? (
                  <div className="s-empty">未找到「{searchQ}」相关内容</div>
                ) : (
                  <>
                    <div className="s-count">共 {searchResults.length} 条结果</div>
                    {searchResults.map((it) => (
                      <button
                        type="button"
                        key={it.id}
                        className="s-item"
                        onClick={() => { goSearchResult(it); setSearchFabOpen(false); }}
                      >
                        <span className="s-badge" style={{ background: metaOf(it.module)?.mc ? 'var(--primary-soft)' : '#eef0ff', color: metaOf(it.module)?.mc ? 'var(--primary-dark)' : '#5b6cffc0' }}>{it.no}</span>
                        <span className="s-body">
                          <span className="s-path">{it.big} · {it.sub}</span>
                          <span className="s-ctx" dangerouslySetInnerHTML={{ __html: it.ctx }} />
                        </span>
                      </button>
                    ))}
                  </>
                )
              ) : (
                <div className="s-empty">输入关键词，实时搜索全手册小节</div>
              )}
            </div>
          </div>
        </div>
      )}

      {editMode && editChapterId && (
        <div className="edit-float">
          <span className="edit-float-title">正在编辑本节 · 点击正文就地修改</span>
          <button type="button" className="l-tool-btn" onClick={() => insertImgRef.current?.click()} disabled={busy || imgUp.state === 'uploading'}>
            {imgUp.state === 'uploading' ? '上传中…' : '插图'}
          </button>
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp" ref={insertImgRef} style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onInsertImage(f); e.target.value = ''; }} />
          {imgUp.state === 'error' && <span className="edit-float-warn">{imgUp.err}</span>}
          <button type="button" className="l-tool-btn primary" onClick={saveEdit} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
          <button type="button" className="l-tool-btn" onClick={loadSnapshots} disabled={busy}>历史</button>
          <button type="button" className="l-tool-btn danger" onClick={cancelEdit} disabled={busy}>取消</button>
        </div>
      )}

      {termPop && (
        <div className="term-overlay open" onClick={() => setTermPop(null)}>
          <div className="term-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <button type="button" className="term-card-close" onClick={() => setTermPop(null)} aria-label="关闭术语卡片">
              ✕
            </button>
            <div className="term-card-head">
              <span className="tc-label">术语解释</span>
              <h4 className="tc-term">{termPop.title}</h4>
              {termPop.en && <i className="tc-en">{termPop.en}</i>}
            </div>
            <div className="term-card-body">
              <div className="manual-v2 lesson-body" dangerouslySetInnerHTML={{ __html: termPop.html }} />
              {(() => {
                const en = (termPop.en || '').toLowerCase();
                const mats = en
                  ? (data?.chapters ?? []).flatMap((ch) => ch.materials.filter((m) => m.word.toLowerCase() === en))
                  : [];
                if (!mats.length) return null;
                const allUrl = (m: { url: string | null }) => m.url ?? '';
                const imgUrls = mats.filter((m) => m.file_type === 'image').map(allUrl).filter(Boolean);
                return (
                  <div className="tc-mats">
                    <div className="tc-mats-title">相关素材（{mats.length}）</div>
                    <div className="tc-mats-row">
                      {mats.map((m) => (
                        <div
                          key={m.id}
                          className="tc-mat"
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            const word = termPop!.en;
                            if (m.file_type === 'video') {
                              setTermPop(null);
                              setViewer({ word, materials: mats, canDelete: isAdmin });
                            } else {
                              const idx = Math.max(0, imgUrls.indexOf(allUrl(m)));
                              setTermPop(null);
                              setLightbox({ list: imgUrls, index: idx });
                            }
                          }}
                        >
                          {m.file_type === 'image' ? (
                            <img src={allUrl(m)} alt="" loading="lazy" />
                          ) : (
                            <span className="tc-mat-play">▶</span>
                          )}
                          <span className="tc-mat-tag">{m.file_type === 'video' ? '视频' : '图片'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="term-card-foot">
              <button type="button" onClick={() => setTermPop(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {viewer && (
        <MaterialViewer
          state={viewer}
          onClose={() => setViewer(null)}
          onDeleted={(id) => {
            setData((d) =>
              d ? { ...d, chapters: d.chapters.map((c) => ({ ...c, materials: c.materials.filter((m) => m.id !== id) })) } : d,
            );
            setViewer((v) => (v ? { ...v, materials: v.materials.filter((m) => m.id !== id) } : v));
          }}
        />
      )}

      {lightbox && <ImageLightbox images={lightbox.list} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function PassphraseModal({ onDone, onClose }: { onDone: (msg: string) => void; onClose: () => void }) {
  const [np, setNp] = useState('');
  const [cf, setCf] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    if (np.length < 6 || np.length > 20) { setErr('密令长度需为 6-20 位'); return; }
    if (!/[A-Za-z]/.test(np) || !/\d/.test(np)) { setErr('密令需同时包含字母和数字'); return; }
    if (np !== cf) { setErr('两次输入的密令不一致'); return; }
    setBusy(true);
    try {
      const r = await changePassphrase(np, cf);
      onDone(r.message ?? '密令修改成功');
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '修改失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pp-overlay" onClick={onClose}>
      <div className="pp-card" onClick={(e) => e.stopPropagation()}>
        <div className="pp-title">修改密令</div>
        <div className="pp-sub">设置一个更好记的密令（6-20 位，需同时包含字母和数字），修改后原始密令仍可登录。</div>
        <input className="pp-input" type="text" autoFocus value={np} placeholder="新密令" onChange={(e) => setNp(e.target.value)} />
        <input className="pp-input" type="text" value={cf} placeholder="确认新密令" onChange={(e) => setCf(e.target.value)} />
        {err && <div className="pp-err">{err}</div>}
        <div className="pp-actions">
          <button type="button" className="pp-btn ghost" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="pp-btn primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}

export default function ManualPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm font-semibold text-slate-400">加载中…</div>}>
      <ManualPageInner />
    </Suspense>
  );
}
