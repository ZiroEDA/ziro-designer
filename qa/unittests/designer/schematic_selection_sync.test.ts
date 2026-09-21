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
  fileURLToPath(
    new URL('../../../designer/src/editors/schematic/SchematicEditor.tsx', import.meta.url),
  ),
  'utf8',
);
const canvas = readFileSync(
  fileURLToPath(
    new URL(
      '../../../designer/src/editors/schematic/components/SchematicCanvas.tsx',
      import.meta.url,
    ),
  ),
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

  it('keeps what a peer sent as uuids, unresolved', () => {
    // The board stores peers' selections unresolved because its own ids are
    // positional; here they need no resolution at all, and storing them as
    // sent is what makes that true.
    const i = editor.indexOf("payload.kind === 'selection'");
    expect(i).toBeGreaterThan(-1);
    // Bounded at the next branch rather than by a character count, so
    // reformatting the body cannot silently move an assertion out of view.
    const end = editor.indexOf("} else if (payload.kind === 'cursor')", i);
    expect(end).toBeGreaterThan(i);
    const body = editor.slice(i, end);
    expect(body).toContain('next.set(fromPeerId, new Set(payload.refs))');
    // An empty selection is a removal, not an empty set left lying around.
    expect(body).toContain('if (payload.refs.length === 0) next.delete(fromPeerId);');
  });

  it('drops a peer selection when that peer leaves', () => {
    const i = editor.indexOf("payload.kind === 'presence'");
    const body = editor.slice(i, editor.indexOf("payload.kind === 'selection'", i));
    expect(body).toContain('setRemoteSelections((prev) => {');
    expect(body).toContain('if (!stillHere.has(peerId)) next.delete(peerId);');
  });
});

describe('a claim only applies to the sheet it was made on', () => {
  it('filters what is drawn by the peer’s own sheet path', () => {
    const i = editor.indexOf('const remoteSelectionList = useMemo(');
    expect(i).toBeGreaterThan(-1);
    const body = editor.slice(i, editor.indexOf('const remoteLockedIds', i));
    expect(body).toContain('p.sheetPath === currentPath');
  });

  it('locks exactly what that filtered list claims, and nothing else', () => {
    const i = editor.indexOf('const remoteLockedIds = useMemo(');
    expect(i).toBeGreaterThan(-1);
    const body = editor.slice(i, i + 400);
    // Built from the already-sheet-filtered list, so an off-sheet selection
    // cannot lock anything here.
    expect(body).toContain('for (const { ids } of remoteSelectionList)');
    expect(body).toContain('[remoteSelectionList]');
  });

  it('hands both to the canvas', () => {
    expect(editor).toContain('remoteSelections={remoteSelectionList}');
    expect(editor).toContain('lockedIds={remoteLockedIds}');
  });
});

describe('a grab on a claimed item is refused before it starts', () => {
  it('guards every single place a move begins', () => {
    // The invariant, not three separate spot checks: if a fourth way to start
    // a move appears without a guard, these two counts stop matching and this
    // fails. That is the whole reason it counts rather than asserting on the
    // three sites it happens to know about today.
    const starts = canvas.match(/modeRef\.current = 'move';/g) ?? [];
    const guards = canvas.match(/isRemotelyLocked\(/g) ?? [];
    expect(starts.length).toBeGreaterThan(0);
    expect(guards).toHaveLength(starts.length);
  });

  it('short-circuits when nobody else is here', () => {
    // A gesture is on the hot path; with no peers this must not walk a set.
    const i = canvas.indexOf('const isRemotelyLocked =');
    expect(i).toBeGreaterThan(-1);
    const body = canvas.slice(i, i + 300);
    expect(body).toContain('if (!lockedIds || lockedIds.size === 0) return false;');
  });
});

describe('a peer’s selection is drawn as theirs', () => {
  it('uses that peer’s own colour, not one shared highlight', () => {
    const i = canvas.indexOf('if (remoteSelections && remoteSelections.length > 0)');
    expect(i).toBeGreaterThan(-1);
    const body = canvas.slice(i, canvas.indexOf("// Other viewers' cursors", i));
    expect(body).toContain('peerColor(rs.peerId)');
    expect(body).toContain('setLineDash([4, 3])');
  });

  it('skips ids this sheet does not have, rather than boxing the origin', () => {
    // A board tab shares this channel and sends board uuids. Without this,
    // `selectionBBox` would be handed ids it cannot place and the peer would
    // appear to have selected a corner of the page.
    const i = canvas.indexOf('if (remoteSelections && remoteSelections.length > 0)');
    const body = canvas.slice(i, canvas.indexOf("// Other viewers' cursors", i));
    expect(body).toContain('hasExtent(schematic, id, libById)');
    expect(body).toContain('if (present.size === 0) continue;');
  });
});
