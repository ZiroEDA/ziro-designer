// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Type column's words, against a measurement of the real GTK chooser.
 *
 * Every string here was read out of a `Gtk.FileChooserWidget`'s own tree model
 * on the parity machine, over files with genuine content. They are not derived
 * from the MIME description — the column shows the word for a type's *generic
 * icon*, which is why a PDF reads `Document` and a `.gbr` reads `Text`. The
 * capture is in `docs/proposals/file-dialog.md`; the mechanism is in the
 * module's own doc.
 *
 * These are user-visible and upstream's, so they are pinned character for
 * character — `KiCad Printed Circuit Board`, not `KiCad PCB`.
 */
import { describe, expect, it } from 'vitest';
import {
  KICAD_FILE_TYPES,
  UNKNOWN_TYPE,
  fileExtension,
  fileTypeLabel,
} from '@ziroeda/designer/src/fs/file_types.js';

describe('the six KiCad types that ship an icon show their own comment', () => {
  for (const [name, label] of [
    ['board.kicad_pro', 'KiCad Project'],
    ['board.pro', 'KiCad Project'],
    ['sheet.kicad_sch', 'KiCad Schematic'],
    ['sheet.sch', 'KiCad Schematic'],
    ['board.kicad_pcb', 'KiCad Printed Circuit Board'],
    ['R_0805.kicad_mod', 'KiCad Footprint'],
    ['device.kicad_sym', 'KiCad Schematic Symbol'],
    ['title.kicad_wks', 'KiCad Drawing Sheet'],
  ] as const) {
    it(`calls ${name} "${label}"`, () => expect(fileTypeLabel(name)).toBe(label));
  }

  it('is exactly the six that declare a <generic-icon>', () => {
    // kicad-kicad.xml.in has six <generic-icon> entries and ships six
    // mimetypes icons. kicad-gerbers.xml.in has none, which is the whole
    // reason the three Gerber types are absent from this list.
    expect(KICAD_FILE_TYPES).toHaveLength(6);
  });
});

describe('the Gerber types do NOT show their comment', () => {
  // The correction this file exists to record. KiCad declares no icon for
  // application/vnd.gerber, so the column falls back to the generic category.
  // Measured: `Gerber file` and `Excellon drill file` never appear in it.
  for (const name of ['top.gbr', 'job.gbrjob', 'holes.drl']) {
    it(`calls ${name} "Text"`, () => expect(fileTypeLabel(name)).toBe('Text'));
  }
});

describe('everything else is a category, not a description', () => {
  for (const [name, label] of [
    // A real 964 kB PDF measured as `Document`, not `PDF document`.
    ['datasheet.pdf', 'Document'],
    ['notes.txt', 'Text'],
    ['bom.csv', 'Text'],
    ['panel.zip', 'Archive'],
    ['logo.svg', 'Image'],
    ['logo.png', 'Image'],
    ['case.stl', 'Image'],
    ['model.step', 'Text'],
    ['model.wrl', 'Document'],
    ['face.ttf', 'Font'],
    ['face.otf', 'Font'],
    ['data.xml', 'Markup'],
    ['pkg.json', 'Program'],
    ['run.sh', 'Program'],
    ['lib.so', 'Shared library'],
    ['cache.sqlite', 'SQLite3 database'],
    // Both odd, both measured: shared-mime-info reads .md as an office
    // document, and .lib as a shared library long before KiCad's legacy
    // symbol format.
    ['notes.md', 'Document'],
    ['device.lib', 'Program'],
  ] as const) {
    it(`calls ${name} "${label}"`, () => expect(fileTypeLabel(name)).toBe(label));
  }

  it('covers the Protel layer extensions as a family, not a list', () => {
    // s_allowedExtensionsToList writes these as four regexes; spelling the
    // numeric ones out would be hundreds of keys.
    for (const n of ['top.gtl', 'bot.gbl', 'paste.gtp', 'edge.gm1', 'inner.g2', 'in.g12']) {
      expect(fileTypeLabel(n), n).toBe('Text');
    }
  });

  it('reads .gba as a Program, which is shared-mime-info being literal', () => {
    // A Protel back-side "assembly" layer by KiCad's regex; a Game Boy Advance
    // ROM to the desktop, which is what the column actually says.
    expect(fileTypeLabel('assembly.gba')).toBe('Program');
  });
});

describe('a type we cannot place', () => {
  it('answers GTK’s own word for one', () => {
    // A browser cannot sniff a file it has not pulled, so where GTK would look
    // inside and answer `Text`, ours says `Unknown`. That is the honest limit,
    // and `Unknown` is the string GTK itself shows for an unplaceable type.
    expect(fileTypeLabel('mystery.qqq')).toBe(UNKNOWN_TYPE);
    expect(UNKNOWN_TYPE).toBe('Unknown');
  });

  it('answers it for a name with no extension at all', () => {
    expect(fileTypeLabel('Makefile')).toBe(UNKNOWN_TYPE);
    expect(fileTypeLabel('.gitignore')).toBe(UNKNOWN_TYPE);
  });
});

describe('the extension, as the table needs it', () => {
  it('takes everything after the last dot, so underscores survive', () => {
    // 'kicad_pcb', not 'pcb' — the table's own keys contain underscores.
    expect(fileExtension('board.kicad_pcb')).toBe('kicad_pcb');
    expect(fileExtension('a.b.kicad_sch')).toBe('kicad_sch');
  });

  it('lowercases, so a shouted name still types', () => {
    // Two different questions from `isListedFile`, which mirrors wxRegEx
    // without wxRE_ICASE and hides BOARD.KICAD_PCB entirely. Naming a file
    // that did get listed is the desktop's job, and its globs are matched
    // case-insensitively.
    expect(fileExtension('Board.KiCad_Pcb')).toBe('kicad_pcb');
    expect(fileTypeLabel('BOARD.KICAD_PCB')).toBe('KiCad Printed Circuit Board');
  });

  it('reports none for a name without one', () => {
    expect(fileExtension('Makefile')).toBe('');
    expect(fileExtension('notes')).toBe('');
  });

  it('does not read a leading dot as an extension', () => {
    // `.gitignore` is a name, not an extension — `dot <= 0` rather than `< 0`.
    expect(fileExtension('.gitignore')).toBe('');
  });
});
