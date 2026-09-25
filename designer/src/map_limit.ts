// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Run async work over a list with a ceiling on how much is in flight.
 *
 * One module rather than a copy per caller, because the two callers want it
 * for opposite reasons and both reasons are easy to get wrong:
 *
 *  - `home/demos.ts` bounds *round trips*. A demo is up to 128 small files and
 *    browsers cap connections per host at about six, so asking for more buys
 *    nothing.
 *  - `cloud/cloudStore.ts` bounds *memory*. Every file being pushed is held
 *    three times over at once -- the base64 the local store keeps, the bytes it
 *    decodes to, and the ciphertext -- so "encrypt every file at once" means
 *    peak memory scales with the project rather than with the limit. Measured
 *    at roughly four times the raw bytes with no ceiling, which is what killed
 *    a browser tab pushing five projects.
 *
 * Results come back in the order of `items`, not the order they finished.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
