// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_PROPERTIES_PANEL` (`pcbnew/widgets/pcb_properties_panel.{h,cpp}`) over
 * the live BOARD: the rows are whatever the PROPERTY_MANAGER registrations of
 * the selected items say, their values are the items' own getters, and an
 * edit is `item->Set( property, value )` for every selected item inside one
 * BOARD_COMMIT pushed as "Edit Properties" — one undo step.
 *
 * `PCB_FOOTPRINT_FIELD_PROPERTY` (:56-138) is here too: a string property per
 * field name found on the selected footprints, variant-aware.
 *
 * Differences, each forced:
 *  - The selection is handed in (`SetSelectionProvider`): PCB_SELECTION_TOOL
 *    is stage 3 of #636, and the editor's selection is still view ids.
 *  - `valueChanging`'s veto has no info bar to report into; the message is
 *    returned to the caller instead of `m_frame->ShowInfoBarError`.
 *  - `PG_NET_SELECTOR_EDITOR` / `PG_FPID_EDITOR` / `PG_URL_EDITOR` are the
 *    grid's editors, not the model's; the model names the property only.
 */
import { RECURSE_MODE, type EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { type PCB_LAYER_ID, ToLAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import {
  PG_CHOICES,
  PROPERTY_BASE,
  TYPE_HASH,
  TYPE_STRING,
  type CLASS_TYPE_ID,
  type INSPECTABLE_ITEM,
  type TYPE_ID,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER } from '@ziroeda/common/properties/property_mgr.js';
import { unescapeString } from '@ziroeda/common/string_utils.js';
import { FIELD_T, GetCanonicalFieldName } from '@ziroeda/common/template_fieldnames.js';
import { EVENTS } from '@ziroeda/common/tool/tool_event.js';
import {
  type PG_CELL,
  type PG_GRID_ROW,
  PROPERTIES_PANEL,
  type PROPERTY_VETO,
} from '@ziroeda/common/widgets/properties_panel.js';

/** The grid row pcbnew's tests and UI name; the common PG_GRID_ROW. */
export type PCB_GRID_ROW = PG_GRID_ROW;
export type { PROPERTY_VETO };
import { ENUM_MAP } from '@ziroeda/common/properties/property.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  COLOR4D_UNSPECIFIED,
  type Color4d,
  setFromHexString,
  toHexString,
} from '@ziroeda/common/gal/color4d.js';
import {
  PGPROPERTY_ANGLE,
  PGPROPERTY_RATIO,
  PGPROPERTY_STRING,
  type PG_FRAME,
} from '@ziroeda/common/properties/pg_properties.js';
import {
  PROPERTY_DISPLAY,
  TYPE_BOOL,
  TYPE_COLOR4D,
  TYPE_DOUBLE,
  TYPE_EDA_ANGLE,
  TYPE_INT,
  TYPE_OPT_DOUBLE,
  TYPE_OPT_INT,
  TYPE_UNSIGNED,
} from '@ziroeda/common/properties/property.js';
import { formatG } from '@ziroeda/common/plotters/fmt.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOARD } from '../board.js';
import { BOARD_COMMIT } from '../board_commit.js';
import { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import { BOARD_ITEM } from '../board_item.js';
import { FOOTPRINT } from '../footprint.js';
import { PCB_TUNING_PATTERN } from '../generators/pcb_tuning_pattern.js';
import { PAD } from '../pad.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { PCB_FIELD } from '../pcb_field.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import { PCB_VIA } from '../pcb_track.js';

const MISSING_FIELD_SENTINEL = '';

/** `PCB_FOOTPRINT_FIELD_PROPERTY`: a footprint field, by name, as a string property. */
export class PCB_FOOTPRINT_FIELD_PROPERTY extends PROPERTY_BASE {
  private readonly m_fieldName: string;

  constructor(aName: string) {
    super(aName);
    this.m_fieldName = aName;
  }

  override OwnerHash(): CLASS_TYPE_ID {
    return FOOTPRINT;
  }

  override BaseHash(): CLASS_TYPE_ID {
    return FOOTPRINT;
  }

  override TypeHash(): TYPE_ID {
    return TYPE_STRING;
  }

  override setter(obj: object, v: unknown): void {
    if (typeof v !== 'string') return;

    const value = v;
    const footprint = obj as FOOTPRINT;
    const field = footprint.GetField(this.m_fieldName);

    const variantName = footprint.GetBoard()?.GetCurrentVariant() ?? '';

    if (variantName !== '') {
      // Store the value as a variant override
      const variant = footprint.AddVariant(variantName);

      if (variant) variant.SetFieldValue(this.m_fieldName, value);
    } else if (!field) {
      // Set the base field value
      const newField = new PCB_FIELD(footprint, FIELD_T.USER, this.m_fieldName);
      newField.SetText(value);
      footprint.Add(newField);
    } else {
      field.SetText(value);
    }
  }

  override getter(obj: object): unknown {
    const footprint = obj as FOOTPRINT;
    const field = footprint.GetField(this.m_fieldName);

    if (field) {
      const variantName = footprint.GetBoard()?.GetCurrentVariant() ?? '';

      if (variantName !== '')
        return footprint.GetFieldValueForVariant(variantName, this.m_fieldName);

      return field.GetText();
    }

    return MISSING_FIELD_SENTINEL;
  }
}

export class PCB_PROPERTIES_PANEL extends PROPERTIES_PANEL {
  /** The field names on the selected footprints (a static std::set upstream). */
  static m_currentFieldNames = new Set<string>();

  protected declare m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_propMgr = PROPERTY_MANAGER.Instance();
  private m_selectionProvider: () => readonly EDA_ITEM[] = () => [];

  constructor(aFrame: PCB_BASE_EDIT_FRAME) {
    super(aFrame);
    this.m_propMgr.Rebuild();
  }

  /** Where `PCB_SELECTION_TOOL::GetSelection()` comes from until stage 3. */
  SetSelectionProvider(aProvider: () => readonly EDA_ITEM[]): void {
    this.m_selectionProvider = aProvider;
  }

  /** `getSelection( aFallbackSelection )`: the footprint editor falls back to its footprint. */
  getSelection(): readonly EDA_ITEM[] {
    const selection = this.m_selectionProvider();

    if (selection.length === 0 && this.m_frame.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR)) {
      const footprint = this.m_frame.GetBoard()?.GetFirstFootprint();

      if (footprint) return [footprint];
    }

    return selection;
  }

  getFrontItem(): EDA_ITEM | null {
    return this.getSelection()[0] ?? null;
  }

  override UpdateData(): void {
    const board = this.m_frame.GetBoard();

    if (!board) return;

    // TODO perhaps it could be called less often? use PROPERTIES_TOOL and catch MODEL_RELOAD?
    this.updateLists(board);

    this.rebuildProperties(this.getSelection());
  }

  override AfterCommit(): void {
    if (!this.m_frame.GetBoard()) return;

    this.rebuildProperties(this.getSelection());
  }

  protected override rebuildProperties(aSelection: readonly EDA_ITEM[]): void {
    PCB_PROPERTIES_PANEL.m_currentFieldNames.clear();

    for (const item of aSelection) {
      if (item.Type() !== KICAD_T.PCB_FOOTPRINT_T) continue;

      const footprint = item as FOOTPRINT;

      for (const field of footprint.GetFields())
        PCB_PROPERTIES_PANEL.m_currentFieldNames.add(field.GetCanonicalName());
    }

    const groupFields = 'Fields';

    // Make sure value comes immediately after reference.
    this.m_propMgr.AddProperty(new PCB_FOOTPRINT_FIELD_PROPERTY('Value'), groupFields);

    for (const name of [...PCB_PROPERTIES_PANEL.m_currentFieldNames].sort()) {
      if (!this.m_propMgr.GetProperty(FOOTPRINT, name)) {
        this.m_propMgr
          .AddProperty(new PCB_FOOTPRINT_FIELD_PROPERTY(name), groupFields)
          .SetAvailableFunc((_: INSPECTABLE_ITEM) =>
            PCB_PROPERTIES_PANEL.m_currentFieldNames.has(name),
          );
      }
    }

    super.rebuildProperties(aSelection);
  }

  /** `createPGProperty`'s PCB_LAYER_ID branch: a PGPROPERTY_COLORENUM cell. */
  protected override customGridRow(
    aCell: PG_CELL,
    aBase: { group: string; name: string },
    aEdit: (value: unknown) => (() => void) | null,
    aWithSet: (
      row: Omit<PG_GRID_ROW, 'set'>,
      set: (v: string | number | boolean) => (() => void) | null,
    ) => PG_GRID_ROW,
  ): PG_GRID_ROW | null {
    const aValue = aCell.value;
    const layer = this.LayerCell(aCell.property);

    if (!layer) return null;

    const idx = typeof aValue === 'number' ? layer.choices.Index(aValue) : -1;
    return aWithSet(
      {
        ...aBase,
        kind: 'choice',
        choices: [...layer.choices].map((c) => c.GetText()),
        value: idx >= 0 ? layer.choices.GetLabel(idx) : '',
        swatch: typeof aValue === 'number' ? layer.color(aValue) : undefined,
      },
      (v) => {
        const i = layer.choices.Index(String(v));
        return i < 0 ? null : aEdit(layer.choices.GetValue(i));
      },
    );
  }

  /**
   * `createPGProperty`'s PCB_LAYER_ID branch: the layer's BOARD name for
   * each canonical choice, and its colour from the frame's colour settings.
   */
  LayerCell(
    aProperty: PROPERTY_BASE,
  ): { choices: PG_CHOICES; color: (layer: number) => string } | null {
    if (aProperty.TypeHash() !== ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID')) return null;

    const canonicalLayers = aProperty.Choices();
    const board = this.m_frame.GetBoard()!;
    const choices = new PG_CHOICES();

    for (let ii = 0; ii < canonicalLayers.GetCount(); ++ii) {
      const layer = canonicalLayers.GetValue(ii);
      choices.Add(board.GetLayerName(ToLAYER_ID(layer)), layer);
    }

    return {
      choices,
      color: (aValue: number) => {
        const c = this.m_frame.GetColorSettings().GetColor(ToLAYER_ID(aValue));
        return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;
      },
    };
  }

  /**
   * The editor a cell swaps in (`createPGProperty`, :502-507): the Footprint
   * field gets PG_FPID_EDITOR, the Datasheet field PG_URL_EDITOR.
   */
  override CellEditor(aProperty: PROPERTY_BASE): 'fpid' | 'url' | null {
    if (aProperty.Name() === GetCanonicalFieldName(FIELD_T.FOOTPRINT)) return 'fpid';
    if (aProperty.Name() === GetCanonicalFieldName(FIELD_T.DATASHEET)) return 'url';
    return null;
  }

  getPropertyFromEvent(aPropertyName: string): PROPERTY_BASE | null {
    const item = this.getFrontItem();

    if (!item || !item.IsBOARD_ITEM()) return null;

    return this.m_propMgr.GetProperty(TYPE_HASH(item), aPropertyName);
  }

  /**
   * `valueChanging( aEvent )`: the property's validator on the front item.
   * Returns the veto, or null to let the edit through.
   */
  override valueChanging(aPropertyName: string, aNewValue: unknown): PROPERTY_VETO | null {
    if (this.m_SuppressGridChangeEvents > 0) return null;

    const item = this.getFrontItem();
    const property = this.getPropertyFromEvent(aPropertyName);

    if (!property || !item) return null;

    const validationFailure = property.Validate(aNewValue, item);

    if (validationFailure) {
      return {
        message: `${property.Name()}: ${validationFailure.Format(this.m_frame.GetUnitsProvider())}`,
      };
    }

    return null;
  }

  /** `valueChanged( aEvent )`: every selected item, one BOARD_COMMIT. */
  override valueChanged(aPropertyName: string, aNewValue: unknown): void {
    if (this.m_SuppressGridChangeEvents > 0) return;

    const selection = this.getSelection();

    if (!this.getPropertyFromEvent(aPropertyName)) return;

    const changes = new BOARD_COMMIT(this.m_frame);

    for (const edaItem of selection) {
      if (!edaItem.IsBOARD_ITEM()) continue;

      const item = edaItem as BOARD_ITEM;
      const property = this.m_propMgr.GetProperty(TYPE_HASH(item), aPropertyName);

      if (!property) return;

      if (item.Type() === KICAD_T.PCB_TABLECELL_T)
        changes.Modify(item.GetParent()!, null, RECURSE_MODE.NO_RECURSE);
      else if (item.Type() === KICAD_T.PCB_GENERATOR_T)
        changes.Modify(item, null, RECURSE_MODE.RECURSE);
      else changes.Modify(item, null, RECURSE_MODE.NO_RECURSE);

      // In the PCB Editor, we generally restrict pad movement to the footprint (like dragging)
      if (
        item.Type() === KICAD_T.PCB_PAD_T &&
        this.m_frame.IsType(FRAME_T.FRAME_PCB_EDITOR) &&
        !this.m_frame.GetPcbNewSettings().m_AllowFreePads &&
        (aPropertyName === 'Position X' || aPropertyName === 'Position Y')
      ) {
        const pad = item as PAD;
        const fp = pad.GetParentFootprint() as FOOTPRINT | null;

        if (fp) {
          const oldPos = pad.GetPosition();
          const newPos = { x: oldPos.x, y: oldPos.y };

          if (aPropertyName === 'Position X') newPos.x = Math.trunc(aNewValue as number);
          else newPos.y = Math.trunc(aNewValue as number);

          const delta = { x: newPos.x - oldPos.x, y: newPos.y - oldPos.y };

          if (delta.x !== 0 || delta.y !== 0) {
            changes.Modify(fp);
            fp.Move(delta);
          }
        }

        continue;
      }

      // Handle variant-aware boolean properties for footprints
      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        const footprint = item as FOOTPRINT;
        const variantName = footprint.GetBoard()?.GetCurrentVariant() ?? '';

        if (
          variantName !== '' &&
          (aPropertyName === 'Do not Populate' ||
            aPropertyName === 'Exclude From Bill of Materials' ||
            aPropertyName === 'Exclude From Position Files')
        ) {
          let variant = footprint.GetVariant(variantName);

          if (!variant) variant = footprint.AddVariant(variantName);

          if (variant) {
            const boolValue = Boolean(aNewValue);

            if (aPropertyName === 'Do not Populate') variant.SetDNP(boolValue);
            else if (aPropertyName === 'Exclude From Bill of Materials')
              variant.SetExcludedFromBOM(boolValue);
            else variant.SetExcludedFromPosFiles(boolValue);

            continue;
          }
        }
      }

      item.Set(property, aNewValue);
    }

    changes.Push('Edit Properties');

    // Perform grid updates as necessary based on value change
    this.AfterCommit();

    // PointEditor may need to update if locked/unlocked
    if (aPropertyName === 'Locked')
      this.m_frame.GetToolManager()?.ProcessEvent(EVENTS.SelectedEvent);
  }

  /** `updateLists( aBoard )`: the live board's layers and nets as the choices. */
  updateLists(aBoard: BOARD): void {
    const layersAll = new PG_CHOICES();
    const layersCu = new PG_CHOICES();
    const nets = new PG_CHOICES();

    // Regenerate all layers
    for (const layer of aBoard.GetEnabledLayers().UIOrder()) layersAll.Add(LSET.Name(layer), layer);

    for (const layer of aBoard.GetEnabledLayers().and(LSET.AllCuMask()).UIOrder())
      layersCu.Add(LSET.Name(layer), layer);

    const pm = this.m_propMgr;
    pm.GetProperty(BOARD_ITEM, 'Layer')?.SetChoices(layersAll);
    pm.GetProperty(PCB_SHAPE, 'Layer')?.SetChoices(layersAll);

    // Copper only properties
    pm.GetProperty(BOARD_CONNECTED_ITEM, 'Layer')?.SetChoices(layersCu);
    pm.GetProperty(PAD, 'Bottom Backdrill Must-Cut')?.SetChoices(layersCu);
    pm.GetProperty(PAD, 'Top Backdrill Must-Cut')?.SetChoices(layersCu);
    pm.GetProperty(PCB_VIA, 'Layer Top')?.SetChoices(layersCu);
    pm.GetProperty(PCB_VIA, 'Layer Bottom')?.SetChoices(layersCu);
    pm.GetProperty(PCB_VIA, 'Bottom Backdrill Must-Cut')?.SetChoices(layersCu);
    pm.GetProperty(PCB_VIA, 'Top Backdrill Must-Cut')?.SetChoices(layersCu);
    pm.GetProperty(PCB_TUNING_PATTERN, 'Layer')?.SetChoices(layersCu);

    // Regenerate nets
    const netNames: [string, number][] = [];

    for (const [netCode, netInfo] of aBoard.GetNetInfo().NetsByNetcode())
      netNames.push([unescapeString(netInfo.GetNetname()), netCode]);

    // wxString::CmpNoCase
    netNames.sort((a, b) => {
      const x = a[0].toLowerCase();
      const y = b[0].toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });

    for (const [netName, netCode] of netNames) nets.Add(netName, netCode);

    pm.GetProperty(BOARD_CONNECTED_ITEM, 'Net')?.SetChoices(nets);
    pm.GetProperty(PCB_TUNING_PATTERN, 'Net')?.SetChoices(nets);
  }

  protected override getItemValue(
    aItem: EDA_ITEM,
    aProperty: PROPERTY_BASE,
  ): { ok: boolean; value: unknown } {
    // For FOOTPRINT variant-aware boolean properties, return variant-specific values
    if (aItem.Type() === KICAD_T.PCB_FOOTPRINT_T) {
      const footprint = aItem as FOOTPRINT;
      const propName = aProperty.Name();
      const variantName = footprint.GetBoard()?.GetCurrentVariant() ?? '';

      if (propName === 'Do not Populate')
        return { ok: true, value: footprint.GetDNPForVariant(variantName) };
      else if (propName === 'Exclude From Bill of Materials')
        return { ok: true, value: footprint.GetExcludedFromBOMForVariant(variantName) };
      else if (propName === 'Exclude From Position Files')
        return { ok: true, value: footprint.GetExcludedFromPosFilesForVariant(variantName) };
    }

    return super.getItemValue(aItem, aProperty);
  }
}
