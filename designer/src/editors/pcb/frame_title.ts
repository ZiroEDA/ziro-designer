// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_EDIT_FRAME::UpdateTitle` (pcbnew/pcb_edit_frame.cpp:2168-2194), row 1 of
 * `docs/frame-titles.md`.
 *
 * The frame title is per-frame upstream — each editor has its own
 * `UpdateTitle()` — but the SHAPE of it is not: star, document, suffixes, em
 * dash, frame name. That shape lives once, in `frameTitle()` in
 * `ui/useDocumentTitle.ts`, and this module states only the PCB editor's own
 * decisions on top of it. The Schematic, Symbol and Footprint editors each
 * have the same three-dozen-line neighbour; the PCB editor was the last of the
 * six launchers still hand-rolling the separator inline, as an ASCII hyphen
 * between two non-breaking-space entities.
 *
 * The C++, in full:
 *
 *     wxFileName fn = GetBoard()->GetFileName();
 *     bool readOnly = false, unsaved = false;
 *     if( fn.IsOk() && fn.FileExists() )  readOnly = !fn.IsFileWritable();
 *     else                                unsaved = true;
 *     wxString title;
 *     if( IsContentModified() )  title = wxT( "*" );
 *     title += fn.GetName();
 *     if( readOnly )  title += wxS( " " ) + _( "[Read Only]" );
 *     if( unsaved )   title += wxS( " " ) + _( "[Unsaved]" );
 *     title += wxT( " — " ) + _( "PCB Editor" );
 *
 * Three things that were each wrong at the call site this replaces:
 *
 *  - The separator is an EM DASH with a space either side. Ours was an ASCII
 *    hyphen between two non-breaking-space entities, which is why our title
 *    bar read `board  - PCB Editor` beside KiCad's `board — PCB Editor`.
 *  - The document half is **the board file's** name — `GetBoard()->GetFileName()`
 *    — not the project's. Ours preferred `projectName` and only fell back to
 *    the file, so a board named differently from its project was titled with
 *    the wrong document entirely. `docs/frame-titles.md` records the same
 *    mistake in GerbView, whose title is the active layer's gerber file.
 *  - `wxFileName::GetName()` drops the extension, so it is `board`, never
 *    `board.kicad_pcb` — and it drops the directory too, which a bare
 *    `.replace(/\.kicad_pcb$/i, '')` did not.
 *
 * There is no placeholder: note A of `docs/frame-titles.md` records that the
 * PCB editor is one of the two frames with no empty branch at all — it leans
 * on `[Unsaved]` instead. Ours printed `No project`, which is neither.
 */

import { frameTitle, type FrameTitleParts, READ_ONLY_SUFFIX } from '../../ui/useDocumentTitle.js';

/** `_( "PCB Editor" )`, the half after the dash. */
export const PCB_FRAME_NAME = 'PCB Editor';

/**
 * `_( "3D Viewer" )` — `eda_3d_viewer_frame.cpp:634`, and row 12 of
 * `docs/frame-titles.md`.
 *
 * The child 3D frame names ITSELF. A parent only overrides that title by
 * passing `aTitle` to `PCB_BASE_FRAME::Update3DView` (pcb_base_frame.cpp:161),
 * and exactly two frames do: the Footprint Library Browser
 * (`footprint_viewer_frame.cpp:966`) and the Footprint Chooser
 * (`footprint_chooser_frame.cpp:392-398`), which both build
 * `_( "3D Viewer" ) + " — " + <footprint name>` — the frame name FIRST, the
 * reverse of every other frame.
 *
 * Neither of our two call sites is one of those. `PCB_EDIT_FRAME` and
 * `DISPLAY_FOOTPRINTS_FRAME` (`display_footprints_frame.cpp:417`) both call
 * `Update3DView` with no title at all, so upstream shows the bare frame name.
 * Ours prefixed the board or footprint name and an ASCII hyphen to both.
 */
export const VIEWER_3D_FRAME_NAME = '3D Viewer';

export interface PcbFrameTitleSpec {
  /**
   * The board's file name, extension included or not — this drops it, the way
   * `wxFileName::GetName()` does, along with any directory. Empty or absent is
   * the no-board case.
   */
  fileName?: string | null;
  /** `IsContentModified()`. */
  modified?: boolean;
  /**
   * `!fn.IsFileWritable()`. A browser has no per-file writable bit; the
   * condition that stands in for one here is the demo project, the same
   * substitution `SchematicEditor`'s `readOnly` prop documents.
   *
   * There is no `[Unsaved]` counterpart, for the reason the schematic's module
   * gives: upstream sets it from `!fn.FileExists()`, and a board in this app
   * exists in the project store from the moment it is opened, so the flag
   * would never be true.
   */
  readOnly?: boolean;
}

export function pcbFrameTitle(spec: PcbFrameTitleSpec): FrameTitleParts {
  const raw = spec.fileName?.trim() ?? '';
  // `wxFileName::GetName()` — the NAME half alone, no directory and no
  // extension. A leading dot is not an extension, so `.kicad_pcb` stays whole.
  const name = raw.split(/[/\\]/).filter(Boolean).pop() ?? '';
  const document = name.replace(/(?!^)\.[^./\\]*$/, '');

  return frameTitle({
    frameName: PCB_FRAME_NAME,
    document,
    modified: spec.modified,
    suffixes: spec.readOnly ? [READ_ONLY_SUFFIX] : [],
  });
}
