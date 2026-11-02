import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSessionState } from './session-activity.js';

test('only busy or waiting Claude sessions appear as active', () => {
  assert.equal(activeSessionState('busy'), 'busy');
  assert.equal(activeSessionState('waiting'), 'waiting');
  assert.equal(activeSessionState('idle'), null);
  assert.equal(activeSessionState(undefined), null);
});
