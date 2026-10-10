// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_IO (`eeschema/sch_io/sch_io.cpp`): what a plugin inherits when it implements only part of
 * the interface - the extension check, the "does not implement" error naming the plugin and the
 * function, and the default-fields fallback.
 */
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { SCH_IO } from '@ziroeda/eeschema/sch_io/sch_io.js';
import type { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { describe, expect, it } from 'vitest';

class PARTIAL_IO extends SCH_IO {
  constructor() {
    super('Test importer');
  }

  GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Test library files', ['tlib']);
  }

  override GetSchematicFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Test schematic files', ['TSch', 'tsch2']);
  }

  GetModifyHash(): number {
    return 0;
  }

  override GetAvailableSymbolFields(aNames: string[]): void {
    aNames.push('MPN', 'Manufacturer');
  }
}

class BARE_IO extends SCH_IO {
  constructor() {
    super('Bare');
  }

  GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('', []);
  }

  GetModifyHash(): number {
    return 0;
  }
}

describe('SCH_IO', () => {
  it('reads a schematic by its extension, ignoring case', () => {
    const io = new PARTIAL_IO();

    expect(io.CanReadSchematicFile('/p/a.tsch')).toBe(true);
    expect(io.CanReadSchematicFile('/p/a.TSCH2')).toBe(true);
    expect(io.CanReadSchematicFile('/p/a.kicad_sch')).toBe(false);
    expect(io.CanReadSchematicFile('/p/tsch')).toBe(false);
  });

  it('reads nothing when its description lists no extension', () => {
    expect(new BARE_IO().CanReadSchematicFile('/p/a.tsch')).toBe(false);
  });

  it('throws an IO_ERROR naming the plugin and the function it does not implement', () => {
    const io = new PARTIAL_IO();
    const calls: [string, () => unknown][] = [
      ['LoadSchematicFile', () => io.LoadSchematicFile('/a', null as unknown as SCHEMATIC)],
      ['SaveLibrary', () => io.SaveLibrary('/a')],
      ['LoadSymbol', () => io.LoadSymbol('/a', 'R')],
      ['GetError', () => io.GetError()],
    ];

    for (const [name, call] of calls) {
      expect(call).toThrow(IO_ERROR);
      expect(call).toThrow(`Plugin "Test importer" does not implement the "${name}" function.`);
    }
  });

  it('shows by default the fields it has, and has no sub-libraries', () => {
    const io = new PARTIAL_IO();
    const names: string[] = [];

    io.GetDefaultSymbolFields(names);

    expect(names).toEqual(['MPN', 'Manufacturer']);
    expect(io.SupportsSubLibraries()).toBe(false);
  });

  it('adds no library options of its own', () => {
    const options = new Map<string, string>();

    new PARTIAL_IO().GetLibraryOptions(options);

    expect(options.size).toBe(0);
  });
});
