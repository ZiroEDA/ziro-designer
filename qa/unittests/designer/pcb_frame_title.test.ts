// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_EDIT_FRAME::UpdateTitle` (pcbnew/pcb_edit_frame.cpp:2168-2194) — row 1
 * of `docs/frame-titles.md` — and the 3D viewer child frame's own name
 * (`eda_3d_viewer_frame.cpp:634`), row 12.
 */
import { describe, expect, it } from 'vitest';
import {
  PCB_FRAME_NAME,
  VIEWER_3D_FRAME_NAME,
  pcbFrameTitle,
} from '@ziroeda/designer/src/editors/pcb/frame_title.js';

describe('pcbFrameTitle', () => {
  /**
   *     title += fn.GetName();
   *     title += wxT( " — " ) + _( "PCB Editor" );
   */
  it('is the board name, an em dash, and the frame name', () => {
    expect(pcbFrameTitle({ fileName: 'ACtoDCconverter.kicad_pcb' }).full).toBe(
      'ACtoDCconverter — PCB Editor',
    );
  });

  /** The separator is U+2014 with a space either side, not an ASCII hyphen. */
  it('separates the halves with an em dash and nothing else', () => {
    const t = pcbFrameTitle({ fileName: 'board.kicad_pcb' });
    expect(t.separator).toBe(' — ');
    expect(t.full).not.toContain('-');
    expect(t.full).not.toContain(' ');
  });

  /** `if( IsContentModified() ) title = wxT( "*" ); title += fn.GetName();` */
  it('marks a modified board with a leading star, hard against the name', () => {
    expect(pcbFrameTitle({ fileName: 'board.kicad_pcb', modified: true }).full).toBe(
      '*board — PCB Editor',
    );
  });

  it('has no star when the board is not modified', () => {
    const t = pcbFrameTitle({ fileName: 'board.kicad_pcb', modified: false });
    expect(t.modified).toBe('');
    expect(t.full.startsWith('board')).toBe(true);
  });

  /** `if( readOnly ) title += wxS( " " ) + _( "[Read Only]" );` */
  it('appends [Read Only] with its own leading space, before the dash', () => {
    expect(pcbFrameTitle({ fileName: 'board.kicad_pcb', readOnly: true }).full).toBe(
      'board [Read Only] — PCB Editor',
    );
  });

  it('puts the star before the name and the suffix after it', () => {
    expect(
      pcbFrameTitle({ fileName: 'board.kicad_pcb', modified: true, readOnly: true }).full,
    ).toBe('*board [Read Only] — PCB Editor');
  });

  /**
   * `wxFileName::GetName()` is the base name alone. The call site this replaced
   * used `.replace(/\.kicad_pcb$/i, '')`, which kept every directory component
   * and dropped nothing else.
   */
  it('drops the directory as well as the extension', () => {
    expect(pcbFrameTitle({ fileName: 'boards/rev2/board.kicad_pcb' }).document).toBe('board');
    expect(pcbFrameTitle({ fileName: 'board.kicad_pcb.bak' }).document).toBe('board.kicad_pcb');
  });

  /**
   * The document half is the BOARD FILE's name. The call site this replaced
   * preferred `projectName` and only fell back to the file, so a board named
   * differently from its project was titled with the wrong document — the
   * mistake `docs/frame-titles.md` records for GerbView. `pcbFrameTitle` has
   * no project input at all, which is how that cannot come back.
   */
  it('takes no project name, so it cannot title a board with one', () => {
    expect(Object.keys(pcbFrameTitle({ fileName: 'board.kicad_pcb' }))).not.toContain('project');
    expect(pcbFrameTitle({ fileName: 'board.kicad_pcb' }).document).toBe('board');
  });

  /**
   * Note A: the PCB editor is one of two frames with no empty branch at all.
   * Ours printed `No project`, which is neither KiCad's placeholder nor its
   * absence.
   */
  it('has no placeholder: with no board it is the frame name alone', () => {
    for (const fileName of ['', '   ', null, undefined]) {
      const t = pcbFrameTitle({ fileName });
      expect(t.full).toBe('PCB Editor');
      expect(t.separator).toBe('');
    }
    expect(pcbFrameTitle({ fileName: '' }).full).not.toContain('No project');
  });

  it('names the frame exactly as _( "PCB Editor" )', () => {
    expect(PCB_FRAME_NAME).toBe('PCB Editor');
    expect(pcbFrameTitle({ fileName: 'board.kicad_pcb' }).frameName).toBe(PCB_FRAME_NAME);
  });
});

describe('the 3D viewer child frame', () => {
  /**
   * `SetTitle( _( "3D Viewer" ) )` — one string, no document and no dash.
   * A parent overrides it only by passing `aTitle` to
   * `PCB_BASE_FRAME::Update3DView` (pcb_base_frame.cpp:161), and neither
   * `PCB_EDIT_FRAME` nor `DISPLAY_FOOTPRINTS_FRAME`
   * (`display_footprints_frame.cpp:417`) does — the two frames ours opens it
   * from. Both of ours had prefixed a document name and an ASCII hyphen.
   */
  it('is the bare frame name', () => {
    expect(VIEWER_3D_FRAME_NAME).toBe('3D Viewer');
    expect(VIEWER_3D_FRAME_NAME).not.toContain('—');
    expect(VIEWER_3D_FRAME_NAME).not.toContain('-');
  });
});
