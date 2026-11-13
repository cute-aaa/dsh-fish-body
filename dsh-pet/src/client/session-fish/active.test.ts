/**
 * 当前会话的模块级记录：同一会话重复上报只算一次，换会话才算新上报。
 * @module dsh-pet/src/client/session-fish/active.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getActiveSession, reportActiveSession } from './active.ts';

describe('active', () => {
  test('同一会话重复上报只算一次；换会话才算新上报', () => {
    assert.equal(reportActiveSession('a'), true);
    assert.equal(reportActiveSession('a'), false);
    assert.equal(getActiveSession(), 'a');
    assert.equal(reportActiveSession('b'), true);
    assert.equal(getActiveSession(), 'b');
  });
});
