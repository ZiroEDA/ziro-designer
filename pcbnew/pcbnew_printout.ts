// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcbnew_printout.cpp`: what `PCBNEW_PRINTOUT` decides for each
 * printed page — which layers a page carries (`OnPrintPage`) and how the
 * painter is set up for print (`setupViewLayers` / `setupPainter`).
 *
 * Moved out of `dialogs/dialog_print_pcbnew.tsx`, where both sat inline in the
 * dialog's print handler; the dialog keeps the settings, the page geometry and
 * the browser print flow.
 */
import type { PcbDrawOptions } from './renderBoard.js';

/** `DRILL_MARKS` in `m_DrillMarks`' order: NO_, SMALL_, FULL_DRILL_SHAPE. */
export const PRINTOUT_DRILL_MARKS = ['none', 'small', 'real'] as const;

/**
 * `PCBNEW_PRINTOUT::OnPrintPage` (`:83-125`)'s layer set per page: one page
 * for the whole checked set, or with `LAYER_PER_PAGE` one page per checked
 * layer, each also carrying Edge.Cuts when "Print board edges on all pages"
 * is set.
 *
 * Note: upstream adds Edge.Cuts whenever `m_PrintEdgeCutsOnAllPages` is set,
 * the single-page case included; this port only does so per layer. Moved
 * as it stood; not a change this file makes.
 */
export function printoutPageLayerSets(
  checked: ReadonlySet<string>,
  onePerLayer: boolean,
  edgesAllPages: boolean,
): ReadonlySet<string>[] {
  return onePerLayer
    ? [...checked].map((l) =>
        edgesAllPages && l !== 'Edge.Cuts' ? new Set([l, 'Edge.Cuts']) : new Set([l]),
      )
    : [checked];
}

/**
 * The draw options a printed page takes, `setupViewLayers` / `setupPainter`
 * (`:133-266`) over the editor's own.
 */
export function printoutDrawOptions(
  drawOpts: PcbDrawOptions,
  print: {
    /** `m_AsItemCheckboxes`, "Print according to objects tab". */
    asItemCheckboxes: boolean;
    /** `m_titleBlock`. */
    titleBlock: boolean;
    /** `m_DrillMarks`, an index into {@link PRINTOUT_DRILL_MARKS}. */
    drillMarks: number;
    theme: PcbDrawOptions['theme'];
  },
): PcbDrawOptions {
  return {
    ...drawOpts,
    // Unless "Print according to objects tab" is set, every item class
    // prints, solid and at full opacity (PCBNEW_PRINTOUT honors the view
    // visibilities only when m_AsItemCheckboxes).
    ...(print.asItemCheckboxes
      ? {}
      : {
          tracks: true,
          vias: true,
          pads: true,
          zones: true,
          fpValues: true,
          fpReferences: true,
          fpText: true,
          trackOpacity: 1,
          viaOpacity: 1,
          padOpacity: 1,
          zoneOpacity: 1,
          imageOpacity: 1,
          filledShapeOpacity: 1,
          trackFill: true,
          viaFill: true,
          padFill: true,
          zoneOutline: false,
        }),
    drawingSheet: print.titleBlock,
    contrastMode: 'normal',
    drillMarks: PRINTOUT_DRILL_MARKS[print.drillMarks] ?? 'small',
    theme: print.theme,
  };
}
