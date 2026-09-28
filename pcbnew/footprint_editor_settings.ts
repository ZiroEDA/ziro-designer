// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_EDITOR_SETTINGS` (`pcbnew/footprint_editor_settings.h` +
 * `.cpp`) — the slice of the designer's `FpEditSettings`
 * (`prefs/settings.ts`) the footprint editor's own modules read, named
 * structurally the same way `pcb_edit_frame.ts`'s `PCBNEW_JSON_SETTINGS_LIKE`
 * is: this package states what it needs of the JSON without importing
 * `designer/`. The designer's own `FpEditSettings` satisfies this by
 * construction; every field name and type below is copied from it.
 */
import { PCB_IU_PER_MM } from '@ziroeda/common';
import type { GridEntry, GridOverride } from '@ziroeda/common/settings/grid_settings_ui.js';

/** A Graphics Defaults row that carries only a line width (Edge Cuts, Courtyards). */
export interface FP_GRAPHICS_LINE_CLASS_LIKE {
  line_width: number;
}

/** A Graphics Defaults row that also carries text (silk, copper, fab, others). */
export interface FP_GRAPHICS_TEXT_CLASS_LIKE extends FP_GRAPHICS_LINE_CLASS_LIKE {
  text_size_h: number;
  text_size_v: number;
  text_thickness: number;
  text_italic: boolean;
}

/** One row of `design_settings.default_footprint_text_items`. */
export interface FP_TEXT_ITEM_LIKE {
  text: string;
  visible: boolean;
  layer: string;
}

export interface FP_EDIT_JSON_SETTINGS_LIKE {
  design_settings: {
    default_footprint_text_items: FP_TEXT_ITEM_LIKE[];
    default_footprint_layer_names: Record<string, string>;
    user_layer_count: number;
    silk: FP_GRAPHICS_TEXT_CLASS_LIKE;
    copper: FP_GRAPHICS_TEXT_CLASS_LIKE;
    edges: FP_GRAPHICS_LINE_CLASS_LIKE;
    courtyard: FP_GRAPHICS_LINE_CLASS_LIKE;
    fab: FP_GRAPHICS_TEXT_CLASS_LIKE;
    others: FP_GRAPHICS_TEXT_CLASS_LIKE;
  };
  window: {
    grid: {
      sizes: GridEntry[];
      last_size_idx: number;
      show: boolean;
      snap: 0 | 1 | 2;
      overrides_enabled: boolean;
      /**
       * `FRAME_FOOTPRINT_EDITOR`'s three surviving override rows
       * (`common/dialogs/panel_grid_settings.cpp:53-92`) — no `wires` or
       * `vias` key here; a footprint has neither.
       */
      overrides: {
        connected: GridOverride;
        text: GridOverride;
        graphics: GridOverride;
      };
    };
  };
}

/** Local aliases so code merged in from graphics_defaults.ts is unchanged. */
type FpEditSettings = FP_EDIT_JSON_SETTINGS_LIKE;
type FpGraphicsTextClass = FP_GRAPHICS_TEXT_CLASS_LIKE;

// --- BOARD_DESIGN_SETTINGS::GetLineThickness et al, for the Footprint Editor (was graphics_defaults.ts) ---

/** The six `LAYER_CLASS_*` buckets, as the keys `design_settings` stores. */
export type FpGraphicsRowKey = 'silk' | 'copper' | 'edges' | 'courtyard' | 'fab' | 'others';

/**
 * The Graphics Defaults grid's rows, in `ROW_*` order
 * (`panel_fp_editor_graphics_defaults.cpp:47-56`) with the base file's labels
 * (`_base.cpp:52-57`).
 *
 * `text: false` is Edge Cuts and Courtyards, whose four text columns the panel
 * disables because no `*_text_*` param exists for them.
 */
export const GRAPHICS_ROWS: readonly { key: FpGraphicsRowKey; label: string; text: boolean }[] = [
  { key: 'silk', label: 'Silk Layers', text: true },
  { key: 'copper', label: 'Copper Layers', text: true },
  { key: 'edges', label: 'Edge Cuts', text: false },
  { key: 'courtyard', label: 'Courtyards', text: false },
  { key: 'fab', label: 'Fab Layers', text: true },
  { key: 'others', label: 'Other Layers', text: true },
];

/**
 * `BOARD_DESIGN_SETTINGS::GetLayerClass( PCB_LAYER_ID )` — which of the six
 * rows a layer belongs to.
 *
 * The switch is: silk for `F_SilkS`/`B_SilkS`, copper for any copper layer,
 * edges for `Edge_Cuts`, courtyard for `F_CrtYd`/`B_CrtYd`, fab for
 * `F_Fab`/`B_Fab`, and others for everything else — which is what makes "Other
 * Layers" the row that catches the user and auxiliary layers.
 */
export function fpLayerClass(layer: string): FpGraphicsRowKey {
  if (layer === 'F.SilkS' || layer === 'B.SilkS') return 'silk';
  if (/\.Cu$/.test(layer)) return 'copper';
  if (layer === 'Edge.Cuts') return 'edges';
  if (layer === 'F.CrtYd' || layer === 'B.CrtYd') return 'courtyard';
  if (layer === 'F.Fab' || layer === 'B.Fab') return 'fab';
  return 'others';
}

/** `GetLineThickness( aLayer )`, in **millimetres** — the unit the file holds. */
export function fpLineThicknessMM(layer: string, cfg: FpEditSettings): number {
  return cfg.design_settings[fpLayerClass(layer)].line_width;
}

/**
 * `GetTextSize( aLayer )` and `GetTextThickness( aLayer )` and
 * `GetTextItalic( aLayer )`, in millimetres, for the four classes that have
 * text.
 *
 * Edge Cuts and Courtyards have none, and upstream's array simply holds
 * whatever the constructor left there for those two indices; a caller asking
 * for a text default on one of them is asking a question the settings file
 * cannot answer, so this returns null rather than a number nobody wrote.
 */
export function fpTextDefaults(layer: string, cfg: FpEditSettings): FpGraphicsTextClass | null {
  const row = cfg.design_settings[fpLayerClass(layer)];
  return 'text_size_h' in row ? row : null;
}

/**
 * `MINIMUM_LINE_WIDTH_MM` / `MAXIMUM_LINE_WIDTH_MM`
 * (`include/board_design_settings.h:107-108`) and `TEXT_MIN_SIZE_MM` /
 * `TEXT_MAX_SIZE_MM` (`include/eda_text.h:58-59`).
 *
 * [data] KiCad's own limits, not a house style: they are what
 * `PANEL_FP_EDITOR_GRAPHICS_DEFAULTS::TransferDataFromWindow` measures a typed
 * value against, so a value this page accepts is one the C++ would accept too.
 */
export const MINIMUM_LINE_WIDTH_MM = 0.005;
export const MAXIMUM_LINE_WIDTH_MM = 100.0;
export const TEXT_MIN_SIZE_MM = 0.001;
export const TEXT_MAX_SIZE_MM = 250.0;

/** What {@link checkFpGraphicsRow} decided about one row. */
export interface FpGraphicsRowCheck {
  /**
   * Only the fields upstream would assign. A refused field is simply ABSENT —
   * `if( !badParam )` guards each assignment separately, so a row with a bad
   * line width still stores its text size, and a row with a bad text size
   * still stores its line width.
   */
  store: Partial<FpGraphicsTextClass>;
  /** The joined `errorsMsg`, or null when the row passed clean. */
  error: string | null;
}

/**
 * `PANEL_FP_EDITOR_GRAPHICS_DEFAULTS::TransferDataFromWindow`'s per-row body
 * (`panel_fp_editor_graphics_defaults.cpp:196-275`), for one row.
 *
 * Three checks, in upstream's order and with upstream's asymmetry:
 *
 *  - a line width outside [MIN, MAX] is REFUSED — the message is raised and the
 *    settings keep the value they had;
 *  - a text width or height outside [MIN, MAX] is refused the same way, and it
 *    short-circuits the thickness check (`if( !badParam && … )`);
 *  - a text thickness outside [MIN, min( MAX_WIDTH, min(w,h) / 4 )] is
 *    **CLAMPED**, not refused: "Text thickness cannot be > text size /4 to be
 *    readable" (`:238`). The message reads "It will be truncated to …" and the
 *    clamped value is written back into the cell.
 *
 * The two `badParam` flags are separate upstream and are separate here. They
 * are easy to collapse into one and that would be wrong: a row whose line width
 * is out of range still commits its text size.
 *
 * The arithmetic is integer IU because upstream's is — `min( w, h ) / 4` is
 * integer division on `GetUnitValue`'s `int`, so doing it in millimetres would
 * put the clamp a fraction of a nanometre off the value KiCad writes.
 *
 * `describe` is the panel's `m_unitProvider->StringFromValue( v, true )`: the
 * limits are quoted in the FRAME's unit, so a mils frame reads "It must be
 * between 0.19685 mils and 3937.00787 mils".
 */
export function checkFpGraphicsRow(
  label: string,
  row: FpGraphicsTextClass,
  hasText: boolean,
  describe: (mm: number) => string,
): FpGraphicsRowCheck {
  const iu = (mm: number): number => Math.round(mm * PCB_IU_PER_MM);
  const toMM = (v: number): number => v / PCB_IU_PER_MM;

  const minWidth = iu(MINIMUM_LINE_WIDTH_MM);
  const maxWidth = iu(MAXIMUM_LINE_WIDTH_MM);
  const minSize = iu(TEXT_MIN_SIZE_MM);
  const maxSize = iu(TEXT_MAX_SIZE_MM);

  const errors: string[] = [];
  const store: Partial<FpGraphicsTextClass> = {};

  const lineWidth = iu(row.line_width);

  if (lineWidth < minWidth || lineWidth > maxWidth) {
    errors.push(
      `${label}: Incorrect line width.\n` +
        `It must be between ${describe(MINIMUM_LINE_WIDTH_MM)} and ` +
        `${describe(MAXIMUM_LINE_WIDTH_MM)}`,
    );
  } else {
    store.line_width = row.line_width;
  }

  // `if( i == ROW_EDGES || i == ROW_COURTYARD ) continue;` (`:219-220`) — the
  // two rows with no text columns leave after the line width, italic included.
  if (!hasText) return { store, error: errors.length > 0 ? errors.join('\n\n') : null };

  let badParam = false;
  const textWidth = iu(row.text_size_h);
  const textHeight = iu(row.text_size_v);
  let textThickness = iu(row.text_thickness);

  if (textWidth < minSize || textHeight < minSize || textWidth > maxSize || textHeight > maxSize) {
    errors.push(
      `${label}: Text size is incorrect.\n` +
        `Size must be between ${describe(TEXT_MIN_SIZE_MM)} and ${describe(TEXT_MAX_SIZE_MM)}`,
    );
    badParam = true;
  }

  const textMaxThickness = Math.min(maxWidth, Math.trunc(Math.min(textWidth, textHeight) / 4));

  if (!badParam && (textThickness < minWidth || textThickness > textMaxThickness)) {
    if (textThickness > textMaxThickness) {
      errors.push(
        `${label}: Text thickness is too large.\n` +
          `It will be truncated to ${describe(toMM(textMaxThickness))}`,
      );
    } else {
      errors.push(
        `${label}: Text thickness is too small.\n` +
          `It will be truncated to ${describe(toMM(minWidth))}`,
      );
    }

    textThickness = Math.min(textThickness, textMaxThickness);
    textThickness = Math.max(textThickness, minWidth);
  }

  if (!badParam) {
    store.text_size_h = row.text_size_h;
    store.text_size_v = row.text_size_v;
    store.text_thickness = toMM(textThickness);
  }

  // `cfg.m_TextItalic[i] = …` sits outside every `if( !badParam )` (`:274`).
  store.text_italic = row.text_italic;

  return { store, error: errors.length > 0 ? errors.join('\n\n') : null };
}
