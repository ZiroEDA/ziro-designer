// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/tools/gerbview_inspection_tool.cpp` + `.h`:
 * `GERBVIEW_INSPECTION_TOOL` - the D-code list, the source file, and the
 * measure tool (a RULER_ITEM over a TWO_POINT_GEOMETRY_MANAGER).
 */

import type { EdaUnits } from '@ziroeda/common/eda_units.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { RULER_ITEM } from '@ziroeda/common/preview_items/ruler_item.js';
import {
  LeaderMode as LEADER_MODE,
  TWO_POINT_GEOMETRY_MANAGER,
} from '@ziroeda/common/preview_items/two_point_geom_manager.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { BUT_LEFT, BUT_RIGHT, MD_SHIFT, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { wxFileExists } from '@ziroeda/common/wx/filefn.js';
import { D_CODE } from '../dcode.js';
import type { GERBVIEW_FRAME } from '../gerbview_frame.js';
import { gerbIUScale } from '../gerbview.js';
import { GERBVIEW_ACTIONS } from './gerbview_actions.js';

/** C's `%2.2d`. */
const d2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Tool for pcb inspection.
 */
export class GERBVIEW_INSPECTION_TOOL extends TOOL_INTERACTIVE {
  private m_frame: GERBVIEW_FRAME | null; // Pointer to the parent frame.

  constructor() {
    super('gerbview.Inspection');
    this.m_frame = null;
  }

  /// @copydoc TOOL_INTERACTIVE::Init()
  override Init(): boolean {
    return true;
  }

  /// @copydoc TOOL_INTERACTIVE::Reset()
  override Reset(_aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<GERBVIEW_FRAME>();
  }

  ///< Show a list of the DCodes
  ShowDCodes(_aEvent: TOOL_EVENT): number {
    const frame = this.m_frame!;
    const list: string[] = [];
    const curr_layer = frame.GetActiveLayer();

    let scale = 1.0;
    let units = '';

    switch (frame.GetUserUnits()) {
      case 'mm':
        scale = gerbIUScale.IU_PER_MM;
        units = 'mm';
        break;

      case 'in':
        scale = gerbIUScale.IU_PER_MILS * 1000;
        units = 'in';
        break;

      case 'mils':
        scale = gerbIUScale.IU_PER_MILS;
        units = 'mil';
        break;

      default:
        console.assert(false, 'Invalid units');
    }

    for (let layer = 0; layer < frame.ImagesMaxCount(); ++layer) {
      const gerber = frame.GetGbrImage(layer);

      if (!gerber) continue;

      if (gerber.GetDcodesCount() === 0) continue;

      if (curr_layer === layer) list.push(`*** Active layer (${d2(layer + 1)}) ***`);
      else list.push(`*** layer ${d2(layer + 1)}  ***`);

      let ii = 1;

      // std::map<int, D_CODE*>: walked in key order.
      for (const [, pt_D_code] of [...gerber.m_ApertureList.entries()].sort(
        (a, b) => a[0] - b[0],
      )) {
        if (pt_D_code === null) continue;

        if (!pt_D_code.m_InUse && !pt_D_code.m_Defined) continue;

        let Line =
          `tool ${ii}:   Dcode D${pt_D_code.m_Num_Dcode}   ` +
          `V ${(pt_D_code.m_Size.y / scale).toFixed(4)} ${units}  ` +
          `H ${(pt_D_code.m_Size.x / scale).toFixed(4)} ${units}   ` +
          `${D_CODE.ShowApertureType(pt_D_code.m_ApertType)}  ` +
          `attribute '${pt_D_code.m_AperFunction === '' ? 'none' : pt_D_code.m_AperFunction}'`;

        if (!pt_D_code.m_Defined) Line += ' (not defined)';

        if (pt_D_code.m_InUse) Line += ' (in use)';

        list.push(Line);
        ii++;
      }
    }

    // wxSingleChoiceDialog( m_frame, "", _( "D Codes" ), list, nullptr,
    //                       wxCHOICEDLG_STYLE & ~wxCANCEL ).ShowModal()
    void frame.Host().SingleChoiceDialog('D Codes', list);

    return 0;
  }

  ///< Show the source for the gerber file
  ShowSource(_aEvent: TOOL_EVENT): number {
    const frame = this.m_frame!;
    const layer = frame.GetActiveLayer();
    const gerber_layer = frame.GetGbrImage(layer);

    if (gerber_layer) {
      // Pgm().GetTextEditor(): a page has no text editor to launch.
      const editorname = '';

      if (editorname !== '') {
        // Call the editor only if the Gerber/drill source file is available.
        // This is not always the case, because it can be a temporary file
        // if it comes from a zip archive.
        if (!wxFileExists(gerber_layer.m_FileName)) {
          const msg = `Source file '${gerber_layer.m_FileName}' not found.`;
          void frame.Host().MessageBox(msg);
        }
      } else {
        void frame.Host().MessageBox('No text editor selected in KiCad.  Please choose one.');
      }
    } else {
      const msg = `No file loaded on the active layer ${layer + 1}.`;
      void frame.Host().MessageBox(msg);
    }

    return 0;
  }

  ///< Launch a tool to measure between points
  *MeasureTool(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.m_frame!;
    const controls = this.getViewControls() as unknown as VIEW_CONTROLS;
    let originSet = false;
    const twoPtMgr = new TWO_POINT_GEOMETRY_MANAGER();
    let units: EdaUnits = frame.GetUserUnits();
    const ruler = new RULER_ITEM(twoPtMgr, gerbIUScale, units, false, false);

    frame.PushTool(aEvent);

    const setCursor = (): void => {
      frame.GetCanvas()!.SetCurrentCursor(KICURSOR.MEASURE);
    };

    const cleanup = (): void => {
      this.getView()!.SetVisible(ruler, false);
      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      originSet = false;
    };

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);
    // Set initial cursor
    setCursor();

    this.getView()!.Add(ruler);
    this.getView()!.SetVisible(ruler, false);

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();
      const c = controls.GetCursorPosition();
      const cursorPos = { x: Math.round(c.x), y: Math.round(c.y) };

      if (evt.IsCancelInteractive()) {
        if (originSet) {
          cleanup();
        } else {
          frame.PopTool(aEvent);
          break;
        }
      } else if (evt.IsActivate()) {
        if (originSet) cleanup();

        if (evt.IsMoveTool()) {
          // leave ourselves on the stack so we come back after the move
          break;
        } else {
          frame.PopTool(aEvent);
          break;
        }
      } else if (!originSet && (evt.IsDrag(BUT_LEFT) || evt.IsClick(BUT_LEFT))) {
        // click or drag starts
        twoPtMgr.SetOrigin(cursorPos);
        twoPtMgr.SetEnd(cursorPos);

        controls.CaptureCursor(true);
        controls.SetAutoPan(true);

        originSet = true;
      } else if (originSet && (evt.IsClick(BUT_LEFT) || evt.IsMouseUp(BUT_LEFT))) {
        // second click or mouse up after drag ends
        originSet = false;

        controls.SetAutoPan(false);
        controls.CaptureCursor(false);
      } else if (originSet && (evt.IsMotion() || evt.IsDrag(BUT_LEFT))) {
        // move or drag when origin set updates rules
        twoPtMgr.SetAngleSnap(evt.Modifier(MD_SHIFT) ? LEADER_MODE.DEG45 : LEADER_MODE.DIRECT);
        twoPtMgr.SetEnd(cursorPos);

        this.getView()!.SetVisible(ruler, true);
        this.getView()!.Update(ruler, VIEW_UPDATE_FLAGS.GEOMETRY);
      } else if (evt.IsAction(ACTIONS.updateUnits)) {
        if (frame.GetUserUnits() !== units) {
          units = frame.GetUserUnits();
          ruler.SwitchUnits(units);
          this.getView()!.Update(ruler, VIEW_UPDATE_FLAGS.GEOMETRY);
        }

        evt.SetPassEvent();
      } else if (evt.IsClick(BUT_RIGHT)) {
        this.m_menu.ShowContextMenu(frame.GetCurrentSelection());
      } else {
        evt.SetPassEvent();
      }
    }

    this.getView()!.SetVisible(ruler, false);
    this.getView()!.Remove(ruler);

    frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
    return 0;
  }

  ///< @copydoc TOOL_INTERACTIVE::setTransitions()
  protected setTransitions(): void {
    this.Go(SYNC_HANDLER(this.ShowSource), GERBVIEW_ACTIONS.showSource.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowDCodes), GERBVIEW_ACTIONS.showDCodes.MakeEvent());
    this.Go(this.MeasureTool, ACTIONS.measureTool.MakeEvent());
  }
}
