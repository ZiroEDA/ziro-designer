// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * One connection per tab.
 *
 * Both editors stay mounted once opened (App hides the inactive one with
 * `display: none`), so when each owned a transport the tab became its own
 * peer: it read "1 other viewer" with nobody else there, listed itself in its
 * own presence panel, and its second transport won the owner election against
 * its first — leaving the actual owner shown as an editor, without the
 * owner-only role controls.
 *
 * These are text assertions rather than a mount because what matters is the
 * *shape* of the effects — which dependency array owns the connection — and
 * that is exactly what a render test cannot see: a provider that reconnects on
 * every editor switch still renders correctly and still passes any behavioural
 * check that does not measure the reconnect.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const text = readFileSync(
  fileURLToPath(new URL('../../../designer/src/sync/ProjectSyncProvider.tsx', import.meta.url)),
  'utf8',
);

/** The body of the effect that owns the connection, up to its deps array. */
function connectEffect(): string {
  const i = text.indexOf('const t = createProjectSyncTransport(');
  expect(i).toBeGreaterThan(-1);
  const end = text.indexOf('}, [', i);
  expect(end).toBeGreaterThan(i);
  return text.slice(i, end);
}

describe('the connection belongs to the tab', () => {
  it("announces this tab's real identity, which is what moved here from the editors", () => {
    // Requirement 5: presence has to read as a person, not four hex digits.
    expect(connectEffect()).toContain('{ displayName }');
    expect(text).toContain('const displayName = session?.user.email ?? null;');
  });

  it('restarts only for identity, never for which editor is on screen', () => {
    // `view` in this array would reconnect on every switch between the
    // schematic and the board, which is the whole thing `updatePresence`
    // exists to avoid — peers would watch you leave and rejoin.
    const i = text.indexOf('const t = createProjectSyncTransport(');
    const deps = text.slice(text.indexOf('}, [', i), text.indexOf(');', text.indexOf('}, [', i)));
    expect(deps).toContain('projectName');
    expect(deps).toContain('projectUid');
    expect(deps).toContain('userId');
    expect(deps).toContain('displayName');
    expect(deps).not.toContain('view');
  });

  it('re-announces the view instead of reconnecting when the editor changes', () => {
    const i = text.indexOf('live.current?.updatePresence(');
    expect(i).toBeGreaterThan(-1);
    const body = text.slice(i, i + 80);
    expect(body).toContain('updatePresence(view, null)');
  });

  it('leaves the sheet path to the schematic, which is the only thing that knows one', () => {
    const i = text.indexOf('live.current?.updatePresence(');
    const guard = text.slice(Math.max(0, i - 200), i);
    expect(guard).toContain("if (view === 'schematic') return;");
  });

  it('connects nothing when no project is open', () => {
    const i = text.indexOf('if (!projectName) {');
    expect(i).toBeGreaterThan(-1);
    // Must bail before building a transport, not after.
    expect(i).toBeLessThan(text.indexOf('const t = createProjectSyncTransport('));
  });
});
