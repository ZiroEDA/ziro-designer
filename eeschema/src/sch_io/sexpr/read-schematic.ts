// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reader: S-expression AST -> typed Schematic model.
 *
 * This is the faithful counterpart to KiCad's `SCH_IO_KICAD_SEXPR_PARSER`. It reads
 * the same fields KiCad reads, converts millimetres to integer internal units, and
 * keeps each item's source `SList` for lossless round-tripping. It tolerates unknown
 * children (they stay in `source`) so newer/foreign fields never cause data loss.
 */

import { head, isList, type SList } from '@ziroeda/sexpr/src/types.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  arg,
  args,
  boolField,
  childNamed,
  childrenNamed,
  maybeAbsentBool,
  numArg,
  numberField,
  stringField,
} from '@ziroeda/sexpr/src/query.js';
import type {
  Fill,
  LabelKind,
  LabelShape,
  LibGraphic,
  LibPin,
  LibSymbol,
  LibSymbolUnit,
  LineKind,
  Schematic,
  SchDirectiveLabel,
  SchField,
  SchJunction,
  SchLabel,
  SchBusEntry,
  SchImage,
  SchLine,
  SchNoConnect,
  SchSheet,
  SchSymbol,
  SchSymbolInstance,
  SchSymbolPin,
  SchTable,
  SchGroup,
  SchTableCell,
  SchTextBox,
  SheetInstance,
  SheetPin,
  Stroke,
  TextEffects,
  TitleBlock,
  Vec2,
} from '../../types.js';

/**
 * `SCH_IO_KICAD_SEXPR_PARSER::parseMaybeAbsentBool( aDefaultValue )`
 * (sch_io_kicad_sexpr_parser.cpp:147). eeschema's copy takes `T_yes`/`T_no`
 * only — pcbnew's also takes `true`/`false` — so the dialect is named here and
 * the three token shapes come from the one shared helper.
 */
const maybeAbsent = (parent: SList, name: string, whenPresent: boolean): boolean | undefined =>
  maybeAbsentBool(parent, name, whenPresent, 'yes-no');

/**
 * Read two positional numeric args (millimetres) starting at `from` as an IU point.
 *
 * `invertY` negates Y, matching KiCad's parser: symbol *library* geometry is stored
 * with +Y up (`parseXY(true)`), while the schematic sheet uses +Y down. Inverting on
 * load puts symbol bodies/pins into the same +Y-down space as the rest of the model,
 * so pins meet their body and asymmetric symbols are oriented like KiCad.
 */
function readPoint(node: SList, from: number, invertY = false): Vec2 {
  const x = numArg(node, from) ?? 0;
  const y = numArg(node, from + 1) ?? 0;
  return { x: mmToIU(x), y: mmToIU(invertY ? -y : y) };
}

/** Read an `(at x y [angle])` child: position in IU plus angle in degrees. */
function readAt(node: SList, invertY = false): { at: Vec2; angle: number } {
  const at = childNamed(node, 'at');
  if (!at) return { at: { x: 0, y: 0 }, angle: 0 };
  return { at: readPoint(at, 0, invertY), angle: numArg(at, 2) ?? 0 };
}

function readStroke(node: SList): Stroke | undefined {
  const s = childNamed(node, 'stroke');
  if (!s) return undefined;
  const width = childNamed(s, 'width');
  const stroke: { -readonly [K in keyof Stroke]: Stroke[K] } = {
    width: width ? mmToIU(numArg(width, 0) ?? 0) : 0,
    type: stringField(s, 'type') ?? 'default',
  };
  const col = childNamed(s, 'color');
  if (col) {
    const r = numArg(col, 0) ?? 0,
      g = numArg(col, 1) ?? 0,
      b = numArg(col, 2) ?? 0,
      a = numArg(col, 3) ?? 1;
    if (r || g || b || a) stroke.color = [r, g, b, a]; // KiCad's (0 0 0 0) = "unspecified"
  }
  return stroke;
}

function readFill(node: SList): Fill | undefined {
  const f = childNamed(node, 'fill');
  if (!f) return undefined;
  const fill: { -readonly [K in keyof Fill]: Fill[K] } = { type: stringField(f, 'type') ?? 'none' };
  const col = childNamed(f, 'color');
  if (col) {
    const r = numArg(col, 0) ?? 0,
      g = numArg(col, 1) ?? 0,
      b = numArg(col, 2) ?? 0,
      a = numArg(col, 3) ?? 1;
    if (r || g || b || a) fill.color = [r, g, b, a]; // (0 0 0 0) = "unspecified"
  }
  return fill;
}

export function readEffects(node: SList): TextEffects | undefined {
  const e = childNamed(node, 'effects');
  if (!e) return undefined;
  const font = childNamed(e, 'font');
  const size = font ? childNamed(font, 'size') : undefined;
  const justify = childNamed(e, 'justify');
  // parseEDA_TEXT's `hide`, parseMaybeAbsentBool( true ) at :891: a bare `hide`
  // token in older files, `(hide)`, or `(hide yes)` in newer ones.
  const effects: { -readonly [K in keyof TextEffects]: TextEffects[K] } = {
    hidden: maybeAbsent(e, 'hide', true) ?? false,
  };
  if (size) effects.fontSize = [mmToIU(numArg(size, 0) ?? 0), mmToIU(numArg(size, 1) ?? 0)];
  const face = font ? stringField(font, 'face') : undefined;
  if (face) effects.face = face;
  if (justify) effects.justify = args(justify);
  if (font) {
    // parseMaybeAbsentBool( true ) at :823 and :828: bare tokens (legacy) or
    // `(bold yes)` / `(italic yes)`. Only a true ever sets the flag, so an
    // absent token stays absent rather than becoming an explicit false.
    if (maybeAbsent(font, 'bold', true) === true) effects.bold = true;
    if (maybeAbsent(font, 'italic', true) === true) effects.italic = true;
    // `(thickness …)`: an explicit glyph pen. Only written when it is not auto,
    // so its absence is meaningful and must stay absent rather than become 0.
    const thick = childNamed(font, 'thickness');
    if (thick) effects.thickness = mmToIU(numArg(thick, 0) ?? 0);
    const col = childNamed(font, 'color');
    if (col) {
      const r = numArg(col, 0) ?? 0,
        g = numArg(col, 1) ?? 0,
        b = numArg(col, 2) ?? 0,
        a = numArg(col, 3) ?? 1;
      if (r || g || b || a) effects.color = [r, g, b, a]; // (0 0 0 0) = "unspecified"
    }
  }
  return effects;
}

/**
 * A text item's hyperlink: `(href "…")` **inside** `(effects …)`.
 *
 * `EDA_TEXT::Format` (common/eda_text.cpp:1116) writes it there, and
 * `parseEDA_TEXT` (sch_io_kicad_sexpr_parser.cpp:869) is the only place that
 * reads it. ZiroEDA used to write a direct `(hyperlink "…")` child instead,
 * which is not in the schematic grammar at all — so those files are still read
 * here, to keep them openable, but the writer never emits that form again.
 */
export function readHyperlink(node: SList): string | undefined {
  const effects = childNamed(node, 'effects');
  const href = effects ? stringField(effects, 'href') : undefined;
  return href ?? stringField(node, 'hyperlink');
}

/**
 * True when a `(property …)` node carries the bare `private` flag.
 *
 * `parseSchField` (sch_io_kicad_sexpr_parser.cpp:2289) and `parseProperty`
 * (:1061) both take a `T_private` token *before* the name, so the flag is not a
 * child list but an atom occupying the first positional slot. Reading it as the
 * name — which is what `args()` gives you, since it does not distinguish an
 * atom from a quoted string — makes the name read as "private" and the value as
 * the name, and then a value edit rewrites the name instead.
 *
 * Exported so the writer can put the flag back in the same slot.
 */
export function fieldIsPrivate(node: SList): boolean {
  const first = node.items[1];
  return first?.kind === 'atom' && first.value === 'private';
}

/** Parse a `(property ...)` node. Exported so the writer can diff edits against the source. */
export function readField(node: SList, invertY = false): SchField {
  const { at, angle } = readAt(node, invertY);
  const isPrivate = fieldIsPrivate(node);
  const slot = isPrivate ? 1 : 0; // the flag shifts name and value along one
  const field: { -readonly [K in keyof SchField]: SchField[K] } = {
    key: arg(node, slot) ?? '',
    value: arg(node, slot + 1) ?? '',
    angle,
    source: node,
  };
  if (isPrivate) field.isPrivate = true;
  if (childNamed(node, 'at')) field.at = at;
  const effects = readEffects(node);
  // KiCad 7 files place the field's `(hide yes)` (or bare `hide`) as a DIRECT
  // child of the property, outside `(effects …)`; KiCad 8+ moved it inside
  // effects. Honor both so hidden Description/Datasheet/Footprint fields don't
  // render (sch_io_kicad_sexpr_parser.cpp parseSchField / parseEDA_TEXT).
  const directHide =
    node.items.some((it) => it.kind === 'atom' && it.value === 'hide') ||
    (childNamed(node, 'hide') ? boolField(node, 'hide', false) : false);
  if (effects) field.effects = directHide ? { ...effects, hidden: true } : effects;
  else if (directHide) field.effects = { hidden: true };
  // parseMaybeAbsentBool( true ) at :1144 (lib) and :2419 (schematic).
  if (maybeAbsent(node, 'show_name', true) === true) field.nameShown = true;
  // parseMaybeAbsentBool( true ) at :1151 (lib) and :2426 (schematic).
  const doNotAutoplace = maybeAbsent(node, 'do_not_autoplace', true);
  if (doNotAutoplace !== undefined) field.doNotAutoplace = doNotAutoplace;
  // `(show_in_chooser yes)`, the field is offered as a Symbol Chooser column
  // (SCH_FIELD::ShowInChooser / LIB_SYMBOL::cacheChooserFields).
  if (boolField(node, 'show_in_chooser', false)) field.showInChooser = true;
  return field;
}

// ----- library symbols ------------------------------------------------------

/** Split a unit name like `Conn_01x02_1_1` into its trailing unit and body-style numbers. */
function parseUnitName(name: string): { unit: number; bodyStyle: number } {
  const m = /_(\d+)_(\d+)$/.exec(name);
  if (!m) return { unit: 0, bodyStyle: 0 };
  return { unit: Number(m[1]), bodyStyle: Number(m[2]) };
}

/** Parse a lib `(pin ...)` node. Exported so the symbol-library writer can diff edits. */
export function readLibPin(node: SList, invertY = false): LibPin {
  const { at, angle } = readAt(node, invertY);
  // hide can be a bare `hide` token (legacy) or `(hide yes)`.
  const hideChild = childNamed(node, 'hide');
  const bareHide = node.items.some((it) => it.kind === 'atom' && it.value === 'hide');
  const pin: { -readonly [K in keyof LibPin]: LibPin[K] } = {
    electricalType: arg(node, 0) ?? 'unspecified',
    shape: arg(node, 1) ?? 'line',
    at,
    angle,
    length: mmToIU(numArg(childNamed(node, 'length') ?? node, 0) ?? 0),
    name: stringField(node, 'name') ?? '',
    number: stringField(node, 'number') ?? '',
    hidden: bareHide || (hideChild ? boolField(node, 'hide', false) : false),
    source: node,
  };
  // Per-pin name/number text sizes. A size of 0 means the text is not drawn
  // (KiCad lays it out zero-height; Altium imports hide names this way).
  // `(alternate "NAME" <electrical type> <shape>)`, one child per alternative
  // function. Positional, exactly as parseSchPin reads them.
  const alts = childrenNamed(node, 'alternate');
  if (alts.length) {
    pin.alternates = alts.map((a) => ({
      name: arg(a, 0) ?? '',
      electricalType: arg(a, 1) ?? 'unspecified',
      shape: arg(a, 2) ?? 'line',
    }));
  }
  const nameFx = childNamed(node, 'name') && readEffects(childNamed(node, 'name')!);
  const numFx = childNamed(node, 'number') && readEffects(childNamed(node, 'number')!);
  if (nameFx?.fontSize) pin.nameSize = nameFx.fontSize[0];
  if (numFx?.fontSize) pin.numberSize = numFx.fontSize[0];
  return pin;
}

/** Parse a graphic body item. Exported so the symbol-library writer can diff edits. */
/** The shape nodes `saveShape` can emit, i.e. what a `(rule_area …)` wraps. */
const SHAPE_KINDS = new Set([
  'polyline',
  'rectangle',
  'circle',
  'arc',
  'bezier',
  'ellipse',
  'ellipse_arc',
]);

export function readGraphic(node: SList, invertY = false): LibGraphic | undefined {
  const kind = head(node);
  const stroke = readStroke(node);
  const fill = readFill(node);
  const withSF = <T extends object>(g: T): T & { stroke?: Stroke; fill?: Fill } => {
    const out = { ...g } as T & { stroke?: Stroke; fill?: Fill };
    if (stroke) out.stroke = stroke;
    if (fill) out.fill = fill;
    return out;
  };

  switch (kind) {
    case 'rectangle': {
      const start = childNamed(node, 'start');
      const end = childNamed(node, 'end');
      if (!start || !end) return undefined;
      return withSF({
        kind: 'rectangle' as const,
        start: readPoint(start, 0, invertY),
        end: readPoint(end, 0, invertY),
        source: node,
      });
    }
    case 'circle': {
      const center = childNamed(node, 'center');
      const radius = childNamed(node, 'radius');
      if (!center) return undefined;
      return withSF({
        kind: 'circle' as const,
        center: readPoint(center, 0, invertY),
        radius: mmToIU(radius ? (numArg(radius, 0) ?? 0) : 0),
        source: node,
      });
    }
    case 'arc': {
      const start = childNamed(node, 'start');
      const mid = childNamed(node, 'mid');
      const end = childNamed(node, 'end');
      if (!start || !mid || !end) return undefined;
      return withSF({
        kind: 'arc' as const,
        start: readPoint(start, 0, invertY),
        mid: readPoint(mid, 0, invertY),
        end: readPoint(end, 0, invertY),
        source: node,
      });
    }
    case 'ellipse':
    case 'ellipse_arc': {
      // `(ellipse (center x y) (major_radius r) (minor_radius r)
      //  (rotation_angle a) [(start_angle a) (end_angle a)] …)`, as
      // `formatEllipse` / `formatEllipseArc` write it.
      const centerNode = childNamed(node, 'center');
      if (!centerNode) return undefined;
      const center = readPoint(centerNode, 0, invertY);
      const numChild = (nm: string): number => {
        const c = childNamed(node, nm);
        return c ? (numArg(c, 0) ?? 0) : 0;
      };
      const base = {
        center,
        majorRadius: mmToIU(numChild('major_radius')),
        minorRadius: mmToIU(numChild('minor_radius')),
        rotation: numChild('rotation_angle'),
      };
      return withSF(
        kind === 'ellipse'
          ? { kind: 'ellipse' as const, ...base, source: node }
          : {
              kind: 'ellipse_arc' as const,
              ...base,
              startAngle: numChild('start_angle'),
              endAngle: numChild('end_angle'),
              source: node,
            },
      );
    }
    case 'polyline': {
      const pts = childNamed(node, 'pts');
      const points = pts ? childrenNamed(pts, 'xy').map((xy) => readPoint(xy, 0, invertY)) : [];
      return withSF({ kind: 'polyline' as const, points, source: node });
    }
    case 'bezier': {
      // Cubic Bézier: `(bezier (pts (xy start) (xy c1) (xy c2) (xy end)) ...)`.
      const pts = childNamed(node, 'pts');
      const points = pts ? childrenNamed(pts, 'xy').map((xy) => readPoint(xy, 0, invertY)) : [];
      return withSF({ kind: 'bezier' as const, points, source: node });
    }
    case 'text': {
      const { at, angle } = readAt(node, invertY);
      const effects = readEffects(node);
      const g: LibGraphic = { kind: 'text', text: arg(node, 0) ?? '', at, angle, source: node };
      return effects ? { ...g, effects } : g;
    }
    default:
      return undefined; // unknown body element; preserved via the parent's source
  }
}

function readLibSymbolUnit(node: SList, invertY: boolean): LibSymbolUnit {
  const name = arg(node, 0) ?? '';
  const { unit, bodyStyle } = parseUnitName(name);
  const graphics: LibGraphic[] = [];
  const pins: LibPin[] = [];
  for (const item of node.items) {
    if (!isList(item)) continue;
    if (head(item) === 'pin') pins.push(readLibPin(item, invertY));
    else {
      const g = readGraphic(item, invertY);
      if (g) graphics.push(g);
    }
  }
  return { name, unit, bodyStyle, graphics, pins, source: node };
}

function readLibSymbol(node: SList): LibSymbol {
  const units: LibSymbolUnit[] = [];
  const properties: SchField[] = [];
  // Symbol-library geometry is stored +Y-up; invert it to the model's +Y-down space.
  for (const item of node.items) {
    if (!isList(item)) continue;
    if (head(item) === 'symbol') units.push(readLibSymbolUnit(item, true));
    else if (head(item) === 'property') properties.push(readField(item, true));
  }
  const extendsName = stringField(node, 'extends');
  const pinNamesNode = childNamed(node, 'pin_names');
  const pinNumbersNode = childNamed(node, 'pin_numbers');
  const bareHide = (n: SList | undefined): boolean =>
    n !== undefined &&
    (boolField(n, 'hide', false) ||
      n.items.some((it) => it.kind === 'atom' && it.value === 'hide'));
  const sym: { -readonly [K in keyof LibSymbol]: LibSymbol[K] } = {
    libId: arg(node, 0) ?? '',
    isPower: childNamed(node, 'power') !== undefined,
    // (power) / (power global) is global; (power local) is not.
    isLocalPower: (() => {
      const power = childNamed(node, 'power');
      return power !== undefined && arg(power, 0) === 'local';
    })(),
    duplicatePinNumbersAreJumpers: (() => {
      const flag = childNamed(node, 'duplicate_pin_numbers_are_jumpers');
      return flag !== undefined && arg(flag, 0) === 'yes';
    })(),
    // (jumper_pin_groups ("1" "2") ("3" "4"))
    jumperPinGroups: (() => {
      const groups = childNamed(node, 'jumper_pin_groups');
      if (!groups) return [];
      return groups.items
        .slice(1)
        .filter((it): it is SList => it.kind === 'list')
        .map((g) =>
          g.items
            .filter(
              (it): it is { kind: 'atom' | 'string'; value: string } =>
                it.kind === 'atom' || it.kind === 'string',
            )
            .map((it) => it.value),
        );
    })(),
    // (associated_footprints (footprint "<lib_id>" (map "STD-8")) …)
    associatedFootprints: (() => {
      const assoc = childNamed(node, 'associated_footprints');
      if (!assoc) return [];
      return childrenNamed(assoc, 'footprint').map((f) => ({
        footprintLibId: arg(f, 0) ?? '',
        mapName: (() => {
          const m = childNamed(f, 'map');
          return m ? (arg(m, 0) ?? '') : '';
        })(),
      }));
    })(),
    // (pin_maps (pin_map "NAME" (entry "<pin>" "<pad>") …))
    pinMaps: (() => {
      const maps = childNamed(node, 'pin_maps');
      if (!maps) return [];
      return childrenNamed(maps, 'pin_map').map((m) => ({
        name: arg(m, 0) ?? '',
        entries: childrenNamed(m, 'entry').map((e) => ({
          pin: arg(e, 0) ?? '',
          pad: arg(e, 1) ?? '',
        })),
      }));
    })(),
    pinNumbersHidden: bareHide(pinNumbersNode),
    pinNamesHidden: bareHide(pinNamesNode),
    pinNameOffset: pinNamesNode
      ? mmToIU(numberField(pinNamesNode, 'offset') ?? 0.508)
      : mmToIU(0.508),
    properties,
    units,
    source: node,
  };
  if (extendsName !== undefined) sym.extends = extendsName;
  // The part's own attributes. `in_bom` / `on_board` / `in_pos_files` are
  // written inverted by the library writer (FormatBool( "in_bom", !excluded )),
  // so they flip back to the "excluded from" sense the model stores. An absent
  // token stays undefined: older libraries omit them, and "Update/reset symbol
  // attributes" must not read that as an explicit no.
  if (childNamed(node, 'exclude_from_sim'))
    sym.excludedFromSim = boolField(node, 'exclude_from_sim', false);
  if (childNamed(node, 'in_bom')) sym.excludedFromBom = !boolField(node, 'in_bom', true);
  if (childNamed(node, 'on_board')) sym.excludedFromBoard = !boolField(node, 'on_board', true);
  if (childNamed(node, 'in_pos_files'))
    sym.excludedFromPosFiles = !boolField(node, 'in_pos_files', true);
  return sym;
}

/** The geometry + display settings a derived symbol inherits from its parent chain. */
interface InheritedBase {
  units: readonly LibSymbolUnit[];
  isPower: boolean;
  isLocalPower: boolean;
  pinNumbersHidden: boolean;
  pinNamesHidden: boolean;
  pinNameOffset: number;
  /** "Fetch the attributes from the *flattened* library symbol. They are not
   *  supported in derived symbols." (dialog_change_symbols.cpp) */
  excludedFromSim?: boolean;
  excludedFromBom?: boolean;
  excludedFromBoard?: boolean;
  excludedFromPosFiles?: boolean;
}

/**
 * Resolve derived symbols, faithful to KiCad's `LIB_SYMBOL::Flatten()`: the
 * flattened symbol is a copy of its *parent*, so a symbol with `(extends "Parent")`
 * takes the parent's body (units/pins), power flag, and pin name/number visibility
 * and name offset from the parent chain, keeping only its own text properties
 * (Reference/Value/Footprint/…). Parent and child live in the same library, and a
 * parent may itself be derived, so resolution walks the chain to the root.
 */
function resolveExtends(symbols: LibSymbol[]): LibSymbol[] {
  const byName = new Map<string, LibSymbol>();
  for (const s of symbols) byName.set(s.libId, s);

  const ownBase = (s: LibSymbol): InheritedBase => ({
    units: s.units,
    isPower: s.isPower,
    isLocalPower: s.isLocalPower ?? false,
    pinNumbersHidden: s.pinNumbersHidden,
    pinNamesHidden: s.pinNamesHidden,
    pinNameOffset: s.pinNameOffset,
    excludedFromSim: s.excludedFromSim,
    excludedFromBom: s.excludedFromBom,
    excludedFromBoard: s.excludedFromBoard,
    excludedFromPosFiles: s.excludedFromPosFiles,
  });

  const resolveBase = (s: LibSymbol, seen: Set<string>): InheritedBase => {
    if (!s.extends || seen.has(s.libId)) return ownBase(s);
    const parent = byName.get(s.extends);
    if (!parent) return ownBase(s);
    seen.add(s.libId);
    const r = resolveBase(parent, seen);
    // Geometry + pin display come from the parent; only power can be additive.
    return {
      ...r,
      isPower: s.isPower || r.isPower,
      isLocalPower: s.isLocalPower || r.isLocalPower,
    };
  };

  return symbols.map((s) => {
    if (!s.extends) return s;
    const r = resolveBase(s, new Set());
    return {
      ...s,
      units: r.units,
      isPower: r.isPower,
      pinNumbersHidden: r.pinNumbersHidden,
      pinNamesHidden: r.pinNamesHidden,
      pinNameOffset: r.pinNameOffset,
      // Attributes come from the parent too: a derived symbol does not declare
      // its own, and the flattened symbol is what "Update symbol attributes"
      // reads.
      ...(r.excludedFromSim !== undefined ? { excludedFromSim: r.excludedFromSim } : {}),
      ...(r.excludedFromBom !== undefined ? { excludedFromBom: r.excludedFromBom } : {}),
      ...(r.excludedFromBoard !== undefined ? { excludedFromBoard: r.excludedFromBoard } : {}),
      ...(r.excludedFromPosFiles !== undefined
        ? { excludedFromPosFiles: r.excludedFromPosFiles }
        : {}),
    };
  });
}

// ----- instance items -------------------------------------------------------

/**
 * A symbol's `(instances (project "…" (path … (reference …) (unit …))))`.
 *
 * KiCad's per-sheet-path annotation (`SCH_SYMBOL::GetInstances`). It is the
 * authority on what a symbol is called: `SCH_SYMBOL::GetRef` (sch_symbol.cpp:646)
 * consults the Reference property only when the current sheet path has no
 * record here. Reading it is what lets the writer keep it in step with an
 * annotation, instead of leaving a stale `R?` behind for KiCad to read back.
 */
function readSymbolInstances(node: SList): SchSymbolInstance[] {
  const instancesNode = childNamed(node, 'instances');
  if (!instancesNode) return [];
  const out: SchSymbolInstance[] = [];
  for (const proj of childrenNamed(instancesNode, 'project')) {
    const project = arg(proj, 0) ?? '';
    for (const p of childrenNamed(proj, 'path')) {
      out.push({
        project,
        path: arg(p, 0) ?? '',
        reference: stringField(p, 'reference') ?? '',
        // saveSymbol always prints (unit N); a file missing it means unit 1.
        unit: numArg(childNamed(p, 'unit') ?? p, 0) ?? 1,
        source: p,
      });
    }
  }
  return out;
}

function readSymbol(node: SList): SchSymbol {
  const { at, angle } = readAt(node);
  const fields = childrenNamed(node, 'property').map((p) => readField(p));
  const mirrorChild = childNamed(node, 'mirror');
  const mirror = mirrorChild ? arg(mirrorChild, 0) : undefined;
  const sym: { -readonly [K in keyof SchSymbol]: SchSymbol[K] } = {
    libId: stringField(node, 'lib_id') ?? '',
    ...(() => {
      const libName = stringField(node, 'lib_name');
      // Only when it says something the id does not, matching the condition
      // KiCad writes it under.
      return libName && libName !== stringField(node, 'lib_id') ? { libName } : {};
    })(),
    at,
    angle,
    unit: numArg(childNamed(node, 'unit') ?? node, 0) ?? 1,
    bodyStyle: numArg(childNamed(node, 'body_style') ?? node, 0) ?? 1,
    inBom: boolField(node, 'in_bom', true),
    onBoard: boolField(node, 'on_board', true),
    dnp: boolField(node, 'dnp', false),
    fields,
    source: node,
  };
  if (mirror === 'x' || mirror === 'y') sym.mirror = mirror;
  // `(fields_autoplaced yes)`. The parser defaults to AUTOPLACE_NONE and the
  // token can only ever raise it to AUTOPLACE_AUTO — MANUAL is never written,
  // so it is never read back either (sch_io_kicad_sexpr_parser.cpp:3112, :3247).
  if (boolField(node, 'fields_autoplaced', false)) sym.fieldsAutoplaced = 'auto';
  // (pin_map_override (mode …) (map "…") (edit "<pin>" "<pad>") …)
  const overrideNode = childNamed(node, 'pin_map_override');
  if (overrideNode) {
    const modeNode = childNamed(overrideNode, 'mode');
    const mapNode = childNamed(overrideNode, 'map');
    const mode = (modeNode ? arg(modeNode, 0) : undefined) ?? 'library_default';
    sym.pinMapOverride = {
      mode:
        mode === 'named_map' || mode === 'identity' || mode === 'delegate'
          ? mode
          : 'library_default',
      mapName: (mapNode ? arg(mapNode, 0) : undefined) ?? '',
      edits: childrenNamed(overrideNode, 'edit').map((e) => ({
        pin: arg(e, 0) ?? '',
        pad: arg(e, 1) ?? '',
      })),
    };
  }
  // `(pin "1" (uuid …) [(alternate "NAME")])`. Only the placement's own pins:
  // a sheet's `(pin …)` is a different item entirely, and readSheet handles it.
  const pinNodes = childrenNamed(node, 'pin');
  if (pinNodes.length) {
    sym.pins = pinNodes.map((p) => {
      const entry: { -readonly [K in keyof SchSymbolPin]: SchSymbolPin[K] } = {
        number: arg(p, 0) ?? '',
      };
      const uuid = stringField(p, 'uuid');
      if (uuid) entry.uuid = uuid;
      const alt = stringField(p, 'alternate');
      if (alt) entry.alternate = alt;
      return entry;
    });
  }
  if (boolField(node, 'locked', false)) sym.locked = true;
  // (passthrough default|block|force), case-insensitive; DEFAULT stays unset.
  const passthroughNode = childNamed(node, 'passthrough');
  const passthrough = passthroughNode ? arg(passthroughNode, 0)?.toLowerCase() : undefined;
  if (passthrough === 'block' || passthrough === 'force') sym.passthrough = passthrough;
  // Keep "token absent" distinct from "no": older files have no exclude_from_sim.
  if (childNamed(node, 'exclude_from_sim'))
    sym.excludedFromSim = boolField(node, 'exclude_from_sim', false);
  // `(in_pos_files yes|no)` is the inverse of SCH_SYMBOL::GetExcludedFromPosFiles;
  // absent in pre-10.0 files, so keep it undefined rather than defaulting.
  if (childNamed(node, 'in_pos_files'))
    sym.excludedFromPosFiles = !boolField(node, 'in_pos_files', true);
  const uuid = stringField(node, 'uuid');
  if (uuid) sym.uuid = uuid;
  const instances = readSymbolInstances(node);
  if (instances.length) sym.instances = instances;
  return sym;
}

function readLine(node: SList, kind: LineKind): SchLine {
  const pts = childNamed(node, 'pts');
  const xy = pts ? childrenNamed(pts, 'xy') : [];
  const all = xy.map((p) => readPoint(p, 0));
  const start = all[0] ?? { x: 0, y: 0 };
  const end = all[all.length - 1] ?? start;
  const line: { -readonly [K in keyof SchLine]: SchLine[K] } = { kind, start, end, source: node };
  // Graphic polylines can have more than two vertices; keep them all for drawing.
  if (all.length > 2) line.points = all;
  const stroke = readStroke(node);
  if (stroke) line.stroke = stroke;
  const uuid = stringField(node, 'uuid');
  if (uuid) line.uuid = uuid;
  return line;
}

function readJunction(node: SList): SchJunction {
  const { at } = readAt(node);
  const j: { -readonly [K in keyof SchJunction]: SchJunction[K] } = {
    at,
    diameter: mmToIU(numArg(childNamed(node, 'diameter') ?? node, 0) ?? 0),
    source: node,
  };
  const col = childNamed(node, 'color');
  if (col) {
    const r = numArg(col, 0) ?? 0,
      g = numArg(col, 1) ?? 0,
      b = numArg(col, 2) ?? 0,
      a = numArg(col, 3) ?? 1;
    if (r || g || b || a) j.color = [r, g, b, a]; // (0 0 0 0) = "unspecified"
  }
  const uuid = stringField(node, 'uuid');
  if (uuid) j.uuid = uuid;
  return j;
}

const PIN_SHAPES = ['input', 'output', 'bidirectional', 'tri_state', 'passive'] as const;

/** Parse a sheet pin: `(pin "NAME" input (at x y side) (effects ..) (uuid ..))`. */
function readSheetPin(node: SList): SheetPin {
  const { at, angle } = readAt(node);
  const shapeTok = arg(node, 1);
  const pin: { -readonly [K in keyof SheetPin]: SheetPin[K] } = {
    name: arg(node, 0) ?? '',
    shape: (PIN_SHAPES as readonly string[]).includes(shapeTok ?? '')
      ? (shapeTok as LabelShape)
      : 'input',
    at,
    angle,
    source: node,
  };
  const effects = readEffects(node);
  if (effects) pin.effects = effects;
  const fields = childrenNamed(node, 'property').map((p) => readField(p));
  if (fields.length) pin.fields = fields;
  const uuid = stringField(node, 'uuid');
  if (uuid) pin.uuid = uuid;
  return pin;
}

/** Parse a `(path "…" (page "…"))` node into a SheetInstance. */
function readInstancePath(pathNode: SList, project: string | undefined): SheetInstance {
  const inst: { -readonly [K in keyof SheetInstance]: SheetInstance[K] } = {
    path: arg(pathNode, 0) ?? '',
    source: pathNode,
  };
  if (project !== undefined) inst.project = project;
  const page = stringField(pathNode, 'page');
  if (page !== undefined) inst.page = page;
  return inst;
}

/** A sheet's `(instances (project "name" (path …(page …))))` records. */
function readSheetInstances(node: SList): SheetInstance[] {
  const instancesNode = childNamed(node, 'instances');
  if (!instancesNode) return [];
  const out: SheetInstance[] = [];
  for (const proj of childrenNamed(instancesNode, 'project')) {
    const name = arg(proj, 0) ?? '';
    for (const p of childrenNamed(proj, 'path')) out.push(readInstancePath(p, name));
  }
  return out;
}

/** Parse a `(sheet ...)`: rectangle + Sheetname/Sheetfile fields + hierarchical pins. */
function readSheet(node: SList): SchSheet {
  const { at } = readAt(node);
  const sizeNode = childNamed(node, 'size');
  const sheet: { -readonly [K in keyof SchSheet]: SchSheet[K] } = {
    at,
    size: {
      w: mmToIU(numArg(sizeNode ?? node, 0) ?? 0),
      h: mmToIU(numArg(sizeNode ?? node, 1) ?? 0),
    },
    fields: childrenNamed(node, 'property').map((p) => readField(p)),
    pins: childrenNamed(node, 'pin').map(readSheetPin),
    instances: readSheetInstances(node),
    // Stored inverted for the first two, and defaulting to "included" so a file
    // written before the tokens existed reads as a plain sheet.
    inBom: boolField(node, 'in_bom', true),
    onBoard: boolField(node, 'on_board', true),
    dnp: boolField(node, 'dnp', false),
    source: node,
  };
  if (childNamed(node, 'exclude_from_sim'))
    sheet.excludedFromSim = boolField(node, 'exclude_from_sim', false);
  const stroke = readStroke(node);
  if (stroke) sheet.stroke = stroke;
  const fill = childNamed(node, 'fill');
  const fillCol = fill && childNamed(fill, 'color');
  if (fillCol) {
    const r = numArg(fillCol, 0) ?? 0,
      g = numArg(fillCol, 1) ?? 0,
      b = numArg(fillCol, 2) ?? 0,
      a = numArg(fillCol, 3) ?? 0;
    // `COLOR4D::UNSPECIFIED` is `COLOR4D( 0, 0, 0, 0 )`, and that is what KiCad
    // writes for a sheet with no background colour of its own — so *all four*
    // components zero means unset, and the painter falls back to the theme.
    // Any other value is a real colour and is kept, even at zero alpha: that is
    // not unset to KiCad, it just does not get drawn ("only draw the background
    // if it has a visible alpha value"). Testing alpha alone dropped such a
    // colour on read, which both lost it on write and let the theme fill a
    // sheet upstream leaves blank.
    if (r !== 0 || g !== 0 || b !== 0 || a !== 0) sheet.fillColor = [r, g, b, a];
  }
  const uuid = stringField(node, 'uuid');
  if (uuid) sheet.uuid = uuid;
  return sheet;
}

/** `(bus_entry (at x y) (size dx dy) (stroke ..) (uuid ..))`, SCH_BUS_WIRE_ENTRY. */
function readBusEntry(node: SList): SchBusEntry {
  const { at } = readAt(node);
  const sizeNode = childNamed(node, 'size');
  const entry: { -readonly [K in keyof SchBusEntry]: SchBusEntry[K] } = {
    at,
    size: {
      x: mmToIU(numArg(sizeNode ?? node, 0) ?? 0),
      y: mmToIU(numArg(sizeNode ?? node, 1) ?? 0),
    },
    source: node,
  };
  const stroke = readStroke(node);
  if (stroke) entry.stroke = stroke;
  const uuid = stringField(node, 'uuid');
  if (uuid) entry.uuid = uuid;
  return entry;
}

/** `(image (at x y) [(scale s)] (data "b64" "b64" ...))`, SCH_BITMAP, centred at `at`. */
function readImage(node: SList): SchImage {
  const { at } = readAt(node);
  const dataNode = childNamed(node, 'data');
  let data = '';
  if (dataNode) {
    for (const it of dataNode.items.slice(1)) {
      if (it.kind === 'string' || it.kind === 'atom') data += it.value;
    }
  }
  const img: { -readonly [K in keyof SchImage]: SchImage[K] } = {
    at,
    scale: numArg(childNamed(node, 'scale') ?? node, 0) ?? 1,
    data,
    source: node,
  };
  const uuid = stringField(node, 'uuid');
  if (uuid) img.uuid = uuid;
  return img;
}

/**
 * `(text_box "content" (at x y angle) (size w h) (margins l t r b)
 *   (stroke ..) (fill ..) (effects ..) (uuid ..))`, SCH_TEXTBOX.
 * `start` = `(at)`, `end` = start + `(size)`. Legacy 6.99 files used bare
 * `(start ..)`/`(end ..)`; both are honored (sch_io_kicad_sexpr_parser.cpp).
 */
function readTextBox(node: SList): SchTextBox {
  const { at, angle } = readAt(node);
  const startNode = childNamed(node, 'start');
  const start = startNode ? readPoint(startNode, 0) : at;
  const sizeNode = childNamed(node, 'size');
  const endNode = childNamed(node, 'end');
  const end = endNode
    ? readPoint(endNode, 0)
    : {
        x: start.x + mmToIU(numArg(sizeNode ?? node, 0) ?? 0),
        y: start.y + mmToIU(numArg(sizeNode ?? node, 1) ?? 0),
      };
  const tb: { -readonly [K in keyof SchTextBox]: SchTextBox[K] } = {
    text: arg(node, 0) ?? '',
    start,
    end,
    angle,
    source: node,
  };
  const marginsNode = childNamed(node, 'margins');
  if (marginsNode) {
    tb.margins = {
      left: mmToIU(numArg(marginsNode, 0) ?? 0),
      top: mmToIU(numArg(marginsNode, 1) ?? 0),
      right: mmToIU(numArg(marginsNode, 2) ?? 0),
      bottom: mmToIU(numArg(marginsNode, 3) ?? 0),
    };
  }
  const stroke = readStroke(node);
  if (stroke) tb.stroke = stroke;
  const fill = readFill(node);
  if (fill) tb.fill = fill;
  const effects = readEffects(node);
  if (effects) tb.effects = effects;
  if (childNamed(node, 'exclude_from_sim'))
    tb.excludedFromSim = boolField(node, 'exclude_from_sim', false);
  const uuid = stringField(node, 'uuid');
  if (uuid) tb.uuid = uuid;
  const hyperlink = readHyperlink(node);
  if (hyperlink) tb.hyperlink = hyperlink;
  return tb;
}

/** `(table_cell "text" (at ..)(size ..)(margins ..)(span c r)(fill)(effects)(uuid))`, SCH_TABLECELL. */
function readTableCell(node: SList): SchTableCell {
  const { at, angle } = readAt(node);
  const startNode = childNamed(node, 'start');
  const start = startNode ? readPoint(startNode, 0) : at;
  const sizeNode = childNamed(node, 'size');
  const endNode = childNamed(node, 'end');
  const end = endNode
    ? readPoint(endNode, 0)
    : {
        x: start.x + mmToIU(numArg(sizeNode ?? node, 0) ?? 0),
        y: start.y + mmToIU(numArg(sizeNode ?? node, 1) ?? 0),
      };
  const spanNode = childNamed(node, 'span');
  const cell: { -readonly [K in keyof SchTableCell]: SchTableCell[K] } = {
    text: arg(node, 0) ?? '',
    start,
    end,
    colSpan: spanNode ? (numArg(spanNode, 0) ?? 1) : 1,
    rowSpan: spanNode ? (numArg(spanNode, 1) ?? 1) : 1,
    source: node,
  };
  // The text angle of a rotated table's cells (SCH_TABLE::Rotate). Kept off the
  // object when zero so an unrotated cell compares equal to one read before the
  // field existed.
  if (angle) cell.angle = angle;
  const marginsNode = childNamed(node, 'margins');
  if (marginsNode) {
    cell.margins = {
      left: mmToIU(numArg(marginsNode, 0) ?? 0),
      top: mmToIU(numArg(marginsNode, 1) ?? 0),
      right: mmToIU(numArg(marginsNode, 2) ?? 0),
      bottom: mmToIU(numArg(marginsNode, 3) ?? 0),
    };
  }
  const fill = readFill(node);
  if (fill) cell.fill = fill;
  const effects = readEffects(node);
  if (effects) cell.effects = effects;
  return cell;
}

/** `(table (column_count N)(border ..)(separators ..)(column_widths ..)(row_heights ..)(uuid)(cells ..))`, SCH_TABLE. */
function readTable(node: SList): SchTable {
  const colCountNode = childNamed(node, 'column_count');
  const widthsNode = childNamed(node, 'column_widths');
  const heightsNode = childNamed(node, 'row_heights');
  const borderNode = childNamed(node, 'border');
  const separatorsNode = childNamed(node, 'separators');
  const cellsNode = childNamed(node, 'cells');
  const table: { -readonly [K in keyof SchTable]: SchTable[K] } = {
    columnCount: colCountNode ? (numArg(colCountNode, 0) ?? 1) : 1,
    colWidths: widthsNode ? args(widthsNode).map((v) => mmToIU(Number(v))) : [],
    rowHeights: heightsNode ? args(heightsNode).map((v) => mmToIU(Number(v))) : [],
    borderExternal: borderNode ? boolField(borderNode, 'external', false) : false,
    borderHeader: borderNode ? boolField(borderNode, 'header', false) : false,
    separatorRows: separatorsNode ? boolField(separatorsNode, 'rows', false) : false,
    separatorCols: separatorsNode ? boolField(separatorsNode, 'cols', false) : false,
    cells: cellsNode ? childrenNamed(cellsNode, 'table_cell').map(readTableCell) : [],
    source: node,
  };
  const borderStroke = borderNode && readStroke(borderNode);
  if (borderStroke) table.borderStroke = borderStroke;
  const sepStroke = separatorsNode && readStroke(separatorsNode);
  if (sepStroke) table.separatorsStroke = sepStroke;
  const uuid = stringField(node, 'uuid');
  if (uuid) table.uuid = uuid;
  return table;
}

function readNoConnect(node: SList): SchNoConnect {
  const { at } = readAt(node);
  const nc: { -readonly [K in keyof SchNoConnect]: SchNoConnect[K] } = { at, source: node };
  const uuid = stringField(node, 'uuid');
  if (uuid) nc.uuid = uuid;
  return nc;
}

function readLabel(node: SList, kind: LabelKind): SchLabel {
  const { at, angle } = readAt(node);
  const label: { -readonly [K in keyof SchLabel]: SchLabel[K] } = {
    kind,
    text: arg(node, 0) ?? '',
    at,
    angle,
    source: node,
  };
  const shape = stringField(node, 'shape');
  if (
    shape === 'input' ||
    shape === 'output' ||
    shape === 'bidirectional' ||
    shape === 'tri_state' ||
    shape === 'passive'
  ) {
    label.shape = shape;
  }
  const effects = readEffects(node);
  if (effects) label.effects = effects;
  if (childNamed(node, 'exclude_from_sim')) {
    label.excludedFromSim = boolField(node, 'exclude_from_sim', false);
  }
  const hyperlink = readHyperlink(node);
  if (hyperlink) label.hyperlink = hyperlink;
  const uuid = stringField(node, 'uuid');
  if (uuid) label.uuid = uuid;
  return label;
}

/** `(directive_label …)` / `(netclass_flag …)`, SCH_DIRECTIVE_LABEL. Only the
 *  placement and its fields are modelled: ERC's netclass test reads the
 *  "Netclass" field, and the node itself round-trips from `source`. */
function readDirectiveLabel(node: SList): SchDirectiveLabel {
  const { at, angle } = readAt(node);
  const first = node.items[1];
  const label: { -readonly [K in keyof SchDirectiveLabel]: SchDirectiveLabel[K] } = {
    text: first && first.kind !== 'list' ? first.value : '',
    at,
    angle,
    fields: childrenNamed(node, 'property').map((p) => readField(p)),
    source: node,
  };
  const shape = stringField(node, 'shape');
  if (shape === 'dot' || shape === 'round' || shape === 'diamond' || shape === 'rectangle') {
    label.shape = shape;
  }
  const length = childNamed(node, 'length');
  if (length) label.pinLength = mmToIU(numArg(length, 0) ?? 0);
  const uuid = stringField(node, 'uuid');
  if (uuid) label.uuid = uuid;
  return label;
}

function readTitleBlock(node: SList): TitleBlock {
  const tb: { -readonly [K in keyof TitleBlock]: TitleBlock[K] } = { source: node };
  const title = stringField(node, 'title');
  const date = stringField(node, 'date');
  const rev = stringField(node, 'rev');
  const company = stringField(node, 'company');
  if (title !== undefined) tb.title = title;
  if (date !== undefined) tb.date = date;
  if (rev !== undefined) tb.rev = rev;
  if (company !== undefined) tb.company = company;
  return tb;
}

/** `(group "NAME" (uuid …) [(locked yes)] [(lib_id "…")] (members …uuids))`
 *  (SCH_IO_KICAD_SEXPR_PARSER::parseGroup). */
function readGroup(node: SList): SchGroup {
  const g: { -readonly [K in keyof SchGroup]: SchGroup[K] } = {
    name: arg(node, 0) ?? '',
    members: [],
    source: node,
  };
  const uuid = stringField(node, 'uuid');
  if (uuid !== undefined) g.uuid = uuid;
  if (boolField(node, 'locked')) g.locked = true;
  const libId = stringField(node, 'lib_id');
  if (libId !== undefined) g.libId = libId;
  const members = childNamed(node, 'members');
  if (members) g.members = args(members);
  return g;
}

const LABEL_KINDS: Record<string, LabelKind> = {
  label: 'label',
  global_label: 'global_label',
  hierarchical_label: 'hierarchical_label',
  text: 'text',
};

const LINE_KINDS: Record<string, LineKind> = {
  wire: 'wire',
  bus: 'bus',
  polyline: 'polyline',
};

/** Build a typed Schematic from a parsed `(kicad_sch ...)` root list. */
/**
 * Read a symbol library: the `(symbol ...)` definitions inside a standalone
 * `(kicad_symbol_lib ...)` file (or a schematic's `(lib_symbols ...)` block).
 * These use the same definition format as embedded library symbols.
 */
export function readSymbolLib(root: SList): LibSymbol[] {
  return resolveExtends(childrenNamed(root, 'symbol').map(readLibSymbol));
}

export function readSchematic(root: SList): Schematic {
  if (head(root) !== 'kicad_sch') {
    throw new Error(`Expected a (kicad_sch ...) root, got (${head(root) ?? '?'} ...)`);
  }

  const libSymbols: LibSymbol[] = [];
  const symbols: SchSymbol[] = [];
  const lines: SchLine[] = [];
  const junctions: SchJunction[] = [];
  const noConnects: SchNoConnect[] = [];
  const labels: SchLabel[] = [];
  const sheets: SchSheet[] = [];
  const busEntries: SchBusEntry[] = [];
  const images: SchImage[] = [];
  const graphics: LibGraphic[] = [];
  const textBoxes: SchTextBox[] = [];
  const tables: SchTable[] = [];
  const groups: SchGroup[] = [];
  const directiveLabels: SchDirectiveLabel[] = [];

  const libSymbolsNode = childNamed(root, 'lib_symbols');
  if (libSymbolsNode) {
    for (const sym of resolveExtends(childrenNamed(libSymbolsNode, 'symbol').map(readLibSymbol)))
      libSymbols.push(sym);
  }

  for (const item of root.items) {
    if (!isList(item)) continue;
    const name = head(item);
    if (name === undefined) continue;

    if (name === 'symbol') symbols.push(readSymbol(item));
    else if (LINE_KINDS[name]) lines.push(readLine(item, LINE_KINDS[name]!));
    else if (name === 'junction') junctions.push(readJunction(item));
    else if (name === 'no_connect') noConnects.push(readNoConnect(item));
    else if (name === 'sheet') sheets.push(readSheet(item));
    else if (name === 'bus_entry') busEntries.push(readBusEntry(item));
    else if (name === 'image') images.push(readImage(item));
    else if (
      name === 'rectangle' ||
      name === 'circle' ||
      name === 'arc' ||
      name === 'bezier' ||
      name === 'ellipse' ||
      name === 'ellipse_arc'
    ) {
      const g = readGraphic(item, false); // sheet coordinates: +Y down, no invert
      if (g) graphics.push(g);
    } else if (name === 'rule_area') {
      // `(rule_area <attrs…> <shape>)`: SCH_RULE_AREA is a SCH_SHAPE, so the
      // shape inside is read exactly as a free-standing one and only carries a
      // flag saying which layer it belongs to. `saveRuleArea` wraps whatever
      // `saveShape` produced, so the child is a normal polyline/rectangle node.
      const shape = item.items.find((c): c is SList => isList(c) && SHAPE_KINDS.has(head(c) ?? ''));
      const g = shape ? readGraphic(shape, false) : undefined;
      // `readGraphic` never returns the text variant for these node names.
      if (g && g.kind !== 'text') graphics.push({ ...g, ruleArea: true, ruleAreaSource: item });
    } else if (name === 'text_box') textBoxes.push(readTextBox(item));
    else if (name === 'table') tables.push(readTable(item));
    else if (name === 'group') groups.push(readGroup(item));
    else if (name === 'directive_label' || name === 'netclass_flag')
      directiveLabels.push(readDirectiveLabel(item));
    else if (LABEL_KINDS[name]) labels.push(readLabel(item, LABEL_KINDS[name]!));
  }

  const sch: { -readonly [K in keyof Schematic]: Schematic[K] } = {
    version: numArg(childNamed(root, 'version') ?? root, 0) ?? 0,
    libSymbols,
    symbols,
    lines,
    junctions,
    noConnects,
    labels,
    sheets,
    busEntries,
    images,
    graphics,
    textBoxes,
    tables,
    groups,
    directiveLabels,
    // Document-level (sheet_instances (path "/" (page "1"))): the root sheet's page.
    sheetInstances: (() => {
      const n = childNamed(root, 'sheet_instances');
      return n ? childrenNamed(n, 'path').map((p) => readInstancePath(p, undefined)) : [];
    })(),
    source: root,
  };
  const generator = stringField(root, 'generator');
  const generatorVersion = stringField(root, 'generator_version');
  const uuid = stringField(root, 'uuid');
  // The full paper spec, not just the name: "A4", "A4 portrait" for a rotated
  // standard size, or "User 431.8 279.4" for a custom size (page_info format).
  const paperNode = childNamed(root, 'paper');
  const paper = paperNode ? args(paperNode).join(' ') : undefined;
  const titleBlockNode = childNamed(root, 'title_block');
  if (generator !== undefined) sch.generator = generator;
  if (generatorVersion !== undefined) sch.generatorVersion = generatorVersion;
  if (uuid !== undefined) sch.uuid = uuid;
  if (paper !== undefined) sch.paper = paper;
  if (titleBlockNode) sch.titleBlock = readTitleBlock(titleBlockNode);

  return sch;
}
