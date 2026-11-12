'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChapterMaterial } from '@/lib/client';
import { api } from '@/lib/client';

export interface ViewerState {
  word: string;
  materials: ChapterMaterial[];
  canDelete: boolean; // 仅管理员
}

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 弹层存在期间锁定页面滚动，并拦截滚轮/触摸的默认滚动，防止穿透到背后章节（15.1） */
function useLockScrollAndWheel() {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const stop = (e: Event) => e.preventDefault(); // 阻止默认（页面滚动/双指缩放），但不 stopPropagation，让子级 React 手势正常
    const opts = { passive: false, capture: true } as AddEventListenerOptions;
    document.addEventListener('wheel', stop, opts);
    document.addEventListener('touchmove', stop, opts);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('wheel', stop, opts);
      document.removeEventListener('touchmove', stop, opts);
    };
  }, []);
}

/**
 * 图片查看：滚轮/按钮缩放、拖拽平移、双击还原、移动端双指缩放。
 * 性能：仅用 transform: translate3d() scale()（GPU 合成，不触发布局重排）；
 * 手势高频更新经 requestAnimationFrame 节流；容器 touch-action:none + will-change:transform。
 */
function ZoomableImage({ src, alt }: { src?: string; alt: string }) {
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [gesturing, setGesturing] = useState(false);
  // 用 ref 存放手势过程中的最新值，rAF 里统一 flush，避免每帧多次 setState
  const viewRef = useRef(view);
  const rafRef = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  // 固定基准双指缩放：首次双指落下记录 baseScale + startDist，整个手势期间 scale = baseScale * curDist/startDist，
  // startDist 绝不更新（否则退回逐帧增量，张开放大几帧后 scale 回缩抖动）。
  const pinch = useRef<{ baseScale: number; startDist: number } | null>(null);

  const clampScale = (s: number) => Math.min(5, Math.max(1, s));
  const flush = (next: { scale: number; tx: number; ty: number }) => {
    viewRef.current = next;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setView(viewRef.current);
    });
  };
  const reset = () => {
    drag.current = null;
    flush({ scale: 1, tx: 0, ty: 0 });
  };

  const wheel = (e: React.WheelEvent) => {
    e.preventDefault(); // 不穿透到页面
    e.stopPropagation();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    flush({ ...viewRef.current, scale: clampScale(viewRef.current.scale * factor) });
  };

  const pinchMove = (a: React.Touch, b: React.Touch) => {
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (!pinch.current) {
      pinch.current = { baseScale: viewRef.current.scale, startDist: dist };
      return;
    }
    if (pinch.current.startDist > 0) {
      flush({ ...viewRef.current, scale: clampScale((pinch.current.baseScale * dist) / pinch.current.startDist) });
    }
  };
  const pinchEnd = () => {
    pinch.current = null;
  };

  return (
    <div
      className="relative w-full overflow-hidden rounded select-none"
      style={{ minHeight: 200, touchAction: 'none' }}
      onWheel={wheel}
      onDoubleClick={reset}
      onTouchStart={(e) => {
        pinch.current = null;
        setGesturing(true);
        if (e.touches.length === 1) {
          drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
        }
      }}
      onTouchMove={(e) => {
        if (e.touches.length === 2) {
          pinchMove(e.touches[0], e.touches[1]);
        } else if (drag.current && e.touches.length === 1) {
          const dx = e.touches[0].clientX - drag.current.x;
          const dy = e.touches[0].clientY - drag.current.y;
          flush({ ...viewRef.current, tx: drag.current.tx + dx, ty: drag.current.ty + dy });
        }
      }}
      onTouchEnd={() => { pinchEnd(); setGesturing(false); }}
      onTouchCancel={() => { pinchEnd(); setGesturing(false); }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        setGesturing(true);
        drag.current = { x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
        (e.nativeEvent as PointerEvent).pointerId !== undefined && e.currentTarget.setPointerCapture?.((e.nativeEvent as PointerEvent).pointerId);
      }}
      onMouseMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x;
        const dy = e.clientY - drag.current.y;
        flush({ ...viewRef.current, tx: drag.current.tx + dx, ty: drag.current.ty + dy });
      }}
      onMouseUp={() => { drag.current = null; setGesturing(false); }}
      onMouseLeave={() => { drag.current = null; setGesturing(false); }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="w-full cursor-grab active:cursor-grabbing"
        style={{
          transform: `translate3d(${view.tx}px, ${view.ty}px, 0) scale(${view.scale})`,
          transformOrigin: 'center center',
          willChange: 'transform',
          transition: gesturing ? 'none' : 'transform 120ms ease-out',
        }}
      />
      <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-1 text-[11px] text-white">
        <span>{Math.round(view.scale * 100)}%</span>
        <button type="button" className="px-1 hover:text-emerald-300" onClick={() => flush({ ...viewRef.current, scale: clampScale(viewRef.current.scale * 1.2) })}>＋</button>
        <button type="button" className="px-1 hover:text-emerald-300" onClick={() => flush({ ...viewRef.current, scale: clampScale(viewRef.current.scale / 1.2) })}>－</button>
        {view.scale !== 1 && (
          <button type="button" className="px-1 hover:text-amber-300" onClick={reset}>还原</button>
        )}
      </div>
      {view.scale === 1 && <div className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[10px] text-white/70">鼠标滚轮缩放 · 拖拽平移 · 双击还原 · 支持手机双指缩放</div>}
    </div>
  );
}

/** 素材查看弹层：视频/图片（弹层打开期间锁定页面滚动 + 拦截滚轮穿透，15.1） */
export default function MaterialViewer({ state, onClose, onDeleted }: { state: ViewerState; onClose: () => void; onDeleted: (id: string) => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [lb, setLb] = useState<{ list: string[]; index: number } | null>(null);
  useLockScrollAndWheel();

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const remove = async (m: ChapterMaterial) => {
    setBusyId(m.id);
    setMsg('');
    try {
      await api(`/api/materials/${m.id}`, { method: 'DELETE' });
      onDeleted(m.id);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const imgList = state.materials.filter((m) => m.file_type === 'image' && m.url).map((m) => m.url as string);
  const imgIndex = (m: ChapterMaterial) => Math.max(0, imgList.findIndex((u) => u === m.url));

  // 18.1 预加载：素材弹层一打开就把图片预热进浏览器缓存，
  // 这样点图进 lightbox 时 <img> 立刻命中缓存、秒显（不再黑屏数秒）。
  useEffect(() => {
    imgList.forEach((u) => {
      const im = new Image();
      im.decoding = 'async';
      im.src = u;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgList.join('|')]);

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">
            「{esc(state.word)}」素材<span className="ml-2 text-slate-400">（{state.materials.length} 条）</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        {msg && <div className="mb-2 rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-600">{msg}</div>}
        <div className="space-y-4">
          {state.materials.length === 0 && <p className="text-sm text-slate-400">暂无素材。可在正文中选中词句后上传。</p>}
          {state.materials.map((m, i) => (
            <div
              key={m.id}
              className={`rounded-lg border border-slate-200 p-2 ${m.file_type === 'image' ? 'cursor-zoom-in' : ''}`}
              {...(m.file_type === 'image'
                ? {
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => setLb({ list: imgList, index: imgIndex(m) }),
                    onKeyDown: (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setLb({ list: imgList, index: imgIndex(m) });
                      }
                    },
                  }
                : {})}
            >
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                <span>素材 {i + 1} · {m.file_type === 'video' ? '视频' : '图片'}</span>
                {state.canDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(m);
                    }}
                    disabled={busyId === m.id}
                    className="text-rose-500 hover:text-rose-700 disabled:opacity-50"
                  >
                    {busyId === m.id ? '删除中…' : '删除'}
                  </button>
                )}
              </div>
              {m.file_type === 'video' ? (
                // 点击手势触发后立即自动播放；controls 提供进度条拖拽
                <video
                  key={`v-${m.id}`}
                  src={m.url ?? undefined}
                  controls
                  playsInline
                  autoPlay
                  preload="metadata"
                  className="w-full rounded"
                  onClick={(e) => (e.currentTarget.muted ? (e.currentTarget.muted = false) : undefined)}
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={m.url ?? undefined} alt={`素材 ${i + 1}`} className="w-full rounded" draggable={false} />
              )}
            </div>
          ))}
        </div>
      </div>
      {lb && imgList.length > 0 && (
        <ImageLightbox images={imgList} index={lb.index} onClose={() => setLb(null)} />
      )}
    </div>
  );
}

/**
 * 全屏黑底图片 lightbox（15.2）：
 * 多图左右切换、滚轮/双指缩放、单指拖动、双击还原、点空白/关闭/ESC 退出。
 * 打开期间锁定页面滚动 + 拦截滚轮触摸穿透（15.1）。
 */
export function ImageLightbox({ images, index, onClose }: { images: string[]; index: number; onClose: () => void }) {
  const list = images.length ? images : [];
  const [i, setI] = useState(() => Math.min(index, Math.max(0, list.length - 1)));
  // view：缩放/平移；手势高频经 ref + rAF 节流，仅改 transform（GPU 合成，60fps）
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [gesturing, setGesturing] = useState(false);
  const viewRef = useRef(view);
  const rafRef = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  // pinch 基准：双指落下时记录一次 baseScale + startDist，整个手势期间 scale = baseScale * curDist/startDist。
  // 禁止在 touchmove 里改 startDist（否则会退回"逐帧增量"：张开放大几帧后 scale 反而回缩抖动）。
  const pinch = useRef<{ baseScale: number; startDist: number } | null>(null);
  const touchX = useRef<number | null>(null);
  const tapTime = useRef(0);
  const swiped = useRef(false);

  const clampScale = (s: number) => Math.min(6, Math.max(1, s));
  const cur = list[i] ?? (list.length ? list[0] : '');

  useLockScrollAndWheel();

  const flush = (next: { scale: number; tx: number; ty: number }) => {
    viewRef.current = next;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setView(viewRef.current);
    });
  };

  const go = (ni: number) => {
    if (!list.length) return;
    drag.current = null;
    flush({ scale: 1, tx: 0, ty: 0 });
    setI((ni + list.length) % list.length);
  };
  const prev = () => go(i - 1);
  const next = () => go(i + 1);
  const reset = () => {
    drag.current = null;
    flush({ scale: 1, tx: 0, ty: 0 });
  };

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    // 18.1 预加载：当前图及前后图进缓存，保证切换/首开秒显（命中缓存时 naturalWidth 立即 >0）。
    if (!cur) return;
    [cur, list[(i + 1) % list.length], list[(i - 1 + list.length) % list.length]]
      .filter(Boolean)
      .forEach((u) => {
        const im = new Image();
        im.decoding = 'async';
        im.src = u;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, i, list]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(i - 1);
      else if (e.key === 'ArrowRight') go(i + 1);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, list.length]);

  if (!cur) return null;

  const scale = view.scale;

  return (
    <div
      className="lb-root"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="lb-count">{(list.length ? i + 1 : 0)} / {list.length || 0}</div>
      <button type="button" onClick={onClose} className="lb-close" aria-label="关闭">✕</button>

      <div
        className="lb-stage"
        onDoubleClick={() => (scale !== 1 ? reset() : flush({ ...viewRef.current, scale: clampScale(viewRef.current.scale * 2) }))}
        onWheel={(e) => {
          e.preventDefault();
          e.stopPropagation();
          flush({ tx: 0, ty: 0, scale: clampScale(viewRef.current.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)) });
        }}
        onTouchStart={(e) => {
          drag.current = null;
          pinch.current = null;
          touchX.current = null;
          swiped.current = false;
          setGesturing(true);
          if (e.touches.length === 1) {
            drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
            touchX.current = e.touches[0].clientX;
          } else if (e.touches.length === 2) {
            // 双指落下：记录一次基准（基准 scale = 手势开始的当前 view，基准距离 = 此刻两指间距），
            // 之后 touchmove 里绝不更新它，保证 scale 单调跟随起始距离比。
            pinch.current = {
              baseScale: viewRef.current.scale,
              startDist: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY),
            };
          }
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2) {
            const [a, b] = [e.touches[0], e.touches[1]];
            const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            // 固定基准：scale = baseScale * 当前间距 / 起始间距（startDist 由 touchstart 记录一次，绝不在此更新）。
            // 避免"逐帧增量"导致张开放大几帧后 scale 相对上一帧回缩、反复拉扯。
            if (pinch.current && pinch.current.startDist > 0) {
              flush({ ...viewRef.current, scale: clampScale((pinch.current.baseScale * dist) / pinch.current.startDist) });
            }
          } else if (drag.current && touchX.current !== null && e.touches.length === 1) {
            const dx = e.touches[0].clientX - drag.current.x;
            const dy = e.touches[0].clientY - drag.current.y;
            // 未放大时水平滑动 = 左右切换
            if (viewRef.current.scale <= 1.01 && !swiped.current) {
              const totalX = e.touches[0].clientX - touchX.current;
              if (Math.abs(totalX) > 48 && Math.abs(totalX) > Math.abs(dy) * 1.2) {
                swiped.current = true;
                go(totalX < 0 ? i + 1 : i - 1);
                return;
              }
            }
            flush({ ...viewRef.current, tx: drag.current.tx + dx, ty: drag.current.ty + dy });
          }
        }}
        onTouchEnd={(e) => {
          // 双击还原（两次 touchend 间隔 < 300ms 且未拖动）
          const now = Date.now();
          if (e.touches.length === 0 && drag.current && touchX.current !== null) {
            const moved = Math.hypot(
              (e.changedTouches[0]?.clientX ?? 0) - drag.current.x,
              (e.changedTouches[0]?.clientY ?? 0) - drag.current.y,
            );
            if (moved < 12) {
              if (now - tapTime.current < 300) {
                if (viewRef.current.scale > 1.01) reset();
                else flush({ ...viewRef.current, scale: clampScale(viewRef.current.scale * 2) });
                tapTime.current = 0;
              } else {
                tapTime.current = now;
              }
            }
          }
          pinch.current = null;
          touchX.current = null;
          drag.current = null;
          setGesturing(false);
        }}
        onTouchCancel={() => { pinch.current = null; touchX.current = null; drag.current = null; setGesturing(false); }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          setGesturing(true);
          drag.current = { x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
        }}
        onMouseMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x;
          const dy = e.clientY - drag.current.y;
          flush({ ...viewRef.current, tx: drag.current.tx + dx, ty: drag.current.ty + dy });
        }}
        onMouseUp={() => { drag.current = null; setGesturing(false); }}
        onMouseLeave={() => { drag.current = null; setGesturing(false); }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={cur}
          src={cur}
          alt=""
          draggable={false}
          decoding="async"
          fetchPriority="high"
          className="lb-img"
          style={{
            transform: `translate3d(${view.tx}px, ${view.ty}px, 0) scale(${view.scale})`,
            transformOrigin: 'center center',
            willChange: 'transform',
            transition: gesturing ? 'none' : 'transform 140ms ease-out',
          }}
        />
      </div>

      {list.length > 1 && (
        <>
          <button type="button" onClick={prev} className="lb-nav lb-nav-l" aria-label="上一张">‹</button>
          <button type="button" onClick={next} className="lb-nav lb-nav-r" aria-label="下一张">›</button>
        </>
      )}

      <div className="lb-ctrl">
        <button type="button" onClick={() => flush({ ...viewRef.current, scale: clampScale(viewRef.current.scale / 1.25) })} aria-label="缩小">－</button>
        <span>{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => flush({ ...viewRef.current, scale: clampScale(viewRef.current.scale * 1.25) })} aria-label="放大">＋</button>
        {scale !== 1 && <button type="button" onClick={reset}>还原</button>}
      </div>

      <div className="lb-hint">滚轮/双指缩放 · 拖动平移 · 双击还原 · {list.length > 1 ? '左右滑动/箭头切换 · ' : ''}ESC 或点空白退出</div>
    </div>
  );
}

export { esc };