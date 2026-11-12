// 素材标记字符串注入器
// 在「渲染管线」内把锚点词/重挂候选词打进 HTML 字符串，随 React 渲染持久化，
// 彻底替代 post-DOM TreeWalker 打标——任何重渲染、翻章、播放弹窗开合、刷新后都稳定存在。
// 仅在客户端执行（依赖 document）；SSR 首帧渲染原始 html，客户端挂载后再标记。

export function materialChipSvg(type?: string): string {
  const c = 'mk-ic';
  switch ((type || 'file').toLowerCase()) {
    case 'video':
    case 'mp4':
    case 'mov':
      // 播放三角
      return `<svg class="${c}" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
    case 'image':
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
      // 图片图标
      return `<svg class="${c}" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 11.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"/></svg>`;
    default:
      // 文档/文件
      return `<svg class="${c}" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h7v2zm0-3h-1V4h1v5z"/></svg>`;
  }
}

export interface MarkTarget {
  word: string;
  className: string;
  chip?: string; // inline SVG html，仅该词首次出现的节点段挂
  attr?: Record<string, string>;
}

export function injectWordMarkers(html: string, targets: MarkTarget[]): string {
  if (!html || targets.length === 0) return html;
  const box = document.createElement('div');
  box.innerHTML = html;
  const root = box;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.closest('.mat-anchor, .mat-chip, .repin-cand, .term-hl, a.term-link, script, style')) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  interface Seg {
    node: Text;
    text: string;
    start: number;
    end: number;
  }
  const segs: Seg[] = [];
  let cur: Node | null;
  while ((cur = walker.nextNode())) {
    const node = cur as Text;
    const text = node.nodeValue ?? '';
    const start = segs.length ? segs[segs.length - 1].end + 1 : 0;
    segs.push({ node, text, start, end: start + text.length });
  }
  if (segs.length === 0) return html;

  const globalRaw = segs.map((s) => s.text).join(' ');
  const map: number[] = [];
  let norm = '';
  let prevSpace = false;
  for (let i = 0; i < globalRaw.length; i++) {
    const ch = globalRaw[i];
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        norm += ' ';
        map.push(i);
      }
      prevSpace = true;
    } else {
      norm += ch.toLowerCase();
      map.push(i);
      prevSpace = false;
    }
  }

  const wanted = targets
    .map((t) => ({ ...t, nword: t.word.toLowerCase().replace(/\s+/g, ' ').trim() }))
    .filter((t) => t.nword.length > 0);
  if (wanted.length === 0) return html;

  const hits: { word: string; cls: string; chip?: string; attr?: Record<string, string>; nStart: number; nEnd: number }[] = [];
  const claimed = new Set<number>();
  for (const w of wanted) {
    let from = 0;
    while (true) {
      const idx = norm.indexOf(w.nword, from);
      if (idx < 0) break;
      let overlap = false;
      for (let k = idx; k < idx + w.nword.length; k++) {
        if (claimed.has(k)) {
          overlap = true;
          break;
        }
      }
      if (!overlap) {
        for (let k = idx; k < idx + w.nword.length; k++) claimed.add(k);
        hits.push({ word: w.word, cls: w.className, chip: w.chip, attr: w.attr, nStart: idx, nEnd: idx + w.nword.length });
      }
      from = idx + w.nword.length;
    }
  }
  if (hits.length === 0) return html;
  hits.sort((a, b) => a.nStart - b.nStart);

  const rawRanges = hits.map((h) => ({
    ...h,
    gStart: map[h.nStart] ?? globalRaw.length,
    gEnd: (map[Math.min(h.nEnd - 1, map.length - 1)] ?? globalRaw.length - 1) + 1,
  }));

  for (const seg of segs) {
    const segHits = rawRanges
      .filter((h) => h.gStart < seg.end && h.gEnd > seg.start)
      .map((h) => ({
        ...h,
        localStart: Math.max(h.gStart, seg.start) - seg.start,
        localEnd: Math.min(h.gEnd, seg.end) - seg.start,
      }))
      .sort((a, b) => a.localStart - b.localStart);
    if (segHits.length === 0) continue;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const h of segHits) {
      if (h.localStart < cursor) continue;
      if (cursor < h.localStart) frag.appendChild(document.createTextNode(seg.text.slice(cursor, h.localStart)));
      const span = document.createElement('span');
      span.className = h.cls;
      span.setAttribute('data-word', h.word);
      span.setAttribute('data-hit', String(h.gStart));
      if (h.cls === 'repin-cand') span.setAttribute('title', '点击把素材挂到「' + h.word + '」');
      if (h.attr) for (const [k, v] of Object.entries(h.attr)) span.setAttribute(k, v);
      span.appendChild(document.createTextNode(seg.text.slice(h.localStart, h.localEnd)));
      if (h.chip && h.gStart >= seg.start) {
        const chip = document.createElement('span');
        chip.className = 'mat-chip';
        chip.innerHTML = h.chip;
        span.appendChild(chip);
      }
      frag.appendChild(span);
      cursor = h.localEnd;
    }
    if (cursor < seg.text.length) frag.appendChild(document.createTextNode(seg.text.slice(cursor)));
    seg.node.parentNode?.replaceChild(frag, seg.node);
  }

  return box.innerHTML;
}