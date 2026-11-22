import test from 'node:test';
import assert from 'node:assert/strict';
import { pauseFailedPublicationLock, recoverStalePublicationLock, SPARK_PUBLICATION_LOCK_TIMEOUT_MS } from '../src/spark/publicationLock.js';

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

test('failed publisher pauses only its own lock and never enables bookings', () => {
  assert.deepEqual(pauseFailedPublicationLock({ phase: 'publishing', owner: 'admin', token: 'mine' }, 'mine'), { phase: 'paused', owner: 'admin', token: 'mine' });
  assert.equal(pauseFailedPublicationLock({ phase: 'publishing', token: 'another' }, 'mine'), undefined);
  assert.equal(pauseFailedPublicationLock({ phase: 'ready' }, 'mine'), undefined);
});
