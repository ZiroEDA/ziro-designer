// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/edit_tool_move_fct.cpp`: EDIT_TOOL's move half - Swap,
 * SwapPadNets, SwapGateNets, PackAndMoveFootprints, Move, getSafeMovement and
 * doMoveSelection. KiCad compiles it into the same class; here it is a mixin
 * edit_tool.ts applies to EDIT_TOOL, each method taking `this: EDIT_TOOL`.
 */
import { type EDA_ITEM, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { IS_MOVING } from '@ziroeda/common/eda_item_flags.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import * as KIPLATFORM_UI from '@ziroeda/common/kiplatform/ui.js';
import { LSET } from '@ziroeda/common/lset.js';
import { STATUS_TEXT_POPUP } from '@ziroeda/common/status_popup.js';
import {
  ACTIONS,
  CURSOR_EVENT_TYPE,
  EVENTS,
  type INCREMENT,
} from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { BUT_LEFT, BUT_RIGHT, MD_SHIFT, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { wxBell } from '@ziroeda/common/wx/utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { BOX2D, type BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 as VECTOR2D, Vec2 as VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { SpreadFootprints } from '../autorouter/spread_footprints.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import { DRC_INTERACTIVE_COURTYARD_CLEARANCE } from '../drc/drc_interactive_courtyard_clearance.js';
import type { FOOTPRINT } from '../footprint.js';
import { FP_JUST_ADDED } from '../footprint.js';
import { PAD } from '../pad.js';
import type { PCB_GENERATOR } from '../pcb_generator.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import { COORDS_PADDING, type EDIT_TOOL } from './edit_tool.js';
import { popupFocus as popupFocusOf } from './pcb_picker_tool.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { SYNCRONOUS_TOOL_STATE as STS } from '@ziroeda/common/tool/tool_event.js';

const VIEW_UPDATE_GEOMETRY = VIEW_UPDATE_FLAGS.GEOMETRY;

/** `VECTOR2I( VECTOR2D )`: the casting constructor truncates. */
function toI(aPt: VECTOR2D): VECTOR2I {
  return { x: Math.trunc(aPt.x), y: Math.trunc(aPt.y) };
}
import { PCB_ACTIONS } from './pcb_actions.js';
import { IsZoneFillAction } from './pcb_picker_tool.js';
import { PCB_GRID_HELPER } from './pcb_grid_helper.js';

/** `std::numeric_limits<int>::max()`. */
const INT_MAX = 2147483647;

/**
 * Ask whether unselected pads on the nets being swapped change too: resolves
 * true with `aIncludeConnectedPads` set, or false when the user cancelled.
 */
function PromptConnectedPadDecision(
  aTool: EDIT_TOOL,
  aPads: readonly PAD[],
  aDialogTitle: string,
): Promise<{ proceed: boolean; includeConnectedPads: boolean }> {
  if (aPads.length === 0) return Promise.resolve({ proceed: true, includeConnectedPads: true });

  const uniquePads = [...new Set(aPads)];

  const msg = `${uniquePads.length} unselected pad(s) are connected to these nets. How do you want to proceed?`;

  let details =
    'Connected tracks, vias, and other non-zone copper items will still swap nets' +
    ' even if you ignore the unselected pads.' +
    '\n \n' + // Add space so GTK doesn't eat the newlines
    'Unselected pads:' +
    '\n';

  for (const pad of uniquePads) {
    const fp = pad.GetParentFootprint();
    details += `  • ${fp ? fp.GetReference() : '<no reference designator>'}:${pad.GetNumber()}\n`;
  }

  const frame = aTool.editFrame();

  if (!frame.ShowConnectedPadDialog)
    return Promise.resolve({ proceed: false, includeConnectedPads: true });

  return frame.ShowConnectedPadDialog(aDialogTitle, msg, details).then((ret) => {
    if (ret === null) return { proceed: false, includeConnectedPads: true };

    return { proceed: true, includeConnectedPads: ret === 'all' };
  });
}

/** EDIT_TOOL's methods from edit_tool_move_fct.cpp, mixed into EDIT_TOOL. */
export class EDIT_TOOL_MOVE_FCT {
  /**
   * Swap currently selected items' positions. Changes position of each item to the next.
   */
  Swap(this: EDIT_TOOL, aEvent: TOOL_EVENT): number {
    if (this.isRouterActive()) {
      wxBell();
      return 0;
    }

    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForMarkers(aCollector);
      sTool.FilterCollectorForHierarchy(aCollector, true);
      sTool.FilterCollectorForFreePads(aCollector);

      // Iterate from the back so we don't have to worry about removals.
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        const item = aCollector.At(i)!;

        if (item.Type() === KICAD_T.PCB_TRACE_T) aCollector.Remove(item);
      }

      sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    if (selection.Size() < 2) return 0;

    const localCommit = new BOARD_COMMIT(this);
    const eventCommit = aEvent.Commit();
    const commit = eventCommit instanceof BOARD_COMMIT ? eventCommit : localCommit;

    const sorted = selection.GetItemsSortedBySelectionOrder();

    // Save items, so changes can be undone
    for (const item of selection) commit.Modify(item, null, RECURSE_MODE.RECURSE);

    for (let i = 0; i < sorted.length - 1; i++) {
      const edaItemA = sorted[i]!;
      const edaItemB = sorted[(i + 1) % sorted.length]!;

      if (!edaItemA.IsBOARD_ITEM() || !edaItemB.IsBOARD_ITEM()) continue;

      const a = edaItemA as unknown as BOARD_ITEM;
      const b = edaItemB as unknown as BOARD_ITEM;

      // Pads may have a copper shape offset from the anchor/hole, so swap visible shape
      // centers rather than anchor positions.  See PAD::SwapShapePositions.
      if (a.Type() === KICAD_T.PCB_PAD_T && b.Type() === KICAD_T.PCB_PAD_T) {
        PAD.SwapShapePositions(a as PAD, b as PAD);

        const aLayer = a.GetLayer();
        const bLayer = b.GetLayer();
        a.SetLayer(bLayer);
        b.SetLayer(aLayer);

        continue;
      }

      // Swap X,Y position
      const aPos = b.GetPosition();
      const bPos = a.GetPosition();
      a.SetPosition(aPos);
      b.SetPosition(bPos);

      // Handle footprints specially. They can be flipped to the back of the board which
      // requires a special transformation.
      if (a.Type() === KICAD_T.PCB_FOOTPRINT_T && b.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        const aFP = a as FOOTPRINT;
        const bFP = b as FOOTPRINT;

        // Store initial orientation of footprints, before flipping them.
        const aAngle = aFP.GetOrientation();
        const bAngle = bFP.GetOrientation();

        // Flip both if needed
        if (aFP.IsFlipped() !== bFP.IsFlipped()) {
          aFP.Flip(aPos, FLIP_DIRECTION.TOP_BOTTOM);
          bFP.Flip(bPos, FLIP_DIRECTION.TOP_BOTTOM);
        }

        // Set orientation
        aFP.SetOrientation(bAngle);
        bFP.SetOrientation(aAngle);
      }
      // We can also do a layer swap safely for two objects of the same type,
      // except groups which don't support layer swaps.
      else if (a.Type() === b.Type() && a.Type() !== KICAD_T.PCB_GROUP_T) {
        // Swap layers
        const aLayer = a.GetLayer();
        const bLayer = b.GetLayer();
        a.SetLayer(bLayer);
        b.SetLayer(aLayer);
      }
    }

    if (!localCommit.Empty()) localCommit.Push('Swap');

    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);

    return 0;
  }

  /**
   * Swap nets between selected pads and propagate to connected copper items
   * (tracks, arcs, vias) for unconstrained pin swapping.
   */
  SwapPadNets(this: EDIT_TOOL, aEvent: TOOL_EVENT): number {
    if (this.isRouterActive()) {
      wxBell();
      return 0;
    }

    const selection = this.selTool().RequestSelection(
      (this.constructor as unknown as { PadFilter: typeof EDIT_TOOL.PadFilter }).PadFilter,
    );

    if (selection.Size() < 2 || !selection.OnlyContains([KICAD_T.PCB_PAD_T])) return 0;

    // Get selected pads in selection order, because swapping is cyclic and we let the user pick
    // the rotation order
    const orderedPads = selection.GetItemsSortedBySelectionOrder();
    const pads: PAD[] = orderedPads.map((it) => it as unknown as PAD);
    const padsCount = orderedPads.length;

    // Record original nets and build selected set for quick membership tests
    const originalNets: number[] = new Array(padsCount);
    const selectedPads = new Set<PAD>();

    for (let i = 0; i < padsCount; ++i) {
      originalNets[i] = pads[i]!.GetNetCode();
      selectedPads.add(pads[i]!);
    }

    // If all nets are the same, nothing to do
    let allSame = true;

    for (let i = 1; i < padsCount; ++i) {
      if (originalNets[i] !== originalNets[0]) {
        allSame = false;
        break;
      }
    }

    if (allSame) return 0;

    // Desired new nets are a cyclic rotation of original nets (like Swap positions)
    const newNetForIndex = (i: number): number => originalNets[(i + 1) % padsCount]!;

    // Take an event commit since we will eventually support this while actively routing the board
    const localCommit = new BOARD_COMMIT(this);
    const eventCommit = aEvent.Commit();
    const commit = eventCommit instanceof BOARD_COMMIT ? eventCommit : localCommit;

    // Connectivity to find items connected to each pad
    const connectivity = this.board().GetConnectivity();

    // Accumulate changes: for each item, assign the resulting new net
    const itemNewNets = new Map<BOARD_CONNECTED_ITEM, number>();
    const nonSelectedPadsToChange: PAD[] = [];

    for (let i = 0; i < padsCount; ++i) {
      const pad = pads[i]!;
      const fromNet = originalNets[i]!;
      const toNet = newNetForIndex(i);

      // For each connected item, if it matches fromNet, schedule it for toNet
      for (const ci of connectivity.GetConnectedItems(pad, 0)) {
        switch (ci.Type()) {
          case KICAD_T.PCB_TRACE_T:
          case KICAD_T.PCB_ARC_T:
          case KICAD_T.PCB_VIA_T:
          case KICAD_T.PCB_PAD_T:
            break;
          // Exclude zones, user probably doesn't want to change zone nets
          default:
            continue;
        }

        if (ci.GetNetCode() !== fromNet) continue;

        // Track conflicts: if already assigned a different new net, just overwrite (last wins)
        itemNewNets.set(ci, toNet);

        if (ci.Type() === KICAD_T.PCB_PAD_T) {
          const otherPad = ci as unknown as PAD;

          if (!selectedPads.has(otherPad)) nonSelectedPadsToChange.push(otherPad);
        }
      }
    }

    void PromptConnectedPadDecision(this, nonSelectedPadsToChange, 'Swap Pad Nets').then(
      ({ proceed, includeConnectedPads }) => {
        if (!proceed) return;

        // Apply changes
        // 1) Selected pads get their new nets directly
        for (let i = 0; i < padsCount; ++i) {
          commit.Modify(pads[i]!);
          pads[i]!.SetNetCode(newNetForIndex(i));
        }

        // 2) Connected items propagate, depending on user choice
        for (const [item, newNet] of itemNewNets) {
          if (item.Type() === KICAD_T.PCB_PAD_T) {
            const p = item as unknown as PAD;

            if (selectedPads.has(p)) continue; // already changed above

            if (!includeConnectedPads) continue; // skip non-selected pads if requested
          }

          commit.Modify(item);
          item.SetNetCode(newNet);
        }

        if (!localCommit.Empty()) localCommit.Push('Swap Pad Nets');

        // Ensure connectivity visuals update
        this.rebuildConnectivity();
        this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);
      },
    );

    return 0;
  }

  SwapGateNets(this: EDIT_TOOL, aEvent: TOOL_EVENT): number {
    if (this.isRouterActive()) {
      wxBell();
      return 0;
    }

    const showError = (): void => {
      this.editFrame().ShowInfoBarError?.(
        'Gate swapping must be performed on pads within one multi-gate footprint.',
      );
    };

    const selection = this.selTool().RequestSelection(
      (this.constructor as unknown as { PadFilter: typeof EDIT_TOOL.PadFilter }).PadFilter,
    );

    // Get our sanity checks out of the way to clean up later loops
    let targetFp: FOOTPRINT | null = null;
    let fail = false;

    for (const it of selection) {
      // This shouldn't happen due to the filter, but just in case
      if (it.Type() !== KICAD_T.PCB_PAD_T) {
        fail = true;
        break;
      }

      const fp = (it as unknown as PAD).GetParentFootprint();

      if (!targetFp) {
        targetFp = fp;
      } else if (fp && targetFp !== fp) {
        fail = true;
        break;
      }
    }

    if (fail || !targetFp || targetFp.GetUnitInfo().length < 2) {
      showError();
      return 0;
    }

    const units = targetFp.GetUnitInfo();

    // Collect unit hits and ordered unit list based on selection order
    const unitHit: boolean[] = new Array(units.length).fill(false);
    const unitOrder: number[] = [];

    const orderedPads = selection.GetItemsSortedBySelectionOrder();

    for (const it of orderedPads) {
      const pad = it as unknown as PAD;

      const padNum = pad.GetNumber();
      let unitIdx = -1;

      for (let i = 0; i < units.length; ++i) {
        for (const p of units[i]!.m_pins) {
          if (p === padNum) {
            unitIdx = i;

            if (!unitHit[i]) unitOrder.push(unitIdx);

            unitHit[i] = true;
            break;
          }
        }

        if (unitIdx >= 0) break;
      }
    }

    // Determine active units from selection order: 0 -> bail, 1 -> single-unit flow, 2+ -> cycle
    let activeUnitIdx: number[] = [];
    let sourceIdx = -1;

    if (unitOrder.length >= 2) {
      activeUnitIdx = unitOrder;
      sourceIdx = unitOrder[0]!;
    }
    // If we only have one gate selected, we must have a target unit name parameter to proceed
    else if (unitOrder.length === 1 && aEvent.HasParameter()) {
      sourceIdx = unitOrder[0]!;
      const targetUnitByName = aEvent.Parameter<string>();

      let targetIdx = -1;

      for (let i = 0; i < units.length; ++i) {
        if (i === sourceIdx) continue;

        if (
          units[i]!.m_pins.length === units[sourceIdx]!.m_pins.length &&
          units[i]!.m_unitName === targetUnitByName
        )
          targetIdx = i;
      }

      if (targetIdx < 0) {
        showError();
        return 0;
      }

      activeUnitIdx.push(sourceIdx);
      activeUnitIdx.push(targetIdx);
    } else {
      showError();
      return 0;
    }

    // Verify equal pin counts across all active units
    const pinCount = units[activeUnitIdx[0]!]!.m_pins.length;

    for (const idx of activeUnitIdx) {
      if (units[idx]!.m_pins.length !== pinCount) {
        this.editFrame().ShowInfoBarError?.(
          'Gate swapping must be performed on gates with equal pin counts.',
        );
        return 0;
      }
    }

    // Build per-unit pad arrays and net vectors
    const unitCount = activeUnitIdx.length;
    const unitPads: PAD[][] = [];
    const unitNets: number[][] = [];

    for (let ui = 0; ui < unitCount; ++ui) {
      const uidx = activeUnitIdx[ui]!;
      const pins = units[uidx]!.m_pins;

      unitPads.push([]);
      unitNets.push([]);

      for (let pi = 0; pi < pinCount; ++pi) {
        const p = targetFp.FindPadByNumber(pins[pi]!);

        if (!p) {
          this.editFrame().ShowInfoBarError?.(
            'Gate swapping failed: pad in unit missing from footprint.',
          );
          return 0;
        }

        unitPads[ui]!.push(p);
        unitNets[ui]!.push(p.GetNetCode());
      }
    }

    // If all unit nets match across positions, nothing to do
    let allSame = true;

    for (let pi = 0; pi < pinCount && allSame; ++pi) {
      const refNet = unitNets[0]![pi]!;

      for (let ui = 1; ui < unitCount; ++ui) {
        if (unitNets[ui]![pi] !== refNet) {
          allSame = false;
          break;
        }
      }
    }

    if (allSame) {
      this.editFrame().ShowInfoBarError?.(
        'Gate swapping has no effect: all selected gates have identical nets.',
      );
      return 0;
    }

    // TODO: someday support swapping while routing and take that commit
    const localCommit = new BOARD_COMMIT(this);
    const eventCommit = aEvent.Commit();
    const commit = eventCommit instanceof BOARD_COMMIT ? eventCommit : localCommit;

    const connectivity = this.board().GetConnectivity();

    // Accumulate changes: item -> new net
    const itemNewNets = new Map<BOARD_CONNECTED_ITEM, number>();
    const nonSelectedPadsToChange: PAD[] = [];

    // Selected pads in the swap (for suppressing re-adding in connected pad handling)
    const swapPads = new Set<PAD>();

    for (const v of unitPads) for (const p of v) swapPads.add(p);

    // Schedule net swaps for connectivity-attached items
    const scheduleForPad = (pad: PAD, fromNet: number, toNet: number): void => {
      for (const ci of connectivity.GetConnectedItems(pad, 0)) {
        switch (ci.Type()) {
          case KICAD_T.PCB_TRACE_T:
          case KICAD_T.PCB_ARC_T:
          case KICAD_T.PCB_VIA_T:
          case KICAD_T.PCB_PAD_T:
            break;

          default:
            continue;
        }

        if (ci.GetNetCode() !== fromNet) continue;

        itemNewNets.set(ci, toNet);

        if (ci.Type() === KICAD_T.PCB_PAD_T) {
          const other = ci as unknown as PAD;

          if (!swapPads.has(other)) nonSelectedPadsToChange.push(other);
        }
      }
    };

    // For each position, rotate nets among units forward
    for (let pi = 0; pi < pinCount; ++pi) {
      for (let ui = 0; ui < unitCount; ++ui) {
        const fromIdx = ui;
        const toIdx = (ui + 1) % unitCount;

        const padFrom = unitPads[fromIdx]![pi]!;
        const fromNet = unitNets[fromIdx]![pi]!;
        const toNet = unitNets[toIdx]![pi]!;

        scheduleForPad(padFrom, fromNet, toNet);
      }
    }

    void PromptConnectedPadDecision(this, nonSelectedPadsToChange, 'Swap Gate Nets').then(
      ({ proceed, includeConnectedPads }) => {
        if (!proceed) return;

        // Apply pad net swaps: rotate per position
        for (let pi = 0; pi < pinCount; ++pi) {
          // First write back nets for each unit's pad at this position
          for (let ui = 0; ui < unitCount; ++ui) {
            const toIdx = (ui + 1) % unitCount;
            const pad = unitPads[ui]![pi]!;
            const newNet = unitNets[toIdx]![pi]!;

            commit.Modify(pad);
            pad.SetNetCode(newNet);
          }
        }

        // Apply connected items
        for (const [item, newNet] of itemNewNets) {
          if (item.Type() === KICAD_T.PCB_PAD_T) {
            const p = item as unknown as PAD;

            if (swapPads.has(p)) continue;

            if (!includeConnectedPads) continue;
          }

          commit.Modify(item);
          item.SetNetCode(newNet);
        }

        if (!localCommit.Empty()) localCommit.Push('Swap Gate Nets');

        this.rebuildConnectivity();
        this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);
      },
    );

    return 0;
  }

  /**
   * Try to fit selected footprints inside a minimal area and start movement.
   */
  *PackAndMoveFootprints(this: EDIT_TOOL, aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.isRouterActive() || this.m_dragging) {
      wxBell();
      return 0;
    }

    const commit = new BOARD_COMMIT(this);
    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForMarkers(aCollector);
      sTool.FilterCollectorForHierarchy(aCollector, true);
      sTool.FilterCollectorForFreePads(aCollector, true);

      // Iterate from the back so we don't have to worry about removals.
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        const item = aCollector.At(i)!;

        if (item.Type() !== KICAD_T.PCB_FOOTPRINT_T) aCollector.Remove(item);
      }

      sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    const footprintsToPack: FOOTPRINT[] = [];

    for (const item of selection) footprintsToPack.push(item as unknown as FOOTPRINT);

    if (footprintsToPack.length === 0) return 0;

    let footprintsBbox: BOX2I | null = null;

    for (const fp of footprintsToPack) {
      commit.Modify(fp);
      fp.SetFlags(IS_MOVING);

      const b = fp.GetBoundingBox(false);

      if (footprintsBbox) footprintsBbox.Merge(b);
      else footprintsBbox = b;
    }

    SpreadFootprints(footprintsToPack, footprintsBbox!.Normalize().GetOrigin(), false);

    if (yield* this.doMoveSelection(aEvent, commit, true)) commit.Push('Pack Footprints');
    else commit.Revert();

    return 0;
  }

  /**
   * Main loop in which events are handled.
   */
  *Move(this: EDIT_TOOL, aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.isRouterActive() || this.m_dragging) {
      wxBell();
      return 0;
    }

    const eventCommit = aEvent.Commit();

    if (eventCommit instanceof BOARD_COMMIT) {
      const state = aEvent.SynchronousState();

      // Most moves will be synchronous unless they are coming from the API
      if (state) state.value = STS.STS_RUNNING;

      if (yield* this.doMoveSelection(aEvent, eventCommit, true)) {
        if (state) state.value = STS.STS_FINISHED;
      } else if (state) {
        state.value = STS.STS_CANCELLED;
      }
    } else {
      const localCommit = new BOARD_COMMIT(this);

      if (yield* this.doMoveSelection(aEvent, localCommit, false)) localCommit.Push('Move');
      else localCommit.Revert();
    }

    // Notify point editor.  (While doMoveSelection() will re-select the items and post this
    // event, it's done before the edit flags are cleared in BOARD_COMMIT::Push() so the point
    // editor doesn't fire up.)
    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    return 0;
  }

  getSafeMovement(
    this: EDIT_TOOL,
    aMovement: VECTOR2I,
    aSourceBBox: BOX2I,
    aBBoxOffset: VECTOR2D,
  ): VECTOR2I {
    const max = INT_MAX - COORDS_PADDING;
    const min = -max;

    const testBox = new BOX2D(aSourceBBox.GetPosition(), aSourceBBox.GetSize());
    testBox.Offset(aBBoxOffset);

    // Do not restrict movement if bounding box is already out of bounds
    if (
      testBox.GetLeft() < min ||
      testBox.GetTop() < min ||
      testBox.GetRight() > max ||
      testBox.GetBottom() > max
    ) {
      return aMovement;
    }

    testBox.Offset(aMovement);

    if (testBox.GetLeft() < min) testBox.Offset(min - testBox.GetLeft(), 0);

    if (max < testBox.GetRight()) testBox.Offset(-(testBox.GetRight() - max), 0);

    if (testBox.GetTop() < min) testBox.Offset(0, min - testBox.GetTop());

    if (max < testBox.GetBottom()) testBox.Offset(0, -(testBox.GetBottom() - max));

    const p = testBox.GetPosition();
    const s = aSourceBBox.GetPosition();

    return {
      x: KiROUND(p.x - aBBoxOffset.x - s.x),
      y: KiROUND(p.y - aBBoxOffset.y - s.y),
    };
  }

  *doMoveSelection(
    this: EDIT_TOOL,
    aEvent: TOOL_EVENT,
    aCommit: BOARD_COMMIT,
    aAutoStart: boolean,
  ): COROUTINE_BODY<boolean> {
    const moveWithReference = aEvent.IsAction(PCB_ACTIONS.moveWithReference);
    const moveIndividually = aEvent.IsAction(PCB_ACTIONS.moveIndividually);

    const editFrame = this.editFrame();
    const cfg = editFrame.GetPcbNewSettings();
    const board = editFrame.GetBoard()!;
    const controls = this.controls();
    const originalCursorPos = controls.GetCursorPosition();
    const originalMousePos = controls.GetMousePosition();
    let statusPopup: STATUS_TEXT_POPUP | null = null;
    let itemIdx = 0;

    // Be sure that there is at least one item that we can modify. If nothing was selected before,
    // try looking for the stuff under mouse cursor (i.e. KiCad old-style hover selection)
    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForMarkers(aCollector);
      sTool.FilterCollectorForHierarchy(aCollector, true);
      sTool.FilterCollectorForFreePads(aCollector);
      sTool.FilterCollectorForTableCells(aCollector);
      sTool.FilterCollectorForLockedItems(aCollector);
    });

    if (this.m_dragging) return false;

    this.selTool().ReportFilteredLockedItems();

    if (selection.Empty()) return false;

    const pushedEvent = aEvent;
    editFrame.PushTool(aEvent);
    this.Activate();

    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);
    controls.SetAutoPan(true);
    controls.ForceCursorPosition(false);

    const displayConstraintsMessage = (aMode: LEADER_MODE): void => {
      let msg: string;

      switch (aMode) {
        case LEADER_MODE.DEG45:
          msg = 'Angle snap lines: 45°';
          break;

        case LEADER_MODE.DEG90:
          msg = 'Angle snap lines: 90°';
          break;

        default:
          msg = '';
          break;
      }

      editFrame.DisplayConstraintsMsg(msg);
    };

    const updateStatusPopup = (item: EDA_ITEM, ii: number, count: number): void => {
      let msg: string;

      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        const fp = item as unknown as FOOTPRINT;
        msg = fp.GetReference();
      } else if (item.Type() === KICAD_T.PCB_PAD_T) {
        const pad = item as unknown as PAD;
        const fp = pad.GetParentFootprint()!;
        msg = `${fp.GetReference()} pad ${pad.GetNumber()}`;
      } else {
        msg = item.GetTypeDesc().toLowerCase();
      }

      if (!statusPopup) statusPopup = new STATUS_TEXT_POPUP();

      statusPopup.SetText(
        `Click to place ${msg} (item ${ii} of ${count})\nPress <esc> to cancel all; double-click to finish`,
      );
    };

    let sel_items: BOARD_ITEM[] = []; // All the items operated on by the move below
    let orig_items: BOARD_ITEM[] = []; // All the original items in the selection

    // Top-level items being moved.  Used instead of selection flags, which can be cleared
    // mid-move by the find dialog (issue 24884).
    let moved_items = new Set<EDA_ITEM>();

    for (const item of selection) {
      if (item.IsBOARD_ITEM()) {
        const boardItem = item as unknown as BOARD_ITEM;

        if (!selection.IsHover()) orig_items.push(boardItem);

        sel_items.push(boardItem);
        moved_items.add(boardItem);
      }

      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        const footprint = item as unknown as FOOTPRINT;

        for (const pad of footprint.Pads()) sel_items.push(pad);

        // Clear this flag here; it will be set by the netlist updater if the footprint is new
        // so that it was skipped in the initial connectivity update in OnNetlistChanged
        footprint.SetAttributes(footprint.GetAttributes() & ~FP_JUST_ADDED);
      }
    }

    const pickedReferencePoint = { value: { x: 0, y: 0 } as VECTOR2I };

    if (
      moveWithReference &&
      !(yield* this.pickReferencePoint(
        'Select reference point for move...',
        '',
        '',
        pickedReferencePoint,
      ))
    ) {
      if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      editFrame.PopTool(pushedEvent);
      return false;
    }

    this.m_inMoveWithReference = moveWithReference;

    if (moveIndividually) {
      orig_items = [];

      for (const item of selection.GetItemsSortedBySelectionOrder()) {
        if (item.IsBOARD_ITEM()) orig_items.push(item as unknown as BOARD_ITEM);
      }

      updateStatusPopup(orig_items[itemIdx]!, itemIdx + 1, orig_items.length);
      const popup = statusPopup as unknown as STATUS_TEXT_POPUP;
      popup.Popup();
      const at = KIPLATFORM_UI.GetMousePosition();
      popup.Move({ x: at.x + 20, y: at.y + 20 });
      this.canvas()?.SetStatusPopup(popupFocusOf(popup));

      this.selTool().ClearSelection();
      this.selTool().AddItemToSel(orig_items[itemIdx]!);

      sel_items = [orig_items[itemIdx]!];

      moved_items = new Set([orig_items[itemIdx]!]);
    }

    let restore_state = false;
    let originalPos: VECTOR2I = { ...originalCursorPos }; // Initialize to current cursor position
    let bboxMovement: VECTOR2D = { x: 0, y: 0 };
    let originalBBox: BOX2I | null = null;
    let updateBBox = true;
    const layers = new LSET([editFrame.GetActiveLayer()]);
    const grid = new PCB_GRID_HELPER(this.m_toolMgr!, editFrame.GetMagneticItemsSettings());
    const copy = aEvent;
    let evt: TOOL_EVENT | null = copy;
    let prevPos: VECTOR2I = { x: 0, y: 0 };
    let enableLocalRatsnest = true;

    let angleSnapMode = this.GetAngleSnapMode();
    let eatFirstMouseUp = true;
    const allowRedraw3D = cfg.m_Display.m_Live3DRefresh;
    const showCourtyardConflicts = !this.m_isFootprintEditor && cfg.m_ShowCourtyardCollisions;

    // Axis locking for arrow key movement
    const AXIS_LOCK = { NONE: 0, HORIZONTAL: 1, VERTICAL: 2 } as const;
    let axisLock: number = AXIS_LOCK.NONE;
    let lastArrowKeyAction = 0;

    // Used to test courtyard overlaps
    let drc_on_move: DRC_INTERACTIVE_COURTYARD_CLEARANCE | null = null;

    if (showCourtyardConflicts) {
      const drcTool = this.m_toolMgr!.FindTool('pcbnew.DRCTool') as unknown as {
        GetDRCEngine(): ConstructorParameters<typeof DRC_INTERACTIVE_COURTYARD_CLEARANCE>[0] | null;
      } | null;
      const drcEngine = drcTool?.GetDRCEngine() ?? null;

      if (drcEngine) {
        drc_on_move = new DRC_INTERACTIVE_COURTYARD_CLEARANCE(drcEngine);
        drc_on_move.Init(board);
      }
    }

    const configureAngleSnap = (aMode: LEADER_MODE): void => {
      let directions: VECTOR2I[] = [];

      switch (aMode) {
        case LEADER_MODE.DEG45:
          directions = [
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
            { x: 1, y: -1 },
          ];
          break;

        case LEADER_MODE.DEG90:
          directions = [
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ];
          break;

        default:
          break;
      }

      grid.SetSnapLineDirections(directions);

      if (directions.length === 0) grid.ClearSnapLine();
      else grid.SetSnapLineOrigin(originalPos);
    };

    configureAngleSnap(angleSnapMode);
    displayConstraintsMessage(angleSnapMode);

    // Prime the pump
    this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);

    // Main loop: keep receiving events
    // `do { ... } while( ( evt = Wait() ) )`: a `continue` takes the next event.
    for (; evt; evt = yield* this.Wait()) {
      let movement: VECTOR2I = { x: 0, y: 0 };
      editFrame.GetCanvas()!.SetCurrentCursor(KICURSOR.MOVING);
      grid.SetSnap(!evt.Modifier(MD_SHIFT));
      grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

      const isSkip = evt.IsAction(PCB_ACTIONS.skip) && moveIndividually;

      if (evt.IsMotion() || evt.IsDrag(BUT_LEFT)) eatFirstMouseUp = false;

      if (
        evt.IsAction(PCB_ACTIONS.move) ||
        evt.IsMotion() ||
        evt.IsDrag(BUT_LEFT) ||
        evt.IsAction(ACTIONS.refreshPreview) ||
        evt.IsAction(PCB_ACTIONS.moveWithReference) ||
        evt.IsAction(PCB_ACTIONS.moveIndividually)
      ) {
        if (
          this.m_dragging &&
          (evt.IsMotion() || evt.IsDrag(BUT_LEFT) || evt.IsAction(ACTIONS.refreshPreview))
        ) {
          let redraw3D = false;

          const selectionGrid = grid.GetSelectionGrid(selection);

          if (controls.GetSettings().m_lastKeyboardCursorPositionValid) {
            const keyboardPos = controls.GetSettings().m_lastKeyboardCursorPosition;

            grid.SetSnap(false);

            // Use the keyboard position directly without grid alignment. The position
            // was already calculated correctly in CursorControl by adding the grid step
            // to the current position. Aligning to grid here would snap to the nearest
            // grid point, which causes precision errors when the original position is
            // not on a grid point (issue #22805).
            this.m_cursor = { x: Math.trunc(keyboardPos.x), y: Math.trunc(keyboardPos.y) };

            // Update axis lock based on arrow key press, but skip on refreshPreview
            // to avoid double-processing when CursorControl posts refreshPreview after
            // handling the arrow key.
            if (!evt.IsAction(ACTIONS.refreshPreview)) {
              const action = controls.GetSettings().m_lastKeyboardCursorCommand;

              if (
                action === CURSOR_EVENT_TYPE.CURSOR_LEFT ||
                action === CURSOR_EVENT_TYPE.CURSOR_RIGHT
              ) {
                if (axisLock === AXIS_LOCK.HORIZONTAL) {
                  // Check if opposite horizontal key pressed to unlock
                  if (
                    (lastArrowKeyAction === CURSOR_EVENT_TYPE.CURSOR_LEFT &&
                      action === CURSOR_EVENT_TYPE.CURSOR_RIGHT) ||
                    (lastArrowKeyAction === CURSOR_EVENT_TYPE.CURSOR_RIGHT &&
                      action === CURSOR_EVENT_TYPE.CURSOR_LEFT)
                  ) {
                    axisLock = AXIS_LOCK.NONE;
                  }
                  // Same direction axis, keep locked
                } else {
                  axisLock = AXIS_LOCK.HORIZONTAL;
                }
              } else if (
                action === CURSOR_EVENT_TYPE.CURSOR_UP ||
                action === CURSOR_EVENT_TYPE.CURSOR_DOWN
              ) {
                if (axisLock === AXIS_LOCK.VERTICAL) {
                  // Check if opposite vertical key pressed to unlock
                  if (
                    (lastArrowKeyAction === CURSOR_EVENT_TYPE.CURSOR_UP &&
                      action === CURSOR_EVENT_TYPE.CURSOR_DOWN) ||
                    (lastArrowKeyAction === CURSOR_EVENT_TYPE.CURSOR_DOWN &&
                      action === CURSOR_EVENT_TYPE.CURSOR_UP)
                  ) {
                    axisLock = AXIS_LOCK.NONE;
                  }
                  // Same direction axis, keep locked
                } else {
                  axisLock = AXIS_LOCK.VERTICAL;
                }
              }

              lastArrowKeyAction = action;
            }
          } else {
            const mousePos = controls.GetMousePosition();

            this.m_cursor = grid.BestSnapAnchor(mousePos, layers, selectionGrid, sel_items);
          }

          if (axisLock === AXIS_LOCK.HORIZONTAL)
            this.m_cursor = { x: this.m_cursor.x, y: prevPos.y };
          else if (axisLock === AXIS_LOCK.VERTICAL)
            this.m_cursor = { x: prevPos.x, y: this.m_cursor.y };

          if (!selection.HasReferencePoint()) originalPos = this.m_cursor;

          if (updateBBox) {
            originalBBox = null;
            bboxMovement = { x: 0, y: 0 };

            for (const item of sel_items) {
              const vb = item.ViewBBox();

              if (originalBBox) originalBBox.Merge(vb);
              else originalBBox = vb;
            }

            updateBBox = false;
          }

          // Constrain selection bounding box to coordinates limits
          movement = this.getSafeMovement(
            { x: this.m_cursor.x - prevPos.x, y: this.m_cursor.y - prevPos.y },
            originalBBox!,
            bboxMovement,
          );

          // Apply constrained movement
          this.m_cursor = { x: prevPos.x + movement.x, y: prevPos.y + movement.y };

          controls.ForceCursorPosition(true, this.m_cursor);
          selection.SetReferencePoint(this.m_cursor);

          prevPos = this.m_cursor;
          bboxMovement = { x: bboxMovement.x + movement.x, y: bboxMovement.y + movement.y };

          // Drag items to the current cursor position
          for (const item of sel_items) {
            // Don't double move child items.
            const parent = item.GetParent();

            if (!parent || !moved_items.has(parent)) {
              item.Move(movement);

              // Images are on non-cached layers and will not be updated automatically in the overlay, so
              // explicitly tell the view they've moved.
              if (item.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T)
                this.view()!.Update(item, VIEW_UPDATE_GEOMETRY);
            }

            if (item.Type() === KICAD_T.PCB_GENERATOR_T && sel_items.length === 1) {
              this.m_toolMgr!.RunSynchronousAction<PCB_GENERATOR>(
                PCB_ACTIONS.genUpdateEdit,
                aCommit,
                item as unknown as PCB_GENERATOR,
              );
            }

            if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) redraw3D = true;
          }

          if (redraw3D && allowRedraw3D) editFrame.Update3DView(false, true);

          if (showCourtyardConflicts && drc_on_move && drc_on_move.m_FpInMove.length) {
            drc_on_move.Run();
            drc_on_move.UpdateConflicts(this.m_toolMgr!.GetView()!, true);
          }

          this.m_toolMgr!.PostEvent(EVENTS.SelectedItemsMoved);
        } else if (!this.m_dragging && (aAutoStart || !evt.IsAction(ACTIONS.refreshPreview))) {
          // Prepare to start dragging
          editFrame.HideSolderMask();

          this.m_dragging = true;

          for (const item of sel_items) {
            const parent = item.GetParent();

            if (parent && moved_items.has(parent)) continue;

            if (!item.IsNew() && !item.IsMoving()) {
              if (item.Type() === KICAD_T.PCB_GENERATOR_T && sel_items.length === 1) {
                enableLocalRatsnest = false;

                this.m_toolMgr!.RunSynchronousAction<PCB_GENERATOR>(
                  PCB_ACTIONS.genStartEdit,
                  aCommit,
                  item as unknown as PCB_GENERATOR,
                );
              } else {
                aCommit.Modify(item, null, RECURSE_MODE.RECURSE);
              }

              item.SetFlags(IS_MOVING);

              if (item.Type() === KICAD_T.PCB_SHAPE_T)
                (item as unknown as PCB_SHAPE).UpdateHatching();

              item.RunOnChildren((child: BOARD_ITEM) => {
                child.SetFlags(IS_MOVING);

                if (child.Type() === KICAD_T.PCB_SHAPE_T)
                  (child as unknown as PCB_SHAPE).UpdateHatching();
              }, RECURSE_MODE.RECURSE);
            }
          }

          this.m_cursor = toI(controls.GetCursorPosition());

          if (selection.HasReferencePoint()) {
            // start moving with the reference point attached to the cursor
            grid.SetAuxAxes(false);

            const ref = selection.GetReferencePoint();
            movement = { x: this.m_cursor.x - ref.x, y: this.m_cursor.y - ref.y };

            // Drag items to the current cursor position
            for (const item of selection) {
              if (!item.IsBOARD_ITEM()) continue;

              // Don't double move footprint pads, fields, etc.
              const parent = item.GetParent();

              if (parent && moved_items.has(parent)) continue;

              const boardItem = item as unknown as BOARD_ITEM;
              boardItem.Move(movement);

              // Images are on non-cached layers and will not be updated automatically in the overlay, so
              // explicitly tell the view they've moved.
              if (boardItem.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T)
                this.view()!.Update(boardItem, VIEW_UPDATE_GEOMETRY);
            }

            selection.SetReferencePoint(this.m_cursor);
          } else {
            if (showCourtyardConflicts && drc_on_move) {
              const FPs = drc_on_move.m_FpInMove;

              for (const item of sel_items) {
                if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) FPs.push(item as FOOTPRINT);

                item.RunOnChildren((child: BOARD_ITEM) => {
                  if (child.Type() === KICAD_T.PCB_FOOTPRINT_T) FPs.push(child as FOOTPRINT);
                }, RECURSE_MODE.RECURSE);
              }
            }

            // Use the mouse position over cursor, as otherwise large grids will allow only
            // snapping to items that are closest to grid points
            this.m_cursor = grid.BestDragOrigin(
              originalMousePos,
              sel_items,
              grid.GetSelectionGrid(selection),
              this.selTool().GetFilter(),
            );

            // Set the current cursor position to the first dragged item origin, so the
            // movement vector could be computed later
            if (moveWithReference) {
              selection.SetReferencePoint(pickedReferencePoint.value);

              if (angleSnapMode !== LEADER_MODE.DIRECT)
                grid.SetSnapLineOrigin(selection.GetReferencePoint());

              controls.ForceCursorPosition(true, pickedReferencePoint.value);
              this.m_cursor = pickedReferencePoint.value;
            } else {
              const dragOrigin = this.m_cursor;

              selection.SetReferencePoint(dragOrigin);

              if (angleSnapMode !== LEADER_MODE.DIRECT) grid.SetSnapLineOrigin(dragOrigin);

              grid.SetAuxAxes(true, dragOrigin);

              if (!editFrame.GetMoveWarpsCursor()) this.m_cursor = toI(originalCursorPos);
              else this.m_cursor = dragOrigin;
            }

            originalPos = selection.GetReferencePoint();
          }

          // Update variables for bounding box collision calculations
          updateBBox = true;

          controls.SetCursorPosition(this.m_cursor, false);

          prevPos = this.m_cursor;
          controls.SetAutoPan(true);
          this.m_toolMgr!.PostEvent(EVENTS.SelectedItemsModified);
        }

        if (statusPopup) {
          const at = KIPLATFORM_UI.GetMousePosition();
          (statusPopup as STATUS_TEXT_POPUP).Move({ x: at.x + 20, y: at.y + 20 });
        }

        if (enableLocalRatsnest)
          this.m_toolMgr!.PostAction(PCB_ACTIONS.updateLocalRatsnest, movement);
      } else if (evt.IsCancelInteractive() || evt.IsActivate()) {
        if (this.m_dragging && evt.IsCancelInteractive()) evt.SetPassEvent(false);

        restore_state = true; // Canceling the tool means that items have to be restored
        break; // Finish
      } else if (evt.IsClick(BUT_RIGHT)) {
        this.selTool().GetToolMenu().ShowContextMenu(selection);
      } else if (evt.IsAction(ACTIONS.undo)) {
        restore_state = true; // Perform undo locally
        break; // Finish
      } else if (evt.IsAction(ACTIONS.doDelete)) {
        evt.SetPassEvent();
        // Exit on a delete; there will no longer be anything to drag.
        break;
      } else if (evt.IsAction(ACTIONS.duplicate) && evt !== copy) {
        wxBell();
      } else if (evt.IsAction(ACTIONS.cut)) {
        wxBell();
      } else if (
        evt.IsAction(PCB_ACTIONS.rotateCw) ||
        evt.IsAction(PCB_ACTIONS.rotateCcw) ||
        evt.IsAction(PCB_ACTIONS.flip) ||
        evt.IsAction(PCB_ACTIONS.mirrorH) ||
        evt.IsAction(PCB_ACTIONS.mirrorV)
      ) {
        updateBBox = true;
        eatFirstMouseUp = false;
        evt.SetPassEvent();
      } else if (evt.IsMouseUp(BUT_LEFT) || evt.IsClick(BUT_LEFT) || isSkip) {
        // Eat mouse-up/-click events that leaked through from the lock dialog
        if (eatFirstMouseUp && !evt.IsAction(ACTIONS.cursorClick)) {
          eatFirstMouseUp = false;
          continue;
        } else if (moveIndividually && this.m_dragging) {
          // Put skipped items back where they started
          if (isSkip) orig_items[itemIdx]!.SetPosition(originalPos);

          this.view()!.Update(orig_items[itemIdx]!);
          this.rebuildConnectivity();

          if (++itemIdx < orig_items.length) {
            const nextItem = orig_items[itemIdx]!;

            this.selTool().ClearSelection();

            originalPos = nextItem.GetPosition();
            this.selTool().AddItemToSel(nextItem);
            selection.SetReferencePoint(originalPos);

            if (angleSnapMode !== LEADER_MODE.DIRECT)
              grid.SetSnapLineOrigin(selection.GetReferencePoint());

            sel_items = [nextItem];

            moved_items = new Set([nextItem]);
            updateStatusPopup(nextItem, itemIdx + 1, orig_items.length);

            // Pick up new item
            aCommit.Modify(nextItem, null, RECURSE_MODE.RECURSE);
            const at = controls.GetCursorPosition(true);
            const pos = nextItem.GetPosition();
            nextItem.Move({ x: Math.trunc(at.x) - pos.x, y: Math.trunc(at.y) - pos.y });

            // Images are on non-cached layers and will not be updated automatically in the overlay, so
            // explicitly tell the view they've moved.
            if (nextItem.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T)
              this.view()!.Update(nextItem, VIEW_UPDATE_GEOMETRY);

            continue;
          }
        }

        break; // finish
      } else if (evt.IsDblClick(BUT_LEFT)) {
        // The first click will move the new item, so put it back
        if (moveIndividually) orig_items[itemIdx]!.SetPosition(originalPos);

        break; // finish
      } else if (evt.IsAction(PCB_ACTIONS.angleSnapModeChanged)) {
        angleSnapMode = this.GetAngleSnapMode();
        configureAngleSnap(angleSnapMode);
        displayConstraintsMessage(angleSnapMode);
        evt.SetPassEvent(true);
      } else if (evt.IsAction(ACTIONS.increment)) {
        if (evt.HasParameter())
          this.m_toolMgr!.RunSynchronousAction(
            ACTIONS.increment,
            aCommit,
            evt.Parameter<INCREMENT>(),
          );
        else
          this.m_toolMgr!.RunSynchronousAction<INCREMENT>(ACTIONS.increment, aCommit, {
            Delta: 1,
            Index: 0,
          });
      } else if (
        IsZoneFillAction(evt) ||
        evt.IsAction(PCB_ACTIONS.moveExact) ||
        evt.IsAction(PCB_ACTIONS.moveWithReference) ||
        evt.IsAction(PCB_ACTIONS.copyWithReference) ||
        evt.IsAction(PCB_ACTIONS.positionRelative) ||
        evt.IsAction(PCB_ACTIONS.interactiveOffsetTool) ||
        evt.IsAction(ACTIONS.find) ||
        evt.IsAction(ACTIONS.findNext) ||
        evt.IsAction(ACTIONS.findPrevious) ||
        evt.IsAction(ACTIONS.redo)
      ) {
        wxBell();
      } else {
        evt.SetPassEvent();
      }
    }

    // Clear temporary COURTYARD_CONFLICT flag and ensure the conflict shadow is cleared
    if (showCourtyardConflicts && drc_on_move)
      drc_on_move.ClearConflicts(this.m_toolMgr!.GetView()!);

    controls.ForceCursorPosition(false);
    controls.ShowCursor(false);
    controls.SetAutoPan(false);

    this.m_dragging = false;

    // Discard reference point when selection is "dropped" onto the board
    selection.ClearReferencePoint();

    // Unselect all items to clear selection flags and then re-select the originally selected
    // items.
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    if (restore_state) {
      if (
        sel_items.length === 1 &&
        sel_items[sel_items.length - 1]!.Type() === KICAD_T.PCB_GENERATOR_T
      ) {
        this.m_toolMgr!.RunSynchronousAction<PCB_GENERATOR>(
          PCB_ACTIONS.genCancelEdit,
          aCommit,
          sel_items[sel_items.length - 1] as unknown as PCB_GENERATOR,
        );
      }
    } else {
      if (
        sel_items.length === 1 &&
        sel_items[sel_items.length - 1]!.Type() === KICAD_T.PCB_GENERATOR_T
      ) {
        this.m_toolMgr!.RunSynchronousAction<PCB_GENERATOR>(
          PCB_ACTIONS.genFinishEdit,
          aCommit,
          sel_items[sel_items.length - 1] as unknown as PCB_GENERATOR,
        );
      }

      this.m_toolMgr!.RunAction<EDA_ITEM[]>(ACTIONS.selectItems, [...orig_items]);
    }

    // Remove the dynamic ratsnest from the screen
    this.m_toolMgr!.RunAction(PCB_ACTIONS.hideLocalRatsnest);

    if (statusPopup) {
      this.canvas()?.SetStatusPopup(null);
      (statusPopup as STATUS_TEXT_POPUP).Hide();
    }

    editFrame.PopTool(pushedEvent);
    editFrame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);

    this.m_inMoveWithReference = false;
    return !restore_state;
  }
}
