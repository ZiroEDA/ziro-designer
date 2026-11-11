// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PIN_PROPERTIES` (eeschema/dialogs/dialog_pin_properties.{h,cpp}) over
 * DIALOG_PIN_PROPERTIES_BASE: a symbol editor pin's name, number, electrical type, graphic style,
 * position, orientation, length, text sizes, units / body styles and visibility, its alternate
 * pin functions in a grid, and a live preview of the pin on a copy of its symbol (the copy's own
 * items moved to unit 1, the pin alone in unit 2). Synchronized pins mode shows in the infobar,
 * with a link that leaves it.
 *
 * The controls' state lives in PIN_DIALOG_STATE, which the handlers change as the C++ handlers
 * change the controls; TransferDataFromWindow reads it as upstream reads the controls.
 */
import { DisplayErrorMessage, IsOK } from '@ziroeda/common/confirm.js';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import type { ELECTRICAL_PINTYPE, GRAPHIC_PINSHAPE } from '@ziroeda/common/pin_type.js';
import {
  GRID_CELL_ICON_TEXT_POPUP,
  GRID_CELL_ICON_TEXT_RENDERER,
} from '@ziroeda/common/widgets/grid_icon_text_helpers.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { WX_GRID, WX_GRID_TABLE_BASE } from '@ziroeda/common/widgets/wx_grid.js';
import { wxGridCellAttr, wxGridSelectionModes, wxGridTableRequest } from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/wx/menu.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { type JSX, useEffect, useRef, useState } from 'react';
import { LIB_SYMBOL } from '../lib_symbol.js';
import {
  PinOrientationCode,
  PinOrientationIcons,
  PinOrientationIndex,
  PinOrientationNames,
  PinShapeIcons,
  PinShapeNames,
  PinTypeIcons,
  PinTypeNames,
} from '../pin_type.js';
import { SCH_PIN, type SCH_PIN_ALT, alternatesInMapOrder } from '../sch_pin.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import { SYMBOL_PREVIEW_WIDGET, SymbolPreviewWidget } from '../widgets/symbol_preview_widget.js';
import { DIALOG_PIN_PROPERTIES_BASE, type PIN_DIALOG_CHECK } from './dialog_pin_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';

/** The alternates grid's columns. */
export enum ALT_COL {
  COL_NAME = 0,
  COL_TYPE,
  COL_SHAPE,
  COL_COUNT, // keep as last
}

/** `ALT_PIN_DATA_MODEL`: the pin's alternates as a grid table, by value. */
export class ALT_PIN_DATA_MODEL extends WX_GRID_TABLE_BASE {
  readonly m_alts: SCH_PIN_ALT[] = [];

  override GetNumberRows(): number {
    return this.m_alts.length;
  }

  override GetNumberCols(): number {
    return ALT_COL.COL_COUNT;
  }

  override GetColLabelValue(aCol: number): string {
    switch (aCol) {
      case ALT_COL.COL_NAME:
        return 'Alternate Pin Name';
      case ALT_COL.COL_TYPE:
        return 'Electrical Type';
      case ALT_COL.COL_SHAPE:
        return 'Graphic Style';
      default:
        console.assert(false);
        return '';
    }
  }

  override IsEmptyCell(_aRow: number, _aCol: number): boolean {
    return false; // don't allow adjacent cell overflow, even if we are actually empty
  }

  override GetValue(aRow: number, aCol: number): string {
    const alt = this.m_alts[aRow]!;

    switch (aCol) {
      case ALT_COL.COL_NAME:
        return alt.m_Name;
      case ALT_COL.COL_TYPE:
        return PinTypeNames()[alt.m_Type]!;
      case ALT_COL.COL_SHAPE:
        return PinShapeNames()[alt.m_Shape]!;
      default:
        console.assert(false);
        return '';
    }
  }

  override SetValue(aRow: number, aCol: number, aValue: string): void {
    const alt = this.m_alts[aRow]!;

    switch (aCol) {
      case ALT_COL.COL_NAME:
        alt.m_Name = aValue;
        break;
      case ALT_COL.COL_TYPE:
        if (PinTypeNames().indexOf(aValue) !== -1)
          alt.m_Type = PinTypeNames().indexOf(aValue) as ELECTRICAL_PINTYPE;
        break;
      case ALT_COL.COL_SHAPE:
        if (PinShapeNames().indexOf(aValue) !== -1)
          alt.m_Shape = PinShapeNames().indexOf(aValue) as GRAPHIC_PINSHAPE;
        break;
      default:
        console.assert(false);
        break;
    }
  }

  AppendRow(aAlt: SCH_PIN_ALT): void {
    this.m_alts.push({ ...aAlt });
    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, 1);
  }

  RemoveRow(aRow: number): void {
    this.m_alts.splice(aRow, 1);
    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, aRow, 1);
  }
}

/** The controls, as the handlers leave them. */
export interface PIN_DIALOG_STATE {
  /** `m_infoBar`: the message, and whether the "Exit sync pins mode" link is on it; null hidden. */
  infoBar: { message: string; exitLink: boolean } | null;
  m_textPinName: string;
  m_textPinNumber: string;
  m_choiceElectricalType: ELECTRICAL_PINTYPE;
  m_choiceStyle: GRAPHIC_PINSHAPE;
  m_choiceOrientation: number;
  m_posXCtrl: string;
  m_posYCtrl: string;
  m_pinLengthCtrl: string;
  m_nameSizeCtrl: string;
  m_numberSizeCtrl: string;
  m_checkApplyToAllParts: PIN_DIALOG_CHECK;
  m_checkApplyToAllBodyStyles: PIN_DIALOG_CHECK;
  m_checkShow: PIN_DIALOG_CHECK;
  m_alternatesTurndown: { collapsed: boolean; enabled: boolean; tooltip?: string };
}

export class DIALOG_PIN_PROPERTIES {
  /** `s_alternatesTurndownOpen`: the alternates pane was open in an earlier dialog. */
  static s_alternatesTurndownOpen = false;

  readonly m_frame: SYMBOL_EDIT_FRAME;
  readonly m_pin: SCH_PIN;
  readonly m_posX: UNIT_BINDER;
  readonly m_posY: UNIT_BINDER;
  readonly m_pinLength: UNIT_BINDER;
  readonly m_nameSize: UNIT_BINDER;
  readonly m_numberSize: UNIT_BINDER;
  /** `m_dummyParent` / `m_dummyPin`: the preview's copy of the symbol, and the pin in it. */
  readonly m_dummyParent: LIB_SYMBOL;
  readonly m_dummyPin: SCH_PIN;
  m_previewWidget: SYMBOL_PREVIEW_WIDGET | null = null;
  readonly m_alternatesGrid = new WX_GRID();
  readonly m_alternatesDataModel = new ALT_PIN_DATA_MODEL();
  readonly m_alternatesTricks: GRID_TRICKS;
  readonly m_focusPinNumber: boolean;
  /** The orientation combo's entries: name and icon, in enum order. */
  readonly m_orientationOptions: { value: string; label: string; bitmap?: string }[];
  /** `m_delayedFocusRow` / `m_delayedFocusColumn`: the alternate to open once OK fails on it. */
  m_delayedFocusRow = -1;
  m_delayedFocusColumn = -1;
  m_origPos: VECTOR2I = { x: 0, y: 0 };
  m_state: PIN_DIALOG_STATE;

  constructor(aParent: SYMBOL_EDIT_FRAME, aPin: SCH_PIN, aFocusPinNumber: boolean) {
    this.m_frame = aParent;
    this.m_pin = aPin;
    this.m_focusPinNumber = aFocusPinNumber;

    const binder = (aLabel: string) =>
      new UNIT_BINDER(aParent, aLabel, (m) => DisplayErrorMessage(m));
    this.m_posX = binder(_('X position:'));
    this.m_posY = binder(_('Y position:'));
    this.m_pinLength = binder(_('Pin length:'));
    this.m_nameSize = binder(_('Name text size:'));
    this.m_numberSize = binder(_('Number text size:'));

    // Create a dummy symbol with a single pin for the preview widget:
    this.m_dummyParent = LIB_SYMBOL.copyOf(aPin.GetParentSymbol() as LIB_SYMBOL);

    // Move everything in the copied symbol to unit 1; we'll use unit 2 for the dummy pin:
    this.m_dummyParent.SetUnitCount(2, false);
    this.m_dummyParent.RunOnChildren((child) => {
      child.SetUnit(1);
    }, RECURSE_MODE.NO_RECURSE);

    this.m_dummyPin = SCH_PIN.copyOf(aPin);
    this.m_dummyPin.ClearFlags(IS_NEW); // Needed to display the dummy pin
    this.m_dummyPin.SetUnit(2);
    this.m_dummyParent.AddDrawItem(this.m_dummyPin, false);

    this.m_dummyParent.SetShowPinNames(true);
    this.m_dummyParent.SetShowPinNumbers(true);

    const orientationIcons = PinOrientationIcons();
    this.m_orientationOptions = PinOrientationNames().map((name, ii) => {
      const bitmap = bitmapUrl(orientationIcons[ii]!);

      return bitmap === undefined
        ? { value: String(ii), label: name }
        : { value: String(ii), label: name, bitmap };
    });

    this.m_state = {
      infoBar: null,
      m_textPinName: '',
      m_textPinNumber: '',
      m_choiceElectricalType: 0 as ELECTRICAL_PINTYPE,
      m_choiceStyle: 0 as GRAPHIC_PINSHAPE,
      m_choiceOrientation: 0,
      m_posXCtrl: '',
      m_posYCtrl: '',
      m_pinLengthCtrl: '',
      m_nameSizeCtrl: '',
      m_numberSizeCtrl: '',
      m_checkApplyToAllParts: { value: false, enabled: true },
      m_checkApplyToAllBodyStyles: { value: false, enabled: true },
      // m_checkShow->SetValue( true )
      m_checkShow: { value: true, enabled: true },
      m_alternatesTurndown: { collapsed: true, enabled: true },
    };

    // Default alternates turndown to whether or not alternates exist, or if we've had it open
    // before
    this.m_state.m_alternatesTurndown.collapsed =
      aPin.GetAlternates().size === 0 && !DIALOG_PIN_PROPERTIES.s_alternatesTurndownOpen;

    // wxwidgets doesn't call the OnCollapseChange even at init, so we update this value if
    // the alternates pane defaults to open
    if (aPin.GetAlternates().size > 0) DIALOG_PIN_PROPERTIES.s_alternatesTurndownOpen = true;

    this.m_alternatesGrid.SetTable(
      this.m_alternatesDataModel,
      false,
      wxGridSelectionModes.wxGridSelectRows,
    );
    this.m_alternatesTricks = new GRID_TRICKS(this.m_alternatesGrid, () => this.OnAddAlternate());

    if (aPin.GetParentSymbol()!.IsMultiBodyStyle()) {
      this.m_state.m_alternatesTurndown = {
        collapsed: true,
        enabled: false,
        tooltip: _(
          'Alternate pin assignments are not available for symbols with multiple body styles.',
        ),
      };
    }

    // Set special attributes
    let attr = new wxGridCellAttr();
    attr.SetRenderer(new GRID_CELL_ICON_TEXT_RENDERER(PinTypeIcons(), PinTypeNames()));
    attr.SetEditor(new GRID_CELL_ICON_TEXT_POPUP(PinTypeIcons(), PinTypeNames()));
    this.m_alternatesGrid.SetColAttr(ALT_COL.COL_TYPE, attr);

    attr = new wxGridCellAttr();
    attr.SetRenderer(new GRID_CELL_ICON_TEXT_RENDERER(PinShapeIcons(), PinShapeNames()));
    attr.SetEditor(new GRID_CELL_ICON_TEXT_POPUP(PinShapeIcons(), PinShapeNames()));
    this.m_alternatesGrid.SetColAttr(ALT_COL.COL_SHAPE, attr);
  }

  /**
   * The preview widget, once the window has built it: `m_ShowHiddenPins = true` and the dummy
   * symbol's unit 2 shown, as the constructor does upstream.
   */
  SetPreviewWidget(aWidget: SYMBOL_PREVIEW_WIDGET | null): void {
    this.m_previewWidget = aWidget;

    if (!aWidget) return;

    aWidget.DisplayPart(
      this.m_dummyParent,
      this.m_dummyPin.GetUnit(),
      this.m_dummyPin.GetBodyStyle(),
    );
    aWidget.GetRenderSettings().m_ShowHiddenPins = true;
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): PIN_DIALOG_STATE {
    const s = this.m_state;
    const parent = this.m_pin.GetParentSymbol()!;

    this.m_origPos = { ...this.m_pin.GetPosition() };

    s.m_choiceOrientation = PinOrientationIndex(this.m_pin.GetOrientation());
    s.m_choiceStyle = this.m_pin.GetShape();
    s.m_choiceElectricalType = this.m_pin.GetType();
    s.m_textPinName = this.m_pin.GetName();
    this.m_nameSize.SetValue(this.m_pin.GetNameTextSize());
    this.m_posX.SetValue(this.m_origPos.x);
    this.m_posY.SetValue(this.m_origPos.y);
    s.m_textPinNumber = this.m_pin.GetNumber();
    this.m_numberSize.SetValue(this.m_pin.GetNumberTextSize());
    this.m_pinLength.SetValue(this.m_pin.GetLength());
    this.readBinders();

    s.m_checkApplyToAllParts = {
      enabled: parent.IsMultiUnit(),
      value: parent.IsMultiUnit() && this.m_pin.GetUnit() === 0,
    };
    s.m_checkApplyToAllBodyStyles = {
      enabled: parent.IsMultiBodyStyle(),
      value: this.m_pin.GetBodyStyle() === 0,
    };
    s.m_checkShow.value = this.m_pin.IsVisible();
    this.m_dummyPin.SetVisible(this.m_pin.IsVisible());

    let commonUnitsToolTip: string;

    if (this.m_frame.m_SyncPinEdit) {
      s.infoBar = { message: this.getSyncPinsMessage(), exitLink: true };
      commonUnitsToolTip =
        'Synchronized pins mode is enabled.\n' +
        'Similar pins will be edited regardless of this option.';
    } else {
      commonUnitsToolTip = _('If checked, this pin will exist in all units.');
    }

    if (!parent.IsMultiUnit())
      commonUnitsToolTip = _('This symbol only has one unit. This control has no effect.');

    s.m_checkApplyToAllParts.tooltip = commonUnitsToolTip;

    for (const [, alt] of alternatesInMapOrder(this.m_pin.GetAlternates()))
      this.m_alternatesDataModel.AppendRow(alt);

    return this.snapshot();
  }

  /** The "Exit sync pins mode" hyperlink: the frame leaves the mode, the infobar goes. */
  OnExitSyncPinsMode(): PIN_DIALOG_STATE {
    this.m_frame.m_SyncPinEdit = false;
    this.m_state.infoBar = null;
    return this.snapshot();
  }

  /** A control the user changed, then `OnPropertiesChange` (every control the base connects). */
  Set<K extends keyof PIN_DIALOG_STATE>(
    aKey: K,
    aValue: PIN_DIALOG_STATE[K] extends PIN_DIALOG_CHECK ? boolean : PIN_DIALOG_STATE[K],
  ): PIN_DIALOG_STATE {
    const s = this.m_state as unknown as Record<string, unknown>;
    const current = s[aKey];

    if (current && typeof current === 'object' && 'value' in current)
      (current as PIN_DIALOG_CHECK).value = aValue as boolean;
    else s[aKey] = aValue;

    this.OnPropertiesChange(aKey === 'm_checkApplyToAllParts');
    return this.snapshot();
  }

  /** `OnPropertiesChange( event )`: the dummy pin follows the controls and the preview redraws. */
  OnPropertiesChange(aFromApplyToAllParts = false): void {
    const s = this.m_state;

    this.writeBinders();

    this.m_dummyPin.SetName(s.m_textPinName);
    this.m_dummyPin.SetNumber(s.m_textPinNumber);
    this.m_dummyPin.SetNameTextSize(this.m_nameSize.GetIntValue());
    this.m_dummyPin.SetNumberTextSize(this.m_numberSize.GetIntValue());
    this.m_dummyPin.SetOrientation(PinOrientationCode(s.m_choiceOrientation));
    this.m_dummyPin.SetLength(this.m_pinLength.GetIntValue());
    this.m_dummyPin.SetType(s.m_choiceElectricalType);
    this.m_dummyPin.SetShape(s.m_choiceStyle);
    this.m_dummyPin.SetVisible(s.m_checkShow.value);

    if (aFromApplyToAllParts && this.m_frame.m_SyncPinEdit && s.infoBar)
      s.infoBar = { ...s.infoBar, message: this.getSyncPinsMessage() };

    this.m_previewWidget?.DisplayPart(
      this.m_dummyParent,
      this.m_dummyPin.GetUnit(),
      this.m_dummyPin.GetBodyStyle(),
    );
  }

  /** `getSyncPinsMessage()`. */
  getSyncPinsMessage(): string {
    if (this.m_state.m_checkApplyToAllParts.value) return 'Synchronized Pins Mode.';
    else if (this.m_pin.IsNew())
      return 'Synchronized Pins Mode.  New pin will be added to all units.';
    else return 'Synchronized Pins Mode.  Matching pins in other units will be updated.';
  }

  /** `OnAddAlternate( event )`: a nameless alternate of the pin's type and style, its name edited. */
  OnAddAlternate(): void {
    if (!this.m_alternatesGrid.CommitPendingChanges()) return;

    this.m_alternatesGrid.OnAddRow((): [number, number] => {
      this.m_alternatesDataModel.AppendRow({
        m_Name: '',
        m_Type: this.m_pin.GetType(),
        m_Shape: this.m_pin.GetShape(),
      });

      return [this.m_alternatesGrid.GetNumberRows() - 1, ALT_COL.COL_NAME];
    });
  }

  /** `OnDeleteAlternate( event )`. */
  OnDeleteAlternate(): void {
    this.m_alternatesGrid.OnDeleteRows((row) => {
      this.m_alternatesDataModel.RemoveRow(row);
    });
  }

  /** `OnCollapsiblePaneChange` (the window grows to fit an opened pane on its own). */
  OnCollapsiblePaneChange(aCollapsed: boolean): PIN_DIALOG_STATE {
    this.m_state.m_alternatesTurndown.collapsed = aCollapsed;
    return this.snapshot();
  }

  /**
   * `OnUpdateUI`'s delayed focus: the turndown opened, and the alternate the failed OK named made
   * current with its editor open.
   */
  HandleDelayedFocus(): PIN_DIALOG_STATE | null {
    if (this.m_delayedFocusRow < 0) return null;

    this.m_state.m_alternatesTurndown.collapsed = false;
    this.m_alternatesGrid.SetGridCursor(this.m_delayedFocusRow, this.m_delayedFocusColumn);
    this.m_alternatesGrid.EnableCellEditControl(true);

    this.m_delayedFocusRow = -1;
    this.m_delayedFocusColumn = -1;
    return this.snapshot();
  }

  /** `TransferDataFromWindow()`: false keeps the dialog up. */
  async TransferDataFromWindow(): Promise<boolean> {
    if (!this.m_alternatesGrid.CommitPendingChanges()) return false;

    // Check for missing alternate names.
    for (let i = 0; i < this.m_alternatesDataModel.m_alts.length; ++i) {
      if (this.m_alternatesDataModel.m_alts[i]!.m_Name === '') {
        DisplayErrorMessage(_('Alternate pin definitions must have a name.'));

        this.m_delayedFocusColumn = ALT_COL.COL_NAME;
        this.m_delayedFocusRow = i;

        return false;
      }
    }

    const s = this.m_state;
    this.writeBinders();

    const newPos: VECTOR2I = { x: this.m_posX.GetIntValue(), y: this.m_posY.GetIntValue() };

    const standard_grid = 50;

    // Only show the warning if the position has been changed. (Upstream takes the remainder of
    // the position in internal units, not mils; kept.)
    if (
      (this.m_origPos.x !== newPos.x || this.m_origPos.y !== newPos.y) &&
      (this.m_posX.GetValue() % standard_grid !== 0 || this.m_posY.GetValue() % standard_grid !== 0)
    ) {
      const msg =
        `This pin is not on a ${standard_grid} mils grid which will make it difficult to ` +
        'connect to in the schematic.\nDo you wish to continue?';

      if (!(await IsOK(msg))) return false;
    }

    this.m_pin.SetName(s.m_textPinName);
    this.m_pin.SetNumber(s.m_textPinNumber);
    this.m_pin.SetNameTextSize(this.m_nameSize.GetIntValue());
    this.m_pin.SetNumberTextSize(this.m_numberSize.GetIntValue());
    this.m_pin.SetOrientation(PinOrientationCode(s.m_choiceOrientation));
    this.m_pin.SetPosition(newPos);
    this.m_pin.ChangeLength(this.m_pinLength.GetIntValue());
    this.m_pin.SetType(s.m_choiceElectricalType);
    this.m_pin.SetShape(s.m_choiceStyle);
    this.m_pin.SetBodyStyle(s.m_checkApplyToAllBodyStyles.value ? 0 : this.m_frame.GetBodyStyle());
    this.m_pin.SetUnit(s.m_checkApplyToAllParts.value ? 0 : this.m_frame.GetUnit());
    this.m_pin.SetVisible(s.m_checkShow.value);

    const alternates = this.m_pin.GetAlternates();
    alternates.clear();

    for (const alt of this.m_alternatesDataModel.m_alts) alternates.set(alt.m_Name, { ...alt });

    return true;
  }

  /** The UNIT_BINDERs' texts into the state. */
  private readBinders(): void {
    const s = this.m_state;
    s.m_posXCtrl = this.m_posX.GetText();
    s.m_posYCtrl = this.m_posY.GetText();
    s.m_pinLengthCtrl = this.m_pinLength.GetText();
    s.m_nameSizeCtrl = this.m_nameSize.GetText();
    s.m_numberSizeCtrl = this.m_numberSize.GetText();
  }

  /** The state's texts into the UNIT_BINDERs, which read them as the controls' text. */
  private writeBinders(): void {
    const s = this.m_state;
    this.m_posX.SetText(s.m_posXCtrl);
    this.m_posY.SetText(s.m_posYCtrl);
    this.m_pinLength.SetText(s.m_pinLengthCtrl);
    this.m_nameSize.SetText(s.m_nameSizeCtrl);
    this.m_numberSize.SetText(s.m_numberSizeCtrl);
  }

  /** A copy for React: the handlers change m_state in place. */
  private snapshot(): PIN_DIALOG_STATE {
    return structuredClone(this.m_state);
  }
}

const ALT_COLUMNS = [{ width: 260 }, { width: 140 }, { width: 140 }];

/**
 * The dialog as the window shows it for the symbol editor's ShowModalDialog( "DIALOG_PIN_PROPERTIES",
 * [ aPin ], { focusPinNumber } ): \a onClose gets wxID_OK once the pin is changed, or wxID_CANCEL.
 */
export function DialogPinProperties({
  frame,
  pin,
  focusPinNumber,
  units,
  onClose,
}: {
  frame: SYMBOL_EDIT_FRAME;
  pin: SCH_PIN;
  focusPinNumber: boolean;
  /** The frame's units, which the UNIT_BINDERs label their entries with. */
  units: StatusUnits;
  onClose: (aResult: number) => void;
}): JSX.Element {
  const [dlg] = useState(() => new DIALOG_PIN_PROPERTIES(frame, pin, focusPinNumber));
  const [s, setS] = useState(() => dlg.TransferDataToWindow());
  const [, setGridTick] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);

  // The grid redraws itself; a row added or removed changes the sizer's content.
  useEffect(() => {
    dlg.m_alternatesGrid.SetModifyHandler(() => setGridTick((n) => n + 1));
    return () => dlg.m_alternatesGrid.SetModifyHandler(null);
  }, [dlg]);

  const text = (aKey: keyof PIN_DIALOG_STATE) => (aText: string) =>
    setS(dlg.Set(aKey, aText as never));

  return (
    <DIALOG_PIN_PROPERTIES_BASE
      infoBar={
        s.infoBar === null
          ? null
          : {
              message: s.infoBar.message,
              ...(s.infoBar.exitLink
                ? {
                    actionLabel: _('Exit sync pins mode'),
                    onAction: () => setS(dlg.OnExitSyncPinsMode()),
                  }
                : {}),
            }
      }
      m_textPinName={s.m_textPinName}
      onPinName={text('m_textPinName')}
      m_textPinNumber={s.m_textPinNumber}
      onPinNumber={text('m_textPinNumber')}
      nameRef={nameRef}
      numberRef={numberRef}
      initialFocus={focusPinNumber ? numberRef : nameRef}
      m_choiceElectricalType={s.m_choiceElectricalType}
      onElectricalType={(t) => setS(dlg.Set('m_choiceElectricalType', t))}
      m_choiceStyle={s.m_choiceStyle}
      onStyle={(t) => setS(dlg.Set('m_choiceStyle', t))}
      orientationOptions={dlg.m_orientationOptions}
      m_choiceOrientation={s.m_choiceOrientation}
      onOrientation={(i) => setS(dlg.Set('m_choiceOrientation', i))}
      m_posXCtrl={s.m_posXCtrl}
      onPosX={text('m_posXCtrl')}
      m_posYCtrl={s.m_posYCtrl}
      onPosY={text('m_posYCtrl')}
      m_pinLengthCtrl={s.m_pinLengthCtrl}
      onPinLength={text('m_pinLengthCtrl')}
      m_nameSizeCtrl={s.m_nameSizeCtrl}
      onNameSize={text('m_nameSizeCtrl')}
      m_numberSizeCtrl={s.m_numberSizeCtrl}
      onNumberSize={text('m_numberSizeCtrl')}
      units={unitLabel(units)}
      m_checkApplyToAllParts={s.m_checkApplyToAllParts}
      onApplyToAllParts={(c) => setS(dlg.Set('m_checkApplyToAllParts', c))}
      m_checkApplyToAllBodyStyles={s.m_checkApplyToAllBodyStyles}
      onApplyToAllBodyStyles={(c) => setS(dlg.Set('m_checkApplyToAllBodyStyles', c))}
      m_checkShow={s.m_checkShow}
      onShow={(c) => setS(dlg.Set('m_checkShow', c))}
      m_panelShowPin={
        <SymbolPreviewWidget project={frame.Prj()} onReady={(w) => dlg.SetPreviewWidget(w)} />
      }
      m_alternatesTurndown={s.m_alternatesTurndown}
      onCollapsiblePaneChange={(c) => setS(dlg.OnCollapsiblePaneChange(c))}
      m_alternatesGrid={
        <WxGridView
          grid={dlg.m_alternatesGrid}
          columns={ALT_COLUMNS}
          flexCol={ALT_COL.COL_NAME}
          ariaLabel="Alternate pin functions"
        />
      }
      onAddAlternate={() => dlg.OnAddAlternate()}
      onDeleteAlternate={() => dlg.OnDeleteAlternate()}
      onOK={() => {
        void dlg.TransferDataFromWindow().then((ok) => {
          if (ok) {
            onClose(wxID_OK);
            return;
          }

          const focused = dlg.HandleDelayedFocus();

          if (focused) setS(focused);
        });
      }}
      onCancel={() => onClose(wxID_CANCEL)}
    />
  );
}
