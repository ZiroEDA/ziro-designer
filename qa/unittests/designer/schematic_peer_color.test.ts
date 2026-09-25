// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The schematic editor's remote-cursor dot, colored per peer the same way
 * the PCB editor's is (see pcb_peer_roles.test.ts's "colored per peer, not
 * one shared color" block) — designer/src/sync/peerColor.ts.
 *
 * SchematicCanvas.tsx is a .tsx qa's tsconfig cannot compile standalone,
 * and too large to mount — read as text and asserted on directly, the
 * same way the PCB editor's equivalent wiring is.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const text = readFileSync(
  fileURLToPath(
    new URL(
      '../../../designer/src/editors/schematic/components/SchematicCanvas.tsx',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('the schematic remote cursor is colored per peer, not one shared color', () => {
  it('no REMOTE_CURSOR_COLOR literal survives — peerColor replaced it', () => {
    expect(text).not.toContain('REMOTE_CURSOR_COLOR');
    expect(text).toContain("import { peerColor } from '../../../sync/peerColor.js';");
  });

  it("the dot's fill reads this peer's own color, from its own peerId", () => {
    const i = text.indexOf('for (const rc of remoteCursors)');
    expect(i).toBeGreaterThan(-1);
    const body = text.slice(i, text.indexOf('}', text.indexOf('fillText', i)));
    expect(body).toContain('ctx.fillStyle = peerColor(rc.peerId);');
  });
});
