// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_EDIT_FRAME::UpdateTitle` (pcbnew/footprint_edit_frame.cpp:1080-1132),
 * row 4 of `docs/frame-titles.md` and the most-branched of the thirteen.
 *
 * The shape — star, document, suffixes, em dash, frame name — is shared and
 * lives in `frameTitle()` in `ui/useDocumentTitle.ts`. This module states only
 * the four branches that are the footprint editor's own.
 *
 * The C++, condensed to its decisions:
 *
 *     LIB_ID     fpid = GetLoadedFPID();
 *     FOOTPRINT* footprint = GetBoard()->GetFirstFootprint();
 *     bool       writable = true;
 *
 *     if( IsCurrentFPFromBoard() )
 *     {
 *         if( IsContentModified() ) title = wxT( "*" );
 *         title += footprint->GetReference();
 *         title += wxS( " " ) + wxString::Format( _( "[from %s]" ),
 *                      Prj().GetProjectName() + wxT( "." ) + FILEEXT::PcbFileExtension );
 *     }
 *     else if( fpid.IsValid() )
 *     {
 *         writable = …->IsFootprintLibWritable( fpid.GetLibNickname() );
 *         if( IsContentModified() ) title = wxT( "*" );
 *         // Note: don't used GetLoadedFPID(); footprint name may have been edited
 *         title += From_UTF8( footprint->GetFPID().Format().c_str() );
 *         if( !writable ) title += wxS( " " ) + _( "[Read Only]" );
 *     }
 *     else if( !fpid.GetLibItemName().empty() )
 *     {
 *         if( IsContentModified() ) title = wxT( "*" );
 *         // Note: don't used GetLoadedFPID(); footprint name may have been edited
 *         title += From_UTF8( footprint->GetFPID().GetLibItemName().c_str() );
 *         title += wxS( " " ) + _( "[Unsaved]" );
 *     }
 *     else
 *     {
 *         title = _( "[no footprint loaded]" );
 *     }
 *
 *     title += wxT( " — " ) + _( "Footprint Editor" );
 *
 * Four things that are easy to get wrong:
 *
 *  - **The guard and the document come from two different FPIDs**, and
 *    upstream comments the trap twice. The branch is chosen by `fpid`, which
 *    is `GetLoadedFPID()` — what was loaded — while the string printed is
 *    `footprint->GetFPID()`, the live one, "because the footprint name may
 *    have been edited". Rename a footprint without saving and the title tracks
 *    the new name while still taking the branch the old one selected. Reading
 *    both off one value is the obvious simplification and it is wrong, so the
 *    two are separate fields here.
 *  - **`[Read Only]` and `[Unsaved]` are not mutually exclusive by file state**
 *    the way frames 1, 2 and 7 have them (`docs/frame-titles.md` note C). They
 *    are two different branches: read-only means the *library* is not
 *    writable, unsaved means the loaded FPID has a library item name but is
 *    not otherwise valid.
 *  - **Branch 1 prints the REFERENCE, not the FPID.** A footprint opened from
 *    the board is titled `R12`, not `Resistor_SMD:R_0805`.
 *  - **The empty branch cannot carry a star**, for the same reason as the
 *    symbol editor's: `title = _( … )` is an assignment and the three
 *    `title = wxT( "*" )` lines all sit in branches that ran already.
 */

import {
  frameTitle,
  type FrameTitleParts,
  READ_ONLY_SUFFIX,
  UNSAVED_SUFFIX,
} from '../../ui/useDocumentTitle.js';

/** `_( "Footprint Editor" )`, the half after the dash. */
export const FP_FRAME_NAME = 'Footprint Editor';

/** `_( "[no footprint loaded]" )` — footprint_edit_frame.cpp:1128. */
export const FP_NO_DOCUMENT = '[no footprint loaded]';

/**
 * `FILEEXT::PcbFileExtension` — [data] KiCad's own constant
 * (`common/kicad_string.h` / `include/wildcards_and_files_ext.h`), interpolated
 * into `[from %s]` after the project name.
 *
 * A local literal because there is no shared FILEEXT mirror in this repo yet;
 * the string is spelled independently in at least five places
 * (`home/file_activation.ts`, `fs/file_types.ts`, `home/project_tree.ts`,
 * `editors/pcb/board_file_settings.ts`). Worth one module eventually — noted
 * rather than done here, because those files belong to other work in flight.
 */
export const PCB_FILE_EXTENSION = 'kicad_pcb';

/**
 * `wxString::Format( _( "[from %s]" ), Prj().GetProjectName() + "." + FILEEXT::PcbFileExtension )`
 * — footprint_edit_frame.cpp:1092-1094. Frame 4 only.
 */
export function fromBoardSuffix(projectName: string): string {
  return `[from ${projectName}.${PCB_FILE_EXTENSION}]`;
}

export interface FpFrameTitleSpec {
  /** `IsCurrentFPFromBoard()` — selects branch 1. */
  fromBoard?: boolean;
  /** `footprint->GetReference()` — branch 1's document. */
  reference?: string;
  /** `Prj().GetProjectName()`, interpolated by {@link fromBoardSuffix}. */
  projectName?: string;
  /**
   * `GetLoadedFPID().IsValid()` — the GUARD on branch 2.
   *
   * Not derivable from {@link fpid} below: that one is the live footprint's,
   * which stays valid-looking while the loaded one is not.
   */
  loadedFpidValid?: boolean;
  /**
   * `!GetLoadedFPID().GetLibItemName().empty()` — the GUARD on branch 3, again
   * on the loaded FPID rather than the live one.
   */
  loadedLibItemName?: string;
  /**
   * `footprint->GetFPID().Format()` — `lib:name` off the LIVE footprint, which
   * is what branch 2 prints.
   */
  fpid?: string;
  /**
   * `footprint->GetFPID().GetLibItemName()` — the live footprint's name half,
   * which is what branch 3 prints.
   */
  libItemName?: string;
  /**
   * `IsFootprintLibWritable( fpid.GetLibNickname() )`. Upstream seeds this
   * `true` and only a successful lookup can clear it — an `IO_ERROR` is
   * swallowed "best efforts", leaving the footprint titled writable. So
   * `undefined` here means writable, not unknown.
   */
  writable?: boolean;
  /** `IsContentModified()`. */
  modified?: boolean;
}

export function fpFrameTitle(spec: FpFrameTitleSpec): FrameTitleParts {
  // 1. `if( IsCurrentFPFromBoard() )` — the reference, plus [from <proj>.kicad_pcb].
  if (spec.fromBoard) {
    return frameTitle({
      frameName: FP_FRAME_NAME,
      document: spec.reference ?? '',
      modified: spec.modified,
      suffixes: [fromBoardSuffix(spec.projectName ?? '')],
    });
  }

  // 2. `else if( fpid.IsValid() )` — the LIVE FPID, plus [Read Only] if the
  //    library is not writable. `writable` defaults true, as upstream's does.
  if (spec.loadedFpidValid) {
    return frameTitle({
      frameName: FP_FRAME_NAME,
      document: spec.fpid ?? '',
      modified: spec.modified,
      suffixes: spec.writable === false ? [READ_ONLY_SUFFIX] : [],
    });
  }

  // 3. `else if( !fpid.GetLibItemName().empty() )` — the LIVE name half, and
  //    [Unsaved] unconditionally.
  if ((spec.loadedLibItemName ?? '') !== '') {
    return frameTitle({
      frameName: FP_FRAME_NAME,
      document: spec.libItemName ?? '',
      modified: spec.modified,
      suffixes: [UNSAVED_SUFFIX],
    });
  }

  // 4. `else { title = _( "[no footprint loaded]" ); }` — an assignment, so no star.
  return frameTitle({
    frameName: FP_FRAME_NAME,
    document: null,
    placeholder: FP_NO_DOCUMENT,
    modified: false,
  });
}
