// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Factories for newly-created items.
 *
 * Every model item carries a `source` S-expression node (the lossless backing
 * store). Items created in the editor therefore get a freshly-built node here, so
 * they serialize correctly later and stay consistent with parsed items. Numbers
 * are written in millimetres, matching the file format.
 */

import { head, isList, list, atom, str, type SList } from '@ziroeda/sexpr/src/types.js';
import { iuToMM } from '@ziroeda/common/src/eda_units.js';
import { newKiid } from '@ziroeda/common/src/kiid.js';
import type {
  SchLine,
  SchJunction,
  SchNoConnect,
  SchSymbol,
  SchField,
  SchLabel,
  SchDirectiveLabel,
  DirectiveShape,
  LabelKind,
  LabelShape,
  LibSymbol,
  TextEffects,
  Vec2,
} from '../types.js';
import type { Orientation } from '@ziroeda/common/src/transform.js';
import { buildPropertyNode as writeFieldNode } from '../sch_io/sexpr/write-schematic.js';
import { flattenLibSymbol } from '../lib_symbol.js';
import { MANDATORY_FIELDS, isMandatoryField } from './properties.js';

/**
 * Set (or insert) the `(uuid ...)` child of an item node.
 *
 * A copied item needs this: `writeSymbol` and friends patch geometry and fields
 * back into the item's own `source` node but never its uuid, so a clone that
 * kept its original node would serialize under the original's uuid.
 */
export function nodeWithUuid(node: SList, uuid: string): SList {
  const items = node.items.filter((it) => !(isList(it) && head(it) === 'uuid'));
  // KiCad writes uuid before properties/pts-dependent children; keep it simple and
  // insert after the last of at/mirror/unit/attribute nodes, before property/pin.
  let insertAt = items.length;
  for (let i = 1; i < items.length; i++) {
    const it = items[i]!;
    if (isList(it) && (head(it) === 'property' || head(it) === 'pin' || head(it) === 'instances')) {
      insertAt = i;
      break;
    }
  }
  items.splice(insertAt, 0, list(atom('uuid'), str(uuid)));
  return { kind: 'list', items };
}

/**
 * New UUIDs for a copied symbol node: the symbol itself, and each `(pin ...)`
 * child.
 *
 * The `(instances ...)` block goes with them. It keys per-sheet-path reference
 * and unit by the *original* symbol's identity, so carrying it onto a copy
 * would hand the copy the original's annotation on every sheet that uses this
 * screen. KiCad drops it on paste for the same reason
 * (`PruneOrphanedSymbolInstances`).
 */
export function symbolNodeWithFreshUuids(node: SList): SList {
  const n = nodeWithUuid(node, newKiid());
  return {
    kind: 'list',
    items: symbolNodeWithoutInstances(n).items.map((it) =>
      isList(it) && head(it) === 'pin' ? nodeWithUuid(it, newKiid()) : it,
    ),
  };
}

/**
 * `prunePastedSymbolInstances` (sch_editor_control.cpp:2011-2030): a pasted
 * symbol drops the instance records the clipboard brought, which belong to
 * another project or to a sheet path that has nothing to do with the
 * destination. Upstream then rebuilds the destination's record with
 * `AddHierarchicalReference` (:1910); we have no per-sheet-path model to
 * rebuild into, so the Reference field alone carries the annotation — the
 * fallback `SCH_SYMBOL::GetRef` takes when no record matches the current path.
 *
 * Split out of {@link symbolNodeWithFreshUuids} because a paste that *keeps*
 * the symbol's KIID (:2354-2364) still has to prune: without this it would
 * paste a symbol whose records annotate a sheet path in the source project.
 */
export function symbolNodeWithoutInstances(node: SList): SList {
  return {
    kind: 'list',
    items: node.items.filter((it) => !(isList(it) && head(it) === 'instances')),
  };
}

/** Format an internal-unit coordinate as KiCad-style millimetres text. */
function mm(iu: number): string {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

const xy = (p: Vec2): SList => list(atom('xy'), atom(mm(p.x)), atom(mm(p.y)));

/** Build the `(wire ...)` node for a new wire segment. */
export function buildWireNode(start: Vec2, end: Vec2, uuid: string): SList {
  return list(
    atom('wire'),
    list(atom('pts'), xy(start), xy(end)),
    list(atom('stroke'), list(atom('width'), atom('0')), list(atom('type'), atom('default'))),
    list(atom('uuid'), str(uuid)),
  );
}

/** Build the `(junction ...)` node for a new junction. */
export function buildJunctionNode(at: Vec2, uuid: string): SList {
  return list(
    atom('junction'),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y))),
    list(atom('diameter'), atom('0')),
    list(atom('color'), atom('0'), atom('0'), atom('0'), atom('0')),
    list(atom('uuid'), str(uuid)),
  );
}

/** Create a new wire model item with a caller-supplied uuid (with its backing AST node). */
export function makeWireWithUuid(start: Vec2, end: Vec2, uuid: string): SchLine {
  return {
    kind: 'wire',
    start,
    end,
    stroke: { width: 0, type: 'default' },
    uuid,
    source: buildWireNode(start, end, uuid),
  };
}

/** Create a new wire model item (with its backing AST node). */
export function makeWire(start: Vec2, end: Vec2): SchLine {
  return makeWireWithUuid(start, end, newKiid());
}

/** Create a new bus model item, KiCad's `(bus ...)`, same shape as a wire. */
export function makeBus(start: Vec2, end: Vec2): SchLine {
  const uuid = newKiid();
  const node = list(
    atom('bus'),
    list(atom('pts'), xy(start), xy(end)),
    list(atom('stroke'), list(atom('width'), atom('0')), list(atom('type'), atom('default'))),
    list(atom('uuid'), str(uuid)),
  );
  return { kind: 'bus', start, end, stroke: { width: 0, type: 'default' }, uuid, source: node };
}

/** Options for a new label: flag shape (global/hier) and text angle (spin). */
export interface LabelOptions {
  shape?: LabelShape;
  angle?: number;
  /** Formatting from the label dialog (DIALOG_LABEL_PROPERTIES). */
  bold?: boolean;
  italic?: boolean;
  /** Text size in IU (both dimensions); default 1.27 mm. */
  fontSize?: number;
  /**
   * Glyph *width* in IU, when it differs from the height.
   *
   * `(font (size H W))` carries two numbers and KiCad sets them independently
   * (`SetTextHeight` / `SetTextWidth`); a graphics import is the case where they
   * differ, because the source drawing's X and Y scales need not match.
   * Defaults to `fontSize`, which is the square box every other caller wants.
   */
  fontWidth?: number;
  /**
   * `(justify …)`, replacing the per-kind default.
   *
   * A net label defaults to `left bottom` and everything else to `left`,
   * because that is where the placement tool puts them. An importer knows the
   * justification the source file specified and must not be overridden by it.
   */
  justify?: readonly string[];
  /** `(font … (color r g b a))` — rgb 0-255, alpha 0-1. */
  color?: readonly [number, number, number, number];
  /**
   * `(font … (thickness …))` in IU — an explicit glyph pen.
   *
   * Left out, the pen is derived from the size the way
   * `EDA_TEXT::GetEffectiveTextPenWidth` derives it, which is what every
   * interactive caller wants; a graphics import is the case that knows better.
   */
  thickness?: number;
}

/**
 * Create a net label / free text. Mirrors KiCad's `(label …)`, `(global_label …)`,
 * `(hierarchical_label …)` and `(text …)`. Global/hierarchical labels carry a
 * `(shape …)`; the default is bidirectional, as in KiCad's place-label tool.
 */
export function makeLabel(
  kind: LabelKind,
  text: string,
  at: Vec2,
  opts: LabelOptions = {},
): SchLabel {
  const uuid = newKiid();
  const angle = opts.angle ?? 0;
  const hasShape = kind === 'global_label' || kind === 'hierarchical_label';
  const shape: LabelShape = opts.shape ?? 'bidirectional';
  const sizeIU = opts.fontSize ?? 12700;
  const widthIU = opts.fontWidth ?? sizeIU;
  const justifyTokens = opts.justify ?? (kind === 'label' ? ['left', 'bottom'] : ['left']);
  const justify = list(atom('justify'), ...justifyTokens.map((t) => atom(t)));
  const fontItems: SList['items'] = [
    atom('font'),
    list(atom('size'), atom(mm(sizeIU)), atom(mm(widthIU))),
  ];
  if (opts.bold) fontItems.push(list(atom('bold'), atom('yes')));
  if (opts.italic) fontItems.push(list(atom('italic'), atom('yes')));
  // EDA_TEXT::Format order: size, thickness, bold, italic, color.
  if (opts.thickness !== undefined)
    fontItems.splice(2, 0, list(atom('thickness'), atom(mm(opts.thickness))));
  if (opts.color) {
    const [r, g, b, alpha] = opts.color;
    fontItems.push(
      list(atom('color'), atom(String(r)), atom(String(g)), atom(String(b)), atom(String(alpha))),
    );
  }
  const effects = list(atom('effects'), { kind: 'list', items: fontItems }, justify);
  const items: SList['items'] = [atom(kind), str(text)];
  if (hasShape) items.push(list(atom('shape'), atom(shape)));
  items.push(
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y)), atom(String(angle))),
    effects,
    list(atom('uuid'), str(uuid)),
  );
  const modelEffects: {
    -readonly [K in keyof TextEffects]?: TextEffects[K];
  } & { hidden: boolean } = {
    hidden: false,
    fontSize: [sizeIU, widthIU],
    justify: [...justifyTokens],
  };
  if (opts.bold) modelEffects.bold = true;
  if (opts.italic) modelEffects.italic = true;
  if (opts.color) modelEffects.color = opts.color;
  if (opts.thickness !== undefined) modelEffects.thickness = opts.thickness;
  const label: { -readonly [K in keyof SchLabel]: SchLabel[K] } = {
    kind,
    text,
    at,
    angle,
    uuid,
    effects: modelEffects,
    source: { kind: 'list', items },
  };
  if (hasShape) label.shape = shape;
  return label;
}

/** Create a new junction model item (with its backing AST node). */
export function makeJunction(at: Vec2): SchJunction {
  return makeJunctionWithUuid(at, newKiid());
}

/** The same with a caller-supplied uuid, so an undoable command can name it. */
export function makeJunctionWithUuid(at: Vec2, uuid: string): SchJunction {
  return { at, diameter: 0, uuid, source: buildJunctionNode(at, uuid) };
}

/** Create a new no-connect flag, KiCad's `(no_connect (at ..) (uuid ..))`. */
export function makeNoConnect(at: Vec2): SchNoConnect {
  const uuid = newKiid();
  const source = list(
    atom('no_connect'),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y))),
    list(atom('uuid'), str(uuid)),
  );
  return { at, uuid, source };
}

/** KiCad's default netclass-flag pin length (SCH_DIRECTIVE_LABEL: 1/2 inch grid
 *  step, i.e. 100 mil) and the fields it is created with. */
export const DEFAULT_DIRECTIVE_PIN_LENGTH = 25400;

/**
 * Create a netclass directive label, `(directive_label "" (length ..)
 * (shape ..) (at ..) (effects ..) (uuid ..) (property "Netclass" ..))`.
 * Mirrors SCH_DRAWING_TOOLS::createNewLabel's LAYER_NETCLASS_REFS branch: the
 * flag carries no text of its own, only a "Netclass" field.
 */
export function makeDirectiveLabel(
  at: Vec2,
  opts: {
    shape?: DirectiveShape;
    pinLength?: number;
    netclass?: string;
    angle?: number;
    fontSize?: number;
    /**
     * Every field the properties dialog collected. `createNewLabel` starts a
     * directive label with two —
     *
     *     labelItem->GetFields().emplace_back( labelItem, FIELD_T::USER, wxT( "Netclass" ) );
     *     labelItem->GetFields().emplace_back( labelItem, FIELD_T::USER, wxT( "Component Class" ) );
     *
     * — and the dialog may add more, so the whole list is carried rather than
     * the netclass alone. Empty ones are dropped, as an empty user field is
     * not written out.
     */
    fields?: readonly { key: string; value: string; effects?: TextEffects }[];
  } = {},
): SchDirectiveLabel {
  const uuid = newKiid();
  const angle = opts.angle ?? 0;
  const shape: DirectiveShape = opts.shape ?? 'round';
  const pinLength = opts.pinLength ?? DEFAULT_DIRECTIVE_PIN_LENGTH;
  const sizeIU = opts.fontSize ?? 12700;
  const fieldAt = { x: at.x, y: at.y };
  // The netclass argument stays authoritative for the Netclass row so a caller
  // that passes only it keeps working.
  const declared = (opts.fields ?? []).map((f) =>
    f.key === 'Netclass' ? { ...f, value: opts.netclass ?? f.value } : f,
  );
  const extras = declared.filter((f) => f.key !== 'Netclass' && f.value.trim() !== '');
  const netclassField = list(
    atom('property'),
    str('Netclass'),
    str(opts.netclass ?? ''),
    list(atom('at'), atom(mm(fieldAt.x)), atom(mm(fieldAt.y)), atom(String(angle))),
    list(
      atom('effects'),
      list(atom('font'), list(atom('size'), atom(mm(sizeIU)), atom(mm(sizeIU)))),
    ),
  );
  const extraNode = (f: { key: string; value: string; effects?: TextEffects }): SList =>
    list(
      atom('property'),
      str(f.key),
      str(f.value),
      list(atom('at'), atom(mm(fieldAt.x)), atom(mm(fieldAt.y)), atom(String(angle))),
      list(atom('effects'), {
        kind: 'list',
        items: [
          atom('font'),
          list(atom('size'), atom(mm(sizeIU)), atom(mm(sizeIU))),
          ...(f.effects?.italic ? [list(atom('italic'), atom('yes'))] : []),
        ],
      }),
    );
  const extraNodes = extras.map(extraNode);
  const source = list(
    atom('directive_label'),
    str(''),
    list(atom('length'), atom(mm(pinLength))),
    list(atom('shape'), atom(shape)),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y)), atom(String(angle))),
    list(
      atom('effects'),
      list(atom('font'), list(atom('size'), atom(mm(sizeIU)), atom(mm(sizeIU)))),
    ),
    list(atom('uuid'), str(uuid)),
    netclassField,
    ...extraNodes,
  );
  return {
    // The node above writes str('') as the first argument; keep the two in step.
    text: '',
    at,
    angle,
    shape,
    pinLength,
    fields: [
      {
        key: 'Netclass',
        value: opts.netclass ?? '',
        at: fieldAt,
        angle,
        effects: { hidden: false, fontSize: [sizeIU, sizeIU] },
        source: netclassField,
      },
      ...extras.map((f, i) => ({
        key: f.key,
        value: f.value,
        at: fieldAt,
        angle,
        effects: {
          hidden: false,
          fontSize: [sizeIU, sizeIU] as [number, number],
          ...(f.effects?.italic ? { italic: true } : {}),
        },
        source: extraNodes[i]!,
      })),
    ],
    uuid,
    source,
  };
}

const DEFAULT_FONT = (): SList =>
  list(atom('effects'), list(atom('font'), list(atom('size'), atom('1.27'), atom('1.27'))));

function buildPropertyNode(key: string, value: string, at: Vec2, angle: number): SList {
  return list(
    atom('property'),
    str(key),
    str(value),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y)), atom(String(angle))),
    DEFAULT_FONT(),
  );
}

/**
 * The library properties that are LIB_SYMBOL members upstream, not fields.
 * See `SCH_IO_KICAD_SEXPR_PARSER::parseProperty` (:1168-1201).
 */
const LIB_ONLY_PROPERTIES = new Set([
  'ki_keywords',
  'ki_description',
  'ki_fp_filters',
  'ki_locked',
]);

/**
 * One library field copied onto a placement: `ImportValues` plus
 * `SetTextPos( m_pos + libField->GetTextPos() )` (sch_symbol.cpp:1440-1441).
 *
 * The whole of the library field's presentation comes along — its visibility
 * above all, since these are the fields the library hides — so this goes
 * through the writer's `buildPropertyNode`, which emits `(hide yes)` and the
 * rest of the effects block. The local one a few lines up cannot: it writes the
 * default font and nothing else, which is all Reference and Value need.
 */
function copyLibField(key: string, tmpl: SchField, at: Vec2): SchField {
  const base: Omit<SchField, 'source'> = {
    key,
    value: tmpl.value,
    at: tmpl.at ? { x: at.x + tmpl.at.x, y: at.y + tmpl.at.y } : { ...at },
    angle: tmpl.angle,
    ...(tmpl.effects ? { effects: tmpl.effects } : {}),
    ...(tmpl.nameShown ? { nameShown: tmpl.nameShown } : {}),
    ...(tmpl.doNotAutoplace ? { doNotAutoplace: tmpl.doNotAutoplace } : {}),
    ...(tmpl.showInChooser ? { showInChooser: tmpl.showInChooser } : {}),
  };
  return { ...base, source: writeFieldNode(base) };
}

function buildSymbolNode(
  libId: string,
  at: Vec2,
  uuid: string,
  fields: SchField[],
  orient: Orientation,
  unit = 1,
): SList {
  const items: SList['items'] = [
    atom('symbol'),
    list(atom('lib_id'), str(libId)),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y)), atom(String(orient.angle))),
  ];
  if (orient.mirror) items.push(list(atom('mirror'), atom(orient.mirror)));
  items.push(
    list(atom('unit'), atom(String(unit))),
    list(atom('exclude_from_sim'), atom('no')),
    list(atom('in_bom'), atom('yes')),
    list(atom('on_board'), atom('yes')),
    list(atom('dnp'), atom('no')),
    list(atom('uuid'), str(uuid)),
    ...fields.map((f) => f.source),
  );
  return { kind: 'list', items };
}

/**
 * Create a newly-placed symbol from a library definition at `at`. Reference is
 * the library's reference prefix with a `?` (pre-annotation), as in KiCad; the
 * visible Reference/Value fields are offset using the library's field templates.
 */
export function makeSymbol(
  libSymbol: LibSymbol,
  at: Vec2,
  orient: Orientation = { angle: 0 },
  unit = 1,
): SchSymbol {
  // `SCH_SYMBOL::SCH_SYMBOL( const LIB_SYMBOL& … )` (sch_symbol.cpp:92):
  // `part = aSymbol.Flatten(); part->SetParent();` before it copies a single
  // field. A placement is never derived, so the fields it inherits — Sim.Device,
  // Sim.Pins and any other the parent defines — have to come from the flattened
  // symbol, not from the two or three properties the derived one lists.
  const lib = flattenLibSymbol(libSymbol);
  const uuid = newKiid();
  const refProp = lib.properties.find((p) => p.key === 'Reference');
  const valProp = lib.properties.find((p) => p.key === 'Value');
  const prefix = refProp?.value ?? 'U';
  const reference = /\?$/.test(prefix) ? prefix : `${prefix}?`;
  const value = valProp?.value ?? lib.libId.split(':').pop() ?? '';

  const mkField = (key: string, val: string, tmpl: SchField | undefined): SchField => {
    const fat: Vec2 = tmpl?.at ? { x: at.x + tmpl.at.x, y: at.y + tmpl.at.y } : at;
    const angle = tmpl?.angle ?? 0;
    return {
      key,
      value: val,
      at: fat,
      angle,
      effects: { hidden: false, fontSize: [12700, 12700] },
      source: buildPropertyNode(key, val, fat, angle),
    };
  };

  const fields: SchField[] = [
    mkField('Reference', reference, refProp),
    mkField('Value', value, valProp),
  ];

  // `SCH_SYMBOL::UpdateFields`, which the constructor calls with
  // `aUpdateStyle = true` (sch_symbol.cpp:97-101): for EVERY field the library
  // defines, `schField->SetTextPos( m_pos + libField->GetTextPos() )`
  // (:1438-1442). Mandatory and hidden ones included — a placement carries its
  // Footprint, Datasheet and Description fields from the moment it is made.
  //
  // Reference and Value are already above because their *text* is not the
  // library's: the reference is the prefix plus `?` and the value is the
  // symbol name. The other three take the library's text as they stand.
  //
  // It matters because these fields are hidden, and where a hidden field sits
  // is not visible until the user shows one. Device:C puts its Footprint at
  // (0.9652, -3.81), i.e. below the body — which is where KiCad draws the
  // footprint string. Ours had no such field until something created one, and
  // what created it put it at the symbol's own anchor, straight through the
  // body.
  for (const key of MANDATORY_FIELDS) {
    if (key === 'Reference' || key === 'Value') continue;
    const tmpl = lib.properties.find((p) => p.key === key);
    if (tmpl) fields.push(copyLibField(key, tmpl, at));
  }

  // ...then the library's own user fields, in the order it lists them.
  // `ki_keywords`, `ki_description`, `ki_fp_filters` and `ki_locked` are not
  // fields at all: the parser turns each into a LIB_SYMBOL member and returns
  // nullptr rather than a SCH_FIELD (sch_io_kicad_sexpr_parser.cpp:1168-1201),
  // so they never reach a placement. We keep them on `LibSymbol.properties`
  // because that is where the library file put them, which is why they have to
  // be skipped by name here.
  for (const tmpl of lib.properties) {
    if (isMandatoryField(tmpl.key) || LIB_ONLY_PROPERTIES.has(tmpl.key)) continue;
    fields.push(copyLibField(tmpl.key, tmpl, at));
  }

  const sym: { -readonly [K in keyof SchSymbol]: SchSymbol[K] } = {
    libId: lib.libId,
    at,
    angle: orient.angle,
    unit,
    bodyStyle: 1,
    inBom: true,
    onBoard: true,
    dnp: false,
    uuid,
    fields,
    source: buildSymbolNode(lib.libId, at, uuid, fields, orient, unit),
  };
  if (orient.mirror) sym.mirror = orient.mirror;
  return sym;
}
