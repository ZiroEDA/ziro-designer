// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A layer set as the `(layers …)` tokens of the board file, and back: what
 * the pad, zone and rule-area dialogs keep their layer checkboxes as. NOT
 * upstream: KiCad's dialogs hold an LSET. The tokens are the s-expression
 * grammar - `PCB_IO_KICAD_SEXPR::formatLayers` writes them and the parser's
 * own layer-name map reads them - so the two ends stay KiCad's.
 */
import { B_Cu, F_Cu } from '@ziroeda/common/layer_ids.js';
import { LSET_Name } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '../pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';

/**
 * The `(layers …)` tokens KiCad writes for a layer set, wildcards and all —
 * `formatLayers( aLayerMask, aEnumerateLayers, aIsZone )` (:1549). With
 * `enumerate` no wildcard is used ("Always enumerate every layer for a zone on
 * a copper layer", :2883).
 */
export function layerTokens(
  layerMaskIn: LSET,
  copperLayerCount: number,
  isZone = false,
  enumerate = false,
): string[] {
  const cu_all = LSET.AllCuMask();
  const fr_bk = new LSET([B_Cu, F_Cu]);
  const cu_board_mask = LSET.AllCuMask(copperLayerCount);
  let layerMask = new LSET(layerMaskIn);
  const out: string[] = [];
  if (!enumerate) {
    // If all copper layers present on the board are enabled, then output the wildcard
    if (layerMask.and(cu_board_mask).equals(cu_board_mask)) {
      out.push('*.Cu');
      layerMask = layerMask.and(cu_all.not());
    } else if (layerMask.and(cu_board_mask).equals(fr_bk)) {
      out.push(isZone ? 'F&B.Cu' : '*.Cu');
      layerMask = layerMask.and(fr_bk.not());
    }
    const pairs: [string, number, number][] = [
      ['*.Adhes', 9, 11],
      ['*.Paste', 13, 15],
      ['*.SilkS', 5, 7],
      ['*.Mask', 1, 3],
      ['*.CrtYd', 31, 29],
      ['*.Fab', 35, 33],
    ];
    for (const [name, a, b] of pairs) {
      const set = new LSET([a, b]);
      if (layerMask.and(set).equals(set)) {
        out.push(name);
        layerMask = layerMask.and(set.not());
      }
    }
  }
  // output any individual layers not handled in wildcard combos above
  for (const layer of layerMask.Seq()) out.push(LSET_Name(layer));
  return out;
}

/** The parser's `m_layerMasks`, built once: every layer name and wildcard it reads. */
let s_layerMasks: ReadonlyMap<string, LSET> | null = null;

/**
 * `(layers …)` tokens back to a layer set: `parseBoardItemLayersAsMask`, the
 * union of `lookUpLayerSet` over each token. A name the parser does not know
 * adds nothing.
 */
export function layerSetOfTokens(aTokens: readonly string[]): LSET {
  if (!s_layerMasks) s_layerMasks = new PCB_IO_KICAD_SEXPR_PARSER('', 'layers').m_layerMasks;

  let set = new LSET();

  for (const tok of aTokens) {
    const mask = s_layerMasks.get(tok);
    if (mask) set = set.or(mask);
  }

  return set;
}
