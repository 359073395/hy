import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:8791';
const browser = await chromium.launch();
let page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

async function signIn(token) {
  await page.goto(base);
  await page.getByPlaceholder('输入访问令牌').fill(token);
  await page.getByRole('button', { name: '进入手册', exact: true }).click();
  await page.waitForURL('**/manual');
  await page.getByText('CI updated chapter', { exact: false }).first().waitFor();
}

try {
  await signIn(process.env.ADMIN_TOKEN);
  await page.screenshot({ path: 'test-results/manual.png', fullPage: true });
  await page.goto(base + '/admin');
  await page.getByText('成员管理', { exact: true }).waitFor();
  await page.getByText('CI learner', { exact: true }).first().waitFor();
  await page.screenshot({ path: 'test-results/admin.png', fullPage: true });
  await page.goto(base + '/admin/knowledge');
  await page.locator('input[type=file]').waitFor();
  const bundle = { schemaVersion: 1, chapters: [{ module: 'M1', sectionNo: '1.2', title: 'Browser import preview', sortOrder: 2, isPublic: false, html: '<p>Browser preview</p>' }], exams: [], assets: [] };
  await page.locator('input[type=file]').setInputFiles({ name: 'ci-knowledge.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await page.getByRole('button', { name: '确认导入', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/knowledge.png', fullPage: true });
  await page.goto(base + '/admin/data');
  await page.getByRole('heading', { name: '数据与备份', exact: true }).waitFor();
  await page.locator('a[href="/api/admin/backup"]').waitFor();
  await page.screenshot({ path: 'test-results/data.png', fullPage: true });
  // Exercise the normal retake button after a real failed attempt.
  const state = JSON.parse(await readFile('test-results/state.json', 'utf8'));
  await page.context().close();
  page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await signIn(state.retakeToken);
  const failed = await page.request.post(base + `/api/exams/records/${state.retakeRecordId}`, { data: { answers: {} } });
  assert.equal(failed.status(), 200);
  await page.goto(base + '/exams');
  await page.getByRole('button', { name: '补考', exact: true }).click();
  await page.getByRole('heading', { name: '在线答题' }).waitFor();
  assert.equal(await page.locator('textarea').count(), 1);
  assert.ok(await page.locator('input[type=radio]').count() > 20);
  await page.screenshot({ path: 'test-results/retake.png', fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile('test-results/browser-results.json', JSON.stringify({ passed: ['admin sign-in', 'manual', 'member management', 'knowledge import preview', 'data and backup page', 'retake button'], pageErrors: errors }, null, 2));
  console.log('PASS browser admin, knowledge preview, and retake flow');
} catch (error) {
  await page.screenshot({ path: 'test-results/browser-failure.png', fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
}
