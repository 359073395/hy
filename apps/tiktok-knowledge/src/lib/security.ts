import sanitizeHtmlLib from 'sanitize-html';

const svgTags = ['svg', 'defs', 'linearGradient', 'stop', 'g', 'rect', 'text', 'line', 'path'];
const svgPresentationAttributes = [
  'id', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'transform',
  'font-family', 'font-size', 'font-weight', 'text-anchor',
];
const svgPaint = /^(?:none|currentColor|transparent|[a-z]+|#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+\-/]+\)|url\(#[a-z_][\w.-]*\))$/i;

/**
 * 正文 XSS 消毒：保留正文、表格和静态 SVG 图表，移除可执行内容与 SVG 外部引用。
 * 用于管理端编辑保存时对正文做清洁。
 */
export function sanitizeContentHtml(dirty: string): string {
  return sanitizeHtmlLib(String(dirty ?? ''), {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr', 'blockquote', 'pre', 'code',
      'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'mark',
      'span', 'div', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
      'a',
      'img', 'figure', 'figcaption',
      ...svgTags,
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel', 'class', 'id', 'data-term'],
      img: ['src', 'alt', 'class', 'id', 'width', 'height'],
      div: ['class', 'id'], p: ['align', 'class', 'id'],
      h1: ['class', 'id'], h2: ['class', 'id'], h3: ['class', 'id'],
      h4: ['class', 'id'], h5: ['class', 'id'], h6: ['class', 'id'],
      span: ['class', 'id'], b: ['class'], strong: ['class'], i: ['class'],
      em: ['class'], u: ['class'], s: ['class'], mark: ['class'],
      blockquote: ['class', 'id'], pre: ['class', 'id'], code: ['class'],
      ul: ['class'], ol: ['class'], li: ['class'],
      table: ['width', 'class', 'id'], thead: ['class'], tbody: ['class'],
      tr: ['class'], td: ['colspan', 'rowspan', 'align', 'class'],
      th: ['colspan', 'rowspan', 'align', 'width', 'class'],
      br: [], hr: [], dl: ['class'], dt: ['class'], dd: ['class'], caption: ['class'],
      svg: ['viewBox', 'width', 'height', 'preserveAspectRatio', 'role', 'aria-label', 'style', ...svgPresentationAttributes],
      defs: ['id'],
      linearGradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform'],
      stop: ['offset', 'stop-color', 'stop-opacity'],
      g: svgPresentationAttributes,
      rect: ['x', 'y', 'width', 'height', 'rx', 'ry', ...svgPresentationAttributes],
      text: ['x', 'y', 'dx', 'dy', ...svgPresentationAttributes],
      line: ['x1', 'y1', 'x2', 'y2', ...svgPresentationAttributes],
      path: ['d', ...svgPresentationAttributes],
    },
    allowedStyles: {
      svg: {
        height: [/^auto$/],
        margin: [/^(?:0|\d+(?:\.\d+)?px)(?:\s+(?:0|\d+(?:\.\d+)?px)){0,3}$/],
      },
    },
    nonTextTags: ['style', 'script', 'textarea', 'option', 'foreignobject', 'foreignObject'],
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { a: ['http', 'https', 'mailto', 'tel'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
    allowProtocolRelative: false,
    transformTags: {
      '*': (tagName, attribs) => {
        // Keep the default case-insensitive HTML parser and restore SVG's case-sensitive names.
        if (tagName === 'lineargradient') tagName = 'linearGradient';
        if (svgTags.includes(tagName)) {
          const attributeNames: Record<string, string> = {
            viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio',
            gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform',
          };
          for (const [source, target] of Object.entries(attributeNames)) {
            if (attribs[source] !== undefined) {
              attribs[target] = attribs[source];
              delete attribs[source];
            }
          }
          for (const name of ['fill', 'stroke', 'stop-color']) {
            if (attribs[name] && !svgPaint.test(attribs[name].trim())) delete attribs[name];
          }
        }
        return { tagName, attribs };
      },
    },
  }).replace(/\n{3,}/g, '\n');
}
