// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Remote selection and the claim it makes, in the schematic editor
 * (designer/src/sync/). The board editor's equivalents are covered by
 * pcb_peer_roles.test.ts and pcb_move_ghost.test.ts; this is the sheet side,
 * which differs in two ways worth pinning:
 *
 *   * a schematic id already IS the item's uuid (`refId` returns
 *     `uuid ?? kind:idx:index`), so nothing is translated per peer the way
 *     the board has to translate its positional ids -- but the `kind:idx:`
 *     fallback names a position in the SENDER's arrays and must never go out;
 *   * a sheet is not a board: the same uuid on another sheet is not the same
 *     claim, so everything here filters through presence's `sheetPath`.
 *
 * Both files are .tsx too large to mount, so they are read as text, the same
 * way every other wiring test in this directory does it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const editor = readFileSync(
  fileURLToPath(new URL('../../../eeschema/sch_edit_frame_ui.tsx', import.meta.url)),
  'utf8',
);

describe('a selection goes out in terms a peer can resolve', () => {
  it('never sends the positional fallback id', () => {
    // `kind:idx:3` means "whatever is third in MY array", which on the
    // receiver is a different item or none. Sending nothing beats that.
    const i = editor.indexOf("publish({ kind: 'selection'");
    expect(i).toBeGreaterThan(-1);
    const body = editor.slice(Math.max(0, i - 400), i);
    expect(body).toContain("filter((id) => !id.includes(':idx:'))");
  });
});
