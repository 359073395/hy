import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:8791';
const adminUsername = process.env.TEST_ADMIN_USERNAME;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
assert.ok(adminUsername && adminPassword, 'Administrator username and password must be supplied');
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

async function signInAdmin() {
  await page.getByLabel('用户名', { exact: true }).fill(adminUsername);
  await page.getByLabel('密码', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: '登录后台', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/admin');
  await page.getByText('成员管理', { exact: true }).waitFor();
  const stored = await page.evaluate(() => Object.values(sessionStorage));
  assert.equal(stored.includes(adminPassword), false);
}

try {
  for (const protectedPath of ['/admin', '/admin/knowledge', '/admin/data']) {
    await page.goto(base + protectedPath);
    await page.waitForURL(url => url.pathname === '/admin/login');
    await page.getByRole('heading', { name: '后台登录', exact: true }).waitFor();
  }
  await page.getByLabel('用户名', { exact: true }).fill(adminUsername);
  await page.getByLabel('密码', { exact: true }).fill('incorrect-test-password');
  await page.getByRole('button', { name: '登录后台', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(new URL(page.url()).pathname, '/admin/login');
  await page.screenshot({ path: 'test-results/admin-login.png', fullPage: true });
  await signInAdmin();
  await page.goto(base + '/manual');
  await page.getByText('CI updated chapter', { exact: false }).first().waitFor();
  assert.equal(await page.locator('.path-card').count(), 9);
  assert.equal(await page.locator('.path-card.locked').count(), 0);
  const emptyModule = page.getByText('暂无章节 · 点击导入或新增', { exact: true }).first();
  await emptyModule.waitFor();
  await emptyModule.click();
  await page.waitForURL(url => url.pathname === '/admin/knowledge');
  await page.goto(base + '/manual');
  await page.getByText('CI updated chapter', { exact: false }).first().waitFor();
  await page.screenshot({ path: 'test-results/manual.png', fullPage: true });
  await page.goto(base + '/admin');
  await page.getByText('成员管理', { exact: true }).waitFor();
  await page.getByRole('row').filter({ hasText: 'CI learner' }).waitFor();
  const state = JSON.parse(await readFile('test-results/state.json', 'utf8'));
  const employeeContext = await browser.newContext();
  try {
    const employeeLogin = await employeeContext.request.post(base + '/api/auth/login', { data: { token: state.retakeToken } });
    assert.equal(employeeLogin.status(), 200);
    const changeToken = async () => {
      const custom = `Browser${randomBytes(4).toString('hex')}9`;
      const changed = await employeeContext.request.post(base + '/api/auth/passphrase', { data: { newPass: custom, confirm: custom } });
      assert.equal(changed.status(), 200);
      return custom;
    };
    const row = page.getByRole('row').filter({ hasText: 'CI retake' });
    const manuallyRefreshed = await changeToken();
    await page.getByPlaceholder('姓名 *', { exact: true }).fill('Draft must survive refresh');
    await page.getByRole('button', { name: '刷新成员数据', exact: true }).click();
    await row.getByText(`自定义:${manuallyRefreshed}`, { exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder('姓名 *', { exact: true }).inputValue(), 'Draft must survive refresh');
    await page.getByRole('button', { name: '考核管理', exact: true }).click();
    const tabRefreshed = await changeToken();
    await page.getByRole('button', { name: '成员管理', exact: true }).click();
    await row.getByText(`自定义:${tabRefreshed}`, { exact: true }).waitFor();
    const automaticallyRefreshed = await changeToken();
    await row.getByText(`自定义:${automaticallyRefreshed}`, { exact: true }).waitFor({ timeout: 45_000 });
    await page.getByRole('status').filter({ hasText: '最近同步' }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: '重置自定义', exact: true }).click();
    await row.getByText('自定义:未设置', { exact: true }).waitFor();
    const originalStillWorks = await employeeContext.request.post(base + '/api/auth/login', { data: { token: state.retakeToken } });
    assert.equal(originalStillWorks.status(), 200);
  } finally {
    await employeeContext.close();
  }
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
  // An employee can open the dedicated administrator login and switch sessions.
  await page.evaluate(token => sessionStorage.setItem('manual-last-token', token), state.retakeToken);
  await page.goto(base + '/admin/login#unused-login-hash');
  await page.getByRole('heading', { name: '后台登录', exact: true }).waitFor();
  await signInAdmin();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('manual-last-token')), null);
  assert.deepEqual(errors, []);
  await writeFile('test-results/browser-results.json', JSON.stringify({ passed: ['protected administrator page redirects', 'incorrect password feedback', 'administrator password sign-in', 'administrator module permissions and empty content import link', 'member management', 'employee custom token manual and tab refresh', 'automatic custom token synchronization', 'administrator custom token reset preserves original login', 'knowledge import preview', 'data and backup page', 'employee token login and retake', 'employee to administrator session switch'], pageErrors: errors }, null, 2));
  console.log('PASS browser administrator password login, knowledge preview, and employee token retake flow');
} catch (error) {
  await page.screenshot({ path: 'test-results/browser-failure.png', fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
}
