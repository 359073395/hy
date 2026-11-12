import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canReadModule, getModuleAccess, type ModuleReader } from '../src/lib/module-access';

test('administrator module permissions are independent of chapter data and employee tier', () => {
  for (const role of ['admin', 'super_admin'] as const) {
    const user: ModuleReader = { role, tier: 'M2' };
    for (const module of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'APPENDIX']) {
      assert.equal(canReadModule(module, false, user), true);
    }
    assert.equal(Object.values(getModuleAccess([], user)).every(Boolean), true);
  }
});

test('employee module access follows the assigned tier and public chapter flag', () => {
  const user: ModuleReader = { role: 'employee', tier: 'M2' };
  assert.equal(canReadModule('M1', false, user), true);
  assert.equal(canReadModule('M2', false, user), true);
  assert.equal(canReadModule('M3', false, user), false);
  assert.equal(canReadModule('M3', true, user), true);
  assert.equal(canReadModule('M8', true, user), true);
  assert.equal(canReadModule('M1', true, null), false);
});

test('module metadata distinguishes empty readable modules from inaccessible existing chapters', () => {
  const user: ModuleReader = { role: 'employee', tier: 'M2' };
  const empty = getModuleAccess([], user);
  assert.equal(empty.M1, true);
  assert.equal(empty.M3, false);
  assert.equal(empty.M7, true);
  const existing = getModuleAccess([
    { module: 'M3', is_public: true },
    { module: 'M7', is_public: false },
  ], user);
  assert.equal(existing.M3, true);
  assert.equal(existing.M7, false);
});
