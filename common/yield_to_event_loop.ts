// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Hand the thread back for one turn of the event loop: input, a frame and
 * the other tasks run, then the caller resumes. `wxYield` / a progress
 * reporter's `KeepRefreshing` in the C++, which pump the event queue from
 * inside a long job.
 *
 * `scheduler.yield()` where the browser has it (it resumes ahead of other
 * tasks); a MessageChannel message elsewhere, which is a macrotask with none
 * of setTimeout's 4 ms clamp.
 */
export function yieldToEventLoop(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;

  if (s?.yield) return s.yield();

  return new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
