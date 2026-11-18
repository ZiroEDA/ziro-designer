// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Git state is read fresh from GitHub, never from the browser's HTTP cache.
 *
 * GitHub answers reads with `Cache-Control: private, max-age=60`. Obeying it, a Pull within a
 * minute of reading the branch head reported "Already up to date" over a newer commit, and a
 * branch created a moment earlier was missing from Switch to Branch (end-to-end test, 11-19).
 */
import { describe, expect, it } from 'vitest';
import { getBranchHead } from '@ziroeda/designer/src/github/github_api.js';

describe('GitHub API reads', () => {
  it('ask the browser not to answer from its cache', async () => {
    const seen: (RequestCache | undefined)[] = [];
    const f = async (_url: string, init?: RequestInit) => {
      seen.push(init?.cache);
      return new Response(JSON.stringify({ object: { sha: 'abc' } }), { status: 200 });
    };
    expect(await getBranchHead(f, 'o', 'r', 'main')).toBe('abc');
    expect(seen).toEqual(['no-store']);
  });
});
