// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/tools/assign_footprints.cpp`: `SCH_EDITOR_CONTROL::AssignFootprints`,
 * what the schematic does with CvPcb's `MAIL_ASSIGN_FOOTPRINTS` — a
 * `(cvpcb_netlist (ref "R1" (fpid "Lib:Name")) …)` written by
 * `NETLIST::FormatCvpcbNetlist`.
 *
 * Upstream reads the payload with DSNLEXER into a PTREE; the s-expression
 * reader here gives the same nodes. The schematic's items are immutable, so the
 * changes come back as one EditCommand per sheet file, pushed together as the
 * one "Assign Footprints" commit.
 */
import { head, parse } from '@ziroeda/sexpr';
import { arg, childNamed, childrenNamed } from '@ziroeda/sexpr/query.js';
import type { Schematic, SchField, SchSymbol } from '../types.js';
import { buildPropertyNode } from '../sch_io/sexpr/write-schematic.js';
import type { EditCommand } from './command.js';
import { refId } from './hittest.js';
import { DSNLEXER } from '@ziroeda/common/dsnlexer.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { PTREE, PTREE_ERROR, Scan } from '@ziroeda/common/ptree.js';
import { LINE_READER } from '@ziroeda/common/richio.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { footprintAssignmentWildcard } from '@ziroeda/common/wildcards_and_files_ext.js';
import { wxFD_FILE_MUST_EXIST, wxFD_OPEN } from '@ziroeda/common/wx/defs.js';
import { wxReadFileSync } from '@ziroeda/common/wx/filefn.js';
import { wxID_OK } from '@ziroeda/common/wx/menu.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_REFERENCE_LIST } from '../sch_reference_list.js';
import { SYMBOL_FILTER } from '../sch_sheet_path.js';
import type { SCH_EDITOR_CONTROL } from './sch_editor_control.js';

/** `wxSingleChoiceDialog`'s answer, which the window fills on OK. */
export interface SINGLE_CHOICE_ARG {
  message: string;
  caption: string;
  choices: readonly string[];
  /** `GetSelection()`. */
  selection: number;
}

/** `getEditFrame<SCH_EDIT_FRAME>()`, which is protected: the tool manager's holder. */
function editFrameOf(aTool: SCH_EDITOR_CONTROL): SCH_EDIT_FRAME {
  return aTool.GetManager()!.GetToolHolder() as unknown as SCH_EDIT_FRAME;
}

export class SCH_ASSIGN_FOOTPRINTS_MIXIN {
  /**
   * `AssignFootprints( aChangedSetOfReferences )` (assign_footprints.cpp:46): CvPcb's
   * `(cvpcb_netlist (ref "R1" (fpid "Lib:Name")) …)` onto every instance of each reference.
   * Throws IO_ERROR for a payload that is not one.
   */
  AssignFootprints(this: SCH_EDITOR_CONTROL, aChangedSetOfReferences: string): void {
    const frame = editFrameOf(this);

    // Build a flat list of symbols in schematic:
    const refs = new SCH_REFERENCE_LIST();
    const commit = new SCH_COMMIT(frame);
    let isChanged = false;

    frame.Schematic().Hierarchy().GetSymbols(refs, SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER);

    const lexer = new DSNLEXER(aChangedSetOfReferences, 'AssignFootprints');
    const doc = new PTREE();

    try {
      Scan(doc, lexer);

      const back_anno = doc.get_child('cvpcb_netlist');
      let footprint: string;

      for (const [key, ref] of back_anno) {
        console.assert(key === 'ref');

        const reference = ref.front()[0];

        // Ensure the "fpid" node contains a footprint name, and get it if exists
        if (ref.get_child('fpid').size()) footprint = ref.get_child('fpid').front()[0];
        else footprint = '';

        // Search the symbol in the flat list
        for (let ii = 0; ii < refs.GetCount(); ++ii) {
          if (reference === refs.at(ii).GetRef()) {
            // We have found a candidate.
            // Note: it can be not unique (multiple parts per package)
            // So we *do not* stop the search here
            const symbol = refs.at(ii).GetSymbol();

            // For backwards-compatibility CvPcb currently updates all instances of a
            // symbol (even though it lists these instances separately).
            const oldfp = refs.at(ii).GetFootprint();
            const footprintField = symbol.GetField(FIELD_T.FOOTPRINT)!;

            if (oldfp === '' && footprintField.IsVisible()) footprintField.SetVisible(false);

            if (oldfp !== footprint) {
              isChanged = true;
              const screen = refs.at(ii).GetSheetPath().LastScreen();

              commit.Modify(symbol, screen, RECURSE_MODE.NO_RECURSE);
              footprintField.SetText(footprint);
            }
          }
        }
      }
    } catch (ex) {
      // remap the exception to something the caller is likely to understand.
      if (ex instanceof PTREE_ERROR) throw new IO_ERROR(ex.message);

      throw ex;
    }

    if (isChanged) {
      frame.SyncView();
      commit.Push('Assign Footprints');
    }
  }

  /**
   * `processCmpToFootprintLinkFile( aFullFilename, aForceVisibilityState, aVisibilityState )`
   * (assign_footprints.cpp:124): a CvPcb `.cmp` file's footprints onto the symbols. False when the
   * file cannot be read.
   */
  processCmpToFootprintLinkFile(
    this: SCH_EDITOR_CONTROL,
    aFullFilename: string,
    aForceVisibilityState: boolean,
    aVisibilityState: boolean,
  ): boolean {
    const frame = editFrameOf(this);

    // Build a flat list of symbols in schematic:
    const referencesList = new SCH_REFERENCE_LIST();
    frame.Schematic().Hierarchy().GetSymbols(referencesList, SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER);

    const bytes = wxReadFileSync(aFullFilename);

    if (bytes === null) return false;

    const cmpFileReader = new LINE_READER(bytes, aFullFilename);
    const lineText = () => {
      const line = cmpFileReader.Line();
      return new TextDecoder().decode(line.subarray(0, cmpFileReader.Length()));
    };

    // Now, for each symbol found in file,
    // replace footprint field value by the new value:
    let reference: string;
    let footprint: string;
    let buffer: string;
    let value: string;

    while (cmpFileReader.ReadLine()) {
      buffer = lineText();

      if (!buffer.startsWith('BeginCmp')) continue;

      // Begin symbol description.
      reference = '';
      footprint = '';

      while (cmpFileReader.ReadLine()) {
        buffer = lineText();

        if (buffer.startsWith('EndCmp')) break;

        // store string value, stored between '=' and ';' delimiters.
        const eq = buffer.indexOf('=');
        value = eq < 0 ? '' : buffer.slice(eq + 1);
        const semi = value.lastIndexOf(';');
        value = semi < 0 ? value : value.slice(0, semi); // BeforeLast: all of it when absent
        value = value.trim();

        if (buffer.startsWith('Reference')) reference = value;
        else if (buffer.startsWith('IdModule')) footprint = value;
      }

      // A block is read: initialize the footprint field of the corresponding symbol
      // if the footprint name is not empty
      if (reference === '') continue;

      // Search the symbol in the flat list
      for (let ii = 0; ii < referencesList.GetCount(); ii++) {
        if (reference === referencesList.at(ii).GetRef()) {
          // We have found a candidate.
          // Note: it can be not unique (multiple units per part)
          // So we *do not* stop the search here
          const symbol = referencesList.at(ii).GetSymbol();

          symbol.SetFootprintFieldText(footprint);

          if (aForceVisibilityState)
            symbol.GetField(FIELD_T.FOOTPRINT)!.SetVisible(aVisibilityState);
        }
      }
    }

    return true;
  }

  /** `ImportFPAssignments( aEvent )` (assign_footprints.cpp:204). */
  *ImportFPAssignments(this: SCH_EDITOR_CONTROL, _aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = editFrameOf(this);
    const projectFullName = frame.Prj().GetProjectFullName();
    const path = projectFullName.includes('/')
      ? projectFullName.slice(0, projectFullName.lastIndexOf('/'))
      : '';

    const filename = yield* this.RunMainStackModal(() =>
      frame.ShowFileDialog(
        'Load Symbol Footprint Link File',
        path,
        '',
        [footprintAssignmentWildcard()],
        wxFD_OPEN | wxFD_FILE_MUST_EXIST,
      ),
    );

    if (filename === null) return 0;

    const choiceDlg: SINGLE_CHOICE_ARG = {
      message: 'Select the footprint field visibility setting.',
      caption: 'Change Visibility',
      choices: [
        'Keep existing footprint field visibility',
        'Show all footprint fields',
        'Hide all footprint fields',
      ],
      selection: 0,
    };

    const answer = yield* this.RunMainStackModal(() =>
      frame.ShowModalDialog('wxSingleChoiceDialog', [], choiceDlg),
    );

    if (answer !== wxID_OK) return 0;

    const forceVisibility = choiceDlg.selection !== 0;
    const visibilityState = choiceDlg.selection === 1;

    if (!this.processCmpToFootprintLinkFile(filename, forceVisibility, visibilityState)) {
      const msg = `Failed to open symbol-footprint link file '${filename}'.`;

      frame.DisplayError(msg);
      return 0;
    }

    frame.SyncView();
    frame.GetCanvas()?.Refresh();
    frame.OnModify();
    return 0;
  }
}
