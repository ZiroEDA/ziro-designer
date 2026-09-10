// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The master key, between this origin's tabs.
 *
 * Each tab keeps the key in its own sessionStorage (`account_keys.ts`), which
 * is what makes closing the browser close the account: nothing is ever
 * written where a later browser could read it. The cost of that in the
 * reference design is that every NEW tab asks for the password again, and
 * that is the one place it is worth departing from Ente. A tab that opens
 * beside an unlocked one should be unlocked too; it is the same person, in
 * the same browser, seconds later.
 *
 * So a tab that finds no key of its own asks the others, over a
 * `BroadcastChannel`, and any tab that has the key for that account answers.
 * The channel is same-origin and in-memory: the browser delivers to this
 * origin's open tabs and nowhere else, so what a sibling receives is what it
 * could already have been given by signing in, and nothing reaches disk. With
 * no sibling open the question goes unanswered, the tab reads `locked`, and
 * the password opens it as before.
 *
 * The key travels with the user id it belongs to, and a tab answers only for
 * the account it holds. A wrong or stale answer cannot do harm — the caller
 * still unwraps the stored account with it, and a key that does not fit is
 * forgotten and the tab asks for the password — but a tab should not be
 * handing keys to questions about someone else.
 */

import { base64ToBytes, bytesToBase64 } from '../cloud/crypto.js';

const CHANNEL = 'ziro.mk';

/** How long a tab waits to hear from a sibling before concluding it is alone. */
export const ASK_TIMEOUT_MS = 300;

type Ask = { type: 'ask'; userId: string; nonce: string };
type Answer = { type: 'key'; userId: string; nonce: string; key: string };

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
  } catch {
    return null;
  }
}

/**
 * Answer siblings that ask for `userId`'s key, until the returned function is
 * called. Register while the account is open, unregister when it closes.
 */
export function serveMasterKey(userId: string, masterKey: Uint8Array): () => void {
  const ch = channel();
  if (!ch) return () => {};
  const key = bytesToBase64(masterKey);
  ch.onmessage = (e: MessageEvent<Ask | Answer>) => {
    const m = e.data;
    if (!m || m.type !== 'ask' || m.userId !== userId) return;
    const answer: Answer = { type: 'key', userId, nonce: m.nonce, key };
    ch.postMessage(answer);
  };
  return () => ch.close();
}

/**
 * Ask the other tabs for `userId`'s master key. Resolves with the first
 * answer, or `null` when none arrives within {@link ASK_TIMEOUT_MS}.
 */
export function askSiblingsForMasterKey(
  userId: string,
  timeoutMs = ASK_TIMEOUT_MS,
): Promise<Uint8Array | null> {
  const ch = channel();
  if (!ch) return Promise.resolve(null);
  const nonce = crypto.randomUUID();
  return new Promise((resolve) => {
    const done = (key: Uint8Array | null): void => {
      clearTimeout(timer);
      ch.close();
      resolve(key);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    ch.onmessage = (e: MessageEvent<Ask | Answer>) => {
      const m = e.data;
      if (!m || m.type !== 'key' || m.nonce !== nonce || m.userId !== userId) return;
      try {
        done(base64ToBytes(m.key));
      } catch {
        done(null);
      }
    };
    const ask: Ask = { type: 'ask', userId, nonce };
    ch.postMessage(ask);
  });
}
