// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Type column's words, against KiCad's shipped MIME entries.
 *
 * `resources/linux/mime/kicad-kicad.xml.in` and `kicad-gerbers.xml.in` are
 * where the GTK file chooser gets `KiCad Project` from. These strings are
 * user-visible and are upstream's, so they are pinned character for character —
 * "KiCad Printed Circuit Board" is not "KiCad PCB", however much shorter that
 * would be.
 */
import { describe, expect, it } from 'vitest';
import {
  KICAD_FILE_TYPES,
  fileExtension,
  fileTypeLabel,
} from '@ziroeda/designer/src/fs/file_types.js';

describe('the Type column shows KiCad’s own words', () => {
  for (const [name, label] of [
    ['board.kicad_pro', 'KiCad Project'],
    ['board.pro', 'KiCad Project'],
    ['sheet.kicad_sch', 'KiCad Schematic'],
    ['sheet.sch', 'KiCad Schematic'],
    ['board.kicad_pcb', 'KiCad Printed Circuit Board'],
    ['R_0805.kicad_mod', 'KiCad Footprint'],
    ['device.kicad_sym', 'KiCad Schematic Symbol'],
    ['title.kicad_wks', 'KiCad Drawing Sheet'],
    ['top.gbr', 'Gerber file'],
    ['job.gbrjob', 'Gerber job file'],
    ['holes.drl', 'Excellon drill file'],
  ] as const) {
    it(`calls ${name} "${label}"`, () => expect(fileTypeLabel(name)).toBe(label));
  }

  it('covers the nine entries the two files declare, and no more', () => {
    expect(KICAD_FILE_TYPES).toHaveLength(9);
  });

  it('does not invent a name for a type the desktop owns', () => {
    // The allowlist has 38 patterns; KiCad ships MIME entries for nine. The
    // rest are the system's to name, and null is the honest answer.
    for (const name of ['datasheet.pdf', 'notes.txt', 'bom.csv', 'panel.zip', 'notes.md']) {
      expect(fileTypeLabel(name), name).toBeNull();
    }
  });

  it('is case-insensitive on the extension, unlike the listing filter', () => {
    // Two different questions. `isListedFile` mirrors wxRegEx without
    // wxRE_ICASE and hides BOARD.KICAD_PCB; naming a file that did get listed
    // is the desktop's job and the MIME globs are matched case-insensitively.
    expect(fileTypeLabel('BOARD.KICAD_PCB')).toBe('KiCad Printed Circuit Board');
  });
});

describe('the extension, as the table needs it', () => {
  it('takes everything after the last dot, so underscores survive', () => {
    // 'kicad_pcb', not 'pcb' — the table's own keys contain underscores.
    expect(fileExtension('board.kicad_pcb')).toBe('kicad_pcb');
    expect(fileExtension('a.b.kicad_sch')).toBe('kicad_sch');
  });

  it('lowercases', () => {
    expect(fileExtension('Board.KiCad_Pcb')).toBe('kicad_pcb');
  });

  it('reports none for a name without one', () => {
    expect(fileExtension('Makefile')).toBe('');
    expect(fileExtension('notes')).toBe('');
  });

  it('does not read a leading dot as an extension', () => {
    // `.gitignore` is a name, not an extension — `dot <= 0` rather than `< 0`.
    expect(fileExtension('.gitignore')).toBe('');
    expect(fileTypeLabel('.gitignore')).toBeNull();
  });
});
