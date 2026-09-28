// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * EMBED_TOOL (`common/tool/embed_tool.cpp`): the two actions, run through the
 * frame's TOOL_MANAGER the way a caller runs them, against the model's
 * EMBEDDED_FILES - and `EMBEDDED_FILES::AddFile( wxFileName, aOverwrite )`
 * (`common/embedded_files.cpp:69-138`), which is what ACTIONS::embeddedFiles
 * calls with `aOverwrite = false`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { EMBEDDED_FILES, FILE_TYPE } from '@ziroeda/common/embedded_files.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { EMBED_TOOL } from '@ziroeda/common/tool/embed_tool.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { wxGetTempDir, wxWriteFileSync } from '@ziroeda/common/wx/filefn.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { PCB_EDIT_FRAME } from '@ziroeda/designer/src/editors/pcb/pcb_edit_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/read_board.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dir = `${wxGetTempDir()}/embed_tool_test`;

function write(name: string, text: string): string {
  const path = `${dir}/${name}`;
  expect(wxWriteFileSync(path, enc(text))).toBe(true);
  return path;
}

/** A model: `getModel<EDA_ITEM>()->GetEmbeddedFiles()` is all the tool asks of it. */
function modelWith(files: EMBEDDED_FILES): EDA_ITEM {
  return { GetEmbeddedFiles: () => files } as unknown as EDA_ITEM;
}

function setup(files = new EMBEDDED_FILES()) {
  const mgr = new TOOL_MANAGER();
  mgr.SetEnvironment(modelWith(files), null, null, null, null);
  const tool = new EMBED_TOOL();
  mgr.RegisterTool(tool);
  mgr.InitTools();
  return { mgr, tool, files };
}

beforeAll(async () => {
  await EMBEDDED_FILES.InitCodec();
});

describe('EMBED_TOOL', () => {
  it('is common.Embed', () => {
    expect(new EMBED_TOOL().GetName()).toBe('common.Embed');
  });

  it('ACTIONS::embeddedFiles adds the named file under its full name', () => {
    const { mgr, files } = setup();
    const path = write('Datasheet.pdf', 'pdf bytes');

    mgr.RunAction(ACTIONS.embeddedFiles, path);

    const f = files.GetEmbeddedFile('Datasheet.pdf');
    expect(f).not.toBeNull();
    expect(f!.name).toBe('Datasheet.pdf');
    expect(f!.type).toBe(FILE_TYPE.DATASHEET);
    expect(f!.is_valid).toBe(true);
    expect(new TextDecoder().decode(f!.decompressedData)).toBe('pdf bytes');
    // CompressAndEncode ran: the stored hash is the one Validate() recomputes.
    expect(f!.data_hash).not.toBe('');
    expect(f!.Validate()).toBe(true);
  });

  it('types a file by its upper-cased extension, OTHER when none matches', () => {
    const { mgr, files } = setup();
    for (const n of ['a.step', 'b.WRZ', 'c.woff2', 'd.otf', 'e.kicad_wks', 'f.txt', 'noext']) {
      mgr.RunAction(ACTIONS.embeddedFiles, write(n, n));
    }
    const t = (n: string) => files.GetEmbeddedFile(n)!.type;
    expect(t('a.step')).toBe(FILE_TYPE.MODEL);
    expect(t('b.WRZ')).toBe(FILE_TYPE.MODEL);
    expect(t('c.woff2')).toBe(FILE_TYPE.FONT);
    expect(t('d.otf')).toBe(FILE_TYPE.FONT);
    expect(t('e.kicad_wks')).toBe(FILE_TYPE.WORKSHEET);
    expect(t('f.txt')).toBe(FILE_TYPE.OTHER);
    expect(t('noext')).toBe(FILE_TYPE.OTHER);
  });

  it('never overwrites: the action passes aOverwrite = false', () => {
    const { mgr, files } = setup();
    mgr.RunAction(ACTIONS.embeddedFiles, write('logo.png', 'first'));
    mgr.RunAction(ACTIONS.embeddedFiles, write('logo.png', 'second'));

    expect(new TextDecoder().decode(files.GetEmbeddedFile('logo.png')!.decompressedData)).toBe(
      'first',
    );
  });

  it('AddFile( name, true ) replaces the existing file', () => {
    const files = new EMBEDDED_FILES();
    files.AddFile(write('logo.png', 'first'), false);
    const f = files.AddFile(write('logo.png', 'second'), true);

    expect(new TextDecoder().decode(f!.decompressedData)).toBe('second');
    expect(files.GetEmbeddedFile('logo.png')).toBe(f);
  });

  it('adds nothing for an unreadable or an empty file', () => {
    const { mgr, files } = setup();
    mgr.RunAction(ACTIONS.embeddedFiles, `${dir}/missing.pdf`);
    mgr.RunAction(ACTIONS.embeddedFiles, write('empty.pdf', ''));

    expect(files.IsEmpty()).toBe(true);
  });

  it('ACTIONS::removeFile drops the named file', () => {
    const { mgr, files } = setup();
    mgr.RunAction(ACTIONS.embeddedFiles, write('a.pdf', 'a'));
    mgr.RunAction(ACTIONS.embeddedFiles, write('b.pdf', 'b'));

    mgr.RunAction(ACTIONS.removeFile, 'a.pdf');

    expect(files.HasFile('a.pdf')).toBe(false);
    expect(files.HasFile('b.pdf')).toBe(true);
  });

  it('GetFileList is in std::map order, not insertion order', () => {
    const { mgr, tool } = setup();
    for (const n of ['zeta.pdf', 'Alpha.pdf', 'beta.pdf']) {
      mgr.RunAction(ACTIONS.embeddedFiles, write(n, n));
    }

    expect(tool.GetFileList()).toEqual(['Alpha.pdf', 'beta.pdf', 'zeta.pdf']);
  });

  it('Reset re-reads the model: a new model gets the new collection', () => {
    const { mgr, tool } = setup();
    const next = new EMBEDDED_FILES();
    mgr.SetEnvironment(modelWith(next), null, null, null, null);
    mgr.ResetTools(RESET_REASON.MODEL_RELOAD);

    mgr.RunAction(ACTIONS.embeddedFiles, write('x.pdf', 'x'));

    expect(next.HasFile('x.pdf')).toBe(true);
    expect(tool.GetFileList()).toEqual(['x.pdf']);
  });

  it('a manager with no model yet is inert, not a crash', () => {
    const mgr = new TOOL_MANAGER();
    mgr.SetEnvironment(null, null, null, null, null);
    const tool = new EMBED_TOOL();
    mgr.RegisterTool(tool);
    mgr.InitTools();

    mgr.RunAction(ACTIONS.embeddedFiles, write('y.pdf', 'y'));
    expect(tool.GetFileList()).toEqual([]);
  });
});

describe('PCB_EDIT_FRAME registers EMBED_TOOL (pcb_edit_frame.cpp:978)', () => {
  it("runs ACTIONS::embeddedFiles against the loaded board's collection", () => {
    installPgm();
    const settings = new PCBNEW_SETTINGS();
    const frame = new PCB_EDIT_FRAME({ settings: () => settings } as never);
    const board = ParseBoard(`(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
)
`);
    frame.SetBoard(board, false);

    frame.GetToolManager()!.RunAction(ACTIONS.embeddedFiles, write('board.pdf', 'b'));

    expect(board.GetEmbeddedFiles().HasFile('board.pdf')).toBe(true);
  });
});
