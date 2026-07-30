/**
 * Board layer identifiers, the pcbnew layer model (pcbnew/layer_ids.h / lset).
 * KiCad's PCB_LAYER_ID is an enum of int ids; this port keeps the canonical
 * string layer names (`F.Cu`, `B.SilkS`, …) that appear in the file as the id,
 * which is what our board model already uses.
 */

export type PCB_LAYER_ID = string;

/**
 * The layer on the opposite board side, KiCad BOARD::FlipLayer (board.cpp:958),
 * whose front/back opposites all swap the `F.`/`B.` prefix for a standard stack
 * (common/lset.cpp). Inner and single-sided user layers are their own opposite.
 */
export function FlipLayer(aLayer: PCB_LAYER_ID): PCB_LAYER_ID {
  if (aLayer.startsWith('F.')) return `B.${aLayer.slice(2)}`;
  if (aLayer.startsWith('B.')) return `F.${aLayer.slice(2)}`;
  return aLayer;
}
