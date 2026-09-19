/** Per-key async mutex. Serialises transactions that share a source account (tx_bad_seq). */
const chains = new Map<string, Promise<unknown>>();

export function withAccountLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  chains.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}
