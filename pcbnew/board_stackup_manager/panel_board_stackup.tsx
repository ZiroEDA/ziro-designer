// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Board Stackup > Physical Stackup. Counterpart:
 * `pcbnew/board_stackup_manager/panel_board_stackup.cpp`
 * (PANEL_SETUP_BOARD_STACKUP), the physical layer stack: a copper-layer
 * count + impedance-controlled option, the borderless 9-column
 * `m_fgGridSizer` (Layer / Id / Type / Material+browse / Thickness+lock /
 * Color / Epsilon R / Loss Tan) and the board thickness. All four actions
 * are KiCad's:
 *
 *  - Add Dielectric Layer… (onAddDielectricLayer): an EDA_LIST_DIALOG of the
 *    dielectric sublayers in stackup order ("Layer 'Dielectric N'
 *    (sublayer i/n)"), inserting a fresh DIELECTRIC_PRMS, thickness 0,
 *    epsilon 1, loss 0, after the chosen one.
 *  - Remove Dielectric Layer… (onRemoveDielectricLayer): lists only the
 *    sublayers of dielectrics that have two or more; the button enables only
 *    when such a dielectric exists (onRemoveDielUI).
 *  - Adjust Dielectric Thickness (onAdjustDielectricThickness +
 *    setDefaultLayerWidths): asks for the target board thickness (min = the
 *    sum of the non-adjustable layers), then distributes, prepregs at a
 *    fixed 0.1 mm, cores splitting the remainder, alternating types
 *    (prepreg-outside except on a two-layer board), both shrinking equally
 *    when 0.1 mm cores would not fit; locked layers keep their value.
 *  - Export to Clipboard (onExportToClipboard / BuildStackupReport): the
 *    ASCII stackup report, one line per enabled layer plus the finish line.
 *
 * The material "…" buttons open DIALOG_DIELECTRIC_MATERIAL: editable
 * Material / Epsilon R / Loss Tan fields over the predefined substrate table
 * for the row's type (dielectric_material.cpp substrateMaterial /
 * solderMaskMaterial / silkscreenMaterial).
 */

import { Button, CheckBox, Choice, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import { type JSX, useRef, useState } from 'react';
import { ShowKicadMessageDialog } from '@ziroeda/common/confirm.js';
import { unitLabelText } from '@ziroeda/common/eda_units.js';
import { wxCENTER, wxOK } from '@ziroeda/wx/defs.js';
import { WxTextEntryDialog } from '@ziroeda/wx/textdlg.js';
import { pcbIUScale, pcbIuToMM, pcbMmToIU } from '@ziroeda/common/eda_units.js';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import {
  wxALIGN_CENTER_HORIZONTAL,
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_RIGHT,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem } from '@ziroeda/wx/sizer.js';
import {
  COPPER_LAYER_CHOICES,
  PANEL_SETUP_BOARD_STACKUP_BASE,
} from './panel_board_stackup_base.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { BOARD_STACKUP_ITEM_TYPE } from './board_stackup.js';
import {
  DIELECTRIC_SUBSTRATE,
  DIELECTRIC_SUBSTRATE_LIST,
  DL_MATERIAL_LIST_TYPE,
} from './dielectric_material.js';
import { GetStandardColors } from './stackup_predefined_prms.js';
import { BuildStackupReport } from './board_stackup_reporter.js';
import { DialogDielectricMaterial, type Substrate } from './dialog_dielectric_list_manager.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import { parseUnitValue, stringFromValue } from '@ziroeda/common/widgets/unit_binder.js';
import { EdaListDialog } from '@ziroeda/common/dialogs/eda_list_dialog.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { BOARD } from '../board.js';
import { BOARD_DESIGN_SETTINGS } from '../board_design_settings.js';
import {
  BOARD_STACKUP,
  BOARD_STACKUP_ITEM,
  KEY_COPPER,
  KEY_CORE,
  KEY_PREPREG,
} from './board_stackup.js';
import { type BoardFinish, edgeConnectorOf } from './panel_board_finish.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** An additional dielectric sublayer (BOARD_STACKUP_ITEM's DIELECTRIC_PRMS
 *  entries past index 0, the `addsublayer` groups of the file format). */
export interface DielectricSublayer {
  material: string;
  thicknessMM: number;
  epsilonR?: number;
  lossTan?: number;
  locked?: boolean;
}

export interface StackupLayer {
  name: string;
  type: string;
  material: string;
  thicknessMM: number;
  color: string;
  locked?: boolean;
  epsilonR?: number;
  lossTan?: number;
  /** Dielectric layers only: sublayers beyond the main one (sublayer 1). A
   *  new sublayer starts as DIELECTRIC_PRMS(): thickness 0, epsilon 1, loss 0. */
  sublayers?: DielectricSublayer[];
}

export interface PhysicalStackup {
  copperCount: number;
  impedanceControlled: boolean;
  layers: StackupLayer[];
}

/** The stackup rows' type strings: the file's keys for the three the file abbreviates. */
const STACKUP_TYPE_LABEL: Record<string, string> = {
  [KEY_COPPER]: _HKI('Copper'),
  [KEY_CORE]: _HKI('Core'),
  [KEY_PREPREG]: 'Prepreg',
};
const STACKUP_TYPE_KEY: Record<string, string> = {
  Copper: KEY_COPPER,
  Core: KEY_CORE,
  Prepreg: KEY_PREPREG,
};
/** `F.SilkS` shows as `F.Silkscreen` in the stackup rows (the layer's default name). */
const STACKUP_DISPLAY_NAME: Record<string, string> = {
  'F.SilkS': 'F.Silkscreen',
  'B.SilkS': 'B.Silkscreen',
};

function stackupItemToWindow(item: BOARD_STACKUP_ITEM): StackupLayer {
  const mm = (iu: number): number => pcbIUScale.iuToMM(iu);
  const isDielectric = item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC;
  const layerName = isDielectric
    ? `Dielectric ${item.GetDielectricLayerId()}`
    : (STACKUP_DISPLAY_NAME[LSET.Name(item.GetBrdLayerId())] ?? LSET.Name(item.GetBrdLayerId()));
  const row: StackupLayer = {
    name: layerName,
    type: STACKUP_TYPE_LABEL[item.GetTypeName()] ?? item.GetTypeName(),
    material: item.GetMaterial(0),
    thicknessMM: mm(item.GetThickness(0)),
    color: item.GetColor(0),
  };
  if (item.IsThicknessLocked(0)) row.locked = true;
  if (item.HasEpsilonRValue()) row.epsilonR = item.GetEpsilonR(0);
  if (item.HasLossTangentValue()) row.lossTan = item.GetLossTangent(0);

  if (item.GetSublayersCount() > 1) {
    const subs: DielectricSublayer[] = [];
    for (let i = 1; i < item.GetSublayersCount(); ++i) {
      const sub: DielectricSublayer = {
        material: item.GetMaterial(i),
        thicknessMM: mm(item.GetThickness(i)),
      };
      if (item.IsThicknessLocked(i)) sub.locked = true;
      if (item.HasEpsilonRValue()) sub.epsilonR = item.GetEpsilonR(i);
      if (item.HasLossTangentValue()) sub.lossTan = item.GetLossTangent(i);
      subs.push(sub);
    }
    row.sublayers = subs;
  }
  return row;
}

function stackupItemFromWindow(row: StackupLayer): BOARD_STACKUP_ITEM {
  const iu = (mm: number): number => pcbIUScale.mmToIU(mm);
  const typeKey = STACKUP_TYPE_KEY[row.type] ?? row.type;
  let type: BOARD_STACKUP_ITEM_TYPE;
  if (typeKey === KEY_COPPER) type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_COPPER;
  else if (typeKey === KEY_CORE || typeKey === KEY_PREPREG)
    type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC;
  else if (/Solder Paste/.test(row.type)) type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERPASTE;
  else if (/Solder Mask/.test(row.type)) type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK;
  else type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SILKSCREEN;

  const item = new BOARD_STACKUP_ITEM(type);
  item.SetTypeName(typeKey);
  if (type !== BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
    const fileName =
      row.name === 'F.Silkscreen' ? 'F.SilkS' : row.name === 'B.Silkscreen' ? 'B.SilkS' : row.name;
    item.SetBrdLayerId(LSET.NameToLayer(fileName) as PCB_LAYER_ID);
  }
  item.SetMaterial(row.material, 0);
  item.SetThickness(iu(row.thicknessMM), 0);
  item.SetThicknessLocked(row.locked ?? false, 0);
  item.SetColor(row.color, 0);
  if (row.epsilonR !== undefined) item.SetEpsilonR(row.epsilonR, 0);
  if (row.lossTan !== undefined) item.SetLossTangent(row.lossTan, 0);

  for (const [i, sub] of (row.sublayers ?? []).entries()) {
    item.AddDielectricPrms(i + 1);
    item.SetMaterial(sub.material, i + 1);
    item.SetThickness(iu(sub.thicknessMM), i + 1);
    item.SetThicknessLocked(sub.locked ?? false, i + 1);
    if (sub.epsilonR !== undefined) item.SetEpsilonR(sub.epsilonR, i + 1);
    if (sub.lossTan !== undefined) item.SetLossTangent(sub.lossTan, i + 1);
  }

  return item;
}

/** The rows into a fresh BOARD_STACKUP, dielectrics numbered in order. */
function stackupOfRows(aRows: readonly StackupLayer[]): BOARD_STACKUP {
  const st = new BOARD_STACKUP();
  let dielectricId = 1;
  for (const row of aRows) {
    const item = stackupItemFromWindow(row);
    if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
      item.SetDielectricLayerId(dielectricId);
      dielectricId++;
    }
    st.Add(item);
  }
  return st;
}

/**
 * `BOARD_STACKUP::IsThicknessEditable()`'s answer for a row
 * (`board_stackup.cpp:314-319`): copper, dielectric and solder mask have a
 * thickness; silkscreen and solder paste do not.
 */
export function isThicknessEditable(aType: string): boolean {
  return stackupItemFromWindow({
    name: '',
    type: aType,
    material: '',
    thicknessMM: 0,
    color: '',
  }).IsThicknessEditable();
}

/** PANEL_SETUP_BOARD_STACKUP's transfers (panel_board_stackup.cpp). */
export const PANEL_SETUP_BOARD_STACKUP = {
  /** The descriptor, synchronised to the board, its enabled rows in order. */
  TransferDataToWindow(aBoard: BOARD): PhysicalStackup {
    const bds = aBoard.GetDesignSettings();
    const stackup = bds.GetStackupDescriptor();
    stackup.SynchronizeWithBoard(bds);
    return {
      copperCount: aBoard.GetCopperLayerCount(),
      impedanceControlled: stackup.m_HasDielectricConstrains,
      layers: stackup
        .GetList()
        .filter((i) => i.IsEnabled())
        .map(stackupItemToWindow),
    };
  },

  /** The rows into the board's descriptor, and the thickness they add up to. */
  TransferDataFromWindow(v: PhysicalStackup, aBoard: BOARD): boolean {
    const bds = aBoard.GetDesignSettings();
    const brd_stackup = bds.GetStackupDescriptor();
    const before = brd_stackup.GetList().map((i) => BOARD_STACKUP_ITEM.copyOf(i));

    brd_stackup.RemoveAll();
    for (const item of stackupOfRows(v.layers).GetList()) brd_stackup.Add(item);

    let modified =
      before.length !== brd_stackup.GetCount() ||
      before.some((b, i) => !b.equals(brd_stackup.GetStackupLayer(i)!));

    const thickness = brd_stackup.BuildBoardThicknessFromStackup();
    if (bds.GetBoardThickness() !== thickness) {
      bds.SetBoardThickness(thickness);
      modified = true;
    }

    if (brd_stackup.m_HasDielectricConstrains !== v.impedanceControlled) {
      brd_stackup.m_HasDielectricConstrains = v.impedanceControlled;
      modified = true;
    }

    if (!bds.m_HasStackup) {
      bds.m_HasStackup = true;
      modified = true;
    }

    return modified;
  },

  /**
   * `transferDataFromUIToStackup()` + PANEL_SETUP_BOARD_FINISH into a scratch
   * BOARD_STACKUP: what "Export to Clipboard" hands to `BuildStackupReport`
   * without touching the board.
   */
  StackupOfWindow(aPhysical: PhysicalStackup, aFinish: BoardFinish): BOARD_STACKUP {
    const st = stackupOfRows(aPhysical.layers);
    st.m_HasDielectricConstrains = aPhysical.impedanceControlled;
    st.m_FinishType = aFinish.copperFinish;
    st.m_EdgeConnectorConstraints = edgeConnectorOf(aFinish.edgeCardConnectors);
    st.m_EdgePlating = aFinish.platedBoardEdge;
    return st;
  },

  /**
   * The rows for a new copper count: `BOARD_STACKUP::BuildDefaultStackupList`
   * over settings with that many copper layers, the stackup `buildLayerStackPanel`
   * creates. [gap] KiCad keeps the rows it has and hides the inactive ones
   * (`showOnlyActiveLayers`), then redistributes the dielectric thickness to
   * keep the board's (`setDefaultLayerWidths`); this rebuilds the default stack.
   */
  DefaultRows(aCopperCount: number): StackupLayer[] {
    const bds = new BOARD_DESIGN_SETTINGS();
    bds.SetCopperLayerCount(aCopperCount);
    const st = new BOARD_STACKUP();
    st.BuildDefaultStackupList(bds);
    return st
      .GetList()
      .filter((i) => i.IsEnabled())
      .map(stackupItemToWindow);
  },
};

// Which editable fields a row's type carries (Solder Paste rows carry none).
/**
 * `BOARD_STACKUP_ITEM`'s four editability predicates, one per column group
 * (`board_stackup.cpp:277-319`). They are NOT the same set of types, and the
 * differences are the whole point:
 *
 *     IsMaterialEditable()  dielectric | soldermask | silkscreen
 *     IsThicknessEditable() dielectric | soldermask | COPPER
 *     IsColorEditable()     dielectric | soldermask | silkscreen
 *     HasEpsilonRValue()    dielectric | soldermask          (Loss Tan too)
 *
 * so copper has a thickness but NO material, and silkscreen has a material but
 * NO thickness. This had both of those backwards — it gave copper a Material
 * cell reading "Copper" and silkscreen a Thickness cell, neither of which
 * exists upstream, and the second one fed a phantom silkscreen thickness into
 * the board-thickness sum.
 */
const hasField = (type: string, f: 'mat' | 'thick' | 'color' | 'eps' | 'diel'): boolean => {
  if (type.includes('Solder Paste')) return false; // no cell of any kind
  // Thickness comes from BOARD_STACKUP_ITEM::IsThicknessEditable, because the
  // `(general (thickness))` writer has to reach the same answer.
  if (f === 'thick') return isThicknessEditable(type);
  if (type === 'Copper') return false;
  if (type.includes('Silk Screen')) return f === 'mat' || f === 'color';
  if (type.includes('Solder Mask')) return f === 'mat' || f === 'color' || f === 'eps';
  return true; // dielectric (Core / Prepreg) has every one
};
/**
 * `m_core_prepreg_choice` (`panel_board_stackup.cpp:121-122`) — the dielectric
 * Type cell's two entries. The LABEL is not the stored name: the choice reads
 * "Core" / "PrePreg" while `SetTypeName()` stores `KEY_CORE` / `KEY_PREPREG`,
 * i.e. the lowercase file tokens `core` and `prepreg`
 * (`stackup_predefined_prms.h:44-45`, `:1207-1221`). Our model holds the
 * capitalised form, so only the second entry's label differs from its value.
 */
const DIELECTRIC_TYPES: [string, string][] = [
  [_HKI('Core'), _HKI('Core')],
  ['Prepreg', _HKI('PrePreg')],
];

const isDielectric = (l: StackupLayer): boolean => l.type === 'Core' || l.type === 'Prepreg';

/**
 * `GetStandardColors()` (`stackup_predefined_prms.cpp:59-84`) — KiCad's own
 * table, mirrored value for value because it is DATA: the names go into the
 * `.gbrjob` file, so they are not free, and the RGB is what the 3D renderer and
 * the swatch bitmaps draw. This file previously carried six invented hex
 * values in a `SWATCH` map and a seven-name `COLORS` list that shared only four
 * entries with either of upstream's two lists.
 *
 * `gbrjobColors` serves silkscreen and soldermask; `dielectricColors` serves
 * dielectric. The alpha in the dielectric table is for the 3D view, so only the
 * RGB is carried here.
 */
/** The view's type string → `BOARD_STACKUP_ITEM_TYPE`, for the two lookups below. */
const itemTypeOf = (type: string): BOARD_STACKUP_ITEM_TYPE => {
  if (type === 'Core' || type === 'Prepreg') return BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC;
  if (type.includes('Solder Mask')) return BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK;
  if (type.includes('Silk Screen')) return BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SILKSCREEN;
  return BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_UNDEFINED;
};

/** A `COLOR4D` as the swatch's css, alpha dropped as the wxBitmapComboBox bitmap drops it. */
const cssOf = (c: Color4d): string =>
  `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;

/** `GetStandardColors( aType )` — which of the two lists a row draws from. */
const colorsFor = (type: string): [string, string][] => {
  const t = itemTypeOf(type);
  // A mask/silk colour is asked for as the DIELECTRIC's would be: the swatch
  // is the bitmap, not the 0.83-alpha `GetColor( SOLDERMASK )`.
  return GetStandardColors(t).map((c) => [
    c.GetName(),
    cssOf(c.GetColor(BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC)),
  ]);
};
const swatchOf = (type: string, name: string | undefined): string =>
  colorsFor(type).find(([n]) => n === (name || 'Not specified'))?.[1] ?? 'transparent';

/**
 * `getColorIconItem()` (`panel_board_stackup.cpp:1569-1596`) — the Layer
 * column's swatch colour, which is NOT the row's Color cell for every type:
 *
 *     case BS_ITEM_TYPE_COPPER:      color = copperColor;
 *     case BS_ITEM_TYPE_DIELECTRIC:  color = dielectricColor;
 *     case BS_ITEM_TYPE_SOLDERMASK:  color = GetSelectedColor( aRow );
 *     case BS_ITEM_TYPE_SILKSCREEN:  color = GetSelectedColor( aRow );
 *     case BS_ITEM_TYPE_SOLDERPASTE: color = pasteColor;
 *
 * so copper, dielectric and paste have three FIXED colours of their own, and
 * only mask and silkscreen follow the Color dropdown. This panel drew a swatch
 * only where `IsColorEditable()` was true, which is exactly the three types
 * that have a fixed colour — copper, dielectric-as-drawn and paste came out
 * blank, and the dielectric's came off the wrong list.
 *
 * [data] `static wxColor copperColor( 220, 180, 30 )` and friends (`:69-71`).
 */
const COPPER_ICON_COLOR = 'rgb(220, 180, 30)';
const DIELECTRIC_ICON_COLOR = 'rgb(75, 120, 75)';
const PASTE_ICON_COLOR = 'rgb(200, 200, 200)';

const iconColorOf = (l: StackupLayer): string => {
  if (l.type === 'Copper') return COPPER_ICON_COLOR;
  if (l.type === 'Core' || l.type === 'Prepreg') return DIELECTRIC_ICON_COLOR;
  if (l.type.includes('Solder Paste')) return PASTE_ICON_COLOR;
  // Solder mask and silkscreen: `GetSelectedColor( aRow )`, the row's own.
  return swatchOf(l.type, l.color);
};

/** Which of the panel's three `DIELECTRIC_SUBSTRATE_LIST`s a row's type draws from. */
const matListTypeOf = (type: string): DL_MATERIAL_LIST_TYPE | null => {
  switch (itemTypeOf(type)) {
    case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC:
      return DL_MATERIAL_LIST_TYPE.DL_MATERIAL_DIELECTRIC;
    case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK:
      return DL_MATERIAL_LIST_TYPE.DL_MATERIAL_SOLDERMASK;
    case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SILKSCREEN:
      return DL_MATERIAL_LIST_TYPE.DL_MATERIAL_SILKSCREEN;
    default:
      return null;
  }
};

const trimNum = (v: number): string => {
  let s = v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
};

interface Props {
  value: PhysicalStackup;
  onChange: (next: PhysicalStackup) => void;
  /** Board finish values for the clipboard report (the sibling page's data). */
  finish?: { copperFinish: string; platedBoardEdge: boolean; edgeCardConnectors: string };
  /** `m_frame->GetUserUnits()`, for the report's thicknesses. */
  units: StatusUnits;
}

/** A picked material-browse / add / remove target. */
type MaterialTarget = { layer: number; sub: number }; // sub 0 = main
type ListPick = { title: string; label: string; items: string[]; onPick: (index: number) => void };

/** `wxMessageBox( aMessage )`: wxOK | wxCENTER under the caption "Message". */
function messageBox(aMessage: string): void {
  void ShowKicadMessageDialog({ message: aMessage, caption: 'Message', style: wxOK | wxCENTER });
}

export function PanelPcbStackup({ value, onChange, finish, units }: Props): JSX.Element {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const setLayer = (i: number, patch: Partial<StackupLayer>): void =>
    onChange({ ...value, layers: value.layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setSub = (i: number, si: number, patch: Partial<DielectricSublayer>): void => {
    const l = value.layers[i]!;
    const sublayers = (l.sublayers ?? []).map((s, j) => (j === si ? { ...s, ...patch } : s));
    setLayer(i, { sublayers });
  };
  const setCount = (copperCount: number): void =>
    onChange({ ...value, copperCount, layers: PANEL_SETUP_BOARD_STACKUP.DefaultRows(copperCount) });

  const subCountOf = (l: StackupLayer): number => 1 + (l.sublayers?.length ?? 0);
  // `BOARD_STACKUP::GetBoardThickness()` (`board_stackup.cpp:498-515`) adds a
  // row only `if( item->IsThicknessEditable() && item->IsEnabled() )`, then all
  // of that row's sublayers. This summed every row unconditionally, so a
  // silkscreen or solder-paste row carrying a stale thickness — and this panel
  // used to give silkscreen an editable one — inflated the board thickness.
  // (Enabled-ness is implicit here: `value.layers` holds only enabled rows.)
  const boardThickness = value.layers.reduce(
    (s, l) =>
      hasField(l.type, 'thick')
        ? s +
          (l.thicknessMM || 0) +
          (l.sublayers ?? []).reduce((a, p) => a + (p.thicknessMM || 0), 0)
        : s,
    0,
  );

  // Dielectric numbering in stackup order (FormatDielectricLayerName).
  const dielIdOf = (i: number): number =>
    value.layers.slice(0, i + 1).filter((l) => isDielectric(l)).length;

  // ----- list-picker + material dialogs ------------------------------------
  const [listPick, setListPick] = useState<ListPick | null>(null);
  const [matTarget, setMatTarget] = useState<MaterialTarget | null>(null);
  // `m_delectricMatList` / `m_solderMaskMatList` / `m_silkscreenMatList`: the
  // panel's own lists, seeded from the predefined tables and grown by whatever
  // the board uses or the user types; they live as long as the panel does.
  const matListsRef = useRef<Record<DL_MATERIAL_LIST_TYPE, DIELECTRIC_SUBSTRATE_LIST> | null>(null);
  const matLists = (): Record<DL_MATERIAL_LIST_TYPE, DIELECTRIC_SUBSTRATE_LIST> => {
    if (!matListsRef.current)
      matListsRef.current = {
        [DL_MATERIAL_LIST_TYPE.DL_MATERIAL_DIELECTRIC]: new DIELECTRIC_SUBSTRATE_LIST(
          DL_MATERIAL_LIST_TYPE.DL_MATERIAL_DIELECTRIC,
        ),
        [DL_MATERIAL_LIST_TYPE.DL_MATERIAL_SOLDERMASK]: new DIELECTRIC_SUBSTRATE_LIST(
          DL_MATERIAL_LIST_TYPE.DL_MATERIAL_SOLDERMASK,
        ),
        [DL_MATERIAL_LIST_TYPE.DL_MATERIAL_SILKSCREEN]: new DIELECTRIC_SUBSTRATE_LIST(
          DL_MATERIAL_LIST_TYPE.DL_MATERIAL_SILKSCREEN,
        ),
      };
    return matListsRef.current;
  };

  // Esc-to-cancel for the material dialog is `DialogDielectricMaterial`'s own
  // `useModalEscape` now. The dielectric picker is an `EdaListDialog`, which
  // asks for itself.

  // onAddDielectricLayer: every dielectric sublayer is an insert position.
  const onAddDielectric = (): void => {
    const items: string[] = [];
    const targets: MaterialTarget[] = [];
    value.layers.forEach((l, i) => {
      if (!isDielectric(l)) return;
      const n = subCountOf(l);
      for (let si = 0; si < n; si++) {
        items.push(
          n > 1
            ? `Layer 'Dielectric ${dielIdOf(i)}' (sublayer ${si + 1}/${n})`
            : `Dielectric ${dielIdOf(i)}`,
        );
        targets.push({ layer: i, sub: si });
      }
    });
    setListPick({
      title: wxGetTranslation('Add Dielectric Layer'),
      label: wxGetTranslation('Select layer to add:'),
      items,
      onPick: (index) => {
        const t = targets[index]!;
        const l = value.layers[t.layer]!;
        // Insert a fresh DIELECTRIC_PRMS after the selected sublayer
        // (thickness 0, epsilon 1, loss 0, the C++ default constructor).
        const fresh: DielectricSublayer = { material: '', thicknessMM: 0, epsilonR: 1, lossTan: 0 };
        const subs = [...(l.sublayers ?? [])];
        subs.splice(t.sub, 0, fresh); // after main (sub 0) = subs[0]; after sub k = subs[k]
        setLayer(t.layer, { sublayers: subs });
      },
    });
  };

  // onRemoveDielectricLayer: only sublayers of dielectrics with >= 2 listed.
  const removableExists = value.layers.some((l) => isDielectric(l) && subCountOf(l) > 1);
  const onRemoveDielectric = (): void => {
    const items: string[] = [];
    const targets: MaterialTarget[] = [];
    value.layers.forEach((l, i) => {
      if (!isDielectric(l) || subCountOf(l) <= 1) return;
      const n = subCountOf(l);
      for (let si = 0; si < n; si++) {
        items.push(`Layer 'Dielectric ${dielIdOf(i)}' sublayer ${si + 1}/${n}`);
        targets.push({ layer: i, sub: si });
      }
    });
    setListPick({
      title: wxGetTranslation('Remove Dielectric Layer'),
      label: wxGetTranslation('Select layer to remove:'),
      items,
      onPick: (index) => {
        const t = targets[index]!;
        const l = value.layers[t.layer]!;
        // RemoveDielectricPrms: drop the prms entry; prms[0] is the main
        // layer, so removing it promotes the first sublayer.
        const prms: DielectricSublayer[] = [
          {
            material: l.material,
            thicknessMM: l.thicknessMM,
            epsilonR: l.epsilonR,
            lossTan: l.lossTan,
            locked: l.locked,
          },
          ...(l.sublayers ?? []),
        ];
        prms.splice(t.sub, 1);
        const [main, ...rest] = prms;
        setLayer(t.layer, {
          material: main!.material,
          thicknessMM: main!.thicknessMM,
          epsilonR: main!.epsilonR,
          lossTan: main!.lossTan,
          locked: main!.locked,
          sublayers: rest.length ? rest : undefined,
        });
      },
    });
  };

  // onAdjustDielectricThickness's wxTextEntryDialog, open.
  const [adjust, setAdjust] = useState<{
    title: string;
    minThickness: number;
    minText: string;
    candidates: number;
  } | null>(null);

  // onAdjustDielectricThickness + setDefaultLayerWidths.
  const onAdjustThickness = (): void => {
    // Min thickness = every thickness the algorithm may not change: layers
    // without a lock control (copper/mask/silk) and locked dielectrics.
    let minThickness = 0;
    let candidates = 0;
    const eachThickness = (
      l: StackupLayer,
      p: { thicknessMM: number; locked?: boolean },
      lockable: boolean,
    ): void => {
      if (!hasField(l.type, 'thick')) return;
      if (lockable && !p.locked) candidates++;
      else minThickness += p.thicknessMM || 0;
    };
    for (const l of value.layers) {
      eachThickness(l, l, isDielectric(l));
      for (const sub of l.sublayers ?? []) eachThickness(l, sub, true);
    }
    const minText = stringFromValue(pcbMmToIU(minThickness), units, true, pcbIUScale);
    // wxTextEntryDialog( this, title, _( "Adjust Unlocked Dielectric Layers" ) ).
    setAdjust({
      title:
        minThickness === 0
          ? `Enter board thickness in ${unitLabelText(units).trim()}:`
          : `Enter expected board thickness (min value ${minText}):`,
      minThickness,
      minText,
      candidates,
    });
  };

  /** After `ShowModal() == wxID_OK`: the checks, then setDefaultLayerWidths. */
  const onAdjustEntered = (aText: string): void => {
    const a = adjust!;
    setAdjust(null);
    const target = parseUnitValue(aText, units, pcbIUScale);
    if (!Number.isFinite(target)) return;
    if (target < a.minThickness) {
      messageBox(`Value too small (min value ${a.minText}).`);
      return;
    }
    if (a.candidates === 0) {
      messageBox(wxGetTranslation('All dielectric  thickness layers are locked'));
      return;
    }

    // setDefaultLayerWidths: fixed 0.1 mm prepregs, cores share the rest,
    // alternating prepreg/core from the outside in (a two-layer board is a
    // single core); both shrink equally when 0.1 mm cores would not fit.
    const prePregDefault = 0.1;
    const copperCount = value.copperCount;
    const dielectricCount = copperCount - 1;
    let coreCount = copperCount / 2 - 1;
    let currentIsCore = false;
    if (copperCount === 2) {
      coreCount = 1;
      currentIsCore = true;
    }
    const prePregCount = dielectricCount - coreCount;

    // Fixed widths: masks/silks/coppers, locked dielectric mains, and every
    // secondary sublayer (they are never auto-resized).
    let fixed = 0;
    for (const l of value.layers) {
      if (hasField(l.type, 'thick') && (!isDielectric(l) || l.locked)) fixed += l.thicknessMM || 0;
      for (const sub of l.sublayers ?? []) fixed += sub.thicknessMM || 0;
    }
    let prePreg = prePregDefault;
    let core = (target - fixed - prePregDefault * prePregCount) / coreCount;
    if (core < prePreg) {
      const remaining = target - fixed;
      prePreg = core = Math.max(0, remaining / dielectricCount);
    }
    const round = (v: number): number => Math.round(v * 1e6) / 1e6;
    const layers = value.layers.map((l) => {
      if (!isDielectric(l)) return l;
      if (l.locked) {
        currentIsCore = !currentIsCore;
        return l;
      }
      const next: StackupLayer = {
        ...l,
        type: currentIsCore ? wxGetTranslation('Core') : 'Prepreg',
        thicknessMM: round(currentIsCore ? core : prePreg),
      };
      currentIsCore = !currentIsCore;
      return next;
    });
    onChange({ ...value, layers });
  };

  // `onExportToClipboard`: the rows and the Board Finish page into a scratch
  // BOARD_STACKUP, then `BuildStackupReport( m_stackup, m_frame->GetUserUnits() )`.
  const onExport = (): void => {
    const report = BuildStackupReport(
      PANEL_SETUP_BOARD_STACKUP.StackupOfWindow(
        value,
        finish ?? { copperFinish: 'None', platedBoardEdge: false, edgeCardConnectors: 'None' },
      ),
      units,
    );
    void navigator.clipboard?.writeText(report);
  };

  // `onMaterialChange` (panel_board_stackup.cpp:1417-1490): first every material
  // the stackup uses is appended to its list if missing, then
  // DIALOG_DIELECTRIC_MATERIAL opens on that list — `TransferDataToWindow`
  // leaves Material empty and puts 1 / 0 in the two numbers.
  const openMaterial = (layer: number, sub: number): void => {
    const lists = matLists();
    for (const row of value.layers) {
      const lt = matListTypeOf(row.type);
      if (lt === null) continue;
      const list = lists[lt];
      for (const p of [row, ...(row.sublayers ?? [])]) {
        const eps = p.epsilonR ?? 0;
        const tan = p.lossTan ?? 0;
        if (list.FindSubstrate(p.material, eps, tan) < 0 && row.material !== '')
          list.AppendSubstrate(new DIELECTRIC_SUBSTRATE(p.material, eps, tan));
      }
    }
    if (matListTypeOf(value.layers[layer]!.type) === null) return;
    setMatTarget({ layer, sub });
  };
  // `DialogDielectricMaterial`'s `onSubmit`: `null` on Cancel/close/an empty
  // name ("No substrate specified"); otherwise `TransferDataFromWindow` has
  // already validated, and this is `SetMaterial`/`SetEpsilonR`/`SetLossTangent`.
  const onMaterialSubmit = (substrate: Substrate | null): void => {
    if (!matTarget) return;
    const target = matTarget;
    setMatTarget(null);
    if (!substrate) return;
    const patch = {
      material: substrate.name,
      // Silk rows carry no epsilon field in the grid, but the value still
      // rides along in the model, like the C++ item.
      epsilonR: Number(substrate.epsilonR),
      lossTan: Number(substrate.lossTan),
    };
    if (target.sub === 0) setLayer(target.layer, patch);
    else setSub(target.layer, target.sub - 1, patch);
  };

  /** m_numericTextCtrlSize / m_numericFieldsSize: GetTextExtent of these. */
  const NUMERIC_TEXT_CTRL = 'XXX.XXXXXXX mils';
  const NUMERIC_FIELD = 'X.XXXXXXX';
  /** The text a field holds while it is typed, by row and column. */
  const field = (aKey: string, aShown: string, aOn: (aText: string) => void) => ({
    value: texts[aKey] ?? aShown,
    onChange: (aText: string) => {
      setTexts((t) => ({ ...t, [aKey]: aText }));
      aOn(aText);
    },
    onBlur: () => setTexts(({ [aKey]: _, ...rest }) => rest),
  });
  /** `addSpacer`: an empty wxStaticText, Insert()ed wxALIGN_CENTER_VERTICAL. */
  const spacer = (aKey: string) => (
    <SizerItem key={aKey} flag={wxALIGN_CENTER_VERTICAL} border={0}>
      <StaticText label="" />
    </SizerItem>
  );

  /** `lazyBuildRowUI`: one row, nine cells, as the class Insert()s them. */
  const renderRow = (l: StackupLayer, i: number, sub: number): JSX.Element[] => {
    const diel = isDielectric(l);
    const p = sub === 0 ? l : l.sublayers![sub - 1]!;
    const key = `${i}.${sub}`;
    const setP = (patch: Record<string, unknown>): void => {
      if (sub === 0) setLayer(i, patch as Partial<StackupLayer>);
      else setSub(i, sub - 1, patch as Partial<DielectricSublayer>);
    };
    const cells: JSX.Element[] = [];

    // The colour swatch: a 24 x 7 bar (m_colorIconsSize.x by .y / 2).
    cells.push(
      <SizerItem
        key={`${key}-sw`}
        flag={wxRIGHT | wxALIGN_CENTER_VERTICAL | wxALIGN_RIGHT}
        border={4}
      >
        <span className="ze-stackup-swatch" style={{ background: iconColorOf(l) }} />
      </SizerItem>,
    );

    if (diel) {
      // FormatDielectricLayerName, and "  (i/n)" on a layer of several.
      const n = subCountOf(l);
      cells.push(
        <SizerItem key={`${key}-nm`} flag={wxRIGHT | wxALIGN_CENTER_VERTICAL} border={2}>
          <StaticText label={n > 1 ? `${l.name}  (${sub + 1}/${n})` : l.name} />
        </SizerItem>,
      );
      cells.push(
        sub === 0 ? (
          <SizerItem
            key={`${key}-ty`}
            proportion={1}
            flag={wxEXPAND | wxLEFT | wxRIGHT | wxALIGN_CENTER_VERTICAL}
            border={2}
          >
            <Choice
              choices={DIELECTRIC_TYPES.map(([, label]) => label)}
              choice={{
                value: DIELECTRIC_TYPES.findIndex(([v]) => v === l.type),
                onChange: (k) => setLayer(i, { type: DIELECTRIC_TYPES[k]![0] }),
              }}
              ariaLabel={`${l.name} type`}
            />
          </SizerItem>
        ) : (
          spacer(`${key}-ty`)
        ),
      );
    } else {
      cells.push(
        <SizerItem key={`${key}-nm`} flag={wxLEFT | wxRIGHT | wxALIGN_CENTER_VERTICAL} border={1}>
          <StaticText label={l.name} />
        </SizerItem>,
      );
      cells.push(
        <SizerItem key={`${key}-ty`} flag={wxLEFT | wxRIGHT | wxALIGN_CENTER_VERTICAL} border={2}>
          <StaticText label={l.type} />
        </SizerItem>,
      );
    }

    if (hasField(l.type, 'mat')) {
      cells.push(
        <SizerItem key={`${key}-mat`} proportion={1} flag={wxRIGHT | wxEXPAND} border={4}>
          {/* bSizerMat: the material and its "..." button */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
              <TextCtrl
                {...field(`${key}-mat`, p.material || 'Not specified', (aText) =>
                  setP({ material: aText }),
                )}
                minWidthText={NUMERIC_TEXT_CTRL}
                ariaLabel={`${l.name} material`}
              />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={2}>
              <Button label="..." exactFit onClick={() => openMaterial(i, sub)} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>,
      );
    } else cells.push(spacer(`${key}-mat`));

    if (hasField(l.type, 'thick')) {
      // m_frame->StringFromValue( thickness, true ), read back in the frame's units.
      cells.push(
        <SizerItem key={`${key}-th`} flag={wxLEFT | wxRIGHT | wxALIGN_CENTER_VERTICAL} border={2}>
          <TextCtrl
            {...field(
              `${key}-th`,
              stringFromValue(pcbMmToIU(p.thicknessMM ?? 0), units, true, pcbIUScale),
              (aText) =>
                setP({
                  thicknessMM: pcbIuToMM(pcbMmToIU(parseUnitValue(aText, units, pcbIUScale))),
                }),
            )}
            minWidthText={NUMERIC_TEXT_CTRL}
            ariaLabel={`${l.name} thickness`}
          />
        </SizerItem>,
      );
      cells.push(
        diel ? (
          <SizerItem
            key={`${key}-lk`}
            flag={wxALIGN_CENTER_VERTICAL | wxALIGN_CENTER_HORIZONTAL}
            border={2}
          >
            <CheckBox
              label=""
              ariaLabel={`${l.name} thickness locked`}
              checked={!!p.locked}
              onChange={(b) => setP({ locked: b })}
            />
          </SizerItem>
        ) : (
          spacer(`${key}-lk`)
        ),
      );
    } else {
      cells.push(spacer(`${key}-th`));
      cells.push(spacer(`${key}-lk`));
    }

    if (sub === 0 && hasField(l.type, 'color')) {
      // createColorBox: a wxBitmapComboBox, a swatch on every entry.
      cells.push(
        <SizerItem
          key={`${key}-cl`}
          proportion={1}
          flag={wxLEFT | wxRIGHT | wxALIGN_CENTER_VERTICAL | wxEXPAND}
          border={2}
        >
          <Combo
            value={l.color || 'Not specified'}
            ariaLabel={`${l.name} color`}
            options={colorsFor(l.type).map(([name, css]) => ({
              value: name,
              label: name,
              swatch: css,
            }))}
            onChange={(c) => setLayer(i, { color: c })}
          />
        </SizerItem>,
      );
    } else cells.push(spacer(`${key}-cl`));

    for (const [k, field2] of [
      ['ep', 'epsilonR'],
      ['lt', 'lossTan'],
    ] as const) {
      if (hasField(l.type, 'eps')) {
        // UIDouble2Str
        cells.push(
          <SizerItem
            key={`${key}-${k}`}
            flag={wxLEFT | wxRIGHT | wxALIGN_CENTER_VERTICAL}
            border={2}
          >
            <TextCtrl
              {...field(`${key}-${k}`, String(p[field2] ?? ''), (aText) =>
                setP({ [field2]: num(aText) }),
              )}
              minWidthText={NUMERIC_FIELD}
              ariaLabel={`${l.name} ${field2 === 'epsilonR' ? 'epsilon R' : 'loss tangent'}`}
            />
          </SizerItem>,
        );
      } else cells.push(spacer(`${key}-${k}`));
    }

    return cells;
  };

  return (
    <>
      <PANEL_SETUP_BOARD_STACKUP_BASE
        m_choiceCopperLayers={{
          value: COPPER_LAYER_CHOICES.indexOf(String(value.copperCount)),
          onChange: (k) => setCount(Number(COPPER_LAYER_CHOICES[k])),
        }}
        m_impedanceControlled={{
          value: value.impedanceControlled,
          onChange: (b) => onChange({ ...value, impedanceControlled: b }),
        }}
        onAddDielectricLayer={onAddDielectric}
        onRemoveDielectricLayer={onRemoveDielectric}
        // onRemoveDielUI: only while some dielectric has sublayers.
        removeEnabled={removableExists}
        lockBitmap={bitmapUrl('locked')}
        rows={value.layers.flatMap((l, i) => [
          ...renderRow(l, i, 0),
          ...(l.sublayers ?? []).flatMap((_, si) => renderRow(l, i, si + 1)),
        ])}
        // m_tcCTValue->ChangeValue( m_frame->StringFromValue( thickness, true ) )
        m_tcCTValue={stringFromValue(boardThickness, units, true, pcbIUScale)}
        minWidthText={NUMERIC_TEXT_CTRL}
        onAdjustDielectricThickness={onAdjustThickness}
        onExportToClipboard={onExport}
      />

      {/* EDA_LIST_DIALOG for add/remove dielectric — the shared component, so
          this picker and the Add User Defined Layer picker are one widget. */}
      {listPick && (
        <EdaListDialog
          title={listPick.title}
          listLabel={listPick.label}
          headers={[wxGetTranslation('Layers')]}
          rows={listPick.items.map((label, idx) => ({ value: String(idx), cells: [label] }))}
          onResult={(picked) => {
            if (picked !== null) listPick.onPick(Number(picked));
            setListPick(null);
          }}
        />
      )}

      {/* DIALOG_DIELECTRIC_MATERIAL */}
      {matTarget &&
        (() => {
          const lt = matListTypeOf(value.layers[matTarget.layer]!.type);
          if (lt === null) return null;
          return (
            <DialogDielectricMaterial materialList={matLists()[lt]} onSubmit={onMaterialSubmit} />
          );
        })()}
      {adjust && (
        <WxTextEntryDialog
          caption={wxGetTranslation('Adjust Unlocked Dielectric Layers')}
          message={adjust.title}
          onCancel={() => setAdjust(null)}
          onConfirm={onAdjustEntered}
        />
      )}
    </>
  );
}
