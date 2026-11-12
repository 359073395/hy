import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isResourceDeepLink } from '../src/lib/use-auth-bootstrap';

test('chapter and module links survive authentication bootstrap', () => {
  for (const hash of ['5.20', 'M1', 'm6', 'APPENDIX', '12345678-1234-1234-1234-123456789abc/term']) {
    assert.equal(isResourceDeepLink(hash), true);
  }
  assert.equal(isResourceDeepLink('tc-member-token'), false);
});
