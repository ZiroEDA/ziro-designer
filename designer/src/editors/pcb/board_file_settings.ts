// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board-file persistence for the Board Setup dialog, the `.kicad_pcb` side.
 * Counterparts: `pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.cpp`
 * (formatGeneral / formatBoardLayers / formatSetup) with its parser, and
 * `pcbnew/board_stackup_manager/board_stackup.cpp` (FormatBoardStackup).
 *
 * The dialog owns these board-file sections: `(general (thickness …))`, the
 * `(layers …)` table, and inside `(setup …)` the `(stackup …)` block, the
 * solder-mask/paste clearances, the tenting flags and the two
 * `dashed_line_*_ratio` tokens of `(pcbplotparams …)` (pcbnew's Formatting
 * page stores its ratios in the plot params, everything else in that block
 * belongs to the Plot dialog and is preserved verbatim). At the file end it
 * owns `(embedded_fonts …)` and the `(embedded_files …)` list.
 *
 * `applyBoardFileSetup` hydrates those slices into a BoardSetupValues;
 * `writeBoardFileSetup` patches them back into the board text, leaving every
 * other node untouched (the same patch-in-place philosophy as
 * pcbnew/src/write-board.ts). Gotchas mirrored from the KiCad writer:
 * `solder_mask_min_width` / `pad_to_paste_clearance*` are omitted when 0,
 * `edge_plating` is only ever written as `yes`, tech layers carry the literal
 * `user` qualifier, dielectric stackup rows are named `"dielectric N"`, and
 * the `locked` / `addsublayer` sub-tokens are bare atoms. Dielectric
 * sublayers round-trip: each bare `addsublayer` atom starts the next
 * sublayer's thickness/material/epsilon/loss property group.
 */

import {
  atom,
  isList,
  head,
  list,
  parse,
  serialize,
  str,
  type SList,
  type SNode,
} from '@ziroeda/sexpr';
import { childNamed, childrenNamed } from '@ziroeda/sexpr/src/query.js';
import {
  LSET_Name,
  LSET_NameToLayer,
  TECH_AND_USER_UI_ORDER,
  UNDEFINED_LAYER,
} from '@ziroeda/pcbnew/src/layer_ids.js';
import {
  buildStackup,
  copperStackNames,
  isThicknessEditable,
  MANDATORY_LAYERS,
  type BoardLayer,
  type BoardSetupValues,
  type DielectricSublayer,
  type StackupLayer,
  type ZoneLayerPropertiesMap,
} from './board_settings.js';

// ---------------------------------------------------------------------------
// Layer tables (include/layer_ids.h + common/lset.cpp).

/**
 * Canonical name -> ordinal for the fixed non-copper layers. Derived from
 * `TECH_AND_USER_UI_ORDER`, which is the same eighteen layers: the ordinal IS
 * the `PCB_LAYER_ID`, so re-typing the numbers here only created a second
 * place for them to drift from `pcbnew/src/layer_ids.ts`.
 */
const TECH_ORDINALS: Record<string, number> = Object.fromEntries(
  TECH_AND_USER_UI_ORDER.map((id) => [LSET_Name(id), id]),
);

/** The fixed tech/user write order (LSET::TechAndUserUIOrder, lset.cpp). */
const TECH_WRITE_ORDER = TECH_AND_USER_UI_ORDER.map(LSET_Name);

/**
 * A user-defined layer's qualifier as `LAYER::ParseType()` reads it
 * (`board.cpp:840-858`). Only `front` and `back` are ever written for one;
 * everything else — `user` included — is LT_AUX.
 */
function parseUserLayerType(aToken: string | undefined): 'aux' | 'front' | 'back' {
  return aToken === 'front' ? 'front' : aToken === 'back' ? 'back' : 'aux';
}

function copperOrdinal(id: string): number | undefined {
  if (id === 'F.Cu') return 0;
  if (id === 'B.Cu') return 2;
  const m = /^In(\d+)\.Cu$/.exec(id);
  if (m) return 2 + 2 * Number(m[1]);
  return undefined;
}

/**
 * Canonical layer name -> ordinal. This is `LSET::NameToLayer` with upstream's
 * -1 turned into `undefined`, which is the shape this file's callers want; the
 * table itself lives in `pcbnew/src/layer_ids.ts` beside `LSET_Name`, so the
 * two directions are one table read each way. Three private copies of the
 * `User.N` / `In%d.Cu` arithmetic used to live here and in the widgets.
 */
function layerOrdinal(id: string): number | undefined {
  const layer = LSET_NameToLayer(id);
  return layer === UNDEFINED_LAYER ? undefined : layer;
}

/** Stackup display name (panel) <-> canonical board-layer name (file). */
const STACKUP_FILE_NAMES: Record<string, string> = {
  'F.Silkscreen': 'F.SilkS',
  'B.Silkscreen': 'B.SilkS',
};
const STACKUP_DISPLAY_NAMES: Record<string, string> = {
  'F.SilkS': 'F.Silkscreen',
  'B.SilkS': 'B.Silkscreen',
};

/** Panel stackup type <-> file type string (stackup_predefined_prms.h keys;
 *  silk/mask/paste use the full display names). */
const STACKUP_TYPE_TO_FILE: Record<string, string> = {
  Copper: 'copper',
  Core: 'core',
  Prepreg: 'prepreg',
};
const STACKUP_TYPE_FROM_FILE: Record<string, string> = {
  copper: 'Copper',
  core: 'Core',
  prepreg: 'Prepreg',
};

// ---------------------------------------------------------------------------
// Formatting helpers (pcb_io_kicad_sexpr.cpp formatInternalUnits shape).

/** mm double -> trimmed string, like write-board.ts / FormatInternalUnits. */
function mm(v: number): string {
  let s = v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

const yesNo = (b: boolean): string => (b ? 'yes' : 'no');

function numArgOf(node: SList | undefined, dflt: number): number {
  const a = node?.items[1];
  const v = a && a.kind !== 'list' ? Number(a.value) : NaN;
  return Number.isFinite(v) ? v : dflt;
}

/** The n-th positional argument of a node, as a number. `(xy X Y)` needs two. */
function numArgAt(node: SList | undefined, index: number, dflt: number): number {
  const a = node?.items[index];
  const v = a && a.kind !== 'list' ? Number(a.value) : Number.NaN;
  return Number.isFinite(v) ? v : dflt;
}

function strArgOf(node: SList | undefined): string | undefined {
  const a = node?.items[1];
  return a && a.kind !== 'list' ? a.value : undefined;
}

function boolArgOf(node: SList | undefined, dflt: boolean): boolean {
  const v = strArgOf(node);
  return v === 'yes' || v === 'true' ? true : v === 'no' || v === 'false' ? false : dflt;
}

// ---------------------------------------------------------------------------
// Read.

/** Hydrate the `.kicad_pcb`-owned slices of `s` from the board text. Returns
 *  false when the text cannot be parsed (slices keep their prior values). */
export function applyBoardFileSetup(pcbText: string, s: BoardSetupValues): boolean {
  let root: SList;
  try {
    root = parse(pcbText);
  } catch {
    return false;
  }
  if (head(root) !== 'kicad_pcb') return false;

  // ----- (layers …): enabled set, user names, copper types.
  const layersNode = childNamed(root, 'layers');
  if (layersNode) {
    const copperRows: BoardLayer[] = [];
    const byId = new Map<string, { name: string; type: string }>();
    for (const child of layersNode.items.slice(1)) {
      if (!isList(child)) continue;
      const [, canon, type, userName] = child.items;
      if (!canon || canon.kind === 'list') continue;
      const id = canon.value;
      const typeStr = type && type.kind !== 'list' ? type.value : 'user';
      const nameStr = userName && userName.kind !== 'list' ? userName.value : id;
      if (copperOrdinal(id) !== undefined) {
        copperRows.push({
          id,
          name: nameStr,
          enabled: true,
          kind: 'copper',
          copperType:
            (['signal', 'power', 'mixed', 'jumper'] as const).find((t) => t === typeStr) ??
            'signal',
        });
      } else {
        byId.set(id, { name: nameStr, type: typeStr });
      }
    }
    if (copperRows.length >= 2) {
      // Rebuild the panel's physical-order list around the file's copper stack.
      const next: BoardLayer[] = [];
      for (const dflt of s.layers.layers) {
        if (dflt.kind === 'copper') continue; // replaced by the file's stack
        const inFile = byId.get(dflt.id);
        // A User.N only exists as a row while it is enabled —
        // `initialize_layers_controls()` appends rows for
        // `m_enabledLayers & LSET::UserDefinedLayersMask()` and no others, which
        // is the whole reason "Add User Defined Layer..." exists. Carrying the
        // default four through as unchecked rows would show four User layers on
        // a board that has none.
        if (dflt.kind === 'user' && inFile === undefined) continue;
        next.push({
          ...dflt,
          // A default User.N row still takes its type from the file, or the
          // `front`/`back` qualifier would be dropped for exactly the four
          // layers a new board ships with.
          ...(dflt.kind === 'user' ? { userType: parseUserLayerType(inFile?.type) } : {}),
          // `BOARD_DESIGN_SETTINGS::SetEnabledLayers` (`:1632-1641`) forces the
          // mandatory set on "regardless of board file configuration", so a
          // board whose `(layers …)` omits Margin still has Margin. Without
          // this they came back unchecked, and the checkbox that would put them
          // back is disabled — `mandatoryLayerCbSetup()` — so nothing could.
          enabled: inFile !== undefined || MANDATORY_LAYERS.has(dflt.id),
          name: inFile?.name ?? dflt.name,
        });
        byId.delete(dflt.id);
      }
      // Splice the copper stack after the front tech block (…, F.Mask, [Cu]).
      const frontEnd = next.findIndex((l) => l.id === 'B.Mask');
      next.splice(frontEnd === -1 ? next.length : frontEnd, 0, ...copperRows);
      // Any remaining ids are user-defined layers (User.N). Their qualifier is
      // `LAYER::ParseType()` (`board.cpp:840-858`): only `front` and `back` are
      // ever written for one, and everything else — `user` included — is LT_AUX.
      for (const [id, info] of byId) {
        if (layerOrdinal(id) !== undefined)
          next.push({
            id,
            name: info.name,
            enabled: true,
            kind: 'user',
            userType: parseUserLayerType(info.type),
          });
      }
      s.layers.layers = next;
      s.physicalStackup.copperCount = copperRows.length;
    }
  }

  const setup = childNamed(root, 'setup');
  if (setup) {
    // ----- (zone_defaults …): per-layer zone hatched-fill offsets.
    // `parseZoneLayerProperties` (`pcb_io_kicad_sexpr_parser.cpp:2940-2970`):
    // each `(property …)` carries a `(layer …)` and, optionally, a
    // `(hatch_position (xy X Y))`. A property with no hatch_position leaves the
    // offset unset, which is what keeps it out of the file again on write.
    const zoneDefaults = childNamed(setup, 'zone_defaults');
    if (zoneDefaults) {
      const map: ZoneLayerPropertiesMap = {};
      for (const prop of childrenNamed(zoneDefaults, 'property')) {
        const layer = strArgOf(childNamed(prop, 'layer'));
        if (layer === undefined) continue;
        const hatch = childNamed(prop, 'hatch_position');
        const xy = hatch ? childNamed(hatch, 'xy') : undefined;
        map[layer] = xy ? { hatchingOffset: { x: numArgOf(xy, 0), y: numArgAt(xy, 2, 0) } } : {};
      }
      s.zoneLayerProperties = map;
    }

    // ----- (stackup …).
    const stackup = childNamed(setup, 'stackup');
    if (stackup) {
      const rows: StackupLayer[] = [];
      for (const child of childrenNamed(stackup, 'layer')) {
        const nameNode = child.items[1];
        if (!nameNode || nameNode.kind === 'list') continue;
        const fileName = nameNode.value;
        const dielMatch = /^dielectric (\d+)$/.exec(fileName);
        const row: StackupLayer = {
          name: dielMatch
            ? `Dielectric ${dielMatch[1]}`
            : (STACKUP_DISPLAY_NAMES[fileName] ?? fileName),
          type: '',
          material: 'Not specified',
          thicknessMM: 0,
          color: '',
        };
        // Sequential walk: the bare `addsublayer` atom starts the next
        // dielectric sublayer's property group (parseBoardStackup's
        // T_addsublayer); type/color/spec-frequency stay on the main layer.
        const subs: DielectricSublayer[] = [];
        let sub: DielectricSublayer | null = null;
        const applyThickness = (node: SList): void => {
          const mmVal = numArgOf(node, 0);
          const locked = node.items.some((n) => n.kind === 'atom' && n.value === 'locked');
          if (sub) {
            sub.thicknessMM = mmVal;
            if (locked) sub.locked = true;
          } else {
            row.thicknessMM = mmVal;
            if (locked) row.locked = true;
          }
        };
        for (const item of child.items.slice(2)) {
          if (item.kind === 'atom' && item.value === 'addsublayer') {
            sub = { material: '', thicknessMM: 0 };
            subs.push(sub);
            continue;
          }
          if (!isList(item)) continue;
          switch (head(item)) {
            case 'type': {
              const typeRaw = strArgOf(item) ?? '';
              row.type = STACKUP_TYPE_FROM_FILE[typeRaw] ?? typeRaw;
              break;
            }
            case 'color':
              row.color = strArgOf(item) ?? '';
              break;
            case 'thickness':
              applyThickness(item);
              break;
            case 'material': {
              const m = strArgOf(item) ?? '';
              if (sub) sub.material = m;
              else row.material = m;
              break;
            }
            case 'epsilon_r': {
              const v = numArgOf(item, 0);
              if (sub) sub.epsilonR = v;
              else row.epsilonR = v;
              break;
            }
            case 'loss_tangent': {
              const v = numArgOf(item, 0);
              if (sub) sub.lossTan = v;
              else row.lossTan = v;
              break;
            }
            case 'spec_frequency':
              row.specFreq = String(numArgOf(item, 0));
              break;
            case 'dielectric_model': {
              const model = strArgOf(item);
              if (model)
                row.dielectricModel = model === 'djordjevic_sarkar' ? 'Wideband' : 'Constant';
              break;
            }
            default:
              break; // unknown tokens are skipped, like parseBoardStackup
          }
        }
        if (subs.length) row.sublayers = subs;
        rows.push(row);
      }
      if (rows.length) s.physicalStackup.layers = rows;
      s.physicalStackup.impedanceControlled = boolArgOf(
        childNamed(stackup, 'dielectric_constraints'),
        s.physicalStackup.impedanceControlled,
      );
      s.boardFinish.copperFinish =
        strArgOf(childNamed(stackup, 'copper_finish')) ?? 'Not specified';
      const edge = strArgOf(childNamed(stackup, 'edge_connector'));
      s.boardFinish.edgeCardConnectors =
        edge === 'bevelled' ? 'Yes, bevelled' : edge === 'yes' ? 'Yes' : 'None';
      s.boardFinish.platedBoardEdge = boolArgOf(childNamed(stackup, 'edge_plating'), false);
    }

    // ----- mask/paste clearances. A missing solder_mask_min_width means 0
    // (the writer omits zero), same for the paste clearances.
    s.maskPaste.maskExpansionMM = numArgOf(childNamed(setup, 'pad_to_mask_clearance'), 0);
    s.maskPaste.maskMinWebMM = numArgOf(childNamed(setup, 'solder_mask_min_width'), 0);
    s.maskPaste.pasteClearanceMM = numArgOf(childNamed(setup, 'pad_to_paste_clearance'), 0);
    s.maskPaste.pasteRelativePct =
      numArgOf(childNamed(setup, 'pad_to_paste_clearance_ratio'), 0) * 100;
    s.maskPaste.allowBridged = boolArgOf(
      childNamed(setup, 'allow_soldermask_bridges_in_footprints'),
      false,
    );
    const tenting = childNamed(setup, 'tenting');
    if (tenting) {
      const front = childNamed(tenting, 'front');
      const back = childNamed(tenting, 'back');
      if (front || back) {
        s.maskPaste.tentFront = boolArgOf(front, true);
        s.maskPaste.tentBack = boolArgOf(back, true);
      } else {
        // Legacy flat list: (tenting front back) / (tenting none).
        const flags = tenting.items.slice(1).map((n) => (n.kind !== 'list' ? n.value : ''));
        s.maskPaste.tentFront = flags.includes('front');
        s.maskPaste.tentBack = flags.includes('back');
      }
    }

    // ----- pcbplotparams: the two dashed-line ratios (Formatting page).
    const plot = childNamed(setup, 'pcbplotparams');
    if (plot) {
      s.formatting.dashLengthRatio = numArgOf(childNamed(plot, 'dashed_line_dash_ratio'), 12);
      s.formatting.gapLengthRatio = numArgOf(childNamed(plot, 'dashed_line_gap_ratio'), 3);
    }
  }

  // No stackup block anywhere: KiCad builds a default stack for the enabled
  // copper count (pcb_io_kicad_sexpr_parser.cpp:3080).
  if (!setup || !childNamed(setup, 'stackup'))
    s.physicalStackup.layers = buildStackup(s.physicalStackup.copperCount);

  // ----- embedded fonts / files.
  s.embeddedFiles.embedFonts = boolArgOf(childNamed(root, 'embedded_fonts'), false);
  const embedded = childNamed(root, 'embedded_files');
  if (embedded) {
    s.embeddedFiles.files = childrenNamed(embedded, 'file').flatMap((f) => {
      const name = strArgOf(childNamed(f, 'name'));
      return name ? [{ name, reference: `kicad-embed://${name}` }] : [];
    });
  } else {
    s.embeddedFiles.files = [];
  }

  return true;
}

// ---------------------------------------------------------------------------
// Write.

function buildLayerEntries(s: BoardSetupValues): SList[] {
  const rows = s.layers.layers;
  const entry = (id: string, type: string, name: string): SList => {
    const items: SNode[] = [atom(String(layerOrdinal(id) ?? 0)), str(id), atom(type)];
    if (name && name !== id) items.push(str(name));
    return { kind: 'list', items };
  };

  const out: SList[] = [];
  // Copper stack front->back; the stackup page's copper count is the source of
  // truth for how many exist (KiCad syncs the layers page the same way).
  // The one copper-stack list, from board_settings.ts — this had its own copy.
  for (const id of copperStackNames(s.physicalStackup.copperCount)) {
    const row = rows.find((l) => l.id === id);
    out.push(entry(id, row?.copperType ?? 'signal', row?.name ?? id));
  }
  // Tech + user layers in the fixed UI order, enabled only. The qualifier is
  // the literal "user" unless the layer is a User.N whose type is LT_FRONT or
  // LT_BACK — `print_type` is false for everything else, so an LT_AUX user
  // layer writes as "user" too (`pcb_io_kicad_sexpr.cpp:680-697`).
  const techRows = [
    ...TECH_WRITE_ORDER.map((id) => rows.find((l) => l.id === id)),
    ...rows.filter((l) => /^User\.\d+$/.test(l.id)),
  ];
  for (const row of techRows) {
    if (!row?.enabled) continue;
    const type = row.userType === 'front' || row.userType === 'back' ? row.userType : 'user';
    out.push(entry(row.id, type, row.name));
  }
  return out;
}

function buildStackupNode(s: BoardSetupValues): SList {
  const items: SNode[] = [atom('stackup')];
  let dielIdx = 0;
  for (const layer of s.physicalStackup.layers) {
    const isDielectric = layer.type === 'Core' || layer.type === 'Prepreg';
    const fileName = isDielectric
      ? `dielectric ${++dielIdx}`
      : (STACKUP_FILE_NAMES[layer.name] ?? layer.name);
    const fileType = STACKUP_TYPE_TO_FILE[layer.type] ?? layer.type;
    const entry: SNode[] = [atom('layer'), str(fileName), list(atom('type'), str(fileType))];
    if (layer.color && layer.color !== 'Not specified')
      entry.push(list(atom('color'), str(layer.color)));
    const isPaste = layer.type.includes('Solder Paste');
    // One property group per sublayer (FormatBoardStackup's sublayer loop);
    // sublayers past the first are introduced by the bare `addsublayer` atom.
    const pushSublayer = (
      p: {
        material: string;
        thicknessMM: number;
        epsilonR?: number;
        lossTan?: number;
        locked?: boolean;
      },
      specFreq?: string,
      dielectricModel?: string,
    ): void => {
      if (!isPaste) {
        const thickness: SNode[] = [atom('thickness'), atom(mm(p.thicknessMM))];
        if (isDielectric && p.locked) thickness.push(atom('locked'));
        entry.push({ kind: 'list', items: thickness });
      }
      const hasMaterial = p.material !== '' && p.material !== 'Not specified';
      if (hasMaterial) entry.push(list(atom('material'), str(p.material)));
      if (hasMaterial && p.epsilonR !== undefined)
        entry.push(list(atom('epsilon_r'), atom(mm(p.epsilonR))));
      if (hasMaterial && p.lossTan !== undefined)
        entry.push(list(atom('loss_tangent'), atom(mm(p.lossTan))));
      const freq = parseFloat(specFreq ?? '');
      if (hasMaterial && Number.isFinite(freq) && freq > 0) {
        entry.push(list(atom('spec_frequency'), atom(mm(freq))));
        entry.push(
          list(
            atom('dielectric_model'),
            atom(dielectricModel === 'Wideband' ? 'djordjevic_sarkar' : 'constant'),
          ),
        );
      }
    };
    pushSublayer(layer, layer.specFreq, layer.dielectricModel);
    for (const sub of layer.sublayers ?? []) {
      entry.push(atom('addsublayer'));
      pushSublayer(sub);
    }
    items.push({ kind: 'list', items: entry });
  }
  if (s.boardFinish.copperFinish !== 'Not specified')
    items.push(list(atom('copper_finish'), str(s.boardFinish.copperFinish)));
  items.push(
    list(atom('dielectric_constraints'), atom(yesNo(s.physicalStackup.impedanceControlled))),
  );
  if (s.boardFinish.edgeCardConnectors !== 'None') {
    items.push(
      list(
        atom('edge_connector'),
        atom(s.boardFinish.edgeCardConnectors === 'Yes, bevelled' ? 'bevelled' : 'yes'),
      ),
    );
  }
  // edge_plating is only ever written as yes (board_stackup.cpp:871).
  if (s.boardFinish.platedBoardEdge) items.push(list(atom('edge_plating'), atom('yes')));
  return { kind: 'list', items };
}

/**
 * `(zone_defaults …)` — `formatSetup`'s block for
 * `BOARD_DESIGN_SETTINGS::m_ZoneLayerProperties`
 * (`pcb_io_kicad_sexpr.cpp:607-615`), written only when the map is non-empty.
 *
 * Each entry goes through `format( ZONE_LAYER_PROPERTIES&, …)` (`:3096-3113`),
 * whose first act is to return without printing anything when the offset is
 * unset — "Do not store the layer properties if no value is actually set". So a
 * layer the user never touched leaves no `(property …)` behind, and a map whose
 * every entry is unset writes no block at all.
 */
function buildZoneDefaultsNode(s: BoardSetupValues): SList | undefined {
  const written = Object.entries(s.zoneLayerProperties).filter(
    ([, p]) => p.hatchingOffset !== undefined,
  );
  if (written.length === 0) return undefined;

  const items: SNode[] = [atom('zone_defaults')];
  for (const [layer, props] of written) {
    const off = props.hatchingOffset as { x: number; y: number };
    items.push(
      list(
        atom('property'),
        list(atom('layer'), str(layer)),
        list(atom('hatch_position'), list(atom('xy'), atom(mm(off.x)), atom(mm(off.y)))),
      ),
    );
  }
  return { kind: 'list', items };
}

/** Rebuild (setup …) in KiCad's write order, patching owned tokens and
 *  carrying every other child through. */
function buildSetupNode(old: SList | undefined, s: BoardSetupValues): SList {
  const OWNED = new Set([
    'stackup',
    'pad_to_mask_clearance',
    'solder_mask_min_width',
    'pad_to_paste_clearance',
    'pad_to_paste_clearance_ratio',
    'allow_soldermask_bridges_in_footprints',
    'tenting',
    'zone_defaults',
  ]);
  const oldChildren = (old?.items.slice(1) ?? []).filter(isList);
  const keep = (name: string): SList | undefined => oldChildren.find((c) => head(c) === name);

  const items: SNode[] = [atom('setup')];
  items.push(buildStackupNode(s));
  items.push(list(atom('pad_to_mask_clearance'), atom(mm(s.maskPaste.maskExpansionMM))));
  if (s.maskPaste.maskMinWebMM !== 0)
    items.push(list(atom('solder_mask_min_width'), atom(mm(s.maskPaste.maskMinWebMM))));
  if (s.maskPaste.pasteClearanceMM !== 0)
    items.push(list(atom('pad_to_paste_clearance'), atom(mm(s.maskPaste.pasteClearanceMM))));
  if (s.maskPaste.pasteRelativePct !== 0) {
    items.push(
      list(atom('pad_to_paste_clearance_ratio'), atom(mm(s.maskPaste.pasteRelativePct / 100))),
    );
  }
  items.push(
    list(atom('allow_soldermask_bridges_in_footprints'), atom(yesNo(s.maskPaste.allowBridged))),
  );
  items.push(
    list(
      atom('tenting'),
      list(atom('front'), atom(yesNo(s.maskPaste.tentFront))),
      list(atom('back'), atom(yesNo(s.maskPaste.tentBack))),
    ),
  );
  // Preserved-opaque siblings, in KiCad's write order when present.
  for (const name of ['covering', 'plugging', 'capping', 'filling']) {
    const node = keep(name);
    if (node) items.push(node);
  }
  // `(zone_defaults …)` sits between `filling` and the aux origin, which is the
  // order `formatSetup` prints them in (`pcb_io_kicad_sexpr.cpp:605-616`). It
  // used to be carried through opaquely; the Zone Hatch Offsets page owns it now.
  const zoneDefaults = buildZoneDefaultsNode(s);
  if (zoneDefaults) items.push(zoneDefaults);
  for (const name of ['aux_axis_origin', 'grid_origin']) {
    const node = keep(name);
    if (node) items.push(node);
  }
  // pcbplotparams: patch only the two dashed-line ratio tokens in place.
  const plot = keep('pcbplotparams');
  const dash = list(atom('dashed_line_dash_ratio'), atom(mm(s.formatting.dashLengthRatio)));
  const gap = list(atom('dashed_line_gap_ratio'), atom(mm(s.formatting.gapLengthRatio)));
  if (plot) {
    let sawDash = false;
    let sawGap = false;
    const patched = plot.items.map((n) => {
      if (!isList(n)) return n;
      if (head(n) === 'dashed_line_dash_ratio') {
        sawDash = true;
        return dash;
      }
      if (head(n) === 'dashed_line_gap_ratio') {
        sawGap = true;
        return gap;
      }
      return n;
    });
    if (!sawDash) patched.push(dash);
    if (!sawGap) patched.push(gap);
    items.push({ kind: 'list', items: patched });
  } else {
    items.push(list(atom('pcbplotparams'), dash, gap));
  }
  // Anything else (unknown to this writer) survives at the end.
  const known = new Set([
    ...OWNED,
    'covering',
    'plugging',
    'capping',
    'filling',
    'zone_defaults',
    'aux_axis_origin',
    'grid_origin',
    'pcbplotparams',
  ]);
  for (const child of oldChildren) {
    const name = head(child);
    if (name && !known.has(name)) items.push(child);
  }
  return { kind: 'list', items };
}

/** Return `pcbText` with the Board Setup-owned sections patched in (all other
 *  nodes preserved), or null when the text cannot be parsed. */
export function writeBoardFileSetup(pcbText: string, s: BoardSetupValues): string | null {
  let root: SList;
  try {
    root = parse(pcbText);
  } catch {
    return null;
  }
  if (head(root) !== 'kicad_pcb') return null;

  // `BOARD_STACKUP::GetBoardThickness()` sums only the thickness-editable rows,
  // and their sublayers with them — not every row (`board_stackup.cpp:498-515`).
  const boardThickness = s.physicalStackup.layers.reduce(
    (sum, l) =>
      isThicknessEditable(l.type)
        ? sum +
          (l.thicknessMM || 0) +
          (l.sublayers ?? []).reduce((a, p) => a + (p.thicknessMM || 0), 0)
        : sum,
    0,
  );

  const items: SNode[] = [...root.items];
  const replace = (name: string, node: SList): void => {
    const i = items.findIndex((n) => isList(n) && head(n) === name);
    if (i !== -1) items[i] = node;
    else items.push(node);
  };

  // (general …): patch thickness, keep the other tokens (legacy_teardrops).
  const general = items.find((n): n is SList => isList(n) && head(n) === 'general');
  if (general) {
    const gItems = general.items.map((n) =>
      isList(n) && head(n) === 'thickness' ? list(atom('thickness'), atom(mm(boardThickness))) : n,
    );
    if (!gItems.some((n) => isList(n) && head(n) === 'thickness'))
      gItems.push(list(atom('thickness'), atom(mm(boardThickness))));
    replace('general', { kind: 'list', items: gItems });
  }

  // (layers …): rebuild from the panel + copper count.
  replace('layers', { kind: 'list', items: [atom('layers'), ...buildLayerEntries(s)] });

  // (setup …): rebuild owned tokens, preserve the rest.
  const oldSetup = items.find((n): n is SList => isList(n) && head(n) === 'setup');
  replace('setup', buildSetupNode(oldSetup, s));

  // (embedded_fonts yes|no), always present at the file end in v10 saves.
  replace('embedded_fonts', list(atom('embedded_fonts'), atom(yesNo(s.embeddedFiles.embedFonts))));

  // (embedded_files …): keep only the entries still listed by the panel (new
  // rows can't be added here, file data enters via the Embed button, later).
  const embeddedIdx = items.findIndex((n) => isList(n) && head(n) === 'embedded_files');
  if (embeddedIdx !== -1) {
    const old = items[embeddedIdx] as SList;
    const wanted = new Set(s.embeddedFiles.files.map((f) => f.name));
    const files = childrenNamed(old, 'file').filter((f) => {
      const name = strArgOf(childNamed(f, 'name'));
      return name !== undefined && wanted.has(name);
    });
    if (files.length === 0) items.splice(embeddedIdx, 1);
    else items[embeddedIdx] = { kind: 'list', items: [atom('embedded_files'), ...files] };
  }

  return serialize({ kind: 'list', items });
}
