// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Change To": turn a label, free text, netclass flag or text box into another
 * of those. Counterpart: `SCH_EDIT_TOOL::ChangeTextType`
 * (eeschema/tools/sch_edit_tool.cpp), reached from the selection context menu
 * and from SCH_ACTIONS::toLabel / toGLabel / toHLabel / toDLabel / toText /
 * toTextBox.
 *
 * The conversion is a delete plus an add, not a mutation, because the four
 * kinds live in different arrays and serialize under different tokens. What
 * carries across is what upstream copies: the text, the font size, bold and
 * italic, the hyperlink, the flag shape and the fields.
 *
 * The two things that make this more than a retag:
 *
 *  - a label's text is a *net name*, so text becoming a label goes through
 *    getValidNetname: newlines and tabs become underscores, spaces too unless
 *    the text parses as a bus group, and the result is escaped for a net name.
 *    Empty text becomes "<empty>" rather than an unnamed net.
 *  - a text box has an extent while a label has an anchor, so converting
 *    between them derives one from the other: the label lands on the middle of
 *    whichever edge the text reads away from, and a box built from a label
 *    starts as the label's own bounding box.
 */

import type {
  Schematic,
  SchLabel,
  SchDirectiveLabel,
  SchTextBox,
  LabelKind,
  TextEffects,
  Vec2,
} from '../types.js';
import { refId } from './hittest.js';
import { labelBox } from './bbox.js';
import { makeLabel, makeDirectiveLabel } from './build.js';
import { setLabelFields, labelFields } from './label_properties.js';
import { makeTextBox } from './build-graphics.js';
import { parseBusGroup } from '../connectivity/bus.js';
import { escapeNetName } from '@ziroeda/common/src/string_utils.js';
import type { EditCommand } from './command.js';

/** What a selection can be turned into: the label kinds, plus the two that
 *  live outside `labels`. */
export type TextType = LabelKind | 'directive_label' | 'text_box';

/** The label a directive flag reports as its text; it has none of its own. */
const EMPTY = '<empty>';

/**
 * `getValidNetname`. A label's text names a net, so whitespace that cannot
 * appear in one is folded to underscores and the result is escaped. Bus groups
 * are the exception that keeps its spaces, since the group syntax uses them.
 */
export function validNetname(text: string): string {
  let out = text.replace(/[\n\r\t]/g, '_');
  if (!parseBusGroup(text)) out = out.replace(/ /g, '_');
  out = escapeNetName(out);
  return out === '' ? EMPTY : out;
}

/** Everything a conversion carries from the old item to the new one. */
interface Source {
  text: string;
  at: Vec2;
  angle: number;
  effects?: TextEffects;
  shape?: SchLabel['shape'];
  hyperlink?: string;
  fields?: SchDirectiveLabel['fields'];
  /** The item's extent, which a text box needs and a label defines. */
  box: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Where a selected item lives, and what it currently is. */
type Located =
  | { kind: 'label'; index: number; item: SchLabel }
  | { kind: 'directive'; index: number; item: SchDirectiveLabel }
  | { kind: 'textbox'; index: number; item: SchTextBox };

/** The convertible items in `ids`, in the arrays they live in. */
function locate(doc: Schematic, ids: ReadonlySet<string>): Located[] {
  const out: Located[] = [];
  doc.labels.forEach((item, index) => {
    if (ids.has(refId('label', item.uuid, index))) out.push({ kind: 'label', index, item });
  });
  (doc.directiveLabels ?? []).forEach((item, index) => {
    if (ids.has(refId('directive', item.uuid, index))) out.push({ kind: 'directive', index, item });
  });
  doc.textBoxes.forEach((item, index) => {
    if (ids.has(refId('textbox', item.uuid, index))) out.push({ kind: 'textbox', index, item });
  });
  return out;
}

/** The current type of a located item, for the "already that" check. */
const typeOf = (l: Located): TextType =>
  l.kind === 'label' ? l.item.kind : l.kind === 'directive' ? 'directive_label' : 'text_box';

function sourceOf(l: Located): Source {
  if (l.kind === 'label') {
    const b = labelBox(l.item);
    return {
      text: l.item.text,
      at: l.item.at,
      angle: l.item.angle,
      ...(l.item.effects ? { effects: l.item.effects } : {}),
      ...(l.item.shape ? { shape: l.item.shape } : {}),
      ...(l.item.hyperlink ? { hyperlink: l.item.hyperlink } : {}),
      ...(labelFields(l.item).length ? { fields: labelFields(l.item) } : {}),
      box: b,
    };
  }
  if (l.kind === 'directive') {
    // A directive flag has no text of its own; upstream reports "<empty>" and
    // its netclass rides along in the fields.
    const size = l.item.fields[0]?.effects?.fontSize?.[0] ?? 12700;
    return {
      text: EMPTY,
      at: l.item.at,
      angle: l.item.angle,
      fields: l.item.fields,
      box: {
        minX: l.item.at.x,
        minY: l.item.at.y - size / 2,
        maxX: l.item.at.x + size,
        maxY: l.item.at.y + size / 2,
      },
    };
  }
  const tb = l.item;
  // The text's own area, inside the margins (ChangeTextType deflates the box by
  // them before working out where a label would sit).
  const m = tb.margins;
  const box = {
    minX: Math.min(tb.start.x, tb.end.x) + (m?.left ?? 0),
    minY: Math.min(tb.start.y, tb.end.y) + (m?.top ?? 0),
    maxX: Math.max(tb.start.x, tb.end.x) - (m?.right ?? 0),
    maxY: Math.max(tb.start.y, tb.end.y) - (m?.bottom ?? 0),
  };
  const vertical = tb.angle === 90 || tb.angle === 270;
  const rightJustified = !!tb.effects?.justify?.includes('right');
  // The label anchors on the edge the text reads away from, and faces back
  // across the box: the spin style and the position are picked together.
  const at = vertical
    ? rightJustified
      ? { x: (box.minX + box.maxX) / 2, y: box.minY }
      : { x: (box.minX + box.maxX) / 2, y: box.maxY }
    : rightJustified
      ? { x: box.maxX, y: (box.minY + box.maxY) / 2 }
      : { x: box.minX, y: (box.minY + box.maxY) / 2 };
  const angle = vertical ? (rightJustified ? 270 : 90) : rightJustified ? 180 : 0;
  return {
    text: tb.text,
    at,
    angle,
    ...(tb.effects ? { effects: tb.effects } : {}),
    ...(tb.hyperlink ? { hyperlink: tb.hyperlink } : {}),
    box,
  };
}

/** The font attributes a conversion copies: size, bold and italic, never the
 *  justification, which each kind sets for itself. */
function carriedEffects(src: Source): TextEffects | undefined {
  const fx = src.effects;
  if (!fx) return undefined;
  const out: TextEffects = { hidden: false };
  if (fx.fontSize) return { ...out, fontSize: fx.fontSize, bold: fx.bold, italic: fx.italic };
  return { ...out, bold: fx.bold, italic: fx.italic };
}

/**
 * Turn every convertible item in `ids` into `target`. Items already of that
 * type are skipped, as upstream skips them.
 */
export function changeTextType(
  doc: Schematic,
  ids: ReadonlySet<string>,
  target: TextType,
): EditCommand | null {
  const located = locate(doc, ids).filter((l) => typeOf(l) !== target);
  if (located.length === 0) return null;

  const drop = {
    labels: new Set(located.filter((l) => l.kind === 'label').map((l) => l.index)),
    directives: new Set(located.filter((l) => l.kind === 'directive').map((l) => l.index)),
    textBoxes: new Set(located.filter((l) => l.kind === 'textbox').map((l) => l.index)),
  };

  const newLabels: SchLabel[] = [];
  const newDirectives: SchDirectiveLabel[] = [];
  const newTextBoxes: SchTextBox[] = [];

  for (const l of located) {
    const src = sourceOf(l);
    const fx = carriedEffects(src);

    if (target === 'text_box') {
      // A box built from a label starts as that label's own extent, so the text
      // lands where it already was rather than jumping.
      newTextBoxes.push(
        makeTextBox(
          { x: src.box.minX, y: src.box.minY },
          { x: src.box.maxX, y: src.box.maxY },
          src.text === EMPTY ? '' : src.text,
          fx ? { effects: { ...fx, justify: ['left', 'top'] } } : {},
        ),
      );
      continue;
    }

    if (target === 'directive_label') {
      // Coming from anything without fields, the text is taken as the netclass
      // name, which is the only thing a directive flag carries.
      const netclass = src.fields?.find((f) => f.key === 'Netclass')?.value ?? src.text;
      newDirectives.push(
        makeDirectiveLabel(src.at, {
          shape: 'round',
          netclass: netclass === EMPTY ? '' : netclass,
          angle: src.angle,
          ...(fx?.fontSize ? { fontSize: fx.fontSize[0] } : {}),
        }),
      );
      continue;
    }

    // A label or free text. Only a label's text is a net name; free text keeps
    // whatever it said.
    const text = target === 'text' ? src.text : validNetname(src.text);
    const built = makeLabel(target, text, src.at, {
      angle: src.angle,
      ...(src.shape ? { shape: src.shape } : {}),
      ...(fx?.fontSize ? { fontSize: fx.fontSize[0] } : {}),
      ...(fx?.bold ? { bold: true } : {}),
      ...(fx?.italic ? { italic: true } : {}),
    });
    // AddFields: the old item's fields ride along, minus the intersheet
    // references, which mean nothing on anything but a global label.
    const carried = (src.fields ?? []).filter(
      (f) => target === 'global_label' || f.key !== 'Intersheetrefs',
    );
    newLabels.push(
      carried.length
        ? setLabelFields(
            built,
            carried.map((f) => ({
              key: f.key,
              value: f.value,
              angle: f.angle ?? 0,
              effects: f.effects ?? { hidden: false },
            })),
          )
        : built,
    );
  }

  const label = `Change To ${TYPE_LABELS[target]}`;
  return {
    label,
    apply(d: Schematic): Schematic {
      return {
        ...d,
        labels: [...d.labels.filter((_, i) => !drop.labels.has(i)), ...newLabels],
        directiveLabels: [
          ...(d.directiveLabels ?? []).filter((_, i) => !drop.directives.has(i)),
          ...newDirectives,
        ],
        textBoxes: [...d.textBoxes.filter((_, i) => !drop.textBoxes.has(i)), ...newTextBoxes],
      };
    },
    invert(before: Schematic): EditCommand {
      // The conversion is not reversible item by item (a net name that was
      // folded cannot be unfolded), so undo restores the three arrays whole.
      return {
        label,
        apply: (d: Schematic): Schematic => ({
          ...d,
          labels: before.labels,
          directiveLabels: before.directiveLabels,
          textBoxes: before.textBoxes,
        }),
        invert: () => changeTextType(doc, ids, target)!,
      };
    },
  };
}

/** Menu labels, as SCH_ACTIONS names each conversion. */
export const TYPE_LABELS: Record<TextType, string> = {
  label: 'Label',
  global_label: 'Global Label',
  hierarchical_label: 'Hierarchical Label',
  directive_label: 'Directive Label',
  text: 'Text',
  text_box: 'Text Box',
};
