// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The login secret, started while the form is still being filled in.
 *
 * `loginSecret` is half a second of Argon2id (2 passes over 64 MiB) that
 * depends on nothing but the email and the password, so it need not wait for
 * the click: the sign-in and sign-up forms prime it when the two fields settle
 * - as someone stops typing, or the moment the browser autofills them - and
 * the submit finds it done (#639: make sign-in faster).
 *
 * One entry, the latest pair, in memory only. The secret is what the form
 * would derive on submit anyway; it is never stored and leaves with the page.
 */
import { loginSecret } from '../cloud/crypto.js';

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 0;
const waiting = new Map<number, { resolve: (s: string) => void; reject: (e: Error) => void }>();

/**
 * The secret, derived in a worker so the page keeps responding while it runs;
 * on the main thread where there are no workers (tests, a locked-down page).
 * The same function either way, so the same bytes.
 */
function deriveOffThread(email: string, password: string): Promise<string> {
  if (!workerFailed && !worker && typeof Worker === 'function') {
    try {
      // The `new URL(..., import.meta.url)` form is what the bundler emits as
      // its own chunk; see pcbnew/browser/drc_runner.ts.
      worker = new Worker(new URL('./login_secret_worker.js', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (e: MessageEvent<{ id: number; secret?: string; error?: string }>) => {
        const w = waiting.get(e.data.id);
        if (!w) return;
        waiting.delete(e.data.id);
        if (e.data.secret !== undefined) w.resolve(e.data.secret);
        else w.reject(new Error(e.data.error ?? 'login secret failed'));
      };
      worker.onerror = () => {
        // Could not start (a CSP, an old browser): main thread from here on.
        workerFailed = true;
        worker = null;
        for (const w of waiting.values()) w.reject(new Error('login secret worker failed'));
        waiting.clear();
      };
    } catch {
      workerFailed = true;
    }
  }
  if (!worker) return loginSecret(email, password);
  const id = ++nextId;
  const w = worker;
  return new Promise<string>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ id, email, password });
  });
}

let latest: { email: string; password: string; secret: Promise<string> } | null = null;

/** Start deriving the secret for this pair, unless it already is. */
export function primeLoginSecret(email: string, password: string): void {
  if (!email || !password) return;
  if (latest && latest.email === email && latest.password === password) return;
  const secret = deriveOffThread(email, password);
  // A failure is the submit's to report, when it asks again.
  secret.catch(() => {
    if (latest?.secret === secret) latest = null;
  });
  latest = { email, password, secret };
}

/** The secret for this pair: the primed one when it matches, else derived now. */
export function loginSecretFor(email: string, password: string): Promise<string> {
  if (latest && latest.email === email && latest.password === password)
    // A primed run that failed is no answer: derive it here instead.
    return latest.secret.catch(() => loginSecret(email, password));
  return loginSecret(email, password);
}

/** Drop the primed secret: the form is gone, or the account is open. */
export function forgetPrimedLoginSecret(): void {
  latest = null;
}
