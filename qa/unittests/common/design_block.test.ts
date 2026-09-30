// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * KiCad 10's design blocks, the shared half (common/design_block*.cpp,
 * common/widgets/design_block_pane.cpp, common/dialogs/dialog_design_block_properties.cpp):
 * the block, its folder format, the library adapter over the library manager,
 * the chooser's tree and details HTML, the properties transfer and the pane's
 * commands.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DESIGN_BLOCK } from '@ziroeda/common/design_block.js';
import {
  DESIGN_BLOCK_FILE_T,
  DESIGN_BLOCK_IO,
  DESIGN_BLOCK_IO_MGR,
} from '@ziroeda/common/design_block_io.js';
import {
  DESIGN_BLOCK_LIBRARY_ADAPTER,
  SAVE_T,
} from '@ziroeda/common/design_block_library_adapter.js';
import { DESIGN_BLOCK_TREE_MODEL_ADAPTER } from '@ziroeda/common/design_block_tree_model_adapter.js';
import {
  DesignBlockPropertiesFromWindow,
  DesignBlockPropertiesToWindow,
} from '@ziroeda/common/dialogs/dialog_design_block_properties.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { LibTreeNodeType } from '@ziroeda/common/lib_tree_model.js';
import { LIBRARY_MANAGER, LOAD_STATUS } from '@ziroeda/common/libraries/library_manager.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { LinkifyHTML } from '@ziroeda/common/string_utils.js';
import {
  DESIGN_BLOCK_PANE,
  type DESIGN_BLOCK_PANE_DIALOGS,
} from '@ziroeda/common/widgets/design_block_pane.js';
import {
  wxDirEnumerate,
  wxDirExists,
  wxFileExists,
  wxGetTempDir,
  wxMkdir,
  wxReadFileSync,
  wxWriteFileSync,
} from '@ziroeda/common/wx/filefn.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (p: string): string => new TextDecoder().decode(wxReadFileSync(p)!);

let n = 0;
let root = '';

beforeEach(() => {
  root = `${wxGetTempDir()}/dbtest${++n}`;
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
});

afterEach(() => SetPgm(null));

/** A library with one block `amp` (schematic + metadata) and one `empty` (folder only). */
function makeLibrary(aName = 'Blocks'): string {
  const lib = `${root}/${aName}.kicad_blocks`;
  wxWriteFileSync(`${lib}/amp.kicad_block/amp.kicad_sch`, enc('(kicad_sch (version 1))'));
  wxWriteFileSync(
    `${lib}/amp.kicad_block/amp.json`,
    enc(
      '{"description": "An amp", "keywords": "audio amp", "fields": {"Gain": "20", "Rail": "5V"}}',
    ),
  );
  wxMkdir(`${lib}/empty.kicad_block`);
  return lib;
}

function manager(aRows: string): LIBRARY_MANAGER {
  const m = new LIBRARY_MANAGER();
  m.SetTable(
    LIBRARY_TABLE_TYPE.DESIGN_BLOCK,
    LIBRARY_TABLE_SCOPE.PROJECT,
    LIBRARY_TABLE.FromFile(
      `${root}/design-block-lib-table`,
      `(design_block_lib_table (version 7) ${aRows})`,
      LIBRARY_TABLE_SCOPE.PROJECT,
      LIBRARY_TABLE_TYPE.DESIGN_BLOCK,
    ),
  );
  return m;
}

const row = (name: string, uri: string, extra = ''): string =>
  `(lib (name "${name}")(type "KiCad")(uri "${uri}")(options "")(descr "${name} blocks")${extra})`;

describe('the file system a design block library lives on', () => {
  it('a made directory exists while empty, and lists with its children', () => {
    const dir = `${root}/a/b`;
    expect(wxDirExists(dir)).toBe(false);
    expect(wxMkdir(dir)).toBe(true);
    expect(wxDirExists(dir)).toBe(true);
    wxWriteFileSync(`${root}/a/f.txt`, enc('x'));
    expect(wxDirEnumerate(`${root}/a`)!.sort((x, y) => x.name.localeCompare(y.name))).toEqual([
      { name: 'b', isDir: true },
      { name: 'f.txt', isDir: false },
    ]);
    expect(wxDirEnumerate(`${root}/nope`)).toBeNull();
  });
});

describe('DESIGN_BLOCK', () => {
  it('search terms: nickname 4, name 8, LIB_ID 16, each keyword 4, keywords 1, description 1', () => {
    const b = new DESIGN_BLOCK();
    b.SetLibId(new LIB_ID('Lib', 'amp'));
    b.SetKeywords('audio  amp');
    b.SetLibDescription('d');
    expect(b.GetSearchTerms().map((t) => [t.text, t.score])).toEqual([
      ['Lib', 4],
      ['amp', 8],
      ['Lib:amp', 16],
      ['audio', 4],
      ['amp', 4],
      ['audio  amp', 1],
      ['d', 1],
    ]);
  });
});

describe('DESIGN_BLOCK_IO', () => {
  const io = new DESIGN_BLOCK_IO();

  it('enumerates the .kicad_block folders by the name before the first dot', () => {
    const lib = makeLibrary();
    const names: string[] = [];
    io.DesignBlockEnumerate(names, lib, false);
    expect(names.sort()).toEqual(['amp', 'empty']);
    // dirname.Before( '.' ): a dotted block name keeps only its first part.
    wxMkdir(`${lib}/rev.2.kicad_block`);
    const dotted: string[] = [];
    io.DesignBlockEnumerate(dotted, lib, false);
    expect(dotted.sort()).toEqual(['amp', 'empty', 'rev']);
    expect(() => io.DesignBlockEnumerate([], `${root}/missing.kicad_blocks`, false)).toThrow(
      IO_ERROR,
    );
  });

  it('loads the schematic path and the metadata, with no nickname', () => {
    const lib = makeLibrary();
    const b = io.DesignBlockLoad(lib, 'amp');
    expect(b.GetLibId().Format()).toBe('amp');
    expect(b.GetSchematicFile()).toBe(`${lib}/amp.kicad_block/amp.kicad_sch`);
    expect(b.GetBoardFile()).toBe('');
    expect(b.GetLibDescription()).toBe('An amp');
    expect(b.GetKeywords()).toBe('audio amp');
    expect([...b.GetFields()]).toEqual([
      ['Gain', '20'],
      ['Rail', '5V'],
    ]);
    expect(() => io.DesignBlockLoad(lib, 'nope')).toThrow("Design block '");
  });

  it('refuses metadata it cannot read', () => {
    const lib = makeLibrary();
    wxWriteFileSync(`${lib}/amp.kicad_block/amp.json`, enc('{"description": 3}'));
    expect(() => io.DesignBlockLoad(lib, 'amp')).toThrow('could not be read');
  });

  it('saves the schematic under the block name and the metadata as ordered_json dump( 0 )', () => {
    const lib = makeLibrary();
    const src = `${root}/src.kicad_sch`;
    wxWriteFileSync(src, enc('(kicad_sch (version 2))'));
    const b = new DESIGN_BLOCK();
    b.SetLibId(new LIB_ID('Blocks', 'filter'));
    b.SetSchematicFile(src);
    b.SetLibDescription('LP "filter"');
    b.SetKeywords('rc');
    b.GetFields().set('Z', '1');
    b.GetFields().set('A', '2');
    io.DesignBlockSave(lib, b);
    expect(text(`${lib}/filter.kicad_block/filter.kicad_sch`)).toBe('(kicad_sch (version 2))');
    // Insertion order, not sorted; a newline between members and no indent.
    expect(text(`${lib}/filter.kicad_block/filter.json`)).toBe(
      '{\n"description": "LP \\"filter\\"",\n"keywords": "rc",\n"fields": {\n"Z": "1",\n"A": "2"\n}\n}',
    );
    expect(io.DesignBlockExists(lib, 'filter')).toBe(true);
  });

  it('writes empty fields as {} and refuses a block with no file or no valid id', () => {
    const lib = makeLibrary();
    const src = `${root}/s.kicad_sch`;
    wxWriteFileSync(src, enc('x'));
    const b = new DESIGN_BLOCK();
    b.SetLibId(new LIB_ID('Blocks', 'bare'));
    b.SetSchematicFile(src);
    io.DesignBlockSave(lib, b);
    expect(text(`${lib}/bare.kicad_block/bare.json`)).toBe(
      '{\n"description": "",\n"keywords": "",\n"fields": {}\n}',
    );
    const noFile = new DESIGN_BLOCK();
    noFile.SetLibId(new LIB_ID('Blocks', 'x'));
    expect(() => io.DesignBlockSave(lib, noFile)).toThrow(
      'does not have a schematic or board file',
    );
    const missing = new DESIGN_BLOCK();
    missing.SetLibId(new LIB_ID('Blocks', 'x'));
    missing.SetSchematicFile(`${root}/nope.kicad_sch`);
    expect(() => io.DesignBlockSave(lib, missing)).toThrow("Schematic source file '");
    expect(() => io.DesignBlockSave(lib, new DESIGN_BLOCK())).toThrow('valid library ID');
  });

  it('deletes one block; a library holding blocks is refused (upstream compares the library extension)', () => {
    const lib = makeLibrary();
    io.DesignBlockDelete(lib, 'empty');
    expect(io.DesignBlockExists(lib, 'empty')).toBe(false);
    expect(() => io.DesignBlockDelete(lib, 'empty')).toThrow(
      "Design block 'empty.kicad_block' does not exist.",
    );
    expect(() => io.DeleteLibrary(lib)).toThrow('Unexpected folder');
    const bare = `${root}/Bare.kicad_blocks`;
    io.CreateLibrary(bare);
    expect(() => io.CreateLibrary(bare)).toThrow('Cannot overwrite library path');
    expect(io.DeleteLibrary(bare)).toBe(true);
    expect(wxDirExists(bare)).toBe(false);
  });

  it('DESIGN_BLOCK_IO_MGR: the table token, and guessing a library path', () => {
    expect(DESIGN_BLOCK_IO_MGR.ShowType(DESIGN_BLOCK_FILE_T.KICAD_SEXP)).toBe('KiCad');
    expect(DESIGN_BLOCK_IO_MGR.ShowType(DESIGN_BLOCK_FILE_T.NESTED_TABLE)).toBe('Table');
    expect(DESIGN_BLOCK_IO_MGR.EnumFromStr('kicad')).toBe(DESIGN_BLOCK_FILE_T.KICAD_SEXP);
    expect(DESIGN_BLOCK_IO_MGR.EnumFromStr('Table')).toBe(DESIGN_BLOCK_FILE_T.NESTED_TABLE);
    expect(DESIGN_BLOCK_IO_MGR.EnumFromStr('Eagle')).toBe(
      DESIGN_BLOCK_FILE_T.DESIGN_BLOCK_FILE_UNKNOWN,
    );
    const lib = makeLibrary();
    expect(DESIGN_BLOCK_IO_MGR.GuessPluginTypeFromLibPath(lib)).toBe(
      DESIGN_BLOCK_FILE_T.KICAD_SEXP,
    );
    expect(DESIGN_BLOCK_IO_MGR.GuessPluginTypeFromLibPath(`${root}/x.pretty`)).toBe(
      DESIGN_BLOCK_FILE_T.FILE_TYPE_NONE,
    );
  });
});

describe('LIBRARY_MANAGER and DESIGN_BLOCK_LIBRARY_ADAPTER', () => {
  it('a project row overrides a global row of the same nickname, in place', () => {
    const m = manager(row('A', '/p/a.kicad_blocks') + row('B', '/p/b.kicad_blocks'));
    m.SetTable(
      LIBRARY_TABLE_TYPE.DESIGN_BLOCK,
      LIBRARY_TABLE_SCOPE.GLOBAL,
      LIBRARY_TABLE.FromFile(
        '/g',
        `(design_block_lib_table (version 7) ${row('B', '/g/b.kicad_blocks')}${row('C', '/g/c.kicad_blocks')})`,
        LIBRARY_TABLE_SCOPE.GLOBAL,
        LIBRARY_TABLE_TYPE.DESIGN_BLOCK,
      ),
    );
    expect(m.Rows(LIBRARY_TABLE_TYPE.DESIGN_BLOCK).map((r) => [r.Nickname(), r.URI()])).toEqual([
      ['B', '/p/b.kicad_blocks'],
      ['C', '/g/c.kicad_blocks'],
      ['A', '/p/a.kicad_blocks'],
    ]);
    expect(m.GetRow(LIBRARY_TABLE_TYPE.DESIGN_BLOCK, 'C', LIBRARY_TABLE_SCOPE.PROJECT)).toBeNull();
  });

  it('GetLibraryNames: the loaded nicknames in StrNumCmp order, ignoring case', () => {
    const lib = makeLibrary();
    const libs = new DESIGN_BLOCK_LIBRARY_ADAPTER(
      manager(row('Lib10', lib) + row('lib9', lib) + row('B', lib)),
    );
    for (const n of ['Lib10', 'lib9', 'B']) libs.LoadOneByName(n);
    expect(libs.GetLibraryNames()).toEqual(['B', 'lib9', 'Lib10']);
  });

  it('loads, lists, loads blocks with the nickname, saves and deletes', () => {
    const lib = makeLibrary();
    const libs = new DESIGN_BLOCK_LIBRARY_ADAPTER(manager(row('Blocks', lib)));
    expect(libs.GetLibraryNames()).toEqual([]);
    expect(libs.LoadOneByName('Blocks').load_status).toBe(LOAD_STATUS.LOADED);
    expect(libs.GetLibraryNames()).toEqual(['Blocks']);
    expect(libs.GetDesignBlockNames('Blocks').sort()).toEqual(['amp', 'empty']);
    expect(
      libs
        .GetDesignBlocks('Blocks')
        .map((b) => b.GetName())
        .sort(),
    ).toEqual(['amp', 'empty']);
    expect(libs.LoadDesignBlock('Blocks', 'amp')!.GetLibId().Format()).toBe('Blocks:amp');
    expect(libs.LoadDesignBlock('Blocks', 'nope')).toBeNull();
    expect(libs.DesignBlockLoadWithOptionalNickname(new LIB_ID('', 'amp'))!.GetLibNickname()).toBe(
      'Blocks',
    );
    expect(libs.IsDesignBlockLibWritable('Blocks')).toBe(true);

    const b = libs.LoadDesignBlock('Blocks', 'amp')!;
    expect(libs.SaveDesignBlock('Blocks', b, false)).toBe(SAVE_T.SAVE_SKIPPED);
    // aOverwrite defaults to true: an existing block is saved over.
    expect(libs.SaveDesignBlock('Blocks', b)).toBe(SAVE_T.SAVE_OK);
    b.SetLibId(new LIB_ID('Blocks', 'amp2'));
    expect(libs.SaveDesignBlock('Blocks', b)).toBe(SAVE_T.SAVE_OK);
    expect(libs.DesignBlockExists('Blocks', 'amp2')).toBe(true);
    libs.DeleteDesignBlock('Blocks', 'amp2');
    expect(libs.DesignBlockExists('Blocks', 'amp2')).toBe(false);
  });

  it('a library that is not there fails to load, with the reason', () => {
    const libs = new DESIGN_BLOCK_LIBRARY_ADAPTER(
      manager(row('Gone', `${root}/gone.kicad_blocks`)),
    );
    const status = libs.LoadOneByName('Gone');
    expect(status.load_status).toBe(LOAD_STATUS.LOAD_ERROR);
    expect(status.error!.message).toContain('does not exist');
    expect(libs.LoadOneByName('Nobody').error!.message).toBe('Library Nobody not found');
  });
});

describe('DESIGN_BLOCK_TREE_MODEL_ADAPTER', () => {
  it('a library per visible row, pinned from the list, its blocks under it', () => {
    const lib = makeLibrary();
    const m = manager(row('Blocks', lib) + row('Hidden', lib, '(hidden)'));
    const libs = new DESIGN_BLOCK_LIBRARY_ADAPTER(m);
    libs.LoadOneByName('Blocks');
    const tree = new DESIGN_BLOCK_TREE_MODEL_ADAPTER(libs);
    tree.AddLibraries(m, ['Blocks']);
    expect(tree.tree.children.map((c) => [c.name, c.pinned, c.desc])).toEqual([
      ['Blocks', true, 'Blocks blocks'],
    ]);
    const items = tree.tree.children[0]!.children;
    expect(items.map((i) => i.name).sort()).toEqual(['amp', 'empty']);
    expect(items.every((i) => i.type === LibTreeNodeType.ITEM)).toBe(true);
  });

  it('GenerateInfo: name, description with links, keywords, the fields table', () => {
    const lib = makeLibrary();
    wxWriteFileSync(
      `${lib}/amp.kicad_block/amp.json`,
      enc('{"description": "See https://x.test/a <b>\\nnext", "keywords": "k", "fields": {"G": "1"}}'),
    );
    const libs = new DESIGN_BLOCK_LIBRARY_ADAPTER(manager(row('Blocks', lib)));
    libs.LoadOneByName('Blocks');
    const tree = new DESIGN_BLOCK_TREE_MODEL_ADAPTER(libs);
    expect(tree.GenerateInfo(new LIB_ID('Blocks', 'amp'))).toBe(
      '<b>amp</b><br>See <a href="https://x.test/a" target="_blank" rel="noreferrer">https://x.test/a</a> &lt;b&gt;<br>next' +
        '<br>Keywords: k<hr><table border=0><tr>   <td><b>G</b></td>   <td>1</td></tr></table>',
    );
    // The load throws; upstream logs it and shows nothing.
    expect(tree.GenerateInfo(new LIB_ID('Blocks', 'nope'))).toBe('');
    // A library that is not loaded gives no block at all: the error text.
    expect(tree.GenerateInfo(new LIB_ID('Other', 'amp'))).toBe(
      "Error loading design block amp from library 'Other'.\n",
    );
    expect(tree.GenerateInfo(new LIB_ID())).toBe('');
  });

  it('LinkifyHTML leaves a trailing full stop out of the link', () => {
    expect(LinkifyHTML('go to http://a.test/x.')).toBe(
      'go to <a href="http://a.test/x" target="_blank" rel="noreferrer">http://a.test/x</a>.',
    );
  });
});

describe('DIALOG_DESIGN_BLOCK_PROPERTIES transfers', () => {
  const block = (): DESIGN_BLOCK => {
    const b = new DESIGN_BLOCK();
    b.SetLibId(new LIB_ID('L', 'amp'));
    b.GetFields().set('F', 'v');
    return b;
  };

  it('to the window and back', () => {
    const b = block();
    const v = DesignBlockPropertiesToWindow(b);
    expect(v).toEqual({ name: 'amp', keywords: '', description: '', fields: [['F', 'v']] });
    expect(
      DesignBlockPropertiesFromWindow(b, {
        name: 'amp2',
        keywords: 'k',
        description: 'd',
        fields: [
          ['B', '1'],
          ['A', '2'],
        ],
      }),
    ).toBeNull();
    expect(b.GetLibId().Format()).toBe('L:amp2');
    expect([b.GetKeywords(), b.GetLibDescription()]).toEqual(['k', 'd']);
    expect([...b.GetFields()]).toEqual([
      ['B', '1'],
      ['A', '2'],
    ]);
  });

  it('refuses an illegal name, a slash, and duplicate field names', () => {
    expect(
      DesignBlockPropertiesFromWindow(block(), {
        name: 'a/b',
        keywords: '',
        description: '',
        fields: [],
      }),
    ).toBe("Illegal character '/' in name 'a/b'.");
    expect(
      DesignBlockPropertiesFromWindow(block(), {
        name: 'a:b',
        keywords: '',
        description: '',
        fields: [],
      }),
    ).toBe("Illegal character ':' in name 'a:b'.");
    expect(
      DesignBlockPropertiesFromWindow(block(), {
        name: 'x',
        keywords: '',
        description: '',
        fields: [
          ['A ', '1'],
          ['A', '2'],
        ],
      }),
    ).toBe('Duplicate fields are not allowed.');
  });

  it('field names lose trailing space and newlines; one pass halves runs of spaces', () => {
    const b = block();
    DesignBlockPropertiesFromWindow(b, {
      name: 'x',
      keywords: '',
      description: '',
      fields: [[' a\n    b  ', 'v']],
    });
    expect([...b.GetFields().keys()]).toEqual([' a  b']);
  });
});

describe('DESIGN_BLOCK_PANE', () => {
  function pane(aDialogs: Partial<DESIGN_BLOCK_PANE_DIALOGS>) {
    const lib = makeLibrary();
    const m = manager(row('Blocks', lib));
    const libs = new DESIGN_BLOCK_LIBRARY_ADAPTER(m);
    libs.LoadOneByName('Blocks');
    const status: string[] = [];
    const errors: string[] = [];
    const p = new DESIGN_BLOCK_PANE(
      {
        DesignBlockLibs: () => libs,
        GetLibraryManager: () => m,
        NormalizePath: (x) => x,
        ShowInfoBarError: (msg) => errors.push(msg),
        SetStatusText: (msg) => status.push(msg),
      },
      {
        IsOK: async () => true,
        OKOrCancel: async () => true,
        ConfirmOverwriteLibrary: async () => true,
        DisplayError: (msg) => errors.push(msg),
        GetTextFromUser: async () => 'desc',
        NewLibraryBrowser: async () => null,
        DesignBlockProperties: async () => true,
        ...aDialogs,
      },
      [],
    );
    let refreshed = 0;
    p.OnRefresh(() => refreshed++);
    return { p, libs, lib, status, errors, refreshed: () => refreshed };
  }

  it('deletes a block after the confirmation, and says so', async () => {
    const t = pane({});
    expect(await t.p.DeleteDesignBlockFromLibrary(new LIB_ID('Blocks', 'amp'), true)).toBe(true);
    expect(t.libs.DesignBlockExists('Blocks', 'amp')).toBe(false);
    expect(t.status).toEqual(["Design block 'amp' deleted from library 'Blocks'"]);
    expect(t.refreshed()).toBe(1);
  });

  it('a declined confirmation deletes nothing', async () => {
    const t = pane({ IsOK: async () => false });
    expect(await t.p.DeleteDesignBlockFromLibrary(new LIB_ID('Blocks', 'amp'), true)).toBe(false);
    expect(t.libs.DesignBlockExists('Blocks', 'amp')).toBe(true);
  });

  it('a rename in the properties saves under the new name and removes the old', async () => {
    const t = pane({
      DesignBlockProperties: async (b) => {
        b.SetLibId(new LIB_ID('Blocks', 'amp_v2'));
        return true;
      },
    });
    expect(await t.p.EditDesignBlockProperties(new LIB_ID('Blocks', 'amp'))).toBe(true);
    expect(t.libs.DesignBlockExists('Blocks', 'amp_v2')).toBe(true);
    expect(t.libs.DesignBlockExists('Blocks', 'amp')).toBe(false);
    expect(t.p.GetSelectedLibId().Format()).toBe('Blocks:amp_v2');
  });

  it('renaming onto an existing block asks first', async () => {
    const asked: string[] = [];
    const t = pane({
      DesignBlockProperties: async (b) => {
        b.SetLibId(new LIB_ID('Blocks', 'empty'));
        return true;
      },
      OKOrCancel: async (msg) => {
        asked.push(msg);
        return false;
      },
    });
    expect(await t.p.EditDesignBlockProperties(new LIB_ID('Blocks', 'amp'))).toBe(false);
    expect(asked).toEqual(["Design block 'empty' already exists in library 'Blocks'."]);
    expect(t.libs.DesignBlockExists('Blocks', 'amp')).toBe(true);
  });

  it('a new library is created, added to the table with its description, and selected', async () => {
    const newLib = `${root}/Fresh.kicad_blocks`;
    const t = pane({ NewLibraryBrowser: async () => ({ path: newLib, global: false }) });
    expect(await t.p.CreateNewDesignBlockLibrary('New Design Block Library')).toBe(newLib);
    expect(wxDirExists(newLib)).toBe(true);
    const rowAdded = Pgm_row(t, 'Fresh');
    expect(rowAdded).toEqual(['Fresh', newLib, 'KiCad', 'desc']);
    expect(t.libs.GetLibraryNames()).toContain('Fresh');
    expect(t.p.GetSelectedLibId().GetLibNickname()).toBe('Fresh');
  });

  function Pgm_row(t: ReturnType<typeof pane>, aName: string): string[] {
    const r = t.libs['m_manager']!.GetRow(LIBRARY_TABLE_TYPE.DESIGN_BLOCK, aName)!;
    return [r.Nickname(), r.URI(), r.Type(), r.Description()];
  }

  it('a read-only library is refused on the infobar', async () => {
    const t = pane({});
    t.libs.IsDesignBlockLibWritable = () => false;
    expect(await t.p.DeleteDesignBlockFromLibrary(new LIB_ID('Blocks', 'amp'), false)).toBe(false);
    expect(t.errors).toEqual(["Library 'Blocks' is read only."]);
    expect(wxFileExists(`${t.lib}/amp.kicad_block/amp.kicad_sch`)).toBe(true);
  });
});
