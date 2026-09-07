// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Board Stackup > Physical Stackup. Counterpart:
 * `pcbnew/board_stackup_manager/panel_board_stackup.cpp`
 * (PANEL_SETUP_BOARD_STACKUP), the physical layer stack: a copper-layer
 * count + impedance-controlled option, a borderless 12-column grid (Layer /
 * Id / Type / Material+browse / Thickness+lock / Color / Epsilon R / Loss Tan
 * / Spec Freq / Dielectric Model) and the board thickness. All four actions
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

import { useState, type JSX } from 'react';
import {
  buildStackup,
  isThicknessEditable,
  type DielectricSublayer,
  type PhysicalStackup,
  type StackupLayer,
} from '../../board_settings.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { Combo } from '../../../../ui/Combo.js';
import { stringFromValue } from '../../../../ui/unit_binder.js';
import { EdaListDialog } from '../../../../ui/EdaListDialog.js';
import { useModalEscape } from '../../../../ui/useModalEscape.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  buildStackup,
  defaultPhysicalStackup,
  type DielectricSublayer,
  type PhysicalStackup,
  type StackupLayer,
} from '../../board_settings.js';

const COPPER_COUNTS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];

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
  // Thickness comes from the shared predicate in board_settings.ts, because the
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
  ['Core', 'Core'],
  ['Prepreg', 'PrePreg'],
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
const GBRJOB_COLORS: [string, string][] = [
  ['Not specified', 'rgb(80, 80, 80)'], // [data] wxColor(  80,  80,  80 )
  ['Green', 'rgb(60, 150, 80)'], // [data] wxColor(  60, 150,  80 )
  ['Red', 'rgb(128, 0, 0)'], // [data] wxColor( 128,   0,   0 )
  ['Blue', 'rgb(0, 0, 128)'], // [data] wxColor(   0,   0, 128 )
  ['Purple', 'rgb(80, 0, 80)'], // [data] wxColor(  80,   0,  80 )
  ['Black', 'rgb(20, 20, 20)'], // [data] wxColor(  20,  20,  20 )
  ['White', 'rgb(200, 200, 200)'], // [data] wxColor( 200, 200, 200 )
  ['Yellow', 'rgb(128, 128, 0)'], // [data] wxColor( 128, 128,   0 )
  ['User defined', 'rgb(128, 128, 128)'], // [data] wxColor( 128, 128, 128 )
];
const DIELECTRIC_COLORS: [string, string][] = [
  ['Not specified', 'rgb(80, 80, 80)'], // [data] wxColor(  80,  80,  80, 255 )
  ['FR4 natural', 'rgb(109, 116, 75)'], // [data] wxColor( 109, 116,  75, 212 )
  ['PTFE natural', 'rgb(252, 252, 250)'], // [data] wxColor( 252, 252, 250, 230 )
  ['Polyimide', 'rgb(205, 130, 0)'], // [data] wxColor( 205, 130,   0, 170 )
  ['Phenolic natural', 'rgb(92, 17, 6)'], // [data] wxColor(  92,  17,   6, 230 )
  ['Aluminum', 'rgb(213, 213, 213)'], // [data] wxColor( 213, 213, 213, 255 )
  ['User defined', 'rgb(128, 128, 128)'], // [data] wxColor( 128, 128, 128, 212 )
];
/** `GetStandardColors( aType )` — which of the two lists a row draws from. */
const colorsFor = (type: string): [string, string][] =>
  type === 'Core' || type === 'Prepreg' ? DIELECTRIC_COLORS : GBRJOB_COLORS;
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

// Predefined substrates (dielectric_material.cpp, names are used in .gbrjob
// files, so they are proper nouns and not translated).
type Substrate = { name: string; epsilonR: number; lossTan: number };
const SUBSTRATE_MATERIALS: Substrate[] = [
  { name: 'Not specified', epsilonR: 0.0, lossTan: 0.0 },
  { name: 'FR4', epsilonR: 4.5, lossTan: 0.02 },
  { name: 'FR408-HR', epsilonR: 3.69, lossTan: 0.0091 },
  { name: 'Polyimide', epsilonR: 3.2, lossTan: 0.004 },
  { name: 'Kapton', epsilonR: 3.2, lossTan: 0.004 },
  { name: 'Polyolefin', epsilonR: 1.0, lossTan: 0.0 },
  { name: 'Al', epsilonR: 8.7, lossTan: 0.001 },
  { name: 'PTFE', epsilonR: 2.1, lossTan: 0.0002 },
  { name: 'Teflon', epsilonR: 2.1, lossTan: 0.0002 },
  { name: 'Ceramic', epsilonR: 1.0, lossTan: 0.0 },
];
const SOLDERMASK_MATERIALS: Substrate[] = [
  { name: 'Not specified', epsilonR: 3.3, lossTan: 0.0 },
  { name: 'Epoxy', epsilonR: 3.3, lossTan: 0.0 },
  { name: 'Liquid Ink', epsilonR: 3.3, lossTan: 0.0 },
  { name: 'Dry Film', epsilonR: 3.3, lossTan: 0.0 },
];
const SILKSCREEN_MATERIALS: Substrate[] = [
  { name: 'Not specified', epsilonR: 1.0, lossTan: 0.0 },
  { name: 'Liquid Photo', epsilonR: 1.0, lossTan: 0.0 },
  { name: 'Direct Printing', epsilonR: 1.0, lossTan: 0.0 },
];
const materialsFor = (type: string): Substrate[] => {
  if (type.includes('Solder Mask')) return SOLDERMASK_MATERIALS;
  if (type.includes('Silk Screen')) return SILKSCREEN_MATERIALS;
  return SUBSTRATE_MATERIALS;
};

/** Display stackup name -> canonical board layer name (report/file). */
const CANONICAL: Record<string, string> = {
  'F.Silkscreen': 'F.SilkS',
  'B.Silkscreen': 'B.SilkS',
};
/** Display type -> the file/report type string (GetTypeName). */
const TYPE_NAME: Record<string, string> = { Copper: 'copper', Core: 'core', Prepreg: 'prepreg' };

const trimNum = (v: number): string => {
  let s = v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
};

/** BuildStackupReport (board_stackup_reporter.cpp): the clipboard text. */
export function buildStackupReport(
  stackup: PhysicalStackup,
  finish: { copperFinish: string; platedBoardEdge: boolean; edgeCardConnectors: string },
): string {
  let report = '';
  stackup.layers.forEach((l, i) => {
    const typeName = TYPE_NAME[l.type] ?? l.type;
    const subCount = 1 + (l.sublayers?.length ?? 0);
    if (isDielectric(l)) {
      // Dielectric ids restart at 1 in stackup order.
      const dielId = stackup.layers.slice(0, i + 1).filter((x) => isDielectric(x)).length;
      report += `layer "Dielectric ${dielId}" type "${typeName}"\n  sublayer "1/${subCount}"`;
    } else {
      report += `layer "${CANONICAL[l.name] ?? l.name}" type "${typeName}"`;
    }
    if (hasField(l.type, 'color')) report += ` Color "${l.color || 'Not specified'}"`;
    const subs: {
      thicknessMM: number;
      locked?: boolean;
      material: string;
      epsilonR?: number;
      lossTan?: number;
    }[] = [l, ...(l.sublayers ?? [])];
    subs.forEach((p, idx) => {
      if (idx) report += `\n  sublayer "${idx + 1}/${subCount}"`;
      if (hasField(l.type, 'thick')) {
        report += ` Thickness ${trimNum(p.thicknessMM)} mm`;
        if (isDielectric(l) && p.locked) report += ' Locked';
      }
      if (hasField(l.type, 'mat')) report += ` Material "${p.material}"`;
      if (p.epsilonR !== undefined) report += ` EpsilonR ${trimNum(p.epsilonR)}`;
      if (p.lossTan !== undefined) report += ` LossTg ${trimNum(p.lossTan)}`;
    });
    report += '\n';
  });
  report += `Finish "${finish.copperFinish}"`;
  if (stackup.impedanceControlled) report += ' Option "Impedance Controlled"';
  if (finish.platedBoardEdge) report += ' Option "Plated edges"';
  if (finish.edgeCardConnectors !== 'None') {
    report += ` EdgeConnector "${finish.edgeCardConnectors === 'Yes, bevelled' ? 'yes,bevelled' : 'yes'}"`;
  }
  report += '\n';
  return report;
}

interface Props {
  value: PhysicalStackup;
  onChange: (next: PhysicalStackup) => void;
  /** Board finish values for the clipboard report (the sibling page's data). */
  finish?: { copperFinish: string; platedBoardEdge: boolean; edgeCardConnectors: string };
}

// KiCad's 12-column wxFlexGridSizer (borderless form; Material has a browse
// button in its own column). Content-sized columns, no cell borders/gridlines.
const HEADERS = [
  'Layer',
  'Id',
  'Type',
  'Material',
  '',
  'Thickness',
  '',
  'Color',
  'Epsilon R',
  'Loss Tan',
  'Spec Freq',
  'Dielectric Model',
];
const GRID_COLS = '40px 96px 138px 118px 26px 84px 26px 150px 64px 64px 80px 120px';
/** A picked material-browse / add / remove target. */
type MaterialTarget = { layer: number; sub: number }; // sub 0 = main
type ListPick = { title: string; label: string; items: string[]; onPick: (index: number) => void };

export function PanelPcbStackup({ value, onChange, finish }: Props): JSX.Element {
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const setLayer = (i: number, patch: Partial<StackupLayer>): void =>
    onChange({ ...value, layers: value.layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setSub = (i: number, si: number, patch: Partial<DielectricSublayer>): void => {
    const l = value.layers[i]!;
    const sublayers = (l.sublayers ?? []).map((s, j) => (j === si ? { ...s, ...patch } : s));
    setLayer(i, { sublayers });
  };
  const setCount = (copperCount: number): void =>
    onChange({ ...value, copperCount, layers: buildStackup(copperCount) });

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
  const [matDraft, setMatDraft] = useState<Substrate>({ name: '', epsilonR: 0, lossTan: 0 });

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts. Registered only while the material dialog is up, so it
  // does not take the key meant for the Board Setup dialog behind it. The
  // dielectric picker is an `EdaListDialog`, which asks for itself.
  useModalEscape(() => setMatTarget(null), matTarget !== null);

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
      title: 'Add Dielectric Layer',
      label: 'Select layer to add:',
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
      title: 'Remove Dielectric Layer',
      label: 'Select layer to remove:',
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
    const title =
      minThickness === 0
        ? 'Enter board thickness in mm:'
        : `Enter expected board thickness (min value ${trimNum(minThickness)} mm):`;
    const answer = window.prompt(`Adjust Unlocked Dielectric Layers\n\n${title}`);
    if (answer === null) return;
    const target = Number(answer);
    if (!Number.isFinite(target)) return;
    if (target < minThickness) {
      window.alert(`Value too small (min value ${trimNum(minThickness)} mm).`);
      return;
    }
    if (candidates === 0) {
      window.alert('All dielectric  thickness layers are locked');
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
        type: currentIsCore ? 'Core' : 'Prepreg',
        thicknessMM: round(currentIsCore ? core : prePreg),
      };
      currentIsCore = !currentIsCore;
      return next;
    });
    onChange({ ...value, layers });
  };

  // onExportToClipboard: the ASCII stackup report.
  const onExport = (): void => {
    const report = buildStackupReport(
      value,
      finish ?? { copperFinish: 'None', platedBoardEdge: false, edgeCardConnectors: 'None' },
    );
    void navigator.clipboard?.writeText(report);
  };

  // Material browse (DIALOG_DIELECTRIC_MATERIAL).
  const openMaterial = (layer: number, sub: number): void => {
    const l = value.layers[layer]!;
    const p = sub === 0 ? l : l.sublayers![sub - 1]!;
    setMatDraft({
      name: p.material || 'Not specified',
      epsilonR: p.epsilonR ?? 0,
      lossTan: p.lossTan ?? 0,
    });
    setMatTarget({ layer, sub });
  };
  const commitMaterial = (): void => {
    if (!matTarget) return;
    const l = value.layers[matTarget.layer]!;
    const patch = {
      material: matDraft.name,
      // Silk rows carry no epsilon field in the grid, but the value still
      // rides along in the model, like the C++ item.
      epsilonR: matDraft.epsilonR,
      lossTan: matDraft.lossTan,
    };
    if (matTarget.sub === 0) setLayer(matTarget.layer, patch);
    else setSub(matTarget.layer, matTarget.sub - 1, patch);
    setMatTarget(null);
  };
  const matType = matTarget ? value.layers[matTarget.layer]!.type : '';

  const txt = (
    v: string | number | undefined,
    onText: (s: string) => void,
    numeric: boolean,
  ): JSX.Element => (
    <input
      className="ze-search"
      type="text"
      style={{ width: '100%', boxSizing: 'border-box' }}
      value={v ?? ''}
      onChange={(e) => onText(e.target.value)}
      data-numeric={numeric || undefined}
    />
  );
  const blank = <span />;

  // One grid row (12 cells) for a main layer or a dielectric sublayer.
  const renderRow = (l: StackupLayer, i: number, sub: number): JSX.Element[] => {
    const diel = isDielectric(l);
    const p = sub === 0 ? l : l.sublayers![sub - 1]!;
    const key = `${i}.${sub}`;
    const setP = (patch: Record<string, unknown>): void => {
      if (sub === 0) setLayer(i, patch as Partial<StackupLayer>);
      else setSub(i, sub - 1, patch as Partial<DielectricSublayer>);
    };
    return [
      // Layer: colour swatch (main rows only)
      <div key={`${key}-sw`} className="ze-stackup-swcell">
        {/* `lazyBuildRowUI` inserts a wxStaticBitmap for EVERY row
            (`panel_board_stackup.cpp:807-810`) and `updateIconColor` fills it
            with a `m_colorIconsSize.x` x `m_colorIconsSize.y / 2` bitmap —
            24 x 7, a bar, not the 14 x 14 square the Color combo uses. */}
        <span className="ze-stackup-swatch" style={{ background: iconColorOf(l) }} />
      </div>,
      // Id: name; sublayers show their "i/n" ordinal, like the C++ rows.
      <div key={`${key}-id`} style={sub ? { paddingLeft: 12 } : undefined}>
        {sub === 0 ? l.name : `sublayer ${sub + 1}/${subCountOf(l)}`}
      </div>,
      // Type. A dielectric's main row is a `wxChoice` of Core / Prepreg — the
      // one editable Type cell on the page; its sublayers get `addSpacer()` and
      // every other layer a `wxStaticText` (`panel_board_stackup.cpp:828-861`).
      // This drew all of them as text, so Core/Prepreg could not be changed.
      <div key={`${key}-ty`}>
        {sub !== 0 ? (
          blank
        ) : diel ? (
          <Combo
            value={l.type}
            ariaLabel={`${l.name} type`}
            options={DIELECTRIC_TYPES.map(([v, label]) => ({ value: v, label }))}
            onChange={(t) => setLayer(i, { type: t })}
          />
        ) : (
          l.type
        )}
      </div>,
      // Material
      <div key={`${key}-mat`}>
        {hasField(l.type, 'mat') ? txt(p.material, (s) => setP({ material: s }), false) : blank}
      </div>,
      // Material browse button
      <div key={`${key}-matb`}>
        {hasField(l.type, 'mat') ? (
          <button
            className="ze-gridbtn"
            style={{ width: 24, height: 24 }}
            title="Select material"
            onClick={() => openMaterial(i, sub)}
          >
            ...
          </button>
        ) : (
          blank
        )}
      </div>,
      // Thickness
      <div key={`${key}-th`}>
        {hasField(l.type, 'thick')
          ? txt(p.thicknessMM, (s) => setP({ thicknessMM: num(s) }), true)
          : blank}
      </div>,
      // Lock (dielectric main + sublayers)
      <div key={`${key}-lk`} style={{ textAlign: 'center' }}>
        {diel ? (
          <input
            type="checkbox"
            title="Locked thickness"
            checked={!!p.locked}
            onChange={(e) => setP({ locked: e.target.checked })}
          />
        ) : (
          blank
        )}
      </div>,
      // Color (main rows only)
      <div key={`${key}-cl`}>
        {sub === 0 && hasField(l.type, 'color') ? (
          // A `wxBitmapComboBox`: every entry carries its own colour swatch,
          // which is exactly `ComboOption.swatch`.
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
        ) : (
          blank
        )}
      </div>,
      // Epsilon R
      <div key={`${key}-ep`}>
        {hasField(l.type, 'eps') ? txt(p.epsilonR, (s) => setP({ epsilonR: num(s) }), true) : blank}
      </div>,
      // Loss Tan
      <div key={`${key}-lt`}>
        {hasField(l.type, 'eps') ? txt(p.lossTan, (s) => setP({ lossTan: num(s) }), true) : blank}
      </div>,
      // Spec Freq (main dielectric rows only)
      <div key={`${key}-sf`}>
        {diel && sub === 0 ? txt(l.specFreq, (s) => setLayer(i, { specFreq: s }), false) : blank}
      </div>,
      // Dielectric Model (main dielectric rows only)
      <div key={`${key}-dm`}>{diel && sub === 0 ? l.dielectricModel : blank}</div>,
    ];
  };

  return (
    <div className="ze-stackup">
      {/* Top options */}
      <div className="ze-stackup-bar">
        <span>Copper layers:</span>
        <Combo
          value={String(value.copperCount)}
          ariaLabel="Copper layers"
          options={COPPER_COUNTS.map((c) => ({ value: String(c), label: String(c) }))}
          onChange={(c) => setCount(Number(c))}
        />
        {/* `bTopSizer->Add( 40, 0, 1, wxEXPAND, 5 )` appears TWICE — once before
            the checkbox and once after (`panel_board_stackup_base.cpp:37`,
            `:46`). Only the second one was here, so the checkbox sat against
            the copper-layers choice instead of centred between the two. */}
        <span className="ze-stackup-spacer" />
        <label className="ze-pref-check">
          <input
            type="checkbox"
            checked={value.impedanceControlled}
            onChange={(e) => onChange({ ...value, impedanceControlled: e.target.checked })}
          />
          Impedance controlled
        </label>
        <span className="ze-stackup-spacer" />
        <button className="ze-btn" onClick={onAddDielectric}>
          Add Dielectric Layer...
        </button>
        <button className="ze-btn" disabled={!removableExists} onClick={onRemoveDielectric}>
          Remove Dielectric Layer...
        </button>
      </div>

      {/* Stackup grid: borderless flexgrid (no table/cell borders), like KiCad. */}
      <div className="ze-stackup-scroll">
        <div className="ze-stackup-grid" style={{ gridTemplateColumns: GRID_COLS }}>
          {/* Header row */}
          {HEADERS.map((h, i) => (
            <div key={`h${i}`} className="ze-stackup-head">
              {h}
            </div>
          ))}

          {/* Layer rows + dielectric sublayer rows */}
          {value.layers.flatMap((l, i) => [
            ...renderRow(l, i, 0),
            ...(l.sublayers ?? []).flatMap((_, si) => renderRow(l, i, si + 1)),
          ])}
        </div>
      </div>

      {/* Bottom: board thickness + actions */}
      <div className="ze-stackup-bar">
        <span>Board thickness from stackup:</span>
        {/* `m_tcCTValue->ChangeValue( m_frame->StringFromValue( thickness, true ) )`
            (`panel_board_stackup.cpp:590-594`) — the unit is IN the field, so
            there is no separate label beside it, and the value is trimmed of
            trailing zeros rather than fixed at three decimals ("1.6 mm", not
            "1.620"). It is `wxTE_READONLY`. */}
        <input
          className="ze-search ze-stackup-thickness"
          aria-label="Board thickness from stackup"
          value={stringFromValue(boardThickness, 'mm', true, pcbIUScale)}
          readOnly
        />
        {/* `bBottomSizer->Add( 10, 0, 0, wxEXPAND )` — a FIXED 10px gap, then
            Adjust; the growable spacer comes after it, which is what puts
            Export hard right and Adjust beside the field (`:139-148`). This had
            the growable spacer first, so both buttons bunched on the right. */}
        <span className="ze-stackup-gap10" />
        <button className="ze-btn" onClick={onAdjustThickness}>
          Adjust Dielectric Thickness
        </button>
        <span className="ze-stackup-spacer" />
        <button className="ze-btn" onClick={onExport}>
          Export to Clipboard
        </button>
      </div>

      {/* EDA_LIST_DIALOG for add/remove dielectric — the shared component, so
          this picker and the Add User Defined Layer picker are one widget. */}
      {listPick && (
        <EdaListDialog
          title={listPick.title}
          listLabel={listPick.label}
          headers={['Layers']}
          rows={listPick.items.map((label, idx) => ({ value: String(idx), cells: [label] }))}
          onResult={(picked) => {
            if (picked !== null) listPick.onPick(Number(picked));
            setListPick(null);
          }}
        />
      )}

      {/* DIALOG_DIELECTRIC_MATERIAL */}
      {matTarget && (
        <div
          className="ze-modal-backdrop"
          onMouseDown={() => setMatTarget(null)}
          style={{ zIndex: 60 }}
        >
          <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Dielectric Material Characteristics
              <span className="x" title="Close" onClick={() => setMatTarget(null)}>
                ✕
              </span>
            </div>
            <div className="ze-modal-body ze-dielmat-body">
              <div className="ze-dielmat-grid">
                <span>Material:</span>
                <input
                  className="ze-search"
                  value={matDraft.name}
                  onChange={(e) => setMatDraft({ ...matDraft, name: e.target.value })}
                />
                <span>Epsilon R:</span>
                <input
                  className="ze-search"
                  value={matDraft.epsilonR}
                  onChange={(e) => setMatDraft({ ...matDraft, epsilonR: num(e.target.value) })}
                />
                <span>Loss Tan:</span>
                <input
                  className="ze-search"
                  value={matDraft.lossTan}
                  onChange={(e) => setMatDraft({ ...matDraft, lossTan: num(e.target.value) })}
                />
              </div>
              <div className="ze-grid-pane ze-dielmat-list">
                <table className="ze-grid">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Epsilon R</th>
                      <th>Loss Tan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materialsFor(matType).map((m) => (
                      <tr
                        key={m.name}
                        className={m.name === matDraft.name ? 'selected' : undefined}
                        onClick={() => setMatDraft({ ...m })}
                        onDoubleClick={() => {
                          setMatDraft({ ...m });
                          commitMaterial();
                        }}
                      >
                        <td>{m.name}</td>
                        <td>{trimNum(m.epsilonR)}</td>
                        <td>{trimNum(m.lossTan)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setMatTarget(null)}>
                Cancel
              </button>
              <button className="ze-btn primary" onClick={commitMaterial}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
