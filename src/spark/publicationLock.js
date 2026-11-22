export const SPARK_PUBLICATION_LOCK_TIMEOUT_MS = 120000;

export function recoverStalePublicationLock(current, now = Date.now()) {
  if (current?.phase !== 'publishing') return undefined;
  const startedAt = Number(current.startedAt);
  if (Number.isFinite(startedAt) && now - startedAt < SPARK_PUBLICATION_LOCK_TIMEOUT_MS) return undefined;
  return { phase: 'paused' };
}
