// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_fields_grid_table.h` / `.cpp`: `PCB_FIELDS_GRID_TABLE`, the
 * Fields tab grid in Footprint Properties — one row per `PCB_FIELD`, on the
 * ported `WX_GRID_TABLE_BASE` (`common/widgets/wx_grid.ts`).
 *
 * No caller yet: neither Footprint Properties dialog
 * (`dialogs/dialog_footprint_properties_ui.tsx`,
 * `dialogs/dialog_footprint_properties_fp_editor.tsx`) has a Fields tab —
 * both say so in their own doc comments, filing it as
 * `DIALOG_TEXT_PROPERTIES` work. This is the model half only.
 *
 * What is deliberately not here, because it is a window/view concern with no
 * headless counterpart to build on:
 *
 * - The specific cell editors/renderers upstream's `GetAttr` assigns per
 *   column — `GRID_CELL_LAYER_RENDERER`/`GRID_CELL_LAYER_SELECTOR` (Layer),
 *   `GRID_CELL_COMBOBOX` (Orientation), `GRID_CELL_URL_EDITOR` /
 *   `GRID_CELL_TEXT_EDITOR` with a `FIELD_VALIDATOR` (Value). `GetAttr` below
 *   still reports which columns are read-only, boolean-checkbox or
 *   centre-aligned — everything a caller's cell-attr *provider*
 *   (`WX_GRID_TABLE_BASE.enhanceAttr`) can layer a real editor over — but
 *   constructs no editor widgets itself.
 * - `NUMERIC_EVALUATOR` (`m_eval`/`onUnitsChanged`): `WX_GRID`'s own port
 *   already documents this gap for every auto-eval column, not just this
 *   table's.
 * - `AngleValueFromString` has no `UNITS_PROVIDER` counterpart here (only
 *   `StringFromAngle` was ported); `parseOrientationText` below is the
 *   minimal stand-in — a bare degree number, same "reads as typed" contract
 *   `WX_GRID`'s auto-eval columns already have.
 */
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { WX_GRID_TABLE_BASE } from '@ziroeda/common/widgets/wx_grid.js';
import { type wxAttrKind, wxGridCellAttr } from '@ziroeda/common/wx/grid.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { IsBackLayer, ToLAYER_ID } from '@ziroeda/common/layer_id.js';
import { PCB_FIELD } from './pcb_field.js';

/** `PCB_FIELDS_COL_ORDER` (`pcb_fields_grid_table.h:36`). */
export enum PCB_FIELDS_COL_ORDER {
  PFC_NAME,
  PFC_VALUE,
  PFC_SHOWN,
  PFC_WIDTH,
  PFC_HEIGHT,
  PFC_THICKNESS,
  PFC_ITALIC,
  PFC_LAYER,
  PFC_ORIENTATION,
  PFC_UPRIGHT,
  PFC_XOFFSET,
  PFC_YOFFSET,
  PFC_KNOCKOUT,
  PFC_MIRRORED,

  PFC_COUNT,
}

const { PFC_COUNT } = PCB_FIELDS_COL_ORDER;

/**
 * `AngleValueFromString` has no port; a bare degree number is the same
 * "typed as-is" contract `WX_GRID`'s un-evaluated auto-eval columns keep.
 */
function parseOrientationText(aText: string): EDA_ANGLE {
  const n = Number.parseFloat(aText);
  return new EDA_ANGLE(Number.isFinite(n) ? n : 0);
}

/**
 * `PCB_FIELDS_GRID_TABLE` (`pcb_fields_grid_table.h:57`): one row per
 * `PCB_FIELD`. Upstream inherits `std::vector<PCB_FIELD>` directly; here the
 * fields are a plain array, same as every other ported table
 * (`PCB_TABLE.m_cells`, `zone_layer_properties_grid`'s rows).
 */
export class PCB_FIELDS_GRID_TABLE extends WX_GRID_TABLE_BASE {
  protected m_fields: PCB_FIELD[];
  private readonly m_unitsProvider: UNITS_PROVIDER;

  constructor(aUnitsProvider: UNITS_PROVIDER, aFields: readonly PCB_FIELD[] = []) {
    super();
    this.m_unitsProvider = aUnitsProvider;
    this.m_fields = [...aFields];
  }

  /** The row data, for a caller to read back after edits (`*this` upstream). */
  GetFields(): readonly PCB_FIELD[] {
    return this.m_fields;
  }
  SetFields(aFields: readonly PCB_FIELD[]): void {
    this.m_fields = [...aFields];
  }
  push_back(aField: PCB_FIELD): void {
    this.m_fields.push(aField);
  }
  at(aRow: number): PCB_FIELD {
    return this.m_fields[aRow]!;
  }

  override GetNumberRows(): number {
    return this.m_fields.length;
  }
  override GetNumberCols(): number {
    return PFC_COUNT;
  }

  GetMandatoryRowCount(): number {
    return this.m_fields.filter((f) => f.IsMandatory()).length;
  }

  override IsEmptyCell(_row: number, _col: number): boolean {
    // don't allow adjacent cell overflow, even if we are actually empty
    return false;
  }

  override GetColLabelValue(aCol: number): string {
    switch (aCol) {
      case PCB_FIELDS_COL_ORDER.PFC_NAME:
        return 'Name';
      case PCB_FIELDS_COL_ORDER.PFC_VALUE:
        return 'Value';
      case PCB_FIELDS_COL_ORDER.PFC_SHOWN:
        return 'Show';
      case PCB_FIELDS_COL_ORDER.PFC_WIDTH:
        return 'Width';
      case PCB_FIELDS_COL_ORDER.PFC_HEIGHT:
        return 'Height';
      case PCB_FIELDS_COL_ORDER.PFC_THICKNESS:
        return 'Thickness';
      case PCB_FIELDS_COL_ORDER.PFC_ITALIC:
        return 'Italic';
      case PCB_FIELDS_COL_ORDER.PFC_LAYER:
        return 'Layer';
      case PCB_FIELDS_COL_ORDER.PFC_ORIENTATION:
        return 'Orientation';
      case PCB_FIELDS_COL_ORDER.PFC_UPRIGHT:
        return 'Keep Upright';
      case PCB_FIELDS_COL_ORDER.PFC_XOFFSET:
        return 'X Offset';
      case PCB_FIELDS_COL_ORDER.PFC_YOFFSET:
        return 'Y Offset';
      case PCB_FIELDS_COL_ORDER.PFC_KNOCKOUT:
        return 'Knockout';
      case PCB_FIELDS_COL_ORDER.PFC_MIRRORED:
        return 'Mirrored';
      default:
        console.assert(false);
        return '';
    }
  }

  override CanGetValueAs(_aRow: number, aCol: number, aTypeName: string): boolean {
    switch (aCol) {
      case PCB_FIELDS_COL_ORDER.PFC_NAME:
      case PCB_FIELDS_COL_ORDER.PFC_VALUE:
      case PCB_FIELDS_COL_ORDER.PFC_WIDTH:
      case PCB_FIELDS_COL_ORDER.PFC_HEIGHT:
      case PCB_FIELDS_COL_ORDER.PFC_THICKNESS:
      case PCB_FIELDS_COL_ORDER.PFC_ORIENTATION:
      case PCB_FIELDS_COL_ORDER.PFC_XOFFSET:
      case PCB_FIELDS_COL_ORDER.PFC_YOFFSET:
        return aTypeName === 'string';

      case PCB_FIELDS_COL_ORDER.PFC_SHOWN:
      case PCB_FIELDS_COL_ORDER.PFC_ITALIC:
      case PCB_FIELDS_COL_ORDER.PFC_UPRIGHT:
      case PCB_FIELDS_COL_ORDER.PFC_KNOCKOUT:
      case PCB_FIELDS_COL_ORDER.PFC_MIRRORED:
        return aTypeName === 'bool';

      case PCB_FIELDS_COL_ORDER.PFC_LAYER:
        return aTypeName === 'number';

      default:
        console.assert(false);
        return false;
    }
  }

  override CanSetValueAs(aRow: number, aCol: number, aTypeName: string): boolean {
    return this.CanGetValueAs(aRow, aCol, aTypeName);
  }

  /**
   * `GetAttr` (`pcb_fields_grid_table.cpp:203`): which columns are read-only
   * or boolean, for a caller's attr provider to layer a real editor/renderer
   * over via `enhanceAttr`. See the file doc comment for what is not here.
   */
  override GetAttr(aRow: number, aCol: number, aKind: wxAttrKind): wxGridCellAttr | null {
    const field = this.m_fields[aRow];
    let attr: wxGridCellAttr | null = null;

    switch (aCol) {
      case PCB_FIELDS_COL_ORDER.PFC_NAME:
        if (field?.IsMandatory()) {
          attr = new wxGridCellAttr();
          attr.SetReadOnly(true);
        }
        break;

      case PCB_FIELDS_COL_ORDER.PFC_SHOWN:
      case PCB_FIELDS_COL_ORDER.PFC_ITALIC:
      case PCB_FIELDS_COL_ORDER.PFC_UPRIGHT:
      case PCB_FIELDS_COL_ORDER.PFC_KNOCKOUT:
      case PCB_FIELDS_COL_ORDER.PFC_MIRRORED:
        attr = new wxGridCellAttr();
        attr.SetAlignment(1 /* wxALIGN_CENTER */, 1);
        break;

      default:
        break;
    }

    return this.enhanceAttr(attr, aRow, aCol, aKind);
  }

  override GetValue(aRow: number, aCol: number): string {
    const field = this.at(aRow);
    const up = this.m_unitsProvider;

    switch (aCol) {
      case PCB_FIELDS_COL_ORDER.PFC_NAME:
        return field.GetName();
      case PCB_FIELDS_COL_ORDER.PFC_VALUE:
        return field.GetText();
      case PCB_FIELDS_COL_ORDER.PFC_WIDTH:
        return up.StringFromValue(field.GetTextWidth(), true);
      case PCB_FIELDS_COL_ORDER.PFC_HEIGHT:
        return up.StringFromValue(field.GetTextHeight(), true);
      case PCB_FIELDS_COL_ORDER.PFC_THICKNESS:
        return up.StringFromValue(field.GetTextThickness(), true);
      case PCB_FIELDS_COL_ORDER.PFC_LAYER:
        return field.GetLayerName();

      case PCB_FIELDS_COL_ORDER.PFC_ORIENTATION: {
        const parentOrientation = field.GetParentFootprint()?.GetOrientation() ?? new EDA_ANGLE(0);
        const angle = field.GetTextAngle().sub(parentOrientation);
        return up.StringFromAngle(angle, true);
      }

      case PCB_FIELDS_COL_ORDER.PFC_XOFFSET:
        return up.StringFromValue(field.GetFPRelativePosition().x, true);
      case PCB_FIELDS_COL_ORDER.PFC_YOFFSET:
        return up.StringFromValue(field.GetFPRelativePosition().y, true);

      default:
        // we can't assert here because a caller sometimes calls this without checking
        // the column type when trying to see if there's an overflow
        return 'bad column!';
    }
  }

  override GetValueAsBool(aRow: number, aCol: number): boolean {
    const field = this.at(aRow);

    switch (aCol) {
      case PCB_FIELDS_COL_ORDER.PFC_SHOWN:
        return field.IsVisible();
      case PCB_FIELDS_COL_ORDER.PFC_ITALIC:
        return field.IsItalic();
      case PCB_FIELDS_COL_ORDER.PFC_UPRIGHT:
        return field.IsKeepUpright();
      case PCB_FIELDS_COL_ORDER.PFC_KNOCKOUT:
        return field.IsKnockout();
      case PCB_FIELDS_COL_ORDER.PFC_MIRRORED:
        return field.IsMirrored();

      default:
        console.assert(false, `column ${aCol} doesn't hold a bool value`);
        return false;
    }
  }

  override GetValueAsLong(aRow: number, aCol: number): number {
    const field = this.at(aRow);

    switch (aCol) {
      case PCB_FIELDS_COL_ORDER.PFC_LAYER:
        return field.GetLayer();

      default:
        console.assert(false, `column ${aCol} doesn't hold a long value`);
        return 0;
    }
  }

  override SetValue(aRow: number, aCol: number, aValue: string): void {
    const field = this.at(aRow);
    const up = this.m_unitsProvider;
    let value = aValue;

    if (aCol !== PCB_FIELDS_COL_ORDER.PFC_VALUE) value = value.trim();

    switch (aCol) {
      case PCB_FIELDS_COL_ORDER.PFC_NAME:
        field.SetName(value);
        break;
      case PCB_FIELDS_COL_ORDER.PFC_VALUE:
        field.SetText(value);
        break;
      case PCB_FIELDS_COL_ORDER.PFC_WIDTH:
        field.SetTextWidth(up.ValueFromString(value));
        break;
      case PCB_FIELDS_COL_ORDER.PFC_HEIGHT:
        field.SetTextHeight(up.ValueFromString(value));
        break;
      case PCB_FIELDS_COL_ORDER.PFC_THICKNESS:
        field.SetTextThickness(up.ValueFromString(value));
        break;

      case PCB_FIELDS_COL_ORDER.PFC_ORIENTATION: {
        const parentOrientation = field.GetParentFootprint()?.GetOrientation() ?? new EDA_ANGLE(0);
        field.SetTextAngle(parseOrientationText(value).add(parentOrientation));
        break;
      }

      case PCB_FIELDS_COL_ORDER.PFC_XOFFSET:
      case PCB_FIELDS_COL_ORDER.PFC_YOFFSET: {
        const pos = field.GetFPRelativePosition();

        if (aCol === PCB_FIELDS_COL_ORDER.PFC_XOFFSET) pos.x = up.ValueFromString(value);
        else pos.y = up.ValueFromString(value);

        field.SetFPRelativePosition(pos);
        break;
      }

      default:
        console.assert(false, `column ${aCol} doesn't hold a string value`);
        break;
    }
  }

  override SetValueAsBool(aRow: number, aCol: number, aValue: boolean): void {
    const field = this.at(aRow);

    switch (aCol) {
      case PCB_FIELDS_COL_ORDER.PFC_SHOWN:
        field.SetVisible(aValue);
        break;
      case PCB_FIELDS_COL_ORDER.PFC_ITALIC:
        field.SetItalic(aValue);
        break;
      case PCB_FIELDS_COL_ORDER.PFC_UPRIGHT:
        field.SetKeepUpright(aValue);
        break;
      case PCB_FIELDS_COL_ORDER.PFC_KNOCKOUT:
        field.SetIsKnockout(aValue);
        break;
      case PCB_FIELDS_COL_ORDER.PFC_MIRRORED:
        field.SetMirrored(aValue);
        break;

      default:
        console.assert(false, `column ${aCol} doesn't hold a bool value`);
        break;
    }
  }

  override SetValueAsLong(aRow: number, aCol: number, aValue: number): void {
    const field = this.at(aRow);

    switch (aCol) {
      case PCB_FIELDS_COL_ORDER.PFC_LAYER: {
        field.SetLayer(ToLAYER_ID(aValue));

        const board = field.GetBoard();

        if (board) field.SetMirrored(board.IsBackLayer(field.GetLayer()));
        else field.SetMirrored(IsBackLayer(field.GetLayer()));

        break;
      }

      default:
        console.assert(false, `column ${aCol} doesn't hold a long value`);
        break;
    }
  }
}
