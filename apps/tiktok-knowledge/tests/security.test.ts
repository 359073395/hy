import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeContentHtml } from '../src/lib/security';

test('static SVG charts retain geometry, local gradients, labels and responsive sizing', () => {
  const dirty = `<svg viewBox="0 0 1100 300" width="100%" role="img" style="height:auto;margin:10px 0 4px;">
    <defs><linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2BB5C9" stop-opacity=".22"/>
      <stop offset="1" stop-color="#2BB5C9" stop-opacity="0"/>
    </linearGradient></defs>
    <g font-family="system-ui" font-size="12" fill="#8a9096">
      <rect x="60" y="36" width="150" height="224" fill="#e5f4f6"/>
      <text x="135" y="24" text-anchor="middle" font-weight="700">Example stage</text>
    </g>
    <g stroke="#e4e1da" stroke-width="1"><line x1="60" y1="100" x2="1040" y2="100"/></g>
    <path d="M80,205 C130,210 180,215 230,190 Z" fill="url(#chart-gradient)"/>
    <path d="M80,205 C130,210 180,215 230,190" fill="none" stroke="#a8541f" stroke-width="2.2" stroke-dasharray="7 5"/>
  </svg>`;
  const clean = sanitizeContentHtml(dirty);
  assert.match(clean, /<svg [^>]*viewBox="0 0 1100 300"/);
  assert.match(clean, /<svg [^>]*width="100%"/);
  assert.match(clean, /<linearGradient id="chart-gradient"/);
  assert.match(clean, /<stop offset="0" stop-color="#2BB5C9" stop-opacity="\.22"/);
  assert.match(clean, /fill="url\(#chart-gradient\)"/);
  assert.match(clean, /d="M80,205 C130,210 180,215 230,190 Z"/);
  assert.match(clean, /stroke-dasharray="7 5"/);
  assert.match(clean, /text-anchor="middle" font-weight="700">Example stage<\/text>/);
  assert.match(clean, /style="height:auto;margin:10px 0 4px"/);
  assert.equal(sanitizeContentHtml(clean), clean);
});

test('SVG scripts, event handlers, foreign content and external references are removed', () => {
  const dirty = `<svg viewBox="0 0 10 10" onload="alert(1)" style="height:auto;background:url(https://evil.invalid/track);">
    <ScRiPt>alert('script')</ScRiPt>
    <foreignObject><p>foreign content</p><img src="https://evil.invalid/embed" onerror="alert(2)"></foreignObject>
    <image href="https://evil.invalid/image"/><use xlink:href="https://evil.invalid/symbol#id"/>
    <defs><linearGradient id="local" href="https://evil.invalid/gradient" xlink:href="javascript:alert(3)"></linearGradient></defs>
    <path d="M0 0 L10 10" fill="url(https://evil.invalid/fill)" stroke="url(//evil.invalid/stroke)" onclick="alert(4)"/>
    <path fill="url(&#x23;local)" stroke="url(data:image/svg+xml,bad)"/>
    <path fill="u\\72l(https://evil.invalid/escape)"/>
    <animate attributeName="href" values="javascript:alert(5)"/>
  </svg>`;
  const clean = sanitizeContentHtml(dirty);
  assert.doesNotMatch(clean, /script|alert|foreign|evil|<image|<use|<animate|onload|onclick|onerror|xlink|href|data:|background/i);
  assert.match(clean, /fill="url\(#local\)"/);
  assert.match(clean, /style="height:auto"/);
  assert.equal(sanitizeContentHtml(clean), clean);
});

test('HTML links and scripts remain sanitized with SVG support enabled', () => {
  const clean = sanitizeContentHtml('<P onclick="alert(1)">Text <A HREF="java&#x73;cript:alert(2)">unsafe</A><a href="https://example.com">safe</a></P><SCRIPT>bad()</SCRIPT>');
  assert.equal(clean, '<p>Text <a>unsafe</a><a href="https://example.com">safe</a></p>');
});
