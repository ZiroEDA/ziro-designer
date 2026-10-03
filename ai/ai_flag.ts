// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The AI assistant is off for normal users while it is being tested. Add `?ai=1` to the app's
 * URL to turn it on in that tab (it stays on for the tab's session; `?ai=0` turns it off).
 *
 * The pane talks to the AI agent server, a separate program that runs on the tester's machine
 * (the private ziro-ai-server repo, `npm run dev`), at AI_AGENT_URL.
 */

const KEY = 'ziroeda.ai';

/** Whether the AI assistant is shown in this tab. */
export function aiEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const flag = new URLSearchParams(window.location.search).get('ai');
  try {
    if (flag === '1') window.sessionStorage.setItem(KEY, '1');
    else if (flag === '0') window.sessionStorage.removeItem(KEY);
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return flag === '1';
  }
}

/** Where the agent server listens; VITE_AI_AGENT_URL overrides the local default. */
export const AI_AGENT_URL: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_AI_AGENT_URL ??
  'http://127.0.0.1:8787';
