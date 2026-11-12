// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDITOR_PIN_TOOL` (eeschema/tools/symbol_editor_pin_tool.{h,cpp}): creating, placing,
 * repeating and editing a symbol's pins, the pins of the other units kept in step when the units
 * are interchangeable, and pushing one pin's length or text sizes to the rest.
 *
 * The two dialogs are the window's: DIALOG_PIN_PROPERTIES through the frame's ShowModalDialog
 * and the pin-clash KIDIALOG through its ShowKiDialog; with no window both are cancelled.
 */
import { IS_LINKED, IS_NEW, IS_PASTED } from '@ziroeda/common/eda_item_flags.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { IncrementString } from '@ziroeda/common/increment.js';
import { DO_NOT_SHOW_KEYS } from '@ziroeda/common/kidialog_do_not_show.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { ELECTRICAL_PINTYPE, GRAPHIC_PINSHAPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER, type TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import { UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { wxID_CANCEL } from '@ziroeda/wx/menu.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { LIB_SYMBOL } from '../lib_symbol.js';
import { SCH_COMMIT } from '../sch_commit.js';
import { SCH_PIN } from '../sch_pin.js';
import { currentSymbolEditorSettings } from '../symbol_editor/symbol_editor_settings.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import { SCH_ACTIONS } from './sch_actions.js';
import { SCH_CONDITIONS } from './sch_selection_tool.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

let g_LastPinType = ELECTRICAL_PINTYPE.PT_INPUT;
let g_LastPinOrient = PIN_ORIENTATION.PIN_RIGHT;
let g_LastPinShape = GRAPHIC_PINSHAPE.LINE;
let g_LastPinCommonBodyStyle = false;
let g_LastPinCommonUnit = false;
let g_LastPinVisible = true;

// The -1 is a non-valid value to trigger delayed initialization
let g_LastPinLength = -1;
let g_LastPinNameSize = -1;
let g_LastPinNumSize = -1;

function GetLastPinLength(): number {
  if (g_LastPinLength === -1)
    g_LastPinLength = schIUScale.milsToIU(currentSymbolEditorSettings().defaults.pin_length);

  return g_LastPinLength;
}

function GetLastPinNameSize(): number {
  if (g_LastPinNameSize === -1)
    g_LastPinNameSize = schIUScale.milsToIU(currentSymbolEditorSettings().defaults.pin_name_size);

  return g_LastPinNameSize;
}

function GetLastPinNumSize(): number {
  if (g_LastPinNumSize === -1)
    g_LastPinNumSize = schIUScale.milsToIU(currentSymbolEditorSettings().defaults.pin_num_size);

  return g_LastPinNumSize;
}

/** Not KiCad's: the statics above back to their start, for a test that wants a clean program. */
export function ResetLastPinProperties(): void {
  g_LastPinType = ELECTRICAL_PINTYPE.PT_INPUT;
  g_LastPinOrient = PIN_ORIENTATION.PIN_RIGHT;
  g_LastPinShape = GRAPHIC_PINSHAPE.LINE;
  g_LastPinCommonBodyStyle = false;
  g_LastPinCommonUnit = false;
  g_LastPinVisible = true;
  g_LastPinLength = -1;
  g_LastPinNameSize = -1;
  g_LastPinNumSize = -1;
}

const veq = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

export class SYMBOL_EDITOR_PIN_TOOL extends SCH_TOOL_BASE<SYMBOL_EDIT_FRAME> {
  constructor() {
    super('eeschema.PinEditing');
  }

  override Init(): boolean {
    super.Init();

    const canEdit = () => {
      const editor = this.m_frame;

      return !!editor && editor.IsSymbolEditable() && !editor.IsSymbolAlias();
    };

    const pinTypes = [KICAD_T.SCH_PIN_T];
    const { And } = SELECTION_CONDITIONS;

    const singlePinCondition = And(SCH_CONDITIONS.Count(1), SCH_CONDITIONS.OnlyTypes(pinTypes));

    const selToolMenu = this.m_selectionTool!.GetToolMenu().GetMenu();

    selToolMenu.AddSeparator(250);
    selToolMenu.AddItem(SCH_ACTIONS.pushPinLength, And(canEdit, singlePinCondition), 250);
    selToolMenu.AddItem(SCH_ACTIONS.pushPinNameSize, And(canEdit, singlePinCondition), 250);
    selToolMenu.AddItem(SCH_ACTIONS.pushPinNumSize, And(canEdit, singlePinCondition), 250);

    return true;
  }

  /**
   * Propagate the edits made to \a aPin to the matching pins of the other units.
   *
   * Pins are matched against \a aOriginalPin, a copy of \a aPin taken before the edit, so that
   * pins which tracked the old geometry are still recognized.  A pin that \a aPin now subsumes
   * (because it became common to all units) is deleted.
   *
   * @return the number of pins deleted from \a aSymbol.
   */
  static SynchronizeOtherUnits(aSymbol: LIB_SYMBOL, aPin: SCH_PIN, aOriginalPin: SCH_PIN): number {
    // A pin can have a unit id = 0 (common to all units) to unit count, so we need a buffer
    // size = GetUnitCount()+1 to store a value in a vector when using the unit id as index.
    const got_unit: boolean[] = new Array(aSymbol.GetUnitCount() + 1).fill(false);

    const markUnit = (aUnit: number): void => {
      if (aUnit >= 0 && aUnit < got_unit.length) got_unit[aUnit] = true;
    };

    const unitDone = (aUnit: number): boolean =>
      aUnit >= 0 && aUnit < got_unit.length && got_unit[aUnit]!;

    markUnit(aPin.GetUnit());

    let removed = 0;

    for (const other of aSymbol.GetPins()) {
      if (other === aPin) continue;

      /// Only change one pin per unit to allow stacking pins
      /// If you change all units on the position, then pins are not
      /// uniquely editable
      if (unitDone(other.GetUnit())) continue;

      if (
        !veq(other.GetPosition(), aOriginalPin.GetPosition()) ||
        other.GetOrientation() !== aOriginalPin.GetOrientation() ||
        other.GetType() !== aOriginalPin.GetType() ||
        other.IsVisible() !== aOriginalPin.IsVisible() ||
        other.GetName() !== aOriginalPin.GetName()
      ) {
        continue;
      }

      if (other.GetBodyStyle() === aPin.GetBodyStyle()) {
        other.ChangeLength(aPin.GetLength());

        // Must be done after ChangeLength(), which can alter the position
        other.SetPosition(aPin.GetPosition());

        other.SetShape(aPin.GetShape());
      }

      other.SetOrientation(aPin.GetOrientation());
      other.SetType(aPin.GetType());
      other.SetVisible(aPin.IsVisible());
      other.SetName(aPin.GetName());
      other.SetNameTextSize(aPin.GetNameTextSize());
      other.SetNumberTextSize(aPin.GetNumberTextSize());

      markUnit(other.GetUnit());

      // Unit or body style 0 means aPin applies to all of them, making the matching pin
      // redundant.  Delete last, because RemoveDrawItem() frees the pin.
      const coversBodyStyles =
        aPin.GetBodyStyle() === 0 && (aPin.GetUnit() === 0 || other.GetUnit() === aPin.GetUnit());
      const coversUnits =
        aPin.GetUnit() === 0 &&
        (aPin.GetBodyStyle() === 0 || other.GetBodyStyle() === aPin.GetBodyStyle());

      if (coversBodyStyles || coversUnits) {
        aSymbol.RemoveDrawItem(other);
        removed++;
      }
    }

    return removed;
  }

  /**
   * \a aRunning is the tool whose coroutine is running and waits on the dialog - upstream's
   * ShowModal() blocks in place, which a browser cannot; the caller's coroutine waits instead.
   */
  *EditPinProperties(
    aPin: SCH_PIN,
    aFocusPinNumber: boolean,
    aRunning: TOOL_INTERACTIVE = this,
  ): COROUTINE_BODY<boolean> {
    const original_pin = aPin.Clone() as SCH_PIN;
    const commit = new SCH_COMMIT(this.m_frame!);
    const parentSymbol = aPin.GetParentSymbol() as LIB_SYMBOL | null;

    if (aPin.GetEditFlags() === 0 && parentSymbol)
      commit.Modify(parentSymbol, this.m_frame!.GetScreen());

    // DIALOG_PIN_PROPERTIES dlg( m_frame, aPin, aFocusPinNumber ): the window's.
    const ret = yield* aRunning.RunMainStackModal(() =>
      this.m_frame!.ShowModalDialog('DIALOG_PIN_PROPERTIES', [aPin], {
        focusPinNumber: aFocusPinNumber,
      }),
    );

    if (ret === null || ret === wxID_CANCEL) return false;

    let removedPins = 0;

    if (!aPin.IsNew() && this.m_frame!.SynchronizePins() && parentSymbol)
      removedPins = SYMBOL_EDITOR_PIN_TOOL.SynchronizeOtherUnits(parentSymbol, aPin, original_pin);

    commit.Push(_('Edit Pin Properties'));

    // RemoveDrawItem() leaves the freed pins in the view, where hit testing would hand them to
    // the next edit.  RebuildView() empties the selection container without clearing SELECTED,
    // so drop the selection through the tool.
    if (removedPins > 0) {
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
      this.m_frame!.RebuildView();
    }

    const items: MSG_PANEL_ITEM[] = [];
    aPin.GetMsgPanelInfo(this.m_frame!.AsDrawFrameLike(), items);
    this.m_frame!.SetMsgPanel(items);

    // Save the pin properties to use for the next new pin.
    g_LastPinNameSize = aPin.GetNameTextSize();
    g_LastPinNumSize = aPin.GetNumberTextSize();
    g_LastPinOrient = aPin.GetOrientation();
    g_LastPinLength = aPin.GetLength();
    g_LastPinShape = aPin.GetShape();
    g_LastPinType = aPin.GetType();
    g_LastPinCommonBodyStyle = aPin.GetBodyStyle() === 0;
    g_LastPinCommonUnit = aPin.GetUnit() === 0;
    g_LastPinVisible = aPin.IsVisible();

    return true;
  }

  /** \a aRunning: the tool whose coroutine waits on the clash question (see EditPinProperties). */
  *PlacePin(
    aCommit: SCH_COMMIT,
    aPin: SCH_PIN,
    aRunning: TOOL_INTERACTIVE = this,
  ): COROUTINE_BODY<boolean> {
    const frame = this.m_frame!;
    const symbol = frame.GetCurSymbol()!;
    let ask_for_pin = true; // Test for another pin in same position in other units

    const pins = symbol.GetPins();

    for (const test of pins) {
      if (test === aPin || !veq(aPin.GetPosition(), test.GetPosition()) || test.GetEditFlags())
        continue;

      // test for same body style
      if (test.GetBodyStyle() && test.GetBodyStyle() !== aPin.GetBodyStyle()) continue;

      if (ask_for_pin && frame.SynchronizePins()) {
        const msg = wxFormat(
          _('This position is already occupied by another pin, in unit %d.'),
          test.GetUnit(),
        );

        const status =
          (yield* aRunning.RunMainStackModal(() =>
            frame.ShowKiDialog({
              caption: _('Confirmation'),
              message: msg,
              extendedMessage: _(
                "Disable the 'Synchronized Pins Mode' option to avoid this message.",
              ),
              icon: 'warning',
              labels: { ok: _('Place Pin Anyway') },
              doNotShowKey: DO_NOT_SHOW_KEYS.symbolEditorPinClash,
            }),
          )) === 'ok';

        // A new pin that is refused is simply dropped (upstream deletes it).
        if (!status) return false;

        ask_for_pin = false;
      }
    }

    if (aPin.IsNew() && !aPin.HasFlag(IS_PASTED)) {
      g_LastPinOrient = aPin.GetOrientation();
      g_LastPinType = aPin.GetType();
      g_LastPinShape = aPin.GetShape();

      if (frame.SynchronizePins()) this.CreateImagePins(aCommit, aPin);

      symbol.AddDrawItem(aPin);
      aPin.ClearFlags(IS_NEW);
    }

    // Put linked pins in new position, and clear flags
    for (const pin of pins) {
      if ((pin.GetEditFlags() & IS_LINKED) === 0) continue;

      pin.SetPosition(aPin.GetPosition());
      pin.ClearFlags();
    }

    frame.RebuildView();
    frame.OnModify();

    return true;
  }

  /** Create a new pin. */
  *CreatePin(
    aPosition: VECTOR2I,
    aSymbol: LIB_SYMBOL,
    aRunning: TOOL_INTERACTIVE = this,
  ): COROUTINE_BODY<SCH_PIN | null> {
    aSymbol.ClearTempFlags();

    const pin = new SCH_PIN(aSymbol);

    pin.SetFlags(IS_NEW);

    // Flag pins to consider
    if (this.m_frame!.SynchronizePins()) pin.SetFlags(IS_LINKED);

    pin.SetPosition(aPosition);
    pin.SetLength(GetLastPinLength());
    pin.SetOrientation(g_LastPinOrient);
    pin.SetType(g_LastPinType);
    pin.SetShape(g_LastPinShape);
    pin.SetNameTextSize(GetLastPinNameSize());
    pin.SetNumberTextSize(GetLastPinNumSize());
    pin.SetBodyStyle(g_LastPinCommonBodyStyle ? 0 : this.m_frame!.GetBodyStyle());
    pin.SetUnit(g_LastPinCommonUnit ? 0 : this.m_frame!.GetUnit());
    pin.SetVisible(g_LastPinVisible);

    if (!(yield* this.EditPinProperties(pin, false, aRunning))) return null;

    return pin;
  }

  CreateImagePins(_aCommit: SCH_COMMIT, aPin: SCH_PIN): void {
    // if "synchronize pins editing" option is off, do not create any similar pin for other
    // units and/or shapes: each unit is edited regardless other units or body
    if (!this.m_frame!.SynchronizePins()) return;

    if (aPin.GetUnit() === 0) return; // Pin common to all units: no need to create similar pins.

    // When units are interchangeable, all units are expected to have similar pins
    // at the same position
    // to facilitate pin editing, create pins for all other units for the current body style
    // at the same position as aPin

    const symbol = aPin.GetParentSymbol() as LIB_SYMBOL;

    for (let ii = 1; ii <= symbol.GetUnitCount(); ii++) {
      if (ii === aPin.GetUnit()) continue;

      // Already called Modify() on parent symbol; no need for Modify() calls on individual items
      const dummy = new SCH_COMMIT(this.m_toolMgr!);
      const newPin = aPin.Duplicate(true, dummy) as SCH_PIN;

      // To avoid mistakes, gives this pin a new pin number because
      // it does no have the save pin number as the master pin
      // Because we do not know the actual number, give it a temporary number
      newPin.SetNumber(`${aPin.GetNumber()}-U${String.fromCharCode('A'.charCodeAt(0) + ii - 1)}`);

      newPin.SetUnit(ii);

      symbol.AddDrawItem(newPin);

      newPin.ClearFlags(IS_NEW);
    }
  }

  PushPinProperties(aEvent: TOOL_EVENT): number {
    const symbol = this.m_frame!.GetCurSymbol()!;
    const selection = this.m_selectionTool!.GetSelection();
    const front = selection.Front();
    const sourcePin = front instanceof SCH_PIN ? front : null;

    if (!sourcePin) return 0;

    this.saveCopyInUndoList(symbol, UNDO_REDO.LIBEDIT);

    for (const pin of symbol.GetPins()) {
      if (pin === sourcePin) continue;

      if (aEvent.IsAction(SCH_ACTIONS.pushPinLength)) {
        if (!pin.GetBodyStyle() || pin.GetBodyStyle() === this.m_frame!.GetBodyStyle())
          pin.ChangeLength(sourcePin.GetLength());
      } else if (aEvent.IsAction(SCH_ACTIONS.pushPinNameSize)) {
        pin.SetNameTextSize(sourcePin.GetNameTextSize());
      } else if (aEvent.IsAction(SCH_ACTIONS.pushPinNumSize)) {
        pin.SetNumberTextSize(sourcePin.GetNumberTextSize());
      }
    }

    this.m_frame!.RebuildView();
    this.m_frame!.OnModify();

    return 0;
  }

  /** Create a new pin based on the previous pin with an incremented pin number. */
  *RepeatPin(
    aSourcePin: SCH_PIN,
    aRunning: TOOL_INTERACTIVE = this,
  ): COROUTINE_BODY<SCH_PIN | null> {
    const commit = new SCH_COMMIT(this.m_frame!);
    const symbol = this.m_frame!.GetCurSymbol()!;

    commit.Modify(symbol, this.m_frame!.GetScreen());

    const pin = aSourcePin.Duplicate(true, commit) as SCH_PIN;

    pin.ClearFlags();
    pin.SetFlags(IS_NEW);

    const cfg = currentSymbolEditorSettings();
    const step = { x: 0, y: 0 };

    switch (pin.GetOrientation()) {
      default:
      case PIN_ORIENTATION.PIN_RIGHT:
        step.y = schIUScale.milsToIU(cfg.repeat.pin_step);
        break;
      case PIN_ORIENTATION.PIN_UP:
        step.x = schIUScale.milsToIU(cfg.repeat.pin_step);
        break;
      case PIN_ORIENTATION.PIN_DOWN:
        step.x = schIUScale.milsToIU(cfg.repeat.pin_step);
        break;
      case PIN_ORIENTATION.PIN_LEFT:
        step.y = schIUScale.milsToIU(cfg.repeat.pin_step);
        break;
    }

    pin.Move(step);

    pin.SetName(IncrementString(pin.GetName(), cfg.repeat.label_delta) ?? pin.GetName());
    pin.SetNumber(IncrementString(pin.GetNumber(), cfg.repeat.label_delta) ?? pin.GetNumber());

    if (this.m_frame!.SynchronizePins()) pin.SetFlags(IS_LINKED);

    if (yield* this.PlacePin(commit, pin, aRunning)) {
      commit.Push(_('Repeat Pin'));
      return pin;
    }

    return null;
  }

  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER(this.PushPinProperties), SCH_ACTIONS.pushPinLength.MakeEvent());
    this.Go(SYNC_HANDLER(this.PushPinProperties), SCH_ACTIONS.pushPinNameSize.MakeEvent());
    this.Go(SYNC_HANDLER(this.PushPinProperties), SCH_ACTIONS.pushPinNumSize.MakeEvent());
  }
}
