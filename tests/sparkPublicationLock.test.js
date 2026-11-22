import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverStalePublicationLock, SPARK_PUBLICATION_LOCK_TIMEOUT_MS } from '../src/spark/publicationLock.js';

test('stale schedule publication locks can be paused for an administrator retry', () => {
  const now = 1000000;
  assert.deepEqual(recoverStalePublicationLock({ phase: 'publishing', startedAt: now - SPARK_PUBLICATION_LOCK_TIMEOUT_MS }, now), { phase: 'paused' });
});

test('a live schedule publication lock is never recovered early', () => {
  const now = 1000000;
  assert.equal(recoverStalePublicationLock({ phase: 'publishing', startedAt: now - SPARK_PUBLICATION_LOCK_TIMEOUT_MS + 1, token: 'current' }, now), undefined);
});

test('non-publishing phases and malformed non-lock data are left untouched', () => {
  assert.equal(recoverStalePublicationLock({ phase: 'ready', startedAt: 1 }, 1000000), undefined);
  assert.deepEqual(recoverStalePublicationLock({ phase: 'publishing', startedAt: 'invalid' }, 1000000), { phase: 'paused' });
});
