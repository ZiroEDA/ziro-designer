// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Writer: typed Schematic model -> S-expression AST -> text.
 *
 * This is the counterpart to readSchematic and the payoff of the lossless design.
 * Each item keeps the `source` node it was read from (or a freshly built one for
 * created items); the writer reuses that node and only *patches* the coordinate
 * sub-nodes from the typed model. So:
 *   - unmodified items round-trip byte-for-byte (including fields we don't model),
 *   - moved/edited items get updated coordinates while keeping everything else,
 *   - new items serialize from their synthesized nodes,
 *   - deleted items simply aren't emitted.
 *
 * Items are written in KiCad's canonical top-level order; any other structural
 * nodes (sheet_instances, embedded_fonts, …) are preserved at the end.
 */

import { head, isList, list, atom, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { arg, childNamed, numArg } from '@ziroeda/sexpr/src/query.js';
import { iuToMM, mmToIU } from '@ziroeda/common/src/eda_units.js';
import { GENERATOR, GENERATOR_VERSION } from '@ziroeda/common/src/generator.js';
import { readEffects, readField } from './read-schematic.js';
import type {
  Schematic,
  SchSymbol,
  SchSymbolPin,
  SchLine,
  SchJunction,
  SchLabel,
  SchDirectiveLabel,
  SchField,
  SheetPin,
  Fill,
  SchNoConnect,
  SchSheet,
  SchBusEntry,
  SchTextBox,
  SchTable,
  SchTableCell,
  SchImage,
  LibGraphic,
  SchGroup,
  TextEffects,
  Stroke,
  SheetInstance,
  Vec2,
} from '../../types.js';

/** KiCad's fixed-point number formatting, trailing zeros trimmed. */
function num(v: number): string {
  let s = v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

function mm(iu: number): string {
  return num(iuToMM(iu));
}

/** Replace items[index] of a list, returning a new list. */
function setItem(node: SList, index: number, value: SNode): SList {
  const items = node.items.slice();
  items[index] = value;
  return { kind: 'list', items };
}

/** Map the first child list named `name`, returning a new parent list. */
function mapChild(node: SList, name: string, fn: (child: SList) => SList): SList {
  let done = false;
  const items = node.items.map((it) => {
    if (!done && isList(it) && head(it) === name) {
      done = true;
      return fn(it);
    }
    return it;
  });
  return { kind: 'list', items };
}

/** Patch the x/y of an `(at x y [angle])` child, keeping the angle and any extras. */
function patchAt(node: SList, p: Vec2): SList {
  return patchXY(node, 'at', p);
}

/** Patch the two coordinates of a `(<name> x y [extra…])` child, keeping the extras. */
function patchXY(node: SList, name: string, p: Vec2): SList {
  return mapChild(node, name, (child) => {
    const items = child.items.slice();
    items[1] = atom(mm(p.x));
    items[2] = atom(mm(p.y));
    return { kind: 'list', items };
  });
}

/**
 * Rewrite the `(xy …)` children of a `(pts …)` child from a vertex list.
 *
 * The vertex *count* can change, not just the coordinates: Add Corner and
 * Remove Corner (SCH_POINT_EDITOR) insert and drop points. So the xy nodes are
 * emitted to match the list exactly rather than patched one for one, which
 * would silently keep a polyline at the length it was read at. Everything in
 * `(pts …)` that is not an xy is left where it was.
 */
function patchPts(node: SList, points: readonly Vec2[]): SList {
  return mapChild(node, 'pts', (pts) => {
    const xy = (p: Vec2): SList => list(atom('xy'), atom(mm(p.x)), atom(mm(p.y)));
    const items: SNode[] = [];
    let i = 0;
    let lastXyAt = -1;
    for (const it of pts.items) {
      if (!isList(it) || head(it) !== 'xy') {
        items.push(it);
        continue;
      }
      // Source vertices beyond the list are dropped; the rest are rewritten.
      if (i < points.length) {
        lastXyAt = items.length;
        items.push(xy(points[i]!));
      }
      i++;
    }
    // Vertices the list gained go in after the last one written, so they stay
    // contiguous with the others rather than landing after a trailing child.
    if (i < points.length) {
      const added = points.slice(i).map(xy);
      items.splice(lastXyAt + 1, 0, ...added);
    }
    return { kind: 'list', items };
  });
}

// ----- property (field) writing ----------------------------------------------
//
// Mirrors KiCad's SCH_IO_KICAD_SEXPR::saveField + EDA_TEXT::Format for the parts
// we model, but as *patches*: every sub-edit compares against the parsed source
// and only rewrites the nodes whose semantic value actually changed, so unedited
// fields (including legacy spellings like a bare `hide` atom) round-trip
// byte-for-byte.

const DEFAULT_TEXT_SIZE = mmToIU(1.27); // DEFAULT_SIZE_TEXT (50 mil)

/** Remove bare `name` atoms and `(name ...)` children from a list. */
function stripToken(node: SList, name: string): SList {
  return {
    kind: 'list',
    items: node.items.filter(
      (it) => !(it.kind === 'atom' && it.value === name) && !(isList(it) && head(it) === name),
    ),
  };
}

/** True if the list has a bare `name` atom or a `(name yes)` child. */
function hasToken(node: SList, name: string): boolean {
  for (const it of node.items) {
    if (it.kind === 'atom' && it.value === name) return true;
    if (isList(it) && head(it) === name) {
      const v = it.items[1];
      return !v || (v.kind === 'atom' && v.value !== 'no');
    }
  }
  return false;
}

/** Set/clear a boolean token, preserving the existing spelling when already right. */
function setToken(node: SList, name: string, value: boolean): SList {
  if (hasToken(node, name) === value) return node;
  const stripped = stripToken(node, name);
  if (!value) return stripped;
  return { kind: 'list', items: [...stripped.items, list(atom(name), atom('yes'))] };
}

const sizeNode = (h: number, w: number): SList => list(atom('size'), atom(mm(h)), atom(mm(w)));

/** `(justify left bottom)` from a token array, or null when all-centred. */
function justifyNode(justify: readonly string[] | undefined): SList | null {
  const tokens = (justify ?? []).filter((t) => t !== 'center');
  if (tokens.length === 0) return null;
  return { kind: 'list', items: [atom('justify'), ...tokens.map((t) => atom(t))] };
}

/** Build a canonical `(effects ...)` node (EDA_TEXT::Format), or null if all-default. */
function buildEffects(fx: TextEffects | undefined): SList | null {
  const size = fx?.fontSize ?? [DEFAULT_TEXT_SIZE, DEFAULT_TEXT_SIZE];
  const nonDefaultSize = size[0] !== DEFAULT_TEXT_SIZE || size[1] !== DEFAULT_TEXT_SIZE;
  const just = justifyNode(fx?.justify);
  if (
    !fx ||
    (!nonDefaultSize &&
      !fx.bold &&
      !fx.italic &&
      !fx.hidden &&
      !just &&
      !fx.color &&
      !fx.face &&
      fx.thickness === undefined)
  ) {
    return null;
  }
  const font: SNode[] = [atom('font')];
  if (fx.face) font.push(list(atom('face'), str(fx.face)));
  font.push(sizeNode(size[0], size[1]));
  // EDA_TEXT::Format writes thickness straight after the size, before bold.
  if (fx.thickness !== undefined) font.push(list(atom('thickness'), atom(mm(fx.thickness))));
  if (fx.bold) font.push(list(atom('bold'), atom('yes')));
  if (fx.italic) font.push(list(atom('italic'), atom('yes')));
  if (fx.color) font.push(colorNode(fx.color));
  const items: SNode[] = [atom('effects'), { kind: 'list', items: font }];
  if (just) items.push(just);
  if (fx.hidden) items.push(list(atom('hide'), atom('yes')));
  return { kind: 'list', items };
}

/** Patch an existing `(effects ...)` node to match `fx`, changing only what differs. */
function patchEffects(effectsNode: SList, fx: TextEffects, orig: TextEffects | undefined): SList {
  let e = effectsNode;

  // Font size / bold / italic.
  const size = fx.fontSize;
  const boldChanged = !!fx.bold !== !!orig?.bold;
  const italicChanged = !!fx.italic !== !!orig?.italic;
  const sizeChanged =
    !!size && (size[0] !== orig?.fontSize?.[0] || size[1] !== orig?.fontSize?.[1]);
  const sameColor = (a: TextEffects['color'], b: TextEffects['color']): boolean =>
    a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);
  const colorChanged = !sameColor(fx.color, orig?.color);
  const faceChanged = (fx.face ?? '') !== (orig?.face ?? '');
  const thicknessChanged = fx.thickness !== orig?.thickness;
  if (
    sizeChanged ||
    boldChanged ||
    italicChanged ||
    colorChanged ||
    faceChanged ||
    thicknessChanged
  ) {
    if (!childNamed(e, 'font'))
      e = { kind: 'list', items: [e.items[0]!, list(atom('font')), ...e.items.slice(1)] };
    e = mapChild(e, 'font', (font) => {
      let f = font;
      if (sizeChanged && size) {
        f = childNamed(f, 'size')
          ? mapChild(f, 'size', () => sizeNode(size[0], size[1]))
          : { kind: 'list', items: [f.items[0]!, sizeNode(size[0], size[1]), ...f.items.slice(1)] };
      }
      if (thicknessChanged) {
        f = stripToken(f, 'thickness');
        if (fx.thickness !== undefined)
          f = {
            kind: 'list',
            items: [...f.items, list(atom('thickness'), atom(mm(fx.thickness)))],
          };
      }
      if (boldChanged) f = setToken(f, 'bold', !!fx.bold);
      if (italicChanged) f = setToken(f, 'italic', !!fx.italic);
      if (colorChanged) {
        f = stripToken(f, 'color');
        if (fx.color) f = { kind: 'list', items: [...f.items, colorNode(fx.color)] };
      }
      if (faceChanged) {
        f = stripToken(f, 'face');
        // KiCad writes the face first inside (font …).
        if (fx.face) {
          f = {
            kind: 'list',
            items: [f.items[0]!, list(atom('face'), str(fx.face)), ...f.items.slice(1)],
          };
        }
      }
      return f;
    });
  }

  // Justification: replace the whole (justify ...) child when it changed.
  const wantJust = justifyNode(fx.justify);
  const haveJust = justifyNode(orig?.justify);
  if (JSON.stringify(wantJust) !== JSON.stringify(haveJust)) {
    e = stripToken(e, 'justify');
    if (wantJust) {
      // Canonical position: after (font ...), before (hide ...).
      const items = e.items.slice();
      const fontIdx = items.findIndex((it) => isList(it) && head(it) === 'font');
      items.splice(fontIdx >= 0 ? fontIdx + 1 : items.length, 0, wantJust);
      e = { kind: 'list', items };
    }
  }

  // Visibility (`hide` is a bare atom in legacy files, `(hide yes)` in newer ones).
  e = setToken(e, 'hide', fx.hidden);
  return e;
}

/** Build a full `(property ...)` node for a field created in the editor.
 * `invertY` writes Y negated for symbol-library fields (stored +Y-up). */
export function buildPropertyNode(field: Omit<SchField, 'source'>, invertY = false): SList {
  const at = field.at ?? { x: 0, y: 0 };
  const y = invertY ? -at.y : at.y;
  const items: SNode[] = [
    atom('property'),
    str(field.key),
    str(field.value),
    list(atom('at'), atom(mm(at.x)), atom(mm(y)), atom(String(field.angle))),
  ];
  if (field.nameShown) items.push(list(atom('show_name'), atom('yes')));
  if (field.doNotAutoplace) items.push(list(atom('do_not_autoplace'), atom('yes')));
  const fx = buildEffects(field.effects);
  if (fx) items.push(fx);
  return { kind: 'list', items };
}

/**
 * Patch a `(property ...)` node to match the typed field, changing only what
 * differs. `invertY` writes Y negated, symbol-*library* fields are stored +Y-up
 * in the file while the model is +Y-down (the mirror of readField's invertY).
 * Exported for the symbol-library writer.
 */
export function patchProperty(propNode: SList, field: SchField, invertY = false): SList {
  const orig = readField(propNode, invertY);
  const fileAt = (p: Vec2): Vec2 => (invertY ? { x: p.x, y: -p.y } : p);
  let n = propNode;
  if (field.key !== orig.key) n = setItem(n, 1, str(field.key));
  if (field.value !== orig.value) n = setItem(n, 2, str(field.value)); // the value
  if (field.at && childNamed(n, 'at')) {
    if (field.at.x !== orig.at?.x || field.at.y !== orig.at?.y) n = patchAt(n, fileAt(field.at));
    if (field.angle !== orig.angle) n = patchAtAngle(n, field.angle);
  } else if (field.at) {
    // Field had no (at ...): insert one right after the value.
    const items = n.items.slice();
    const p = fileAt(field.at);
    items.splice(3, 0, list(atom('at'), atom(mm(p.x)), atom(mm(p.y)), atom(String(field.angle))));
    n = { kind: 'list', items };
  }
  // show_name sits between (at ...) and (effects ...) in KiCad's canonical order.
  if (hasToken(n, 'show_name') !== !!field.nameShown) {
    n = stripToken(n, 'show_name');
    if (field.nameShown) {
      const items = n.items.slice();
      const atIdx = items.findIndex((it) => isList(it) && head(it) === 'at');
      items.splice(atIdx >= 0 ? atIdx + 1 : items.length, 0, list(atom('show_name'), atom('yes')));
      n = { kind: 'list', items };
    }
  }
  // do_not_autoplace follows show_name, and like it is only written once set,
  // so a file that never carried the token keeps not carrying it.
  if (hasToken(n, 'do_not_autoplace') !== !!field.doNotAutoplace) {
    n = stripToken(n, 'do_not_autoplace');
    if (field.doNotAutoplace) {
      const items = n.items.slice();
      // After the last of (at …) / (show_name …), which is where KiCad's
      // canonical order puts it.
      let after = -1;
      items.forEach((it, i) => {
        if (isList(it) && (head(it) === 'at' || head(it) === 'show_name')) after = i;
      });
      items.splice(
        after >= 0 ? after + 1 : items.length,
        0,
        list(atom('do_not_autoplace'), atom('yes')),
      );
      n = { kind: 'list', items };
    }
  }
  // KiCad 7 files put a field's `(hide yes)` — or a bare `hide` — directly on
  // the property, outside `(effects …)`, and the reader honours that form by
  // forcing hidden. patchEffects writes the KiCad 8 form *inside* effects, so
  // un-hiding such a field wrote `(hide no)` inside while the old direct token
  // stayed put and won on the next read: the field would not un-hide. The
  // effects form is what we write, so the direct one is dropped.
  n = stripToken(n, 'hide');
  n = { kind: 'list', items: n.items.filter((it) => !(it.kind === 'atom' && it.value === 'hide')) };
  // Effects: patch in place when present; otherwise synthesize only if non-default.
  if (childNamed(n, 'effects')) {
    n = mapChild(n, 'effects', (e) =>
      patchEffects(e, field.effects ?? { hidden: false }, orig.effects),
    );
  } else {
    const fx = buildEffects(field.effects);
    if (fx) n = { kind: 'list', items: [...n.items, fx] };
  }
  return n;
}

/** Set the rotation angle (3rd element) of an `(at x y angle)` child. */
function patchAtAngle(node: SList, angle: number): SList {
  return mapChild(node, 'at', (at) => {
    const items = at.items.slice();
    items[3] = atom(String(angle));
    return { kind: 'list', items };
  });
}

/**
 * Reflect the typed mirror axis into the node: insert/update `(mirror x|y)` right
 * after `(at ...)`, or drop any existing mirror node when the symbol is unmirrored.
 * Matches KiCad, which writes `(mirror x)` / `(mirror y)` only when mirrored.
 */
function patchMirror(node: SList, mirror: 'x' | 'y' | undefined): SList {
  const items = node.items.filter((it) => !(isList(it) && head(it) === 'mirror'));
  if (mirror) {
    const atIdx = items.findIndex((it) => isList(it) && head(it) === 'at');
    const mirrorNode = list(atom('mirror'), atom(mirror));
    items.splice(atIdx >= 0 ? atIdx + 1 : items.length, 0, mirrorNode);
  }
  return { kind: 'list', items };
}

// Canonical order of a schematic (symbol ...)'s children (SCH_IO_KICAD_SEXPR::saveSymbol).
const SYMBOL_CHILD_ORDER = [
  'lib_name',
  'lib_id',
  'at',
  'mirror',
  'unit',
  'body_style',
  'exclude_from_sim',
  'in_bom',
  'on_board',
  'in_pos_files',
  'dnp',
  'passthrough',
  'locked',
  'fields_autoplaced',
  'uuid',
  'property',
  'pin',
  'instances',
];

/**
 * Insert `child` immediately before the first child named in `before`, or
 * append when none of them is present.
 *
 * The per-item writers upstream print their children in a fixed order, so a
 * value that was absent from the source has one right place to go. Patching
 * only when the child already exists — which is what these writers used to do —
 * silently drops an edit that introduces the child for the first time.
 */
function insertBeforeAny(node: SList, child: SList, before: readonly string[]): SList {
  const items = node.items.slice();
  const idx = items.findIndex((it) => isList(it) && before.includes(head(it) ?? ''));
  items.splice(idx === -1 ? items.length : idx, 0, child);
  return { kind: 'list', items };
}

/** Insert `child` after the last existing child that canonically precedes it. */
function insertCanonical(node: SList, child: SList): SList {
  const rank = SYMBOL_CHILD_ORDER.indexOf(head(child) ?? '');
  let insertAt = node.items.length;
  for (let i = node.items.length - 1; i >= 1; i--) {
    const it = node.items[i]!;
    const r = isList(it) ? SYMBOL_CHILD_ORDER.indexOf(head(it) ?? '') : -1;
    if (r !== -1 && r <= rank) {
      insertAt = i + 1;
      break;
    }
    insertAt = i;
  }
  const items = node.items.slice();
  items.splice(insertAt, 0, child);
  return { kind: 'list', items };
}

/** Patch `(name yes|no)`; insert canonically when absent and non-default. */
function patchSymbolBool(node: SList, name: string, value: boolean, dflt: boolean): SList {
  const child = childNamed(node, name);
  if (child) {
    const cur = child.items[1]?.kind === 'atom' ? child.items[1].value !== 'no' : true;
    if (cur === value) return node;
    return mapChild(node, name, () => list(atom(name), atom(value ? 'yes' : 'no')));
  }
  if (value === dflt) return node;
  return insertCanonical(node, list(atom(name), atom(value ? 'yes' : 'no')));
}

/** Patch `(passthrough block|force)`; DEFAULT (undefined) removes the token,
 *  the writer omits it "to avoid file churn" (saveSymbol). */
function patchPassthrough(node: SList, mode: 'block' | 'force' | undefined): SList {
  const child = childNamed(node, 'passthrough');
  if (!mode) {
    if (!child) return node;
    return { kind: 'list', items: node.items.filter((it) => it !== child) };
  }
  if (child) {
    if (child.items[1]?.kind === 'atom' && child.items[1].value === mode) return node;
    return mapChild(node, 'passthrough', () => list(atom('passthrough'), atom(mode)));
  }
  return insertCanonical(node, list(atom('passthrough'), atom(mode)));
}

/** Patch `(unit N)`; insert canonically when absent and not unit 1. */
function patchUnit(node: SList, unit: number): SList {
  const child = childNamed(node, 'unit');
  if (child) {
    if (numArg(child, 0) === unit) return node;
    return mapChild(node, 'unit', () => list(atom('unit'), atom(String(unit))));
  }
  if (unit === 1) return node;
  return insertCanonical(node, list(atom('unit'), atom(String(unit))));
}

/** Patch `(body_style N)`; insert canonically when absent and not style 1.
 *  saveSymbol writes it unconditionally, but adding it to a file that never had
 *  it would churn every symbol, so it appears once the style leaves 1. */
function patchBodyStyle(node: SList, bodyStyle: number): SList {
  const child = childNamed(node, 'body_style');
  if (child) {
    if (numArg(child, 0) === bodyStyle) return node;
    return mapChild(node, 'body_style', () => list(atom('body_style'), atom(String(bodyStyle))));
  }
  if (bodyStyle === 1) return node;
  return insertCanonical(node, list(atom('body_style'), atom(String(bodyStyle))));
}

function writeSymbol(sym: SchSymbol): SList {
  let node = patchAt(sym.source, sym.at);
  node = patchAtAngle(node, sym.angle);
  node = patchMirror(node, sym.mirror);
  node = patchUnit(node, sym.unit);
  node = patchBodyStyle(node, sym.bodyStyle);
  if (sym.excludedFromSim !== undefined)
    node = patchSymbolBool(node, 'exclude_from_sim', sym.excludedFromSim, false);
  node = patchSymbolBool(node, 'in_bom', sym.inBom, true);
  node = patchSymbolBool(node, 'on_board', sym.onBoard, true);
  // Written inverted, like saveSymbol's FormatBool( "in_pos_files", !excluded ).
  if (sym.excludedFromPosFiles !== undefined)
    node = patchSymbolBool(node, 'in_pos_files', !sym.excludedFromPosFiles, true);
  node = patchSymbolBool(node, 'dnp', sym.dnp, false);
  node = patchPassthrough(node, sym.passthrough);
  node = patchSymbolBool(node, 'locked', sym.locked ?? false, false);
  node = patchSymbolPins(node, sym.pins);

  // Rewrite the property block from the model's field list (order preserved), so
  // renamed/added/removed fields land exactly where KiCad writes them.
  const propNodes = sym.fields.map((f) => patchProperty(f.source, f));
  const items: SNode[] = [];
  let inserted = false;
  for (const it of node.items) {
    if (isList(it) && head(it) === 'property') {
      if (!inserted) {
        items.push(...propNodes);
        inserted = true;
      }
      continue; // old property nodes are replaced by the model's list
    }
    items.push(it);
  }
  if (!inserted) {
    // No properties in the source (unusual): put them before the first pin/instances.
    const idx = items.findIndex(
      (it) => isList(it) && (head(it) === 'pin' || head(it) === 'instances'),
    );
    items.splice(idx === -1 ? items.length : idx, 0, ...propNodes);
  }
  return { kind: 'list', items };
}

/**
 * Patch a placement's `(pin "N" (uuid …) [(alternate "NAME")])` children to
 * match the model, matching by pin number and leaving anything else in the node
 * alone. Counterpart: the `GetRawPins()` loop in `SCH_IO_KICAD_SEXPR::saveSymbol`.
 *
 * A pin the model does not mention keeps its node untouched — the model only
 * carries pins the *file* carried, so a symbol whose pins were never listed
 * does not grow a list here.
 */
function patchSymbolPins(node: SList, pins: readonly SchSymbolPin[] | undefined): SList {
  if (!pins?.length) return node;
  const byNumber = new Map(pins.map((p) => [p.number, p]));
  const written = new Set<string>();
  const items = node.items.map((it) => {
    if (!isList(it) || head(it) !== 'pin') return it;
    const number = arg(it, 0) ?? '';
    const pin = byNumber.get(number);
    if (!pin) return it;
    written.add(number);
    let n: SList = it;
    // saveSymbol writes no (alternate …) at all when the alt is empty *or*
    // equals the base pin name — a deliberate workaround for alternates that
    // were once set to the pin's own name. Clearing the model's alternate must
    // therefore remove the child, not write an empty one.
    n = stripToken(n, 'alternate');
    if (pin.alternate) {
      n = { kind: 'list', items: [...n.items, list(atom('alternate'), str(pin.alternate))] };
    }
    return n;
  });
  // A pin the file never listed but that now carries an alternate needs a node
  // of its own, or the selection is lost on save with nothing to show for it.
  // Only those: a pin with no alternate has nothing to say, and KiCad's writer
  // emits the full list on its next save anyway.
  const added = pins.filter((p) => p.alternate && !written.has(p.number));
  if (added.length) {
    const nodes = added.map((p) =>
      list(atom('pin'), str(p.number), list(atom('alternate'), str(p.alternate!))),
    );
    // Canonical position: after the properties, before (instances …).
    const idx = items.findIndex((it) => isList(it) && head(it) === 'instances');
    items.splice(idx === -1 ? items.length : idx, 0, ...nodes);
  }
  return { kind: 'list', items };
}

/** `(color r g b a)` from a typed colour; KiCad writes (0 0 0 0) for "unset". */
function colorNode(color: readonly [number, number, number, number] | undefined): SList {
  const [r, g, b, a] = color ?? [0, 0, 0, 0];
  return list(atom('color'), atom(String(r)), atom(String(g)), atom(String(b)), atom(String(a)));
}

/** Patch (or append) a `(stroke (width ..) (type ..) [(color ..)])` node to
 *  match `stroke`, leaving any other tokens in place. A set colour is written;
 *  clearing one rewrites an existing color child to KiCad's (0 0 0 0). */
function patchStroke(node: SList, stroke: Stroke | undefined): SList {
  if (!stroke) return node;
  if (childNamed(node, 'stroke')) {
    return mapChild(node, 'stroke', (s) => {
      let out = s;
      const width = list(atom('width'), atom(mm(stroke.width)));
      const type = list(atom('type'), atom(stroke.type));
      // STROKE_PARAMS::Format prints width, then type, then colour, and prints
      // all three: a source that carried only some of them must gain the rest
      // rather than swallow the edit.
      out = childNamed(out, 'width')
        ? mapChild(out, 'width', () => width)
        : insertBeforeAny(out, width, ['type', 'color']);
      out = childNamed(out, 'type')
        ? mapChild(out, 'type', () => type)
        : insertBeforeAny(out, type, ['color']);
      if (childNamed(out, 'color')) out = mapChild(out, 'color', () => colorNode(stroke.color));
      else if (stroke.color) out = { kind: 'list', items: [...out.items, colorNode(stroke.color)] };
      return out;
    });
  }
  const strokeItems = [
    atom('stroke'),
    list(atom('width'), atom(mm(stroke.width))),
    list(atom('type'), atom(stroke.type)),
    ...(stroke.color ? [colorNode(stroke.color)] : []),
  ];
  return { kind: 'list', items: [...node.items, list(...strokeItems)] };
}

function writeLine(l: SchLine): SList {
  // A multi-point polyline patches each vertex from `points`; a wire/bus has just
  // its two endpoints. Extra source xy's beyond what we model are left untouched.
  const verts = l.points ?? [l.start, l.end];
  return patchStroke(patchPts(l.source, verts), l.stroke);
}

/** Patch a junction: position, `(diameter ..)` and `(color ..)`. */
function writeJunction(j: SchJunction): SList {
  let node = patchAt(j.source, j.at);
  const diameter = list(atom('diameter'), atom(mm(j.diameter)));
  if (childNamed(node, 'diameter')) node = mapChild(node, 'diameter', () => diameter);
  // saveJunction always prints it, right after (at …) and before (color …), so
  // a diameter set on a junction whose file had none still round-trips.
  else if (j.diameter) node = insertBeforeAny(node, diameter, ['color', 'uuid']);
  if (childNamed(node, 'color')) node = mapChild(node, 'color', () => colorNode(j.color));
  else if (j.color) {
    // Insert before (uuid ..) to keep KiCad's field order (at diameter color uuid).
    const items = [...node.items];
    const uuidIdx = items.findIndex((it) => isList(it) && head(it) === 'uuid');
    items.splice(uuidIdx === -1 ? items.length : uuidIdx, 0, colorNode(j.color));
    node = { kind: 'list', items };
  }
  return node;
}

const writeNoConnect = (nc: SchNoConnect): SList => patchAt(nc.source, nc.at);

/**
 * Patch a bus entry: its anchor and its `(size …)`.
 *
 * The size is a *vector*, and its signs are the entry's direction — the entry
 * tool turns a stub through its four orientations by rotating that vector
 * (`{x: sz.y, y: -sz.x}`), so dropping it saved every entry pointing down-right
 * whichever way it was drawn. saveBusEntry prints it right after (at …).
 */
function writeBusEntry(be: SchBusEntry): SList {
  const node = patchAt(be.source, be.at);
  const size = list(atom('size'), atom(mm(be.size.x)), atom(mm(be.size.y)));
  const withSize = childNamed(node, 'size')
    ? mapChild(node, 'size', () => size)
    : insertBeforeAny(node, size, ['stroke', 'uuid']);
  // A bus entry carries a stroke like any wire, and DIALOG_WIRE_BUS_PROPERTIES
  // edits it. The patch was missing, so a width or style change would have been
  // lost on save — the same shape as the six the writer audit found.
  return patchStroke(withSize, be.stroke);
}

/** Patch the `(page …)` inside each `(path …)` of an `(instances …)` or
 *  `(sheet_instances …)` node from the typed instances, keyed by project+path. */
function patchInstancePages(
  node: SList,
  pageByKey: ReadonlyMap<string, string | undefined>,
  hasProject: boolean,
): SList {
  const patchPath = (pathNode: SList, project: string): SList => {
    const page = pageByKey.get(`${project}\u0000${arg(pathNode, 0) ?? ''}`);
    if (page === undefined || !childNamed(pathNode, 'page')) return pathNode;
    return mapChild(pathNode, 'page', () => list(atom('page'), str(page)));
  };
  const items = node.items.map((it) => {
    if (!isList(it)) return it;
    if (hasProject && head(it) === 'project') {
      const proj = arg(it, 0) ?? '';
      return {
        kind: 'list' as const,
        items: it.items.map((p) => (isList(p) && head(p) === 'path' ? patchPath(p, proj) : p)),
      };
    }
    if (!hasProject && head(it) === 'path') return patchPath(it, '');
    return it;
  });
  return { kind: 'list', items };
}

const instanceKey = (i: SheetInstance): string => `${i.project ?? ''}\u0000${i.path}`;

/** Patch a sheet: its position, each field, each pin, and instance page numbers. */
/**
 * Patch a sheet pin in place: its name, flag shape, position/side, and its own
 * `(property …)` fields — SCH_SHEET_PIN is a SCH_LABEL_BASE, so the properties
 * dialog can give it fields like any other label.
 */
/** `(fill (type ..) [(color ..)])`, as the graphic builders write it. */
function textBoxFillNode(fill: Fill): SList {
  const items: SNode[] = [atom('fill'), list(atom('type'), atom(fill.type))];
  if (fill.color) items.push(colorNode(fill.color));
  return { kind: 'list', items };
}

function writeSheetPin(node: SList, pin: SheetPin): SList {
  let n = setItem(node, 1, str(pin.name));
  n = setItem(n, 2, atom(pin.shape));
  n = patchAt(n, pin.at);
  n = mapChild(n, 'at', (at) => setItem(at, 3, atom(String(pin.angle))));
  // Formatting, the same way a label patches it: the pin's text is editable
  // through its properties dialog and through Edit Text & Graphics.
  if (pin.effects && childNamed(n, 'effects')) {
    const orig = readEffects(node);
    n = mapChild(n, 'effects', (e) => patchEffects(e, pin.effects!, orig));
  }
  const fields = pin.fields ?? [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const written = new Set<string>();
  // Existing property nodes are patched in place; fields the dialog added are
  // appended, ones it removed are dropped.
  const items: SNode[] = [];
  for (const it of n.items) {
    if (isList(it) && head(it) === 'property') {
      const key = it.items[1];
      const f = key && key.kind === 'string' ? byKey.get(key.value) : undefined;
      if (!f) continue;
      written.add(f.key);
      items.push(patchProperty(it, f));
      continue;
    }
    items.push(it);
  }
  for (const f of fields) if (!written.has(f.key)) items.push(buildPropertyNode(f));
  return { kind: 'list', items };
}

function writeSheet(sh: SchSheet): SList {
  let node = patchAt(sh.source, sh.at);
  // `(size w h)`, so a resize (SCH_POINT_EDITOR's sheet handles) round-trips.
  if (childNamed(node, 'size')) {
    node = mapChild(node, 'size', () =>
      list(atom('size'), atom(mm(sh.size.w)), atom(mm(sh.size.h))),
    );
  }
  // Attributes, written the same way a symbol's are: an explicit yes/no, added
  // only once the flag leaves its default so a file that never carried the
  // token keeps not carrying it. `in_bom` and `on_board` are stored inverted
  // from the dialog's "Exclude from…", exactly as saveSheet writes them.
  node = patchSymbolBool(node, 'in_bom', sh.inBom, true);
  node = patchSymbolBool(node, 'on_board', sh.onBoard, true);
  node = patchSymbolBool(node, 'dnp', sh.dnp, false);
  if (sh.excludedFromSim !== undefined)
    node = patchSymbolBool(node, 'exclude_from_sim', sh.excludedFromSim, false);
  // Border width and colour live in the sheet's `(stroke …)`.
  node = patchStroke(node, sh.stroke);
  // `(fill (color r g b a))`; an absent background is alpha 0, which is how
  // saveSheet writes COLOR4D::UNSPECIFIED.
  //
  // saveSheet prints this for every sheet, unconditionally:
  //
  //     m_out->Print( "(fill (color %d %d %d %s))", ... );
  //
  // Patching only an existing node — which is what this did — silently dropped
  // any background colour set on a sheet whose source carried no `(fill …)`, or
  // carried one without a `(color …)` inside it. Autosave re-reads what it
  // wrote, so the colour survived the edit and vanished a second later.
  const colour = colorNode(sh.fillColor ?? [0, 0, 0, 0]);
  if (!childNamed(node, 'fill')) {
    node = insertBeforeAny(node, list(atom('fill'), colour), ['uuid', 'property', 'pin']);
  } else {
    node = mapChild(node, 'fill', (f) =>
      childNamed(f, 'color') ? mapChild(f, 'color', () => colour) : insertBeforeAny(f, colour, []),
    );
  }
  if (childNamed(node, 'instances') && sh.instances.length) {
    const pages = new Map(sh.instances.map((i) => [instanceKey(i), i.page]));
    node = mapChild(node, 'instances', (inst) => patchInstancePages(inst, pages, true));
  }
  const byKey = new Map(sh.fields.map((f) => [f.key, f]));
  // The pins come from the model, not from the source's pin nodes.
  //
  // `saveSheet` prints `aSheet->GetPins()`, so the object is what the file
  // says. Patching the source's nodes one-for-one instead — which is what this
  // did — worked only while the count never fell: delete a pin and the model
  // shrank while the leftover node stayed behind, so the file came back with
  // the old pin still on it and the deletion undid itself on the next load.
  // Each pin carries its own `source`, so the ones that were already there
  // still round-trip byte-for-byte.
  const pinNodes = sh.pins.map((p) => writeSheetPin(p.source, p));
  let emitted = false;
  const items: SNode[] = [];
  for (const it of node.items) {
    if (isList(it) && head(it) === 'property') {
      const key = it.items[1];
      const f = key && key.kind === 'string' ? byKey.get(key.value) : undefined;
      items.push(f ? patchProperty(it, f) : it);
      continue;
    }
    if (isList(it) && head(it) === 'pin') {
      // Where the first one was, so a sheet KiCad wrote keeps its node order.
      if (!emitted) {
        emitted = true;
        items.push(...pinNodes);
      }
      continue;
    }
    items.push(it);
  }
  if (!emitted) items.push(...pinNodes);
  return { kind: 'list', items };
}

function writeLabel(l: SchLabel): SList {
  let node = patchAt(setItem(l.source, 1, str(l.text)), l.at);
  // Orientation is the third `(at x y angle)` argument.
  node = mapChild(node, 'at', (at) => setItem(at, 3, atom(String(l.angle))));
  // Global/hierarchical labels carry a `(shape …)`; patch it in place when
  // present so a shape edit round-trips (local labels/text have no shape).
  if (l.shape !== undefined) {
    const shape = list(atom('shape'), atom(l.shape));
    // saveText prints (shape …) before (at …) for global/hierarchical labels.
    node = childNamed(node, 'shape')
      ? mapChild(node, 'shape', () => shape)
      : insertBeforeAny(node, shape, ['at']);
  }
  // Formatting edits (bold/italic/size/justify) patch the `(effects …)` node
  // against the source's parsed effects, keeping everything else byte-stable.
  if (l.effects && childNamed(node, 'effects')) {
    const orig = readEffects(l.source);
    node = mapChild(node, 'effects', (e) => patchEffects(e, l.effects!, orig));
  }
  // `(exclude_from_sim yes|no)`, written only once the model carries it, so a
  // file that never had the token keeps not having it.
  if (l.excludedFromSim !== undefined) node = setToken(node, 'exclude_from_sim', l.excludedFromSim);
  node = setHyperlink(node, l.hyperlink);
  return node;
}

/** `(hyperlink "…")`, written only while one is set (SCH_TEXT::Format). */
function setHyperlink(node: SList, link: string | undefined): SList {
  const have = childNamed(node, 'hyperlink');
  const current = have ? (arg(have, 0) ?? '') : '';
  if ((link ?? '') === current) return node;
  const stripped: SList = {
    kind: 'list',
    items: node.items.filter((it) => !(isList(it) && head(it) === 'hyperlink')),
  };
  if (!link) return stripped;
  return { kind: 'list', items: [...stripped.items, list(atom('hyperlink'), str(link))] };
}

/**
 * Patch a netclass directive label: its position, orientation, flag shape, pin
 * length and its fields (the "Netclass" property the dialog edits). Everything
 * else in the node, effects, uuid, anything we don't model, passes through.
 */
function writeDirectiveLabel(l: SchDirectiveLabel): SList {
  // The text is the node's first argument, like every other label's.
  let node = setItem(l.source, 1, str(l.text));
  node = patchAt(node, l.at);
  node = mapChild(node, 'at', (at) => setItem(at, 3, atom(String(l.angle))));
  if (l.pinLength !== undefined) {
    // saveText prints (length …) first for a directive label, then (shape …),
    // then (at …).
    const len = list(atom('length'), atom(mm(l.pinLength)));
    node = childNamed(node, 'length')
      ? mapChild(node, 'length', () => len)
      : insertBeforeAny(node, len, ['shape', 'at']);
  }
  if (l.shape !== undefined) {
    const shape = list(atom('shape'), atom(l.shape));
    node = childNamed(node, 'shape')
      ? mapChild(node, 'shape', () => shape)
      : insertBeforeAny(node, shape, ['at']);
  }
  const byKey = new Map(l.fields.map((f) => [f.key, f]));
  node = {
    kind: 'list',
    items: node.items.map((it) => {
      if (isList(it) && head(it) === 'property') {
        const key = it.items[1];
        const f = key && key.kind === 'string' ? byKey.get(key.value) : undefined;
        return f ? patchProperty(it, f) : it;
      }
      return it;
    }),
  };
  return node;
}

/** Patch a text box: content (item 1), position (`at` = start) and `(size ..)`. */
function writeTextBox(tb: SchTextBox): SList {
  let node = setItem(tb.source, 1, str(tb.text));
  node = patchAt(node, tb.start);
  // A text box rotates (SCH_TEXTBOX, R on a selected box, which flips angle
  // between 0 and 90) and patchAt writes only x and y, keeping whatever third
  // item the file already had. So a rotation lived in the model and on screen
  // and never reached the file. Found by the structural writer sweep.
  node = patchAtAngle(node, tb.angle);
  const size = { x: tb.end.x - tb.start.x, y: tb.end.y - tb.start.y };
  if (childNamed(node, 'size')) {
    node = mapChild(node, 'size', () => list(atom('size'), atom(mm(size.x)), atom(mm(size.y))));
  }
  // saveTextBox prints (margins l t r b) right after (size …); the writer used
  // not to emit them at all, so a text box's text inset was lost on save.
  if (tb.margins) {
    const m = tb.margins;
    const margins = list(
      atom('margins'),
      atom(mm(m.left)),
      atom(mm(m.top)),
      atom(mm(m.right)),
      atom(mm(m.bottom)),
    );
    node = childNamed(node, 'margins')
      ? mapChild(node, 'margins', () => margins)
      : insertBeforeAny(node, margins, ['stroke', 'fill', 'effects', 'uuid']);
  }
  if (tb.effects && childNamed(node, 'effects')) {
    const orig = readEffects(tb.source);
    node = mapChild(node, 'effects', (e) => patchEffects(e, tb.effects!, orig));
  }
  if (tb.stroke) node = patchStroke(node, tb.stroke);
  if (tb.fill && childNamed(node, 'fill')) {
    node = mapChild(node, 'fill', () => textBoxFillNode(tb.fill!));
  }
  if (tb.excludedFromSim !== undefined) {
    node = setToken(node, 'exclude_from_sim', tb.excludedFromSim);
  }
  node = setHyperlink(node, tb.hyperlink);
  return node;
}

/** Patch a table cell: content (item 1), position and size (like a text box). */
/** `(group "name" (uuid …) [(locked yes)] [(lib_id "…")] (members …))` with the
 *  member uuids sorted, exactly as SCH_IO_KICAD_SEXPR::saveGroup emits it. */
function writeGroup(g: SchGroup): SList {
  const items: SNode[] = [atom('group'), str(g.name)];
  if (g.uuid !== undefined) items.push(list(atom('uuid'), str(g.uuid)));
  if (g.locked) items.push(list(atom('locked'), atom('yes')));
  if (g.libId !== undefined) items.push(list(atom('lib_id'), str(g.libId)));
  items.push(list(atom('members'), ...[...g.members].sort().map(str)));
  return { kind: 'list', items };
}

function writeTableCell(cell: SchTableCell): SList {
  let node = setItem(cell.source, 1, str(cell.text));
  node = patchAt(node, cell.start);
  const size = { x: cell.end.x - cell.start.x, y: cell.end.y - cell.start.y };
  if (childNamed(node, 'size')) {
    node = mapChild(node, 'size', () => list(atom('size'), atom(mm(size.x)), atom(mm(size.y))));
  }
  // The span was read and never written back, because until merge/unmerge
  // nothing could change it. It is added when absent as well as patched: a cell
  // that had no `(span ...)` is a 1x1 one, and after a merge it is not.
  const span = list(atom('span'), atom(String(cell.colSpan)), atom(String(cell.rowSpan)));
  node = childNamed(node, 'span')
    ? mapChild(node, 'span', () => span)
    : { kind: 'list', items: [...node.items, span] };
  // Margins, fill and effects, the same three a text box patches. They were
  // skipped for the same reason the span was -- nothing could change them --
  // and the cell properties dialog changes all three.
  if (cell.margins) {
    const m = cell.margins;
    const margins = list(
      atom('margins'),
      atom(mm(m.left)),
      atom(mm(m.top)),
      atom(mm(m.right)),
      atom(mm(m.bottom)),
    );
    node = childNamed(node, 'margins')
      ? mapChild(node, 'margins', () => margins)
      : insertBeforeAny(node, margins, ['fill', 'effects', 'uuid']);
  }
  if (cell.fill && childNamed(node, 'fill')) {
    node = mapChild(node, 'fill', () => textBoxFillNode(cell.fill!));
  }
  if (cell.effects && childNamed(node, 'effects')) {
    const orig = readEffects(cell.source);
    node = mapChild(node, 'effects', (e) => patchEffects(e, cell.effects!, orig));
  }
  return node;
}

/**
 * Set a `(name yes|no)` child inside a node, adding it when absent.
 *
 * The reader defaults a missing flag to false, so writing it explicitly is what
 * makes a change survive: a node that never carried `(header no)` would
 * otherwise keep reading back as whatever it had before.
 */
function setFlagChild(node: SList, name: string, value: boolean): SList {
  const flag = list(atom(name), atom(value ? 'yes' : 'no'));
  return childNamed(node, name)
    ? mapChild(node, name, () => flag)
    : { kind: 'list', items: [...node.items, flag] };
}

/**
 * Patch a table: its `(cells ...)` block, and the border and separator flags.
 *
 * The flags were not patched at all until the properties panel made them
 * editable — the eighth-and-a-half instance of the shape the writer audit
 * named, and the one I introduced myself by adding the rows before checking
 * their patcher. `(border ...)` and `(separators ...)` are only written when
 * the node already has them: a table that never carried either is left alone
 * rather than gaining nodes it did not have.
 */
function writeTable(tb: SchTable): SList {
  let node = tb.source;
  // The two `(stroke …)` children are patched alongside the flags. They were
  // read and never written, which was invisible while nothing could change them
  // — DIALOG_TABLE_PROPERTIES changes both, and it is also how "no line" is
  // stored, as a width of −1. Without this a border switched off came back on
  // at the next load.
  if (childNamed(node, 'border')) {
    node = mapChild(node, 'border', (b) =>
      patchStroke(
        setFlagChild(setFlagChild(b, 'external', tb.borderExternal), 'header', tb.borderHeader),
        tb.borderStroke,
      ),
    );
  }
  if (childNamed(node, 'separators')) {
    node = mapChild(node, 'separators', (sep) =>
      patchStroke(
        setFlagChild(setFlagChild(sep, 'rows', tb.separatorRows), 'cols', tb.separatorCols),
        tb.separatorsStroke,
      ),
    );
  }
  // The shape of the table is patched too, not just each cell's contents. It
  // was safe to skip while a table could only be read: adding or deleting a row
  // changes the cell count, the column count and the width/height lists, and a
  // patcher that walked the *source* nodes would silently write the old shape.
  node = mapChild(node, 'column_count', () =>
    list(atom('column_count'), atom(String(tb.columnCount))),
  );
  if (childNamed(node, 'column_widths'))
    node = mapChild(node, 'column_widths', () =>
      list(atom('column_widths'), ...tb.colWidths.map((w) => atom(mm(w)))),
    );
  if (childNamed(node, 'row_heights'))
    node = mapChild(node, 'row_heights', () =>
      list(atom('row_heights'), ...tb.rowHeights.map((h) => atom(mm(h)))),
    );
  // Built from the model's cells rather than from the source list, so a table
  // that gained or lost cells writes the cells it actually has. Each cell still
  // patches its own source node, so an untouched table is still byte-stable.
  return mapChild(node, 'cells', () => ({
    kind: 'list',
    items: [atom('cells'), ...tb.cells.map(writeTableCell)],
  }));
}

/**
 * Patch a sheet-level graphic shape's geometry against its source node.
 *
 * Each kind is patched through the sub-nodes the reader took it from
 * (`readGraphic`), so stroke, fill, uuid and anything we don't model ride along
 * untouched. Sheet coordinates are +Y down, so unlike the symbol-library writer
 * there is no Y inversion here.
 */
/** Replace a single-value child like `(major_radius 5.08)`, adding it if absent. */
function patchNumberChild(node: SList, name: string, value: string): SList {
  const next = list(atom(name), atom(value));
  return childNamed(node, name)
    ? mapChild(node, name, () => next)
    : { kind: 'list', items: [...node.items, next] };
}

function writeGraphic(g: LibGraphic): SList {
  // Text is the one graphic with no border or fill; the rest carry both, and
  // DIALOG_SHAPE_PROPERTIES edits them, so they are patched alongside geometry.
  if (g.kind === 'text') return patchAt(setItem(g.source, 1, str(g.text)), g.at);

  let node: SList;
  switch (g.kind) {
    case 'rectangle':
      node = patchXY(patchXY(g.source, 'start', g.start), 'end', g.end);
      break;
    case 'circle':
      node = patchXY(g.source, 'center', g.center);
      if (childNamed(node, 'radius'))
        node = mapChild(node, 'radius', () => list(atom('radius'), atom(mm(g.radius))));
      break;
    case 'arc':
      node = patchXY(patchXY(patchXY(g.source, 'start', g.start), 'mid', g.mid), 'end', g.end);
      break;
    case 'polyline':
    case 'bezier':
      node = patchPts(g.source, g.points);
      break;
    case 'ellipse':
    case 'ellipse_arc': {
      // `formatEllipse`:
      //
      //     "(ellipse %s (center %s) (major_radius %s) (minor_radius %s) (rotation_angle %s)"
      //
      // plus `(start_angle …)` / `(end_angle …)` for the arc form.
      node = patchXY(g.source, 'center', g.center);
      node = patchNumberChild(node, 'major_radius', mm(g.majorRadius));
      node = patchNumberChild(node, 'minor_radius', mm(g.minorRadius));
      node = patchNumberChild(node, 'rotation_angle', num(g.rotation));
      if (g.kind === 'ellipse_arc') {
        node = patchNumberChild(node, 'start_angle', num(g.startAngle));
        node = patchNumberChild(node, 'end_angle', num(g.endAngle));
      }
      break;
    }
  }
  node = patchStroke(node, g.stroke);
  node = patchShapeFill(node, g.fill);

  // `saveRuleArea` is `saveShape` inside a wrapper that carries the four
  // attribute flags:
  //
  //     m_out->Print( "(rule_area " );
  //     ... FormatBool( exclude_from_sim / in_bom / on_board / dnp ) ...
  //     saveShape( aRuleArea );
  //     m_out->Print( ")" );
  //
  // A rule area read from a file keeps its wrapper, so those flags round-trip
  // whatever they were set to; one drawn here gets a fresh wrapper with the
  // defaults `SCH_RULE_AREA`'s constructor uses.
  if (!g.ruleArea) return node;
  const wrapper =
    g.ruleAreaSource ??
    list(
      atom('rule_area'),
      list(atom('exclude_from_sim'), atom('no')),
      list(atom('in_bom'), atom('yes')),
      list(atom('on_board'), atom('yes')),
      list(atom('dnp'), atom('no')),
    );
  const shaped = node;
  const items = wrapper.items.filter((it) => !(isList(it) && SHAPE_NODE_NAMES.has(head(it) ?? '')));
  return { kind: 'list', items: [...items, shaped] };
}

/** The node names `saveShape` emits, i.e. the child a `(rule_area …)` wraps. */
const SHAPE_NODE_NAMES = new Set([
  'polyline',
  'rectangle',
  'circle',
  'arc',
  'bezier',
  'ellipse',
  'ellipse_arc',
]);

/**
 * Patch a shape's `(fill (type …) [(color …)])`.
 *
 * The fill type is one of UI_FILL_MODE's five, and the colour only means
 * anything for `color`, so switching away from it drops the colour rather than
 * leaving a stale one behind for the next switch back to pick up.
 */
function patchShapeFill(node: SList, fill: Fill | undefined): SList {
  if (!fill) return node;
  const items: SNode[] = [atom('fill'), list(atom('type'), atom(fill.type))];
  if (fill.color) items.push(colorNode(fill.color));
  const next: SList = { kind: 'list', items };
  if (childNamed(node, 'fill')) return mapChild(node, 'fill', () => next);
  return { kind: 'list', items: [...node.items, next] };
}

/**
 * Patch an image: `(at x y)` and `(scale …)`; the `(data …)` payload is
 * untouched. Scale is a bare multiplier, not a length, so it is not in IU.
 */
function writeImage(im: SchImage): SList {
  const node = patchAt(im.source, im.at);
  // saveBitmap omits the scale entirely at 1.0 and prints it after (at …)
  // otherwise, so a resized image round-trips and one scaled back to 1 drops
  // the token again rather than leaving a stale one behind.
  if (im.scale === 1) {
    if (!childNamed(node, 'scale')) return node;
    return {
      kind: 'list',
      items: node.items.filter((it) => !(isList(it) && head(it) === 'scale')),
    };
  }
  const scale = list(atom('scale'), atom(num(im.scale)));
  return childNamed(node, 'scale')
    ? mapChild(node, 'scale', () => scale)
    : insertBeforeAny(node, scale, ['uuid']);
}

const HEADER_ORDER = ['version', 'generator', 'generator_version', 'uuid', 'paper', 'title_block'];
const STRUCTURAL = new Set([...HEADER_ORDER, 'lib_symbols']);
/**
 * Node names `writeSchematic` re-emits from the model. Anything *not* here is
 * copied through from the source untouched, so a name missing from this set is
 * written twice — once from the model, once as an unrecognised leftover.
 */
const ITEM_HEADS = new Set([
  'symbol',
  'wire',
  'bus',
  'polyline',
  'junction',
  'no_connect',
  'label',
  'global_label',
  'hierarchical_label',
  'text',
  'bus_entry',
  'sheet',
  'image',
  'rectangle',
  'circle',
  'arc',
  'bezier',
  'ellipse',
  'ellipse_arc',
  // A rule area is written from `sch.graphics` too (writeGraphic re-wraps it),
  // so its original node must not also pass through below — that duplicated
  // every rule area on save.
  'rule_area',
  'text_box',
  'table',
  'group',
  'directive_label',
  'netclass_flag',
]);

/** Rebuild the `(kicad_sch ...)` root list from the current model. */
export function writeSchematic(sch: Schematic): SList {
  const out: SNode[] = [atom('kicad_sch')];

  for (const name of HEADER_ORDER) {
    // We wrote this file, so we name ourselves, exactly as KiCad overwrites the
    // generator with its own name on save. Preserving the original would leave
    // a schematic we edited still attributed to eeschema, which is the
    // misattribution these fields exist to prevent. Written unconditionally so
    // a file that arrived without the token still gains one.
    if (name === 'generator') {
      out.push(list(atom('generator'), str(GENERATOR)));
      continue;
    }
    if (name === 'generator_version') {
      out.push(list(atom('generator_version'), str(GENERATOR_VERSION)));
      continue;
    }
    const c = childNamed(sch.source, name);
    if (c) out.push(c);
  }

  out.push(list(atom('lib_symbols'), ...sch.libSymbols.map((l) => l.source)));

  // KiCad sorts the screen's items into a multiset keyed on (type ordinal,
  // uuid) before writing — "Enforce item ordering" in
  // SCH_IO_KICAD_SEXPR::Format — so the section order is the KICAD_T enum's,
  // not the order the items happen to sit in.
  //
  // We emitted symbols first and graphics near the end, which put every
  // section in the wrong place: a KiCad file saved by us came back as a
  // permutation of itself, and the whole document showed as changed in a diff
  // (#437). The order below is typeinfo.h's, and the label kinds are split out
  // because KiCad gives each its own ordinal while our model keeps them in one
  // array.
  //
  // Within a kind KiCad then sorts by uuid. We keep the order the file gave us,
  // which is the same thing for a file KiCad wrote; only items *we* added land
  // differently, and appending them is the lesser surprise.
  const labelsOfKind = (kind: string): SNode[] =>
    sch.labels.filter((l) => l.kind === kind).map(writeLabel);

  out.push(
    ...sch.graphics.map(writeGraphic), // SCH_SHAPE_T
    ...labelsOfKind('text'), // SCH_TEXT_T
    ...sch.textBoxes.map(writeTextBox), // SCH_TEXTBOX_T
    ...sch.junctions.map(writeJunction), // SCH_JUNCTION_T
    ...sch.noConnects.map(writeNoConnect), // SCH_NO_CONNECT_T
    ...sch.busEntries.map(writeBusEntry), // SCH_BUS_WIRE_ENTRY_T
    ...sch.lines.map(writeLine), // SCH_LINE_T
    ...sch.images.map(writeImage), // SCH_BITMAP_T
    ...sch.tables.map(writeTable), // SCH_TABLE_T
    ...labelsOfKind('label'), // SCH_LABEL_T
    ...labelsOfKind('global_label'), // SCH_GLOBAL_LABEL_T
    ...labelsOfKind('hierarchical_label'), // SCH_HIER_LABEL_T
    ...(sch.directiveLabels ?? []).map(writeDirectiveLabel), // SCH_DIRECTIVE_LABEL_T
    ...sch.symbols.map(writeSymbol), // SCH_SYMBOL_T
    // Empty groups are never written (SCH_IO_KICAD_SEXPR::saveGroup).
    ...sch.groups.filter((g) => g.members.length > 0).map(writeGroup), // SCH_GROUP_T
    ...sch.sheets.map(writeSheet), // SCH_SHEET_T
  );

  // Preserve any remaining structural nodes (sheet_instances, embedded_fonts, …).
  for (const it of sch.source.items) {
    if (!isList(it)) continue;
    const h = head(it);
    if (h === undefined || STRUCTURAL.has(h) || ITEM_HEADS.has(h)) continue;
    // The root sheet's page lives in (sheet_instances (path "/" (page …))); patch
    // it from the typed model so Edit Sheet Page Number on the root round-trips.
    if (h === 'sheet_instances' && sch.sheetInstances.length) {
      const pages = new Map(sch.sheetInstances.map((i) => [instanceKey(i), i.page]));
      out.push(patchInstancePages(it, pages, false));
      continue;
    }
    out.push(it);
  }

  return { kind: 'list', items: out };
}
