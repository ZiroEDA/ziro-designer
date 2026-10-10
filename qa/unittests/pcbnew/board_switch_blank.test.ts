// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The board editor opens a DIFFERENT board onto a blank sheet. KiCad never
 * shows the previous board under "Load PCB": changing or closing the project
 * closes every KIWAY_PLAYER, so pcbnew starts fresh. Ours keeps the frame
 * alive between projects, and the dialog sat over somebody else's board
 * (reported 10-10). Pinned at the source - the frame needs a GL canvas; the
 * blank sheet was seen in headless Chrome switching cm5_minima -> ecc83
 * (qa/probes/board_switch_probe.mjs).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(new URL('../../../pcbnew/pcb_edit_frame_ui.tsx', import.meta.url), 'utf8');

describe('PCB editor: another board does not open over the last one', () => {
  it('a different project/file drops to the blank board before the load starts', () => {
    const effect = SRC.slice(SRC.indexOf('const which = `${projectDirRef.current}/${fileName}`;'));
    const clear = effect.slice(0, effect.indexOf('if (!shown) return;'));
    expect(clear).toContain('loadedWhich.current !== which');
    expect(clear).toContain('boardRef.current = emptyBoard;');
    expect(clear).toContain('setBoard(emptyBoard);');
    expect(clear).toContain('loadedWhich.current = which;');
  });

  it('keyed on the project as well as the file: two projects may both have board.kicad_pcb', () => {
    expect(SRC).toContain('const which = `${projectDirRef.current}/${fileName}`;');
  });
});

describe('MAIL_IMPORT_FILE: Import Non-KiCad Project hands the board editor a file', () => {
  it('imports once per request, and only after the frame finished opening the project board', () => {
    const effect = SRC.slice(SRC.indexOf('const importedNonce = useRef<number | null>(null);'));
    const body = effect.slice(0, effect.indexOf('importNonKicadFile(req.path, req.bytes);'));
    // Not before the 30 ms-deferred parse of the project's (empty) board,
    // which would land on top of the imported one.
    expect(body).toContain('loading !== null) return;');
    expect(body).toContain('if (parsedOpen.current !== `${openNonce ?? 0} ${fileName}`) return;');
    expect(body).toContain('if (importedNonce.current === req.nonce) return;');
  });

  it('the same import as File > Import > Non-KiCad Board File', () => {
    // Its two callers: the menu's file dialog and the manager's mail.
    expect(SRC.split('importNonKicadFile(').length - 1).toBe(2);
    expect(SRC).toContain('importNonKicadFile(file.path, file.bytes);');
  });
});
