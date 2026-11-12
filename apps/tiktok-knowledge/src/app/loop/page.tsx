'use client';

import { useEffect, useState } from 'react';
import './loop.css';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';

type ModuleRef = { code: string; name: string; color: string };
type Point = { text: string; to?: string };

type Station = {
  id: string;
  seq?: number;
  kind: 'station' | 'cross';
  cls: string;
  icon: React.ReactNode;
  part: string;
  name: string;
  sub: string;
  color: string;
  drive: string;
  modules: ModuleRef[];
  points: Point[];
  upstream: string;
  downstream: string;
};

/* ===== 实心汽车部件图标（currentColor） ===== */
function IconEngine() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {/* 真实汽车发动机：矩形缸体 + 顶部缸盖 + 进气管 + 火花塞 */}
      <rect x="4.5" y="9" width="15" height="8.5" rx="1.6" />
      <path d="M7 9V6.4h10V9" />
      <path d="M4.5 6.4V4h4v2.4M19.5 6.4V4h-4v2.4" />
      <path d="M9 4.6h6" />
      <path d="M12 6.4v-1.8" strokeWidth="1.3" />
      <path d="M4.5 11.6H3M20.5 11.6H21" />
      <path d="M7.3 17.5V21M7.3 17.5h-1.6M12 17.5V21M12 17.5h-1.6M16.7 17.5V21M16.7 17.5h-1.6" strokeWidth="1.3" />
    </svg>
  );
}
function IconFuel() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {/* 加油枪：把柄 + 枪管 + 弯曲喷油嘴 */}
      <path d="M18.6 3.2l2.4 2.7c.3.34.3.86 0 1.2l-1.3 1.5-.9-.8-.2.18a1.7 1.7 0 0 1-1.1.42v1.9h.7c.5.5.5 1.4 0 1.9v4.2a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2V6.9a3.4 3.4 0 0 1 3.4-3.4h5.6v-.3l.5-.13c.5-.13.98-.4 1.3-.74" />
      <path d="M7.8 5.6h2.2" strokeWidth="1.3" />
      <path d="M5 15h3.2" strokeWidth="1.3" opacity="0.7" />
      <path d="M10 19.4h6M10 19.4v1.6" strokeWidth="1.6" />
    </svg>
  );
}
function IconPedal() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {/* 加速踏板：立式踏板（略前倾）+ 底座 */}
      <path d="M10 3.5h4c1 0 1.8.7 2 1.7l1.8 6c.3 1 .5 2 .5 3v3.6a1 1 0 0 1-1 1H6.7a1 1 0 0 1-1-1v-3.6c0-1 .2-2 .5-3l1.8-6c.2-1 1-1.7 2-1.7z" />
      <path d="M8.6 11.2h6.8l1.1 3.6H7.5l1.1-3.6z" opacity="0.65" />
      <path d="M5 20.5h14" strokeWidth="2.2" />
      <path d="M7.5 20.5v-3M16.5 20.5v-3" strokeWidth="1.4" />
      <circle cx="12" cy="2.4" r="1.4" strokeWidth="1.7" />
    </svg>
  );
}
function IconDash() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
      {/* 仪表盘：一个圆 + 一个指针 */}
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 12 L8.6 16.4" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M12 16.8 V19.4 M8.6 15.8 L7 17.4 M15.4 15.8 L17 17.4" strokeWidth="1.2" opacity="0.7" />
    </svg>
  );
}
function IconWheel() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {/* 真实三辐方向盘：粗轮缘 + 三条辐条 + 中央圆盘 */}
      <circle cx="12" cy="12" r="8.6" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M12 12 V20.6" />
      <path d="M12 12 L5 14" />
      <path d="M12 12 L19 14" />
      <circle cx="12" cy="3.7" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="15.4" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="19.4" cy="15.4" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconGuard() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 1.8 3.5 5v5.7c0 5 3.6 9.3 8.5 10.5 4.9-1.2 8.5-5.5 8.5-10.5V5L12 1.8zm-1.2 13.3-2.8-2.8 1.3-1.3 1.5 1.5 3.9-3.9 1.3 1.3-5.2 5.2z" />
    </svg>
  );
}
function IconAI() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M14.7 2.5c.4 0 .8.3.8.8V4h1.3c1.5 0 2.7 1.2 2.7 2.7v1.3h.7c.4 0 .8.3.8.8v2.4c0 .4-.4.8-.8.8h-.7v1.3c0 1.5-1.2 2.7-2.7 2.7h-1.3v.7c0 .4-.4.8-.8.8h-2.4c-.4 0-.8-.4-.8-.8V16h-.9v.7c0 .4-.4.8-.9.8H7.4c-.5 0-.9-.4-.9-.8V16H5.2c-1.5 0-2.7-1.2-2.7-2.7V12h-.7c-.4 0-.8-.4-.8-.8V8.8c0-.5.4-.8.8-.8h.7V6.7C3.3 5.2 4.5 4 6 4h1.3v-.7c0-.5.4-.8.9-.8h2.4c.5 0 .9.3.9.8V4h.9v-.7c0-.5.4-.8.8-.8h1.5zM8.6 7.9c-.9 0-1.6.7-1.6 1.6v.3h-.3c-.9 0-1.6.7-1.6 1.6v1.2c0 .9.7 1.6 1.6 1.6h.3v.3c0 .9.7 1.6 1.6 1.6h1.2c.9 0 1.6-.7 1.6-1.6v-.3h.3c.9 0 1.6-.7 1.6-1.6v-1.2c0-.9-.7-1.6-1.6-1.6h-.3v-.3c0-.9-.7-1.6-1.6-1.6H8.6zm.6 2.3v3.6l3.1-1.8-3.1-1.8z" />
    </svg>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  engine: <IconEngine />, fuel: <IconFuel />, pedal: <IconPedal />,
  dash: <IconDash />, wheel: <IconWheel />, guard: <IconGuard />, ai: <IconAI />,
};

/* 循环光带：沿环带中线顺时针流动的一条金色光带（替代旧的多条关系线） */

/* ===== 立体厚壁圆环几何（视角后倒 20°：更扁、更平视，单位 0–100，圆心 50,50）===== */
const RING = {
  cx: 50,
  cy: 50,
  rxO: 50,    // 外椭圆水平半径（放大铺满）
  ryO: 20,    // 外椭圆垂直半径（≈0.40，视角压低后椭圆更扁）
  rxI: 31,    // 内椭圆水平半径
  ryI: 12.4,  // 内椭圆垂直半径（与外椭圆同比 0.62 → 0.40）
  depth: 7, // 侧壁厚度（屏幕向下；压扁视角下按比例收敛，避免侧壁过厚失真）
  sweep: 60,  // 每段弧度
  gap: 12,    // 段间缺口（5*60 + 5*12 = 360）
};
type RingSeg = {
  id: string;
  color: string;
  mid: number;
  top: string;        // 顶面环形扇
  topX: number; topY: number; // 顶面径向中心（关系线锚点）
  iconX: number; iconY: number; // 图标（顶面偏外，避开中心司机）
  labelX: number; labelY: number; // 环外标签
  zOrder: number;
};
/* 伪透视：屏幕 y 越靠下（离观众越近）整体放大、越靠上（远）收缩 → 前大后小。
   所有几何（顶面/外壁/内壁/切面/光带/组合钮锚点）统一经 ell() 计算而自动跟随，
   缩放中心取环心 (cx, cy)，中心司机与 hub 不受影响。 */
const PERSP = 0.13;
function perspF(y: number) {
  return 1 + (PERSP * (y - RING.cy)) / RING.ryO;
}
function ell(rx: number, ry: number, deg: number) {
  const r = (deg * Math.PI) / 180;
  const x = RING.cx + rx * Math.cos(r);
  const y = RING.cy + ry * Math.sin(r);
  const f = perspF(y);
  return { x: RING.cx + (x - RING.cx) * f, y: RING.cy + (y - RING.cy) * f, f };
}
function annularSector(a0: number, a1: number, rxO: number, ryO: number, rxI: number, ryI: number) {
  /* 采样生成完整闭合环形扇区，避免单条 A 弧跨象限 flag 翻转导致顶面残缺 */
  const N = 24;
  const pts: string[] = [];
  for (let i = 0; i < N; i++) {
    const p = ell(rxO, ryO, a0 + ((a1 - a0) * i) / (N - 1));
    pts.push(`${i === 0 ? 'M' : 'L'} ${p.x.toFixed(3)} ${p.y.toFixed(3)}`);
  }
  const i1 = ell(rxI, ryI, a1);
  pts.push(`L ${i1.x.toFixed(3)} ${i1.y.toFixed(3)}`);
  for (let i = N - 1; i >= 0; i--) {
    const p = ell(rxI, ryI, a0 + ((a1 - a0) * i) / (N - 1));
    pts.push(`L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`);
  }
  pts.push('Z');
  return pts.join(' ');
}
function buildRing(ids: { id: string; color: string }[]): RingSeg[] {
  const start0 = -90 - RING.sweep / 2; // 第一段居中正上方
  return ids.map((it, i) => {
    const a0 = start0 + i * (RING.sweep + RING.gap);
    const a1 = a0 + RING.sweep;
    const mid = (a0 + a1) / 2;
    const top = annularSector(a0, a1, RING.rxO, RING.ryO, RING.rxI, RING.ryI);
    const mt = ell((RING.rxO + RING.rxI) / 2, (RING.ryO + RING.ryI) / 2, mid);
    // 图标放在顶面径向约 76% 处（偏外），与中心司机拉开距离
    const iconPos = ell(RING.rxI + (RING.rxO - RING.rxI) * 0.76, RING.ryI + (RING.ryO - RING.ryI) * 0.76, mid);
    // 左右两侧标签向内收，避免出界；整体贴近环带（与图标形成组）
    const absX = Math.abs(Math.cos((mid * Math.PI) / 180));
    const lblRx = RING.rxO + 2.5 - absX * 4;
    const lblRy = RING.ryO + 8;
    const ml = ell(lblRx, lblRy, mid);
    return {
      id: it.id,
      color: it.color,
      mid,
      top,
      topX: mt.x,
      topY: mt.y,
      iconX: iconPos.x,
      iconY: iconPos.y,
      labelX: ml.x,
      labelY: ml.y,
      zOrder: mt.y,
    };
  });
}

/* 朝外弧片向下挤出，形成环块外侧壁。
   采样多点沿外椭球面生成，顶部沿 a0→a1、底部反向，杜绝 A 弧跨象限 flag 翻转。 */
function annularExtrudeFull(a0: number, a1: number) {
  const N = 24;
  const pts: string[] = [];
  const o0 = ell(RING.rxO, RING.ryO, a0);
  pts.push(`M ${o0.x.toFixed(3)} ${o0.y.toFixed(3)}`);
  for (let i = 1; i < N; i++) {
    const p = ell(RING.rxO, RING.ryO, a0 + ((a1 - a0) * i) / (N - 1));
    pts.push(`L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`);
  }
  const p1 = ell(RING.rxO, RING.ryO, a1);
  pts.push(`L ${p1.x.toFixed(3)} ${(RING.cy + (p1.y + RING.depth - RING.cy) * p1.f).toFixed(3)}`);
  for (let i = N - 2; i >= 0; i--) {
    const p = ell(RING.rxO, RING.ryO, a0 + ((a1 - a0) * i) / (N - 1));
    pts.push(`L ${p.x.toFixed(3)} ${(RING.cy + (p.y + RING.depth - RING.cy) * p.f).toFixed(3)}`);
  }
  pts.push('Z');
  return pts.join(' ');
}

/* 单个径向切面（缺口处的竖直厚度面）：在外/内半径同角度处向下挤出 */
function radialCut(deg: number) {
  const o = ell(RING.rxO, RING.ryO, deg);
  const i = ell(RING.rxI, RING.ryI, deg);
  const bo = { x: o.x, y: RING.cy + (o.y + RING.depth - RING.cy) * o.f };
  const bi = { x: i.x, y: RING.cy + (i.y + RING.depth - RING.cy) * i.f };
  return [
    `M ${o.x} ${o.y}`,
    `L ${i.x} ${i.y}`,
    `L ${bi.x} ${bi.y}`,
    `L ${bo.x} ${bo.y}`,
    'Z',
  ].join(' ');
}

/* 内壁：沿内弧向下挤出（补齐环内侧厚度，消除内圈露背景的断裂感）。
   顶边沿 a0→a1、底边反向，与前半圈顶面内缘共享边界、无缝衔接。 */
function annularInnerExtrude(a0: number, a1: number) {
  const N = 24;
  const pts: string[] = [];
  const i0 = ell(RING.rxI, RING.ryI, a0);
  pts.push(`M ${i0.x.toFixed(3)} ${i0.y.toFixed(3)}`);
  for (let i = 1; i < N; i++) {
    const p = ell(RING.rxI, RING.ryI, a0 + ((a1 - a0) * i) / (N - 1));
    pts.push(`L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`);
  }
  const p1 = ell(RING.rxI, RING.ryI, a1);
  pts.push(`L ${p1.x.toFixed(3)} ${(RING.cy + (p1.y + RING.depth - RING.cy) * p1.f).toFixed(3)}`);
  for (let i = N - 2; i >= 0; i--) {
    const p = ell(RING.rxI, RING.ryI, a0 + ((a1 - a0) * i) / (N - 1));
    pts.push(`L ${p.x.toFixed(3)} ${(RING.cy + (p.y + RING.depth - RING.cy) * p.f).toFixed(3)}`);
  }
  pts.push('Z');
  return pts.join(' ');
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="#fff" aria-hidden>
      <path d="M16 3v10.55A4 4 0 1 0 18 17V7h-6V3h4z" />
    </svg>
  );
}

export default function LoopOverviewPage() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    api<{ stations: Omit<Station, 'icon'>[] }>('/api/loop')
      .then((result) => {
        if (!cancelled) setStations(result.stations.map((s) => ({ ...s, icon: ICONS[s.id] ?? <IconEngine /> })));
      })
      .catch((error: Error & { status?: number }) => {
        if (cancelled) return;
        if (error.status === 401) router.replace('/');
        else setLoadError(error.message);
      })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [router]);
  if (!loaded || stations.length === 0) return (
    <main className="p-8 text-center">
      <p>{loadError || (loaded ? '请管理员在知识库管理中导入带有闭环图的知识包。' : '正在加载闭环图…')}</p>
      <a href="/manual" className="text-indigo-600 underline">返回手册</a>
    </main>
  );

  const active = stations.find((s) => s.id === activeId) ?? stations[0];
  const ringStations = stations.filter((s) => s.kind === 'station');
  const crossCards = stations.filter((s) => s.kind === 'cross');

  // 立体圆环几何（按 ringStations 顺序，发动机起顺时针）
  const segs = buildRing(ringStations.map((s) => ({ id: s.id, color: s.color })));
  const segById = new Map(segs.map((g) => [g.id, g]));
  // 关系线锚点：用各段顶面中心
  const bandRX = (RING.rxO + RING.rxI) / 2;
  const bandRY = (RING.ryO + RING.ryI) / 2;
  // 流星巡航路径：沿环带中线顺时针采样一圈（闭合），72 点数组供彗尾取子段
  const bandPts: { x: number; y: number }[] = [];
  for (let i = 0; i < 72; i++) {
    bandPts.push(ell(bandRX, bandRY, -120 + (360 * i) / 72));
  }
  const bandPath = 'M ' + bandPts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ') + ' Z';
  // 流星巡航周期（仅发光头球，无彗尾）
  const COMET_DUR = 5;
  // 绘制顺序：靠后的段先画（y 小在上=远），保证侧壁前后遮挡正确
  const ordered = [...segs].sort((a, b) => a.zOrder - b.zOrder);

  return (
    <div className="loop-page">
      <div className="lp-topbar">
        <div className="lp-topbar-inner">
          <span className="lp-logo">
            <NoteIcon />
          </span>
          <span className="lp-brand">
            TikTok Shop 运营指南
            <small>带货闭环总览 · Knowledge Loop</small>
          </span>
          <a className="lp-back" href="/manual">
            返回手册
          </a>
        </div>
      </div>

      {/* 目的地：成交增长（页面右上角空白区，topbar 下方） */}
      <div className="lp-dest">
        <svg viewBox="0 0 24 24" aria-hidden className="lp-pin">
          <path d="M12 2C7.6 2 4 5.6 4 10c0 5.6 6.4 13 8 13s8-7.4 8-13c0-4.4-3.6-8-8-8z" fill="#e8593c" />
          <circle cx="12" cy="10" r="3.2" fill="#fff" />
        </svg>
        <span>目的地 · 成交增长</span>
      </div>

      <div className="lp-wrap">
        <div className={`lp-grid${activeId ? ' is-split' : ''}`}>
          {/* 3D 立体环 */}
          <div className={`lp-stage-wrap${activeId ? ' is-shrunk' : ' is-hero'}`}>
            <div className="lp-stage">
              <div className="lp-floor" />

              {/* 中心：3D 卡通司机（白底抠图透明，无任何底色） */}
              <div className="lp-hub">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="lp-yoyo" src="/driver-cut.png" alt="司机·运营" />
              </div>

              {/* 立体厚壁分段圆环（俯视） */}
              <svg
                className="lp-ring3d"
                viewBox="0 18 100 68"
                preserveAspectRatio="none"
                role="group"
                aria-label="带货闭环五段立体环"
              >
                <defs>
                  {segs.map((g) => (
                    <linearGradient key={`tg-${g.id}`} id={`top-${g.id}`} gradientUnits="userSpaceOnUse" x1="12" y1="22" x2="88" y2="84">
                      <stop offset="0%" stopColor={g.color} stopOpacity="1" />
                      <stop offset="55%" stopColor={g.color} stopOpacity="0.92" />
                      <stop offset="100%" stopColor={g.color} stopOpacity="0.74" />
                    </linearGradient>
                  ))}
                </defs>

                {/* 整体地面投影（环下方统一椭圆柔影，略向右下偏移，落在台面上） */}
                <ellipse
                  className="ring-ground"
                  cx={RING.cx + 2}
                  cy={RING.cy + RING.ryO + RING.depth - 1}
                  rx={RING.rxO - 2}
                  ry={RING.depth * 0.95}
                />

                {/* 侧壁系统：各段外层弧壁 + 内层弧壁 + 缺口两端径向切面。
                   上半圈也渲染外壁/内壁与缺口切面，保证环块结构完整（被前方段遮挡属正常透视）。 */}
                {ordered.map((g) => {
                  const idx = ringStations.findIndex((s) => s.id === g.id);
                  const st = ringStations[idx];
                  const a0 = -90 - RING.sweep / 2 + idx * (RING.sweep + RING.gap);
                  const a1 = a0 + RING.sweep;
                  // 侧壁：沿整段外弧挤出（覆盖全圈，后半圈被顶面盖住亦正确）
                  const c0 = a0;
                  const c1 = a1;
                  return (
                    <g key={`wall-${st.id}`}>
                      {c1 > c0 && (
                        <path
                          className="seg-wall outer"
                          d={annularExtrudeFull(c0, c1)}
                          fill={st.color}
                          style={{ opacity: 1 }}
                        />
                      )}
                      {/* 内壁：沿内弧向下挤出，补齐环内侧厚度 */}
                      {c1 > c0 && (
                        <path
                          className="seg-wall inner"
                          d={annularInnerExtrude(c0, c1)}
                          fill={st.color}
                          style={{ opacity: 1 }}
                        />
                      )}
                      {/* 缺口两端的径向竖直切面：上下半圈都画，补齐环块结构 */}
                      {<path className="seg-wall cut" d={radialCut(a0)} fill={st.color} />}
                      {<path className="seg-wall cut" d={radialCut(a1)} fill={st.color} />}
                    </g>
                  );
                })}

                {/* 5 段顶面：靠后→靠前，保证遮挡正确 */}
                {ordered.map((g) => {
                  const st = ringStations.find((s) => s.id === g.id)!;
                  const isOn = activeId === g.id;
                  return (
                    <g
                      key={g.id}
                      className={`ring-seg ${isOn ? 'is-active' : ''}`}
                      style={{ ['--seg' as string]: g.color }}
                    >
                      <path
                        className="seg-top"
                        d={g.top}
                        fill={`url(#top-${g.id})`}
                      />
                      </g>
                  );
                })}
              </svg>

              {/* 循环光带：沿环带中线顺时针流动的一条金色光带（五个模块之间穿棱） */}
              <svg className="lp-bandlayer" viewBox="0 18 100 68" preserveAspectRatio="none" aria-hidden>
                <defs>
                  <radialGradient id="cometGrad">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="42%" stopColor="#ffe9b0" />
                    <stop offset="100%" stopColor="#ffb44d" stopOpacity="0" />
                  </radialGradient>
                </defs>
                {/* 发光头球（白核+暖金光晕，沿环带截面中线顺时针巡航） */}
                <circle className="comet-head" r="2.6" fill="url(#cometGrad)">
                  <animateMotion dur={`${COMET_DUR}s`} begin={`-${COMET_DUR}s`} repeatCount="indefinite" path={bandPath} />
                </circle>
                <circle className="comet-core" r="0.95" fill="#ffffff">
                  <animateMotion dur={`${COMET_DUR}s`} begin={`-${COMET_DUR}s`} repeatCount="indefinite" path={bandPath} />
                </circle>
              </svg>

              {/* 环外「图标+标题」组合钮：图标与文字一体可点，锚定环带外缘（顶部段横排防越界） */}
              {segs.map((g) => {
                const st = ringStations.find((s) => s.id === g.id)!;
                const isOn = activeId === g.id;
                const [arx, ary] = g.id === 'engine' ? [RING.rxO + 4, RING.ryO + 8.5] : [RING.rxO + 6, RING.ryO + 6.5];
                const anchor = ell(arx, ary, g.mid);
                const lx = Math.min(90, Math.max(10, anchor.x));
                const ty = Math.min(84, Math.max(6, ((anchor.y - 18) / 68) * 100));
                return (
                  <div key={g.id} className="ring-node">
                    <button
                      type="button"
                      className={`rh-group ${g.id} ${isOn ? 'is-active' : ''}`}
                      style={{ left: `${lx}%`, top: `${ty}%`, ['--rc' as string]: g.color }}
                      onClick={() => setActiveId(activeId === g.id ? null : g.id)}
                      aria-pressed={isOn}
                      aria-label={`${st.part} ${st.name}`}
                    >
                      <span className="rh-ico">{st.icon}</span>
                      <span className="rh-t">
                        <b>{st.name}</b>
                        <small>{st.part}</small>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

            {/* 详情卡（拆分时作为右侧列；未点击时隐藏） */}
            {activeId && active && (
            <aside className="lp-detail open" style={{ ['--dc' as string]: active.color }}>
              <button type="button" className="lp-detail-close" onClick={() => setActiveId(null)} aria-label="关闭卡片">×</button>
              <div className="lp-detail-head">
                <div className="d-part">{active.part}</div>
                <h2>{active.name}</h2>
                <p className="d-drive">{active.drive}</p>
              </div>
              <div className="lp-detail-body">
                <a
                  className="lp-detail-cta"
                  href={(() => {
                    const c = active.modules[0]?.code ?? '';
                    return /^M[1-8]$/i.test(c) || c.toLowerCase() === 'appendix'
                      ? `/manual#${c.toUpperCase()}`
                      : `/manual#${c}`;
                  })()}
                >
                  在手册中打开「{active.name}」章节 →
                </a>
                <h3>对应手册模块 <span className="lp-mod-hint">（可点击下钻）</span></h3>
                <div className="lp-modules">
                  {active.modules.map((m) => {
                    const target = /^M[1-8]$/i.test(m.code) || m.code.toLowerCase() === 'appendix'
                      ? `/manual#${m.code.toUpperCase()}`
                      : `/manual#${m.code}`;
                    return (
                      <a key={m.code} className="lp-chip" href={target} style={{ ['--mc' as string]: m.color }}>
                        <i>{m.code}</i> {m.name}
                      </a>
                    );
                  })}
                </div>

                <h3>关键知识点 <span className="lp-mod-hint">（点击下钻到手册小节）</span></h3>
                <ul className="lp-points">
                  {active.points.map((p, i) =>
                    typeof p === 'string' ? (
                      <li key={i}>{p}</li>
                    ) : (
                      <li key={i}>
                        {p.text}
                        {p.to && (
                          <a className="lp-drill" href={`/manual#${p.to}`}>
                            #{p.to}
                          </a>
                        )}
                      </li>
                    ),
                  )}
                </ul>

                <h3>在闭环里的关系</h3>
                <div className="lp-flow">
                  <span className="tag">上游：{active.upstream}</span>
                  <span className="arrow">→</span>
                  <span className="tag">下游：{active.downstream}</span>
                </div>

                <div className="lp-drill-hint">
                    可下钻：点击上方「对应手册模块」或每条知识点后的 <span className="lp-drill-inline">#小节号</span>，会跳到手册对应章节定位阅读。知识点的「影响关系」看下方上游/下游与车环上各部件。
                  </div>
              </div>
            </aside>
            )}

            {/* 横切层 */}
            <div className="lp-cross">
              {crossCards.map((s) => {
                const c0 = s.modules?.[0]?.code ?? '';
                const crossTarget = /^M[1-8]$/i.test(c0) || c0.toLowerCase() === 'appendix'
                  ? `/manual#${c0.toUpperCase()}`
                  : `/manual#${c0}`;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`lp-cross-card ${s.cls} ${activeId === s.id ? 'is-active' : ''}`}
                    style={{ ['--cc' as string]: s.color }}
                    onClick={() => setActiveId(s.id)}
                    aria-pressed={activeId === s.id}
                  >
                    <span className="cico">{s.icon}</span>
                    <span className="cc-main">
                      <b>{s.name}</b>
                      <small>{s.part}｜{s.sub}</small>
                      <a className="lp-cross-cta" href={crossTarget} onClick={(e) => e.stopPropagation()}>
                        进入 {c0} 章节 →
                      </a>
                    </span>
                  </button>
                );
              })}
            </div>


      </div>
    </div>
    </div>
  );
}
