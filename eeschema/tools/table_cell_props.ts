// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Table Cell Properties. Counterpart: `DIALOG_TABLECELL_PROPERTIES`, which the
 * context menu opens when the selection is **cells and nothing else**
 * (`SELECTION_CONDITIONS::OnlyTypes`).
 *
 * The dialog edits *several* cells at once, and that is the whole design:
 *
 *  - a property every selected cell agrees on shows its value;
 *  - a property they disagree on shows as **indeterminate** — upstream's
 *    `wxCHK_UNDETERMINED` and `UNIT_BINDER::IsIndeterminate` — and on OK is
 *    **left alone**, cell by cell, rather than being flattened to whatever the
 *    first cell happened to have.
 *
 * That second rule is the one worth having a model for. A dialog that read back
 * its own displayed value would quietly make every selected cell bold because
 * one of them already was.
 *
 * Here `undefined` is exactly that indeterminate state, on the way in and on
 * the way out. `applyCellProps` writes only the properties that are defined.
 *
 * Text is the exception: upstream writes the text box's contents to every
 * selected cell unconditionally, even when they differed. That is deliberate on
 * its part — the box can only show one string — so it is reproduced, with the
 * caller responsible for not offering a text box for a multi-cell selection it
 * would flatten.
 */

import type { Fill, SchTableCell, TextEffects } from '../types.js';
// The same rule the field boxes use: a centred axis writes no token, so there
// is one implementation rather than two that could drift.
import { justifyTokens } from '../fieldbox.js';

/** A cell's editable properties; `undefined` means "the cells disagree". */
export interface CellProps {
  text?: string;
  bold?: boolean;
  italic?: boolean;
  /** Font height in IU (KiCad edits one number and writes it to both axes). */
  textSize?: number;
  face?: string;
  hAlign?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'center' | 'bottom';
  fill?: Fill;
  marginLeft?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
}

const H_ALIGNS = ['left', 'center', 'right'] as const;
const V_ALIGNS = ['top', 'center', 'bottom'] as const;

/**
 * The justification tokens KiCad writes are a set, not an ordered pair, and a
 * centred axis writes no token at all — so the absence of `left`/`right` means
 * centred rather than unset.
 */
export function hAlignOf(e: TextEffects | undefined): 'left' | 'center' | 'right' {
  const j = e?.justify ?? [];
  return (H_ALIGNS.find((a) => a !== 'center' && j.includes(a)) ?? 'center') as
    | 'left'
    | 'center'
    | 'right';
}

export function vAlignOf(e: TextEffects | undefined): 'top' | 'center' | 'bottom' {
  const j = e?.justify ?? [];
  return (V_ALIGNS.find((a) => a !== 'center' && j.includes(a)) ?? 'center') as
    | 'top'
    | 'center'
    | 'bottom';
}

/** The value all cells agree on, or undefined when they do not. */
function common<T>(cells: readonly SchTableCell[], read: (c: SchTableCell) => T): T | undefined {
  if (cells.length === 0) return undefined;
  const first = read(cells[0]!);
  return cells.every((c) => read(c) === first) ? first : undefined;
}

/** Fills compared by value: `common` compares by identity, and a colour is an array. */
function commonFill(cells: readonly SchTableCell[]): Fill | undefined {
  if (cells.length === 0) return undefined;
  const key = (c: SchTableCell): string => `${c.fill?.type ?? ''}:${(c.fill?.color ?? []).join()}`;
  const first = cells[0]!;
  return cells.every((c) => key(c) === key(first)) ? first.fill : undefined;
}

/** What the dialog should show for a selection (`TransferDataToWindow`). */
export function cellPropsFromSelection(cells: readonly SchTableCell[]): CellProps {
  return {
    text: common(cells, (c) => c.text),
    bold: common(cells, (c) => c.effects?.bold ?? false),
    italic: common(cells, (c) => c.effects?.italic ?? false),
    textSize: common(cells, (c) => c.effects?.fontSize?.[0]),
    face: common(cells, (c) => c.effects?.face),
    hAlign: common(cells, (c) => hAlignOf(c.effects)),
    vAlign: common(cells, (c) => vAlignOf(c.effects)),
    // Compared by its serialized form: two equal colours are different array
    // objects, and `common` compares by identity.
    fill: commonFill(cells),
    marginLeft: common(cells, (c) => c.margins?.left),
    marginTop: common(cells, (c) => c.margins?.top),
    marginRight: common(cells, (c) => c.margins?.right),
    marginBottom: common(cells, (c) => c.margins?.bottom),
  };
}

/**
 * Apply the dialog's values to one cell, leaving every indeterminate property
 * as that cell had it (`TransferDataFromWindow`).
 */
export function applyCellProps(cell: SchTableCell, p: CellProps): SchTableCell {
  let effects: TextEffects | undefined = cell.effects;
  const touchesText =
    p.bold !== undefined ||
    p.italic !== undefined ||
    p.textSize !== undefined ||
    p.face !== undefined ||
    p.hAlign !== undefined ||
    p.vAlign !== undefined;

  if (touchesText) {
    const base: TextEffects = effects ?? { hidden: false };
    effects = {
      // Spreading `base` first is what keeps every indeterminate property as
      // this cell had it; each line below overwrites one only when it was set.
      ...base,
      ...(p.bold !== undefined ? { bold: p.bold } : {}),
      ...(p.italic !== undefined ? { italic: p.italic } : {}),
      ...(p.face !== undefined ? { face: p.face } : {}),
      // KiCad edits one number and writes it to both axes.
      ...(p.textSize !== undefined ? { fontSize: [p.textSize, p.textSize] as const } : {}),
      justify: justifyTokens(p.hAlign ?? hAlignOf(base), p.vAlign ?? vAlignOf(base)),
    };
  }

  const margins =
    p.marginLeft !== undefined ||
    p.marginTop !== undefined ||
    p.marginRight !== undefined ||
    p.marginBottom !== undefined
      ? {
          left: p.marginLeft ?? cell.margins?.left ?? 0,
          top: p.marginTop ?? cell.margins?.top ?? 0,
          right: p.marginRight ?? cell.margins?.right ?? 0,
          bottom: p.marginBottom ?? cell.margins?.bottom ?? 0,
        }
      : cell.margins;

  return {
    ...cell,
    ...(p.text !== undefined ? { text: p.text } : {}),
    ...(p.fill !== undefined ? { fill: p.fill } : {}),
    effects,
    margins,
  };
}
