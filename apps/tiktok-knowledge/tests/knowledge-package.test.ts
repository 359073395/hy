import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareKnowledge } from '../src/lib/server/knowledge-import';
import { loopSchema } from '../src/lib/knowledge-package';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=';
const chapter = { module: 'M1', sectionNo: '1.1', title: 'Test', sortOrder: 1, isPublic: false, html: '<p>Test</p>' };

test('private inline images become durable content-addressed references', () => {
  const result = prepareKnowledge({ schemaVersion: 1, chapters: [{ ...chapter, html: '<p onclick="alert(1)">Safe</p><script>alert(2)</script><img src="/notes/test.png">' }], assets: [{ path: 'notes/test.png', contentType: 'image/png', base64: png }] });
  assert.match(result.pack.chapters[0].html, /\/api\/files\/knowledge-assets\/[a-f0-9]{64}\.png/);
  assert.doesNotMatch(result.pack.chapters[0].html, /onclick|<script/);
  assert.equal(result.assets[0].bytes.toString('base64'), png);
});

test('missing assets and paths outside the import namespace are rejected', () => {
  assert.throws(() => prepareKnowledge({ schemaVersion: 1, chapters: [{ ...chapter, html: '<img src="/notes/missing.png">' }] }), /缺少图片/);
  assert.throws(() => prepareKnowledge({ schemaVersion: 1, assets: [{ path: 'notes/../../secret.png', contentType: 'image/png', base64: png }] }));
  assert.throws(() => prepareKnowledge({ schemaVersion: 1, assets: [{ path: 'notes/test.png', contentType: 'image/png', base64: Buffer.from('<script>bad</script>').toString('base64') }] }), /类型不符/);
});

test('ambiguous chapters and malformed objective answers cannot be imported', () => {
  assert.throws(() => prepareKnowledge({ schemaVersion: 1, chapters: [chapter, chapter] }), /重复/);
  assert.throws(() => prepareKnowledge({ schemaVersion: 1, exams: [{ code: 'ops_assistant', name: 'Test', questions: [{ qtype: 'multiple', question_text: 'Test?', options: ['A', 'B', 'C', 'D'], answer: '0,0' }] }] }), /无效/);
});

test('knowledge export paths can be re-imported', () => {
  const result = prepareKnowledge({ schemaVersion: 1, chapters: [{ ...chapter, html: '<img src="/knowledge-assets/example.png">' }], assets: [{ path: 'knowledge-assets/example.png', contentType: 'image/png', base64: png }], loop: [{ id: 'engine', name: 'Goods' }] });
  assert.match(result.pack.chapters[0].html, /\/api\/files\/knowledge-assets\/[a-f0-9]{64}\.png/);
  assert.equal(result.pack.loop?.[0].name, 'Goods');
  assert.deepEqual(result.pack.loop?.[0].modules, []);
  assert.deepEqual(result.pack.loop?.[0].points, []);
});

test('loop records retain content and reject structures that cannot render', () => {
  const station = { id: 'engine', name: 'Goods', color: '#123456', modules: [{ code: 'M1', name: 'Store', color: '#123456' }], points: [{ text: 'Review stock', to: '1.1' }], customField: 'retained' };
  const parsed = loopSchema.parse([station]);
  assert.equal(parsed[0].customField, 'retained');
  assert.equal(parsed[0].modules[0].code, 'M1');
  assert.equal(parsed[0].points[0].to, '1.1');
  assert.throws(() => loopSchema.parse([station, station]), /重复/);
  assert.throws(() => loopSchema.parse([{ ...station, modules: null }]));
  assert.throws(() => loopSchema.parse([{ ...station, points: [{ text: 'Point', to: 'javascript:alert(1)' }] }]));
  assert.throws(() => loopSchema.parse([{ ...station, color: 'red; position:fixed' }]));
});
