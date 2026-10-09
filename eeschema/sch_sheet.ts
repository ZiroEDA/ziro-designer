// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_sheet.h` / `sch_sheet.cpp`: `SCH_SHEET`, a hierarchical sheet symbol
 * (eeschema stage E3).
 *
 * Pending, marked in place: Plot (the plotters), * GetMenuImage, Show (debug), the property registration.
 */

import {
  PROPERTY,
  PROPERTY_DISPLAY,
  TYPE_BOOL,
  TYPE_COLOR4D,
  TYPE_INT,
  TYPE_STRING,
} from '@ziroeda/common/properties/property.js';
import { VALIDATION_ERROR_MSG } from '@ziroeda/common/properties/property_validators.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';
import { GetFieldValidationErrorMessage } from '@ziroeda/common/validators.js';
import {
  INSPECT_RESULT,
  type INSPECTOR,
  type OutStr,
  type RECURSE_MODE,
} from '@ziroeda/common/eda_item.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { COLOR4D_UNSPECIFIED, type Color4d, color4dEquals } from '@ziroeda/common/gal/color4d.js';
import { niluuid, type KIID_PATH } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import { DO_TRANSLATE, FIELD_T, GetDefaultFieldName } from '@ziroeda/common/template_fieldnames.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import {
  KIUI_EllipsizeMenuText,
  KIUI_EllipsizeStatusText,
} from '@ziroeda/common/widgets/ui_common.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  ANGLE_270,
  ANGLE_90,
  ANGLE_HORIZONTAL,
  ANGLE_VERTICAL,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_BoxHitTestChain } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { DEFAULT_LINE_WIDTH_MILS } from './default_values.js';
import { FindField, NextFieldOrdinal, SCH_FIELD } from './sch_field.js';
import { AUTOPLACE_ALGO, type DANGLING_END_ITEM, SCH_ITEM } from './sch_item.js';
import type { SCH_LABEL_BASE } from './sch_label.js';
import type { SCH_NO_CONNECT } from './sch_no_connect.js';
import type { SCH_SCREEN } from './sch_screen.js';
import { SCH_SHEET_PIN, SHEET_SIDE } from './sch_sheet_pin.js';
import { SCH_SHEET_INSTANCE, SCH_SHEET_PATH, SCH_SHEET_VARIANT } from './sch_sheet_path.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/eda_item.js';

export const MIN_SHEET_WIDTH = 500; // Units are mils.
export const MIN_SHEET_HEIGHT = 150; // Units are mils.

/** `bumpToNextGrid`: a 50 mil grid. */
function bumpToNextGrid(aVal: number, aDirection: number): number {
  const gridSize = schIUScale.milsToIU(50);

  const base = Math.trunc(aVal / gridSize);
  const excess = Math.abs(aVal % gridSize);

  if (aDirection > 0) {
    return (base + 1) * gridSize;
  } else if (excess > 0) {
    return base * gridSize;
  } else {
    return (base - 1) * gridSize;
  }
}

const addPt = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const samePt = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/**
 * Sheet symbol placed in a schematic, and is the entry point for a sub schematic.
 */
export class SCH_SHEET extends SCH_ITEM {
  /**
   * Screen that contains the physical data for the sheet.  In complex hierarchies
   * multiple sheets can share a common screen.
   */
  private m_screen!: SCH_SCREEN | null;

  /// The list of sheet connection points.
  private m_pins!: SCH_SHEET_PIN[];

  private m_fields!: SCH_FIELD[];

  private m_excludedFromSim!: boolean;
  private m_excludedFromBOM!: boolean;
  private m_excludedFromBoard!: boolean;
  private m_DNP!: boolean;

  private m_pos!: VECTOR2I; // The position of the sheet.
  private m_size!: VECTOR2I; // The size of the sheet.
  private m_borderWidth!: number;
  private m_borderColor!: Color4d;
  private m_backgroundColor!: Color4d;

  private m_instances!: SCH_SHEET_INSTANCE[];

  constructor(
    aParent: EDA_ITEM | null = null,
    aPos: VECTOR2I = { x: 0, y: 0 },
    aSize: VECTOR2I = {
      x: schIUScale.milsToIU(MIN_SHEET_WIDTH),
      y: schIUScale.milsToIU(MIN_SHEET_HEIGHT),
    },
  ) {
    super(aParent, KICAD_T.SCH_SHEET_T);
    this.m_excludedFromSim = false;
    this.m_excludedFromBOM = false;
    this.m_excludedFromBoard = false;
    this.m_DNP = false;

    this.m_layer = SCH_LAYER_ID.LAYER_SHEET;
    this.m_pos = { ...aPos };
    this.m_size = { ...aSize };
    this.m_screen = null;
    this.m_pins = [];
    this.m_instances = [];

    this.m_borderWidth = 0;
    this.m_borderColor = { ...COLOR4D_UNSPECIFIED };
    this.m_backgroundColor = { ...COLOR4D_UNSPECIFIED };
    this.m_fieldsAutoplaced = AUTOPLACE_ALGO.AUTOPLACE_AUTO;

    this.m_fields = [
      new SCH_FIELD(
        this,
        FIELD_T.SHEET_NAME,
        GetDefaultFieldName(FIELD_T.SHEET_NAME, DO_TRANSLATE),
      ),
      new SCH_FIELD(
        this,
        FIELD_T.SHEET_FILENAME,
        GetDefaultFieldName(FIELD_T.SHEET_FILENAME, DO_TRANSLATE),
      ),
    ];

    this.AutoplaceFields(null, this.m_fieldsAutoplaced);
  }

  /**
   * `SCH_SHEET( const SCH_SHEET& aSheet )`: copies the fields and pins, shares the screen
   * (one more reference to it), keeps the uuid.
   */
  static copyOf(aSheet: SCH_SHEET): SCH_SHEET {
    const copy = new SCH_SHEET();
    SCH_ITEM.copySchItem(copy, aSheet);

    copy.m_pos = { ...aSheet.m_pos };
    copy.m_size = { ...aSheet.m_size };
    copy.m_layer = aSheet.m_layer;
    (copy as { m_Uuid: string }).m_Uuid = aSheet.m_Uuid;
    copy.m_fields = aSheet.m_fields.map((f) => SCH_FIELD.copyOf(f));
    copy.m_fieldsAutoplaced = aSheet.m_fieldsAutoplaced;
    copy.m_screen = aSheet.m_screen;

    copy.m_excludedFromSim = aSheet.m_excludedFromSim;
    copy.m_excludedFromBOM = aSheet.m_excludedFromBOM;
    copy.m_excludedFromBoard = aSheet.m_excludedFromBoard;
    copy.m_DNP = aSheet.m_DNP;

    copy.m_borderWidth = aSheet.m_borderWidth;
    copy.m_borderColor = { ...aSheet.m_borderColor };
    copy.m_backgroundColor = { ...aSheet.m_backgroundColor };
    copy.m_instances = aSheet.m_instances.map((i) => i.Clone());

    copy.m_pins = [];

    for (const pin of aSheet.m_pins) {
      const p = SCH_SHEET_PIN.copyOf(pin);
      p.SetParent(copy);
      copy.m_pins.push(p);
    }

    for (const field of copy.m_fields) field.SetParent(copy);

    if (copy.m_screen) copy.m_screen.IncRefCount();

    return copy;
  }

  /** `~SCH_SHEET()`: drop this sheet's reference to its screen. */
  override Destroy(): void {
    // also, look at the associated sheet & its reference count
    // perhaps it should be deleted also.
    if (this.m_screen) {
      this.m_screen.DecRefCount();

      if (this.m_screen.GetRefCount() === 0) this.m_screen.Destroy();
    }

    super.Destroy();
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_SHEET_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_SHEET';
  }

  /**
   * `GetMsgPanelInfo( aFrame, aList )` (sch_sheet.cpp). `schframe->GetCurrentSheet()` is the
   * schematic's CurrentSheet(): with no schematic there is no SCH_EDIT_FRAME behind the call.
   */
  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    // Don't use GetShownText(); we want to see the variable references here
    aList.push(new MSG_PANEL_ITEM('Sheet Name', KIUI_EllipsizeStatusText(aFrame, this.GetName())));

    const schematic = this.Schematic();
    let currentSheet: SCH_SHEET_PATH | null = null;
    let currentVariant = '';

    if (schematic) {
      const path = schematic.CurrentSheet().Clone();
      path.push_back(this);
      currentSheet = schematic.CurrentSheet();
      currentVariant = schematic.GetCurrentVariant();

      aList.push(new MSG_PANEL_ITEM('Hierarchical Path', path.PathHumanReadable(false, true)));
    }

    // Don't use GetShownText(); we want to see the variable references here
    aList.push(
      new MSG_PANEL_ITEM('File Name', KIUI_EllipsizeStatusText(aFrame, this.GetFileName())),
    );

    const msgs: string[] = [];

    if (this.GetExcludedFromSim()) msgs.push('Simulation');

    if (this.GetExcludedFromBOM()) msgs.push('BOM');

    if (this.GetExcludedFromBoard()) msgs.push('Board');

    if (this.GetDNP(currentSheet, currentVariant)) msgs.push('DNP');

    const msg = msgs.join(', ');

    if (msg) aList.push(new MSG_PANEL_ITEM('Exclude from', msg));
  }

  /**
   * Return true for items which are moved with the anchor point at mouse cursor
   * and false for items moved with no reference to anchor.
   *
   * Usually return true for small items (labels, junctions) and false for items which can
   * be large (hierarchical sheets, symbols).
   */
  override IsMovableFromAnchorPoint(): boolean {
    return false;
  }

  GetFields(): SCH_FIELD[] {
    return this.m_fields;
  }

  /**
   * `GetField( FIELD_T )` creates a missing mandatory field (the non-const overload);
   * `GetField( const wxString& )` finds by name.
   */
  GetField(aField: FIELD_T | string): SCH_FIELD | null {
    if (typeof aField === 'string') return FindField(this.m_fields, aField);

    const field = FindField(this.m_fields, aField);

    if (field) return field;

    const created = new SCH_FIELD(this, aField);
    this.m_fields.push(created);
    return created;
  }

  /** Return the next ordinal for a user field for this sheet. */
  GetNextFieldOrdinal(): number {
    return NextFieldOrdinal(this.m_fields);
  }

  /**
   * Set multiple schematic fields.
   *
   * @param aFields are the fields to set in this symbol.
   */
  SetFields(aFields: readonly SCH_FIELD[]): void {
    this.m_fields = aFields.map((f) => SCH_FIELD.copyOf(f)); // vector copying, length is changed possibly

    // Make sure that we get the UNIX variant of the file path
    this.SetFileName(this.GetField(FIELD_T.SHEET_FILENAME)!.GetText());
  }

  /**
   * Add a field to the sheet.
   *
   * @return the newly inserted field.
   */
  AddField(aField: SCH_FIELD): SCH_FIELD {
    const field = SCH_FIELD.copyOf(aField);
    this.m_fields.push(field);
    return field;
  }

  SetFieldText(
    aFieldName: string,
    aFieldText: string,
    aPath: SCH_SHEET_PATH | null = null,
    aVariantName = '',
  ): void {
    if (aFieldName === '') return; // wxCHECK

    const field = this.GetField(aFieldName);

    if (!field) return; // wxCHECK

    switch (field.GetId()) {
      case FIELD_T.SHEET_FILENAME: {
        // File names are stored using unix separators.
        const tmp = aFieldText.replaceAll('\\', '/');
        this.GetField(FIELD_T.SHEET_FILENAME)!.SetText(tmp);
        break;
      }

      case FIELD_T.SHEET_NAME:
        field.SetText(aFieldText);
        break;

      default: {
        const defaultText = field.GetText(aPath);

        if (aVariantName === '') {
          if (aFieldText !== defaultText) field.SetText(aFieldText);
        } else {
          const instance = this.getInstance(aPath!.Path());

          if (!instance) return; // wxCHECK

          const variant = instance.m_Variants.get(aVariantName);

          if (variant) {
            if (aFieldText !== defaultText) variant.m_Fields.set(aFieldName, aFieldText);
            else variant.m_Fields.delete(aFieldName);
          } else if (aFieldText !== defaultText) {
            const newVariant = new SCH_SHEET_VARIANT(aVariantName);

            newVariant.InitializeAttributes(this);
            newVariant.m_Fields.set(aFieldName, aFieldText);
            instance.m_Variants.set(aVariantName, newVariant);
          }
        }

        break;
      }
    }
  }

  GetFieldText(aFieldName: string, aPath: SCH_SHEET_PATH | null = null, aVariantName = ''): string {
    if (aFieldName === '') return ''; // wxCHECK

    const field = this.GetField(aFieldName);

    if (!field) return ''; // wxCHECK

    switch (field.GetId()) {
      case FIELD_T.REFERENCE:
      case FIELD_T.FOOTPRINT:
        return field.GetText();

      default:
        if (aVariantName === '') {
          return field.GetText();
        } else {
          const instance = this.getInstance(aPath!.Path());
          const value = instance!.m_Variants.get(aVariantName)?.m_Fields.get(aFieldName);

          if (value !== undefined) return value;
        }

        break;
    }

    return field.GetText();
  }

  GetShownName(aAllowExtraText: boolean): string {
    return this.GetField(FIELD_T.SHEET_NAME)!.GetShownText(aAllowExtraText);
  }

  GetName(): string {
    return this.GetField(FIELD_T.SHEET_NAME)!.GetText();
  }

  SetName(aName: string): void {
    this.GetField(FIELD_T.SHEET_NAME)!.SetText(aName);
  }

  GetScreen(): SCH_SCREEN | null {
    return this.m_screen;
  }

  GetSize(): VECTOR2I {
    return this.m_size;
  }

  SetSize(aSize: VECTOR2I): void {
    this.m_size = { ...aSize };
  }

  GetBorderWidth(): number {
    return this.m_borderWidth;
  }

  SetBorderWidth(aWidth: number): void {
    this.m_borderWidth = aWidth;
  }

  GetBorderColor(): Color4d {
    return this.m_borderColor;
  }

  SetBorderColor(aColor: Color4d): void {
    this.m_borderColor = { ...aColor };
  }

  GetBackgroundColor(): Color4d {
    return this.m_backgroundColor;
  }

  SetBackgroundColor(aColor: Color4d): void {
    this.m_backgroundColor = { ...aColor };
  }

  /** The virtual root sheet has the nil uuid (it sits above the top-level sheets). */
  IsVirtualRootSheet(): boolean {
    if (!this.Schematic()) return false; // wxCHECK_MSG

    return this.m_Uuid === niluuid;
  }

  /** Check if this sheet is a top-level sheet (a child of the virtual root). */
  IsTopLevelSheet(): boolean {
    const schematic = this.Schematic();

    if (!schematic) return false; // wxCHECK_MSG

    return schematic.IsTopLevelSheet(this);
  }

  /**
   * Set the #SCH_SCREEN associated with this sheet to \a aScreen.
   *
   * The screen reference counting is performed by SetScreen.  If \a aScreen is not
   * the same as the current screen, the current screen reference count is decremented
   * and \a aScreen becomes the screen for the sheet.  If the current screen reference
   * count reaches zero, the current screen is deleted.  NULL is a valid value for
   * \a aScreen.
   */
  SetScreen(aScreen: SCH_SCREEN | null): void {
    if (aScreen === this.m_screen) return;

    if (this.m_screen !== null) {
      this.m_screen.DecRefCount();

      if (this.m_screen.GetRefCount() === 0) {
        this.m_screen.Destroy();
        this.m_screen = null;
      }
    }

    this.m_screen = aScreen;

    if (this.m_screen) this.m_screen.IncRefCount();
  }

  /** Return the number of times the associated screen for the sheet is being used. */
  GetScreenCount(): number {
    if (this.m_screen === null) return 0;

    return this.m_screen.GetRefCount();
  }

  /** Return the list of system text vars & fields for this sheet. */
  GetContextualTextVars(aVars: string[]): void {
    const add = (aVar: string): void => {
      if (!aVars.includes(aVar)) aVars.push(aVar);
    };

    for (const field of this.m_fields) {
      if (field.IsMandatory()) add(field.GetCanonicalName().toUpperCase());
      else add(field.GetName());
    }

    const sheetPath = this.findSelf();

    if (sheetPath.size() >= 2) {
      sheetPath.pop_back();
      sheetPath.Last()!.GetContextualTextVars(aVars);
    } else if (this.Schematic()) {
      this.Schematic()!.GetContextualTextVars(aVars);
    }

    add('#');
    add('##');
    add('SHEETPATH');
    add('EXCLUDE_FROM_BOM');
    add('EXCLUDE_FROM_BOARD');
    add('EXCLUDE_FROM_SIM');
    add('DNP');
    add('ERC_ERROR <message_text>');
    add('ERC_WARNING <message_text>');

    TITLE_BLOCK.GetContextualTextVars(aVars);
  }

  /**
   * Resolve any references to system tokens supported by the sheet.
   *
   * @param aDepth is a counter for limiting recursion and circular references.
   */
  ResolveTextVar(aPath: SCH_SHEET_PATH | null, token: OutStr, aDepth = 0): boolean {
    if (!aPath) return false; // wxCHECK

    const schematic = this.Schematic();

    if (!schematic) return false;

    if (token.value.includes(':')) {
      if (schematic.ResolveCrossReference(token, aDepth + 1)) return true;
    }

    for (const field of this.m_fields) {
      const fieldName = field.IsMandatory()
        ? field.GetCanonicalName().toUpperCase()
        : field.GetName();

      if (token.value === fieldName) {
        token.value = field.GetShownText(aPath, false, aDepth + 1);
        return true;
      }
    }

    const project = schematic.Project();
    const variant = schematic.GetCurrentVariant();

    // We cannot resolve text variables initially on load as we need to first load the
    // screen and then parse the hierarchy.  So skip the resolution if the screen isn't
    // set yet
    if (this.m_screen && this.m_screen.GetTitleBlock().TextVarResolver(token, project)) {
      return true;
    }

    if (token.value === '#') {
      token.value = aPath.GetPageNumber();
      return true;
    } else if (token.value === '##') {
      token.value = String(schematic.Hierarchy().length);
      return true;
    } else if (token.value === 'SHEETPATH') {
      token.value = aPath.PathHumanReadable();
      return true;
    } else if (token.value === 'EXCLUDE_FROM_BOM') {
      token.value = '';

      if (aPath.GetExcludedFromBOM(variant) || this.ResolveExcludedFromBOM(aPath, variant))
        token.value = 'Excluded from BOM';

      return true;
    } else if (token.value === 'EXCLUDE_FROM_BOARD') {
      token.value = '';

      if (aPath.GetExcludedFromBoard(variant) || this.ResolveExcludedFromBoard(aPath, variant))
        token.value = 'Excluded from board';

      return true;
    } else if (token.value === 'EXCLUDE_FROM_SIM') {
      token.value = '';

      if (aPath.GetExcludedFromSim(variant) || this.ResolveExcludedFromSim(aPath, variant))
        token.value = 'Excluded from simulation';

      return true;
    } else if (token.value === 'DNP') {
      token.value = '';

      if (aPath.GetDNP(variant) || this.ResolveDNP(aPath, variant)) token.value = 'DNP';

      return true;
    }

    // See if parent can resolve it (these will recurse to ancestors)

    if (aPath.size() >= 2) {
      const path = aPath.Clone();
      path.pop_back();

      if (path.Last()!.ResolveTextVar(path, token, aDepth + 1)) return true;
    } else {
      if (schematic.ResolveTextVar(aPath, token, aDepth + 1)) return true;
    }

    return false;
  }

  /**
   * Checks if the sheet is vertically oriented: it has pins on the top or bottom edge and
   * none on the left or right.
   */
  IsVerticalOrientation(): boolean {
    let leftRight = 0;
    let topBottom = 0;

    for (const pin of this.m_pins) {
      switch (pin.GetSide()) {
        case SHEET_SIDE.LEFT:
          leftRight++;
          break;
        case SHEET_SIDE.RIGHT:
          leftRight++;
          break;
        case SHEET_SIDE.TOP:
          topBottom++;
          break;
        case SHEET_SIDE.BOTTOM:
          topBottom++;
          break;
        default:
          break;
      }
    }

    return topBottom > 0 && leftRight === 0;
  }

  /**
   * The no-connect markers on this sheet's pins, found on the screen that is the sheet's
   * parent.
   */
  GetNoConnects(): Map<SCH_SHEET_PIN, SCH_NO_CONNECT> {
    const noConnects = new Map<SCH_SHEET_PIN, SCH_NO_CONNECT>();

    const parent = this.GetParent() as unknown as SCH_SCREEN | null;

    if (parent && typeof (parent as { Items?: unknown }).Items === 'function') {
      for (const sheetPin of this.m_pins) {
        const p = sheetPin.GetTextPos();

        for (const noConnect of parent
          .Items()
          .Overlapping(KICAD_T.SCH_NO_CONNECT_T, new BOX2I(p, { x: 0, y: 0 })))
          noConnects.set(sheetPin, noConnect as SCH_NO_CONNECT);
      }
    }

    return noConnects;
  }

  /** Move the sheet and its fields to \a aPosition, leaving the pins where they are. */
  SetPositionIgnoringPins(aPosition: VECTOR2I): void {
    const delta = { x: aPosition.x - this.m_pos.x, y: aPosition.y - this.m_pos.y };

    this.m_pos = { ...aPosition };

    for (const field of this.m_fields) field.Move(delta);
  }

  /**
   * Add aSheetPin to the sheet.
   *
   * Note: Once a sheet pin is added to the sheet, it is owned by the sheet.
   *       Do not delete the sheet pin object or you will likely get a segfault
   *       when the sheet is destroyed.
   */
  AddPin(aSheetPin: SCH_SHEET_PIN): void {
    aSheetPin.SetParent(this);
    this.m_pins.push(aSheetPin);
    this.renumberPins();
  }

  GetPins(): SCH_SHEET_PIN[] {
    return this.m_pins;
  }

  /** Remove \a aSheetPin from the sheet. */
  RemovePin(aSheetPin: SCH_SHEET_PIN): void {
    const i = this.m_pins.indexOf(aSheetPin);

    if (i >= 0) {
      this.m_pins.splice(i, 1);
      this.renumberPins();
    }
  }

  /**
   * Delete sheet label which do not have a corresponding hierarchical label.
   *
   * @note Make sure you save a copy of the sheet in the undo list before calling
   *       CleanupSheet() otherwise any unreferenced sheet labels will be lost.
   */
  CleanupSheet(): void {
    const pins = this.m_pins;

    this.m_pins = [];

    for (const pin of pins) {
      /* Search the schematic for a hierarchical label corresponding to this sheet label. */
      let HLabel: SCH_LABEL_BASE | null = null;

      for (const aItem of this.m_screen!.Items().OfType(KICAD_T.SCH_HIER_LABEL_T)) {
        const label = aItem as SCH_LABEL_BASE;

        if (pin.GetText().toLowerCase() === label.GetText().toLowerCase()) {
          HLabel = label;
          break;
        }
      }

      if (HLabel) this.m_pins.push(pin);
    }
  }

  /**
   * Return the sheet pin item found at \a aPosition in the sheet.
   *
   * @return The sheet pin found at \a aPosition or NULL if no sheet pin is found.
   */
  GetPin(aPosition: VECTOR2I): SCH_SHEET_PIN | null {
    for (const pin of this.m_pins) {
      if (pin.HitTest(aPosition)) return pin;
    }

    return null;
  }

  /**
   * Check if the sheet already has a sheet pin named \a aName.
   *
   * @return True if sheet pin with \a aName is found, otherwise false.
   */
  HasPin(aName: string): boolean {
    for (const pin of this.m_pins) {
      if (pin.GetText() === aName) return true;
    }

    return false;
  }

  HasPins(): boolean {
    return this.m_pins.length > 0;
  }

  /**
   * Check all sheet labels against schematic for undefined hierarchical labels.
   *
   * @return True if there are any undefined labels.
   */
  HasUndefinedPins(): boolean {
    for (const pin of this.m_pins) {
      /* Search the schematic for a hierarchical label corresponding to this sheet label. */
      let HLabel: SCH_LABEL_BASE | null = null;

      for (const aItem of this.m_screen!.Items().OfType(KICAD_T.SCH_HIER_LABEL_T)) {
        const label = aItem as SCH_LABEL_BASE;

        if (pin.GetText() === label.GetText()) {
          HLabel = label;
          break;
        }
      }

      if (HLabel === null)
        // Corresponding hierarchical label not found.
        return true;
    }

    return false;
  }

  /**
   * Return the minimum width of the sheet based on the widths of the sheet pin text.
   *
   * The minimum sheet width is determined by the width of the bounding box of each
   * hierarchical sheet pin.  If two pins are horizontally adjacent ( same Y position )
   * to each other, the sum of the bounding box widths is used.  If at some Y position
   * a pin is not horizontally adjacent to another, the width of the bounding box of the
   * pin is used.
   *
   * @param aFromLeft True if checking the minimum width while resizing from the left.
   * @return The minimum width the sheet can be resized.
   */
  GetMinWidth(aFromLeft: boolean): number {
    let pinsLeft = this.m_pos.x + this.m_size.x;
    let pinsRight = this.m_pos.x;

    for (const pin of this.m_pins) {
      const edge = pin.GetSide();

      if (edge === SHEET_SIDE.TOP || edge === SHEET_SIDE.BOTTOM) {
        const pinRect = pin.GetBoundingBox();

        pinsLeft = Math.min(pinsLeft, pinRect.GetLeft());
        pinsRight = Math.max(pinsRight, pinRect.GetRight());
      }
    }

    pinsLeft = bumpToNextGrid(pinsLeft, -1);
    pinsRight = bumpToNextGrid(pinsRight, 1);

    let pinMinWidth: number;

    if (pinsLeft >= pinsRight) pinMinWidth = 0;
    else if (aFromLeft) pinMinWidth = pinsRight - this.m_pos.x;
    else pinMinWidth = this.m_pos.x + this.m_size.x - pinsLeft;

    return Math.max(pinMinWidth, schIUScale.milsToIU(MIN_SHEET_WIDTH));
  }

  /**
   * Return the minimum height that the sheet can be resized based on the sheet pin
   * positions.
   *
   * @param aFromTop True if checking the minimum height while resizing from the top.
   * @return The minimum height the sheet can be resized.
   */
  GetMinHeight(aFromTop: boolean): number {
    let pinsTop = this.m_pos.y + this.m_size.y;
    let pinsBottom = this.m_pos.y;

    for (const pin of this.m_pins) {
      const edge = pin.GetSide();

      if (edge === SHEET_SIDE.RIGHT || edge === SHEET_SIDE.LEFT) {
        const pinRect = pin.GetBoundingBox();

        pinsTop = Math.min(pinsTop, pinRect.GetTop());
        pinsBottom = Math.max(pinsBottom, pinRect.GetBottom());
      }
    }

    pinsTop = bumpToNextGrid(pinsTop, -1);
    pinsBottom = bumpToNextGrid(pinsBottom, 1);

    let pinMinHeight: number;

    if (pinsTop >= pinsBottom) pinMinHeight = 0;
    else if (aFromTop) pinMinHeight = pinsBottom - this.m_pos.y;
    else pinMinHeight = this.m_pos.y + this.m_size.y - pinsTop;

    return Math.max(pinMinHeight, schIUScale.milsToIU(MIN_SHEET_HEIGHT));
  }

  override GetPenWidth(): number {
    if (this.GetBorderWidth() > 0) return this.GetBorderWidth();

    const schematic = this.Schematic();

    if (schematic) return schematic.Settings().m_DefaultLineWidth;

    return schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS);
  }

  /**
   * Return a bounding box for the sheet body but not the fields.
   */
  GetBodyBoundingBox(): BOX2I {
    const box = new BOX2I(this.m_pos, this.m_size);
    const lineWidth = this.GetPenWidth();
    const textLength = 0;

    // Calculate bounding box X size:
    const end = {
      x: Math.max(this.m_size.x, textLength) + this.m_pos.x,
      y: this.m_size.y + this.m_pos.y,
    };

    box.SetEnd(end);
    box.Inflate(Math.trunc(lineWidth / 2));

    return box;
  }

  override GetBoundingBox(): BOX2I {
    const bbox = this.GetBodyBoundingBox();

    for (const field of this.m_fields) bbox.Merge(field.GetBoundingBox());

    return bbox;
  }

  /**
   * Rotating around the boundingBox's center can cause walking when the sheetname or
   * filename is longer than the edge it's on.
   */
  GetRotationCenter(): VECTOR2I {
    const box = new BOX2I(this.m_pos, this.m_size);
    return box.GetCenter();
  }

  protected override swapData(aItem: SCH_ITEM): void {
    if (aItem.Type() !== KICAD_T.SCH_SHEET_T)
      throw new Error(`SCH_SHEET object cannot swap data with ${aItem.GetClass()} object.`);

    const sheet = aItem as SCH_SHEET;

    [this.m_pos, sheet.m_pos] = [sheet.m_pos, this.m_pos];
    [this.m_size, sheet.m_size] = [sheet.m_size, this.m_size];
    [this.m_fields, sheet.m_fields] = [sheet.m_fields, this.m_fields];
    [this.m_fieldsAutoplaced, sheet.m_fieldsAutoplaced] = [
      sheet.m_fieldsAutoplaced,
      this.m_fieldsAutoplaced,
    ];
    [this.m_pins, sheet.m_pins] = [sheet.m_pins, this.m_pins];

    // Update parent pointers after swapping.
    for (const sheetPin of this.m_pins) sheetPin.SetParent(this);

    for (const sheetPin of sheet.m_pins) sheetPin.SetParent(sheet);

    for (const field of this.m_fields) field.SetParent(this);

    for (const field of sheet.m_fields) field.SetParent(sheet);

    [this.m_excludedFromSim, sheet.m_excludedFromSim] = [
      sheet.m_excludedFromSim,
      this.m_excludedFromSim,
    ];
    [this.m_excludedFromBOM, sheet.m_excludedFromBOM] = [
      sheet.m_excludedFromBOM,
      this.m_excludedFromBOM,
    ];
    [this.m_excludedFromBoard, sheet.m_excludedFromBoard] = [
      sheet.m_excludedFromBoard,
      this.m_excludedFromBoard,
    ];
    [this.m_DNP, sheet.m_DNP] = [sheet.m_DNP, this.m_DNP];

    [this.m_borderWidth, sheet.m_borderWidth] = [sheet.m_borderWidth, this.m_borderWidth];
    [this.m_borderColor, sheet.m_borderColor] = [sheet.m_borderColor, this.m_borderColor];
    [this.m_backgroundColor, sheet.m_backgroundColor] = [
      sheet.m_backgroundColor,
      this.m_backgroundColor,
    ];
    [this.m_instances, sheet.m_instances] = [sheet.m_instances, this.m_instances];
  }

  /**
   * Count our own symbols, without the power symbols.
   */
  SymbolCount(): number {
    let n = 0;

    if (this.m_screen) {
      for (const aItem of this.m_screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
        const symbol = aItem as unknown as SCH_SYMBOL;

        if (!symbol.IsPower()) n++;
      }

      for (const aItem of this.m_screen.Items().OfType(KICAD_T.SCH_SHEET_T))
        n += (aItem as SCH_SHEET).SymbolCount();
    }

    return n;
  }

  /**
   * Search the existing hierarchy for an instance of screen loaded from \a aFileName.
   *
   * @param aFilename = the filename to find (MUST be absolute, and in wxPATH_NATIVE encoding)
   * @param aScreen = a location to return a pointer to the screen (if found)
   * @return true if found, and a pointer to the screen
   */
  SearchHierarchy(aFilename: string, aScreen: { value: SCH_SCREEN | null }): boolean {
    if (this.m_screen) {
      // Only check the root sheet once and don't recurse.
      if (!this.GetParent()) {
        if (this.m_screen && this.m_screen.GetFileName() === aFilename) {
          aScreen.value = this.m_screen;
          return true;
        }
      }

      for (const aItem of this.m_screen.Items().OfType(KICAD_T.SCH_SHEET_T)) {
        const sheet = aItem as SCH_SHEET;
        const screen = sheet.m_screen;

        // Must use the screen's path (which is always absolute) rather than the
        // sheet's (which could be relative).
        if (screen && screen.GetFileName() === aFilename) {
          aScreen.value = screen;
          return true;
        }

        if (sheet.SearchHierarchy(aFilename, aScreen)) return true;
      }
    }

    return false;
  }

  /**
   * Search the existing hierarchy for an instance of screen loaded from \a aFileName.
   * Don't bother looking at the root sheet - it must be unique, no other references to
   * its m_screen otherwise there would be loops in the hierarchy.
   *
   * @param[in]  aScreen = the SCH_SCREEN* screen that we search for
   * @param[in]  aList = the SCH_SHEET_PATH* that must be used
   * @return true if found
   */
  LocatePathOfScreen(aScreen: SCH_SCREEN, aList: SCH_SHEET_PATH): boolean {
    if (this.m_screen) {
      aList.push_back(this);

      if (this.m_screen === aScreen) return true;

      for (const item of this.m_screen.Items().OfType(KICAD_T.SCH_SHEET_T)) {
        const sheet = item as SCH_SHEET;

        if (sheet.LocatePathOfScreen(aScreen, aList)) return true;
      }

      aList.pop_back();
    }

    return false;
  }

  /**
   * Count the number of sheets found in "this" sheet including all of the subsheets;
   * `CountSheets( const wxString& aFileName )` counts the sheets that use that file.
   */
  CountSheets(aFileName?: string): number {
    if (aFileName !== undefined) {
      let count = 0;

      if (this.m_screen) {
        if (this.m_screen.GetFileName() === aFileName) count++;

        for (const aItem of this.m_screen.Items().OfType(KICAD_T.SCH_SHEET_T))
          count += (aItem as SCH_SHEET).CountSheets(aFileName);
      }

      return count;
    }

    let count = 1; //1 = this!!

    if (this.m_screen) {
      for (const aItem of this.m_screen.Items().OfType(KICAD_T.SCH_SHEET_T))
        count += (aItem as SCH_SHEET).CountSheets();
    }

    return count;
  }

  /**
   * Same as CountSheets but excluding the virtual root sheet.
   */
  CountActiveSheets(): number {
    let count = this.CountSheets();

    if (this.IsVirtualRootSheet()) count--;

    return count;
  }

  /**
   * Return the filename corresponding to this sheet.
   *
   * @return a wxString containing the filename
   */
  GetFileName(): string {
    return this.GetField(FIELD_T.SHEET_FILENAME)!.GetText();
  }

  // Set a new filename without changing anything else
  SetFileName(aFilename: string): void {
    // Filenames are stored using unix notation
    const tmp = aFilename.replaceAll('\\', '/');
    this.GetField(FIELD_T.SHEET_FILENAME)!.SetText(tmp);
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.m_pos = addPt(this.m_pos, aMoveVector);

    for (const pin of this.m_pins) pin.Move(aMoveVector);

    for (const field of this.m_fields) field.Move(aMoveVector);
  }

  override MirrorHorizontally(aCenter: number): void {
    let dx = this.m_pos.x;

    this.m_pos = { x: -(this.m_pos.x - aCenter) + aCenter - this.m_size.x, y: this.m_pos.y };
    dx -= this.m_pos.x; // dx,0 is the move vector for this transform

    for (const sheetPin of this.m_pins) sheetPin.MirrorHorizontally(aCenter);

    for (const field of this.m_fields) {
      const pos = field.GetTextPos();
      field.SetTextPos({ x: pos.x - dx, y: pos.y });
    }
  }

  override MirrorVertically(aCenter: number): void {
    let dy = this.m_pos.y;

    this.m_pos = { x: this.m_pos.x, y: -(this.m_pos.y - aCenter) + aCenter - this.m_size.y };
    dy -= this.m_pos.y; // 0,dy is the move vector for this transform

    for (const sheetPin of this.m_pins) sheetPin.MirrorVertically(aCenter);

    for (const field of this.m_fields) {
      const pos = field.GetTextPos();
      field.SetTextPos({ x: pos.x, y: pos.y - dy });
    }
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    const prev = this.m_pos;

    this.m_pos = RotatePoint(this.m_pos, aCenter, aRotateCCW ? ANGLE_90 : ANGLE_270);
    this.m_size = RotatePoint(this.m_size, aRotateCCW ? ANGLE_90 : ANGLE_270);

    if (this.m_size.x < 0) {
      this.m_pos = { x: this.m_pos.x + this.m_size.x, y: this.m_pos.y };
      this.m_size = { x: -this.m_size.x, y: this.m_size.y };
    }

    if (this.m_size.y < 0) {
      this.m_pos = { x: this.m_pos.x, y: this.m_pos.y + this.m_size.y };
      this.m_size = { x: this.m_size.x, y: -this.m_size.y };
    }

    // Pins must be rotated first as that's how we determine vertical vs horizontal
    // orientation for auto-placement
    for (const sheetPin of this.m_pins) sheetPin.Rotate(aCenter, aRotateCCW);

    if (
      this.m_fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_AUTO ||
      this.m_fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_MANUAL
    ) {
      this.AutoplaceFields(/* aScreen */ null, this.m_fieldsAutoplaced);
    } else {
      // Move the fields to the new position because the parent itself has moved.
      for (const field of this.m_fields) {
        const pos = field.GetTextPos();
        field.SetTextPos({
          x: pos.x - (prev.x - this.m_pos.x),
          y: pos.y - (prev.y - this.m_pos.y),
        });
      }
    }
  }

  override Matches(_aSearchData: EDA_SEARCH_DATA, _aAuxData: unknown): boolean {
    // Sheets are searchable via the child field and pin item text.
    return false;
  }

  override IsReplaceable(): boolean {
    return true;
  }

  /**
   * Resize this sheet to aSize and adjust all of the labels accordingly.
   *
   * @param[in] aSize The new size for this sheet.
   */
  Resize(aSize: VECTOR2I): void {
    if (samePt(aSize, this.m_size)) return;

    this.m_size = { ...aSize };

    // Move the fields if we're in autoplace mode
    if (
      this.m_fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_AUTO ||
      this.m_fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_MANUAL
    )
      this.AutoplaceFields(/* aScreen */ null, this.m_fieldsAutoplaced);

    // Move the sheet labels according to the new sheet size.
    for (const sheetPin of this.m_pins) sheetPin.ConstrainOnEdge(sheetPin.GetPosition(), false);
  }

  override AutoplaceFields(_aScreen: unknown, aAlgo: AUTOPLACE_ALGO): void {
    const sheetNameField = this.GetField(FIELD_T.SHEET_NAME)!;
    let textSize = sheetNameField.GetTextSize();
    const borderMargin = KiROUND(this.GetPenWidth() / 2.0) + 4;
    let margin = borderMargin + KiROUND(Math.max(textSize.x, textSize.y) * 0.5);

    if (this.IsVerticalOrientation()) {
      sheetNameField.SetTextPos(addPt(this.m_pos, { x: -margin, y: this.m_size.y }));
      sheetNameField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      sheetNameField.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
      sheetNameField.SetTextAngle(ANGLE_VERTICAL);
    } else {
      sheetNameField.SetTextPos(addPt(this.m_pos, { x: 0, y: -margin }));
      sheetNameField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      sheetNameField.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
      sheetNameField.SetTextAngle(ANGLE_HORIZONTAL);
    }

    const sheetFilenameField = this.GetField(FIELD_T.SHEET_FILENAME)!;

    textSize = sheetFilenameField.GetTextSize();
    margin = borderMargin + KiROUND(Math.max(textSize.x, textSize.y) * 0.4);

    if (this.IsVerticalOrientation()) {
      sheetFilenameField.SetTextPos(
        addPt(this.m_pos, { x: this.m_size.x + margin, y: this.m_size.y }),
      );
      sheetFilenameField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      sheetFilenameField.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
      sheetFilenameField.SetTextAngle(ANGLE_VERTICAL);
    } else {
      sheetFilenameField.SetTextPos(addPt(this.m_pos, { x: 0, y: this.m_size.y + margin }));
      sheetFilenameField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      sheetFilenameField.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
      sheetFilenameField.SetTextAngle(ANGLE_HORIZONTAL);
    }

    if (aAlgo === AUTOPLACE_ALGO.AUTOPLACE_AUTO || aAlgo === AUTOPLACE_ALGO.AUTOPLACE_MANUAL)
      this.m_fieldsAutoplaced = aAlgo;
  }

  override GetEndPoints(aItemList: DANGLING_END_ITEM[]): void {
    for (const sheetPin of this.m_pins) {
      if (sheetPin.Type() !== KICAD_T.SCH_SHEET_PIN_T) continue; // wxCHECK2_MSG

      sheetPin.GetEndPoints(aItemList);
    }
  }

  override UpdateDanglingState(
    aItemListByType: DANGLING_END_ITEM[],
    aItemListByPos: DANGLING_END_ITEM[],
    _aPath: SCH_SHEET_PATH | null = null,
  ): boolean {
    let changed = false;

    for (const sheetPin of this.m_pins) {
      if (sheetPin.UpdateDanglingState(aItemListByType, aItemListByPos)) changed = true;
    }

    return changed;
  }

  override IsConnectable(): boolean {
    return true;
  }

  override HasConnectivityChanges(
    aItem: SCH_ITEM,
    _aInstance: SCH_SHEET_PATH | null = null,
  ): boolean {
    // Do not compare to ourself.
    if (aItem === this) return false;

    if (!(aItem instanceof SCH_SHEET)) return false; // wxCHECK

    const sheet = aItem;

    // Don't compare against a different SCH_ITEM.
    if (!samePt(this.GetPosition(), sheet.GetPosition())) return true;

    // If the file names are different, then the connectivity is different.
    if (this.GetFileName() !== sheet.GetFileName() || this.GetName() !== sheet.GetName())
      return true;

    if (this.m_pins.length !== sheet.m_pins.length) return true;

    for (let i = 0; i < this.m_pins.length; i++) {
      if (this.m_pins[i]!.HasConnectivityChanges(sheet.m_pins[i]!)) return true;
    }

    return false;
  }

  override CanConnect(aItem: SCH_ITEM): boolean {
    return (
      (aItem.Type() === KICAD_T.SCH_LINE_T && aItem.GetLayer() === SCH_LAYER_ID.LAYER_WIRE) ||
      (aItem.Type() === KICAD_T.SCH_LINE_T && aItem.GetLayer() === SCH_LAYER_ID.LAYER_BUS) ||
      aItem.Type() === KICAD_T.SCH_NO_CONNECT_T ||
      aItem.Type() === KICAD_T.SCH_SYMBOL_T
    );
  }

  override GetConnectionPoints(): VECTOR2I[] {
    const retval: VECTOR2I[] = [];

    for (const sheetPin of this.m_pins) retval.push(sheetPin.GetPosition());

    return retval;
  }

  override Visit(
    aInspector: INSPECTOR,
    _testData: unknown,
    aScanTypes: readonly KICAD_T[],
  ): INSPECT_RESULT {
    for (const scanType of aScanTypes) {
      // If caller wants to inspect my type
      if (scanType === KICAD_T.SCH_LOCATE_ANY_T || scanType === this.Type()) {
        if (INSPECT_RESULT.QUIT === aInspector(this, null)) return INSPECT_RESULT.QUIT;
      }

      if (scanType === KICAD_T.SCH_LOCATE_ANY_T || scanType === KICAD_T.SCH_FIELD_T) {
        // Test the sheet fields.
        for (const field of this.m_fields) {
          if (INSPECT_RESULT.QUIT === aInspector(field, this)) return INSPECT_RESULT.QUIT;
        }
      }

      if (scanType === KICAD_T.SCH_LOCATE_ANY_T || scanType === KICAD_T.SCH_SHEET_PIN_T) {
        // Test the sheet labels.
        for (const sheetPin of this.m_pins) {
          if (INSPECT_RESULT.QUIT === aInspector(sheetPin, this)) return INSPECT_RESULT.QUIT;
        }
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }

  override RunOnChildren(aFunction: (aItem: SCH_ITEM) => void, _aMode: RECURSE_MODE): void {
    for (const field of this.m_fields) aFunction(field);

    for (const pin of this.m_pins) aFunction(pin);
  }

  // The four variant-aware attributes share one shape upstream, written out four times
  // (the board flag is not variant-aware on a sheet); here once.
  private setVariantAttr(
    aMember: 'm_DNP' | 'm_excludedFromBOM' | 'm_excludedFromSim',
    aVariantField: 'm_DNP' | 'm_ExcludedFromBOM' | 'm_ExcludedFromSim',
    aEnable: boolean,
    aInstance: SCH_SHEET_PATH | null,
    aVariantName: string,
  ): void {
    if (!aInstance || aVariantName === '') {
      this[aMember] = aEnable;
      return;
    }

    const instance = this.getInstance(aInstance.Path());

    if (!instance) return; // wxCHECK_MSG: invalid sheet path

    const existing = instance.m_Variants.get(aVariantName);

    if (existing && aEnable !== existing[aVariantField]) {
      existing[aVariantField] = aEnable;
    } else {
      const variant = new SCH_SHEET_VARIANT(aVariantName);

      variant.InitializeAttributes(this);
      variant[aVariantField] = aEnable;
      this.AddVariant(aInstance, variant);
    }
  }

  private getVariantAttr(
    aMember: 'm_DNP' | 'm_excludedFromBOM' | 'm_excludedFromSim',
    aVariantField: 'm_DNP' | 'm_ExcludedFromBOM' | 'm_ExcludedFromSim',
    aInstance: SCH_SHEET_PATH | null,
    aVariantName: string,
  ): boolean {
    if (!aInstance || aVariantName === '') return this[aMember];

    const instance = new SCH_SHEET_INSTANCE();

    if (!this.getInstance(instance, aInstance.Path())) return this[aMember];

    const variant = instance.m_Variants.get(aVariantName);

    if (variant) return variant[aVariantField];

    return this[aMember];
  }

  override SetExcludedFromSim(
    aExcludeFromSim: boolean,
    aInstance: SCH_SHEET_PATH | null = null,
    aVariantName = '',
  ): void {
    this.setVariantAttr(
      'm_excludedFromSim',
      'm_ExcludedFromSim',
      aExcludeFromSim,
      aInstance,
      aVariantName,
    );
  }

  override GetExcludedFromSim(aInstance: SCH_SHEET_PATH | null = null, aVariantName = ''): boolean {
    return this.getVariantAttr('m_excludedFromSim', 'm_ExcludedFromSim', aInstance, aVariantName);
  }

  GetExcludedFromSimProp(): boolean {
    const schematic = this.Schematic()!;
    return this.GetExcludedFromSim(schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  SetExcludedFromSimProp(aEnable: boolean): void {
    const schematic = this.Schematic()!;
    this.SetExcludedFromSim(aEnable, schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  override SetExcludedFromBOM(
    aExcludeFromBOM: boolean,
    aInstance: SCH_SHEET_PATH | null = null,
    aVariantName = '',
  ): void {
    this.setVariantAttr(
      'm_excludedFromBOM',
      'm_ExcludedFromBOM',
      aExcludeFromBOM,
      aInstance,
      aVariantName,
    );
  }

  override GetExcludedFromBOM(aInstance: SCH_SHEET_PATH | null = null, aVariantName = ''): boolean {
    return this.getVariantAttr('m_excludedFromBOM', 'm_ExcludedFromBOM', aInstance, aVariantName);
  }

  GetExcludedFromBOMProp(): boolean {
    const schematic = this.Schematic()!;
    return this.GetExcludedFromBOM(schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  SetExcludedFromBOMProp(aEnable: boolean): void {
    const schematic = this.Schematic()!;
    this.SetExcludedFromBOM(aEnable, schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  override SetExcludedFromBoard(
    aExclude: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {
    this.m_excludedFromBoard = aExclude;
  }

  override GetExcludedFromBoard(
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): boolean {
    return this.m_excludedFromBoard;
  }

  GetExcludedFromBoardProp(): boolean {
    return this.GetExcludedFromBoard();
  }

  SetExcludedFromBoardProp(aExclude: boolean): void {
    this.SetExcludedFromBoard(aExclude);
  }

  override GetDNP(aInstance: SCH_SHEET_PATH | null = null, aVariantName = ''): boolean {
    return this.getVariantAttr('m_DNP', 'm_DNP', aInstance, aVariantName);
  }

  override SetDNP(aDNP: boolean, aInstance: SCH_SHEET_PATH | null = null, aVariantName = ''): void {
    this.setVariantAttr('m_DNP', 'm_DNP', aDNP, aInstance, aVariantName);
  }

  GetDNPProp(): boolean {
    const schematic = this.Schematic()!;
    return this.GetDNP(schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  SetDNPProp(aEnable: boolean): void {
    const schematic = this.Schematic()!;
    this.SetDNP(aEnable, schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    const sheetnameField = this.GetField(FIELD_T.SHEET_NAME)!;

    return `Hierarchical Sheet '${aFull ? sheetnameField.GetShownText(false) : KIUI_EllipsizeMenuText(sheetnameField.GetText())}'`;
  }

  /**
   * `SCH_SHEET& operator=( const SCH_ITEM& aSheet )`: note it APPENDS the other sheet's
   * pins and instances to this one's, as upstream does.
   */
  assignSheet(aItem: SCH_ITEM): this {
    if (this.Type() !== aItem.Type()) return this; // wxCHECK_MSG

    if (aItem !== this) {
      this.assignSchItem(aItem);

      const sheet = aItem as SCH_SHEET;

      this.m_pos = { ...sheet.m_pos };
      this.m_size = { ...sheet.m_size };
      this.m_fields = sheet.m_fields.map((f) => SCH_FIELD.copyOf(f));

      for (const pin of sheet.m_pins) {
        const p = SCH_SHEET_PIN.copyOf(pin);
        p.SetParent(this);
        this.m_pins.push(p);
      }

      for (const instance of sheet.m_instances) this.m_instances.push(instance.Clone());
    }

    return this;
  }

  /** `operator<`: by type, then sheet name, then file name (code-point order). */
  override lessThan(aItem: SCH_ITEM): boolean {
    if (this.Type() !== aItem.Type()) return this.Type() < aItem.Type();

    const otherSheet = aItem as SCH_SHEET;

    if (this.GetName() !== otherSheet.GetName()) return this.GetName() < otherSheet.GetName();

    if (this.GetFileName() !== otherSheet.GetFileName())
      return this.GetFileName() < otherSheet.GetFileName();

    return false;
  }

  override ViewGetLayers(): number[] {
    // Sheet pins are drawn by their parent sheet, so the parent needs to draw to LAYER_DANGLING
    return [
      SCH_LAYER_ID.LAYER_DANGLING,
      SCH_LAYER_ID.LAYER_HIERLABEL,
      SCH_LAYER_ID.LAYER_SHEETNAME,
      SCH_LAYER_ID.LAYER_SHEETFILENAME,
      SCH_LAYER_ID.LAYER_SHEETFIELDS,
      SCH_LAYER_ID.LAYER_SHEET,
      SCH_LAYER_ID.LAYER_SHEET_BACKGROUND,
      SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
    ];
  }

  override GetPosition(): VECTOR2I {
    return this.m_pos;
  }

  override SetPosition(aPosition: VECTOR2I): void {
    // Remember the sheet and all pin sheet positions must be
    // modified. So use Move function to do that.
    this.Move({ x: aPosition.x - this.m_pos.x, y: aPosition.y - this.m_pos.y });
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I) {
      const rect = a.Clone();

      rect.Inflate(c ?? 0);

      if (b) return rect.Contains(this.GetBodyBoundingBox());

      return rect.Intersects(this.GetBodyBoundingBox());
    }

    if (typeof (a as VECTOR2I).x === 'number' && typeof (a as VECTOR2I).y === 'number') {
      const rect = this.GetBodyBoundingBox();

      rect.Inflate((b as number | undefined) ?? 0);

      return rect.Contains(a as VECTOR2I);
    }

    return KIGEOM_BoxHitTestChain(a as SHAPE_LINE_CHAIN, this.GetBodyBoundingBox(), b as boolean);
  }

  /** `Plot`: pending (the plotters). */

  override Clone(): SCH_SHEET {
    return SCH_SHEET.copyOf(this);
  }

  GetInstances(): readonly SCH_SHEET_INSTANCE[] {
    return this.m_instances;
  }

  /**
   * Check to see if this sheet has a root sheet instance.
   *
   * @note It is possible for sheets to contain both a root sheet instance path and
   *       other instances.  This is not an error, it just means that the sheet may be
   *       shared by multiple top level sheets.
   */
  HasRootInstance(): boolean {
    for (const instance of this.m_instances) {
      if (instance.m_Path.size() === 0) return true;
    }

    return false;
  }

  /**
   * Return the root sheet instance data.
   *
   * @warning If there is no root sheet instance data, a default-constructed instance is
   *          returned.
   */
  GetRootInstance(): SCH_SHEET_INSTANCE {
    for (const instance of this.m_instances) {
      if (instance.m_Path.size() === 0) return instance;
    }

    // wxFAIL
    return new SCH_SHEET_INSTANCE();
  }

  RemoveInstance(aInstancePath: KIID_PATH): void {
    // Search for an existing path and remove it if found (should not occur)
    for (let ii = this.m_instances.length - 1; ii >= 0; --ii) {
      if (this.m_instances[ii]!.m_Path.equals(aInstancePath)) this.m_instances.splice(ii, 1);
    }
  }

  AddInstance(aInstance: SCH_SHEET_INSTANCE): void {
    const oldInstance = new SCH_SHEET_INSTANCE();

    if (this.getInstance(oldInstance, aInstance.m_Path)) this.RemoveInstance(aInstance.m_Path);

    this.m_instances.push(aInstance.Clone());
  }

  DeleteVariant(aPath: KIID_PATH | SCH_SHEET_PATH, aVariantName: string): void {
    const instance = this.getInstance(aPath instanceof SCH_SHEET_PATH ? aPath.Path() : aPath);

    if (!instance || !instance.m_Variants.has(aVariantName)) return;

    instance.m_Variants.delete(aVariantName);
  }

  RenameVariant(aPath: KIID_PATH | SCH_SHEET_PATH, aOldName: string, aNewName: string): void {
    const instance = this.getInstance(aPath instanceof SCH_SHEET_PATH ? aPath.Path() : aPath);

    if (!instance || !instance.m_Variants.has(aOldName)) return;

    const variant = instance.m_Variants.get(aOldName)!.Clone();
    variant.m_Name = aNewName;
    instance.m_Variants.delete(aOldName);

    // std::map::insert keeps an existing entry
    if (!instance.m_Variants.has(aNewName)) instance.m_Variants.set(aNewName, variant);
  }

  CopyVariant(
    aPath: KIID_PATH | SCH_SHEET_PATH,
    aSourceVariant: string,
    aNewVariant: string,
  ): void {
    const instance = this.getInstance(aPath instanceof SCH_SHEET_PATH ? aPath.Path() : aPath);

    if (!instance || !instance.m_Variants.has(aSourceVariant)) return;

    const variant = instance.m_Variants.get(aSourceVariant)!.Clone();
    variant.m_Name = aNewVariant;

    // std::map::insert keeps an existing entry
    if (!instance.m_Variants.has(aNewVariant)) instance.m_Variants.set(aNewVariant, variant);
  }

  AddVariant(aInstance: SCH_SHEET_PATH, aVariant: SCH_SHEET_VARIANT): void {
    const instance = this.getInstance(aInstance.Path());

    // The instance path must already exist.
    if (!instance) return;

    // std::map::insert keeps an existing entry
    if (!instance.m_Variants.has(aVariant.m_Name))
      instance.m_Variants.set(aVariant.m_Name, aVariant.Clone());
  }

  /**
   * Check if the instance data of this sheet has any changes compared to \a aOther.
   *
   * @param aOther is the sheet to compare against.
   * @return true if there are page number changes with \a aOther otherwise false.
   */
  HasPageNumberChanges(aOther: SCH_SHEET): boolean {
    // Avoid self comparison.
    if (aOther === this) return false;

    // A difference in the instance data count implies a page numbering change.
    if (this.GetInstances().length !== aOther.GetInstances().length) return true;

    // Sort by path, descending (`aLhs.m_Path > aRhs.m_Path`).
    const byPathDesc = (a: SCH_SHEET_INSTANCE, b: SCH_SHEET_INSTANCE): number =>
      b.m_Path.lessThan(a.m_Path) ? -1 : a.m_Path.lessThan(b.m_Path) ? 1 : 0;

    const instances = [...this.GetInstances()].sort(byPathDesc);
    const otherInstances = [...aOther.GetInstances()].sort(byPathDesc);

    for (let i = 0; i < instances.length; i++) {
      const itThis = instances[i]!;
      const itOther = otherInstances[i]!;

      if (itThis.m_Path.equals(itOther.m_Path) && itThis.m_PageNumber !== itOther.m_PageNumber)
        return true;
    }

    return false;
  }

  /**
   * Compare page numbers of schematic sheets.
   *
   * @return 0 if the page numbers are equal, -1 if aPageNumberA < aPageNumberB, 1 otherwise
   */
  static ComparePageNum(aPageNumberA: string, aPageNumberB: string): number {
    if (aPageNumberA === aPageNumberB) return 0; // A == B

    // First sort numerically if the page numbers are integers
    const pageA = wxToLong(aPageNumberA);
    const pageB = wxToLong(aPageNumberB);

    if (pageA !== null && pageB !== null) {
      if (pageA < pageB)
        return -1; //A < B
      else return 1; // A > B
    }

    // Numerical page numbers always before strings
    if (pageA !== null)
      return -1; //A < B
    else if (pageB !== null) return 1; // A > B

    // If not numeric, then sort as strings using natural sort
    let result = strNumCmp(aPageNumberA, aPageNumberB);

    // Divide by zero bad.
    if (result === 0) return 0; // wxCHECK

    result = Math.trunc(result / Math.abs(result));

    return result;
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (this.Type() !== aOther.Type()) return 0.0;

    const other = aOther as SCH_SHEET;

    if (this.m_screen!.GetFileName() === other.m_screen!.GetFileName()) return 1.0;

    return 0.0;
  }

  /** `operator==( const SCH_ITEM& aOther )`. */
  override equals(aOther: SCH_ITEM): boolean {
    if (this.Type() !== aOther.Type()) return false;

    const other = aOther as SCH_SHEET;

    if (!samePt(this.m_pos, other.m_pos)) return false;

    if (!samePt(this.m_size, other.m_size)) return false;

    if (this.GetExcludedFromSim() !== other.GetExcludedFromSim()) return false;

    if (this.GetExcludedFromBOM() !== other.GetExcludedFromBOM()) return false;

    if (this.GetExcludedFromBoard() !== other.GetExcludedFromBoard()) return false;

    if (this.GetDNP() !== other.GetDNP()) return false;

    if (!color4dEquals(this.GetBorderColor(), other.GetBorderColor())) return false;

    if (!color4dEquals(this.GetBackgroundColor(), other.GetBackgroundColor())) return false;

    if (this.GetBorderWidth() !== other.GetBorderWidth()) return false;

    if (this.GetFields().length !== other.GetFields().length) return false;

    for (let i = 0; i < this.GetFields().length; ++i) {
      if (!this.GetFields()[i]!.equals(other.GetFields()[i]!)) return false;
    }

    return true;
  }

  /** `setInstances`: the parser's. */
  setInstances(aInstances: readonly SCH_SHEET_INSTANCE[]): void {
    this.m_instances = aInstances.map((i) => i.Clone());
  }

  /**
   * Add a new instance \a aSheetPath to the instance list.
   *
   * If \a aSheetPath does not already exist, it is added to the list.  If already exists
   * in the list, do nothing.  Sheet instances allow for the sharing in complex hierarchies
   * which allows for per instance data such as page number for sheets to stored.
   *
   * @param[in] aInstance is the #KIID_PATH of the sheet instance to the instance list.
   * @return false if the instance already exists, true if the instance was added.
   */
  addInstance(aPath: KIID_PATH): boolean {
    for (const instance of this.m_instances) {
      // if aSheetPath is found, nothing to do:
      if (instance.m_Path.equals(aPath)) return false;
    }

    const instance = new SCH_SHEET_INSTANCE();
    instance.m_Path = aPath.Clone();

    // This entry does not exist: add it with an empty page number.
    this.m_instances.push(instance);
    return true;
  }

  /**
   * Return the sheet page number for \a aParentPath.
   *
   * @return the page number for the requested sheet instance.
   */
  getPageNumber(aParentPath: KIID_PATH): string {
    let pageNumber = '';

    for (const instance of this.m_instances) {
      if (instance.m_Path.equals(aParentPath)) {
        pageNumber = instance.m_PageNumber;
        break;
      }
    }

    return pageNumber;
  }

  /**
   * Set the page number for the sheet instance \a aInstance.
   *
   * @param[in] aInstance is the hierarchical path of the sheet.
   * @param[in] aReference is the new page number for the sheet.
   */
  setPageNumber(aPath: KIID_PATH, aPageNumber: string): void {
    for (const instance of this.m_instances) {
      if (instance.m_Path.equals(aPath)) {
        instance.m_PageNumber = aPageNumber;
        break;
      }
    }
  }

  /**
   * `getInstance( SCH_SHEET_INSTANCE& aInstance, const KIID_PATH& aSheetPath,
   * bool aTestFromEnd )` copies the instance out and says whether it was found;
   * `getInstance( const KIID_PATH& aPath )` returns the live instance or null.
   */
  getInstance(
    aInstance: SCH_SHEET_INSTANCE,
    aSheetPath: KIID_PATH,
    aTestFromEnd?: boolean,
  ): boolean;
  getInstance(aPath: KIID_PATH): SCH_SHEET_INSTANCE | null;
  getInstance(
    a: SCH_SHEET_INSTANCE | KIID_PATH,
    aSheetPath?: KIID_PATH,
    aTestFromEnd = false,
  ): boolean | SCH_SHEET_INSTANCE | null {
    if (aSheetPath === undefined) {
      const path = a as KIID_PATH;

      for (const instance of this.m_instances) {
        if (instance.m_Path.equals(path)) return instance;
      }

      return null;
    }

    for (const instance of this.m_instances) {
      if (!aTestFromEnd) {
        if (instance.m_Path.equals(aSheetPath)) {
          Object.assign(a, instance.Clone());
          return true;
        }
      } else if (instance.m_Path.EndsWith(aSheetPath)) {
        Object.assign(a, instance.Clone());
        return true;
      }
    }

    return false;
  }

  /**
   * Renumber the sheet pins in the sheet.
   *
   * This method is used internally by SCH_SHEET to update the pin numbering
   * when the pin list changes.  Make sure you call this method any time a
   * sheet pin is added or removed.
   */
  private renumberPins(): void {
    let id = 2;

    for (const pin of this.m_pins) {
      pin.SetNumber(id);
      id++;
    }
  }

  /**
   * Get the sheetpath of this sheet.
   *
   * NB: REQUIRES that the current sheet is set to this sheet or one of its parents.
   */
  protected findSelf(): SCH_SHEET_PATH {
    const schematic = this.Schematic();

    if (!schematic) return new SCH_SHEET_PATH(); // wxCHECK_MSG

    let sheetPath = schematic.CurrentSheet().Clone();

    while (!sheetPath.empty() && sheetPath.Last() !== this) sheetPath.pop_back();

    if (sheetPath.empty()) {
      // If we weren't in the hierarchy, then we must be a child of the current sheet.
      sheetPath = schematic.CurrentSheet().Clone();
      sheetPath.push_back(this);
    }

    return sheetPath;
  }

  protected override doIsConnected(aPosition: VECTOR2I): boolean {
    for (const sheetPin of this.m_pins) {
      if (samePt(sheetPin.GetPosition(), aPosition)) return true;
    }

    return false;
  }
}

/** `wxString::ToLong`: the whole string as a base-10 integer, else null. */
function wxToLong(s: string): number | null {
  if (!/^[ \t\n\r\f\v]*[+-]?[0-9]+$/.test(s)) return null;

  return Number.parseInt(s, 10);
}

/**
 * `static struct SCH_SHEET_DESC` (eeschema/sch_sheet.cpp:2120).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(SCH_SHEET);
  propMgr.InheritsAfter(SCH_SHEET, SCH_ITEM);

  propMgr
    .AddProperty(
      new PROPERTY<SCH_SHEET, string>(SCH_SHEET, 'Sheet Name', 'SetName', 'GetName', TYPE_STRING),
    )
    .SetValidator((aValue) => {
      if (typeof aValue !== 'string') return null;

      const msg = GetFieldValidationErrorMessage(FIELD_T.SHEET_NAME, aValue);

      if (msg === '') return null;

      return new VALIDATION_ERROR_MSG(msg);
    });

  propMgr.AddProperty(
    new PROPERTY<SCH_SHEET, number>(
      SCH_SHEET,
      'Border Width',
      'SetBorderWidth',
      'GetBorderWidth',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
  );

  propMgr.AddProperty(
    new PROPERTY<SCH_SHEET, Color4d>(
      SCH_SHEET,
      'Border Color',
      'SetBorderColor',
      'GetBorderColor',
      TYPE_COLOR4D,
    ),
  );

  propMgr.AddProperty(
    new PROPERTY<SCH_SHEET, Color4d>(
      SCH_SHEET,
      'Background Color',
      'SetBackgroundColor',
      'GetBackgroundColor',
      TYPE_COLOR4D,
    ),
  );

  const groupAttributes = 'Attributes';

  const flag = (
    aName: string,
    aSetter: keyof SCH_SHEET & string,
    aGetter: keyof SCH_SHEET & string,
  ) =>
    propMgr.AddProperty(
      new PROPERTY<SCH_SHEET, boolean>(SCH_SHEET, aName, aSetter, aGetter, TYPE_BOOL),
      groupAttributes,
    );

  flag('Exclude From Board', 'SetExcludedFromBoardProp', 'GetExcludedFromBoardProp');
  flag('Exclude From Simulation', 'SetExcludedFromSimProp', 'GetExcludedFromSimProp');
  flag('Exclude From Bill of Materials', 'SetExcludedFromBOMProp', 'GetExcludedFromBOMProp');
  flag('Do not Populate', 'SetDNPProp', 'GetDNPProp');
})();
