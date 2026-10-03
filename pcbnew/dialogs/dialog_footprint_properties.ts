// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint Properties (board side), headless.
 * Counterpart: `pcbnew/dialogs/dialog_footprint_properties.cpp`.
 *
 * Single-footprint, so there is no three-state fold; every field carries a
 * value. Every applied field lands on the model; the writer formats the model.
 *
 * Moving and rotating go through edit-board's own helpers rather than writing
 * `(at …)` directly: a footprint's pads, texts and graphics are stored
 * board-absolute in this model, so its anchor cannot move on its own.
 */

import type { PcbFootprint } from '../types.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { BOARD_COMMIT } from '../board_commit.js';
import {
  type FOOTPRINT,
  FP_BOARD_ONLY,
  FP_DNP,
  FP_EXCLUDE_FROM_BOM,
  FP_EXCLUDE_FROM_POS_FILES,
  FP_SMD,
  FP_THROUGH_HOLE,
} from '../footprint.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { ZONE_CONNECTION } from '../zones.js';
import type { FP_3DMODEL } from '../footprint.js';
import type { TransferResult } from './dialog_text_properties.js';

/** FOOTPRINT_ATTR_T, in the order PCB_IO_KICAD_SEXPR writes them. */
export const FOOTPRINT_ATTRIBUTES = [
  'smd',
  'through_hole',
  'board_only',
  'exclude_from_pos_files',
  'exclude_from_bom',
  'allow_missing_courtyard',
  'dnp',
  'allow_soldermask_bridges',
] as const;

export type FootprintAttribute = (typeof FOOTPRINT_ATTRIBUTES)[number];

/** Every field the dialog edits. */
export interface FootprintValues {
  reference: string;
  value: string;
  /** Board-absolute anchor, IU. */
  x: number;
  y: number;
  /** Degrees. */
  orientation: number;
  /** Which side the footprint sits on; changing it is FOOTPRINT::Flip. */
  side: 'front' | 'back';
  locked: boolean;
  /**
   * Footprint type. `through_hole` and `smd` are mutually exclusive here, as
   * the dialog's three-way choice makes them; `unspecified` writes neither.
   */
  footprintType: 'through_hole' | 'smd' | 'unspecified';
  notInSchematic: boolean;
  doNotPopulate: boolean;
  excludeFromBom: boolean;
  excludeFromPosFiles: boolean;
  allowMissingCourtyard: boolean;
  allowSolderMaskBridges: boolean;
  /** Clearance overrides; null is "blank", meaning use the Board Setup value. */
  localClearance: number | null;
  localSolderMaskMargin: number | null;
  localSolderPasteMargin: number | null;
  localSolderPasteMarginRatio: number | null;
  zoneConnection: NonNullable<PcbFootprint['zoneConnection']>;
  /**
   * `m_3dPanel->GetModelList()`: the 3D Models page's list, which OK copies onto
   * the footprint (`dialog_footprint_properties.cpp:729-733`). Absent when the page
   * was not shown, and then the footprint's models are left alone.
   */
  models?: FP_3DMODEL[];
}

/** Resolve a `footprint:N` id, or null when the selection is not one footprint. */
/** DIALOG_FOOTPRINT_PROPERTIES::TransferDataToWindow. */
/** The `(attr …)` flag list a value set implies, in upstream's write order. */
export function attributesFor(v: FootprintValues): FootprintAttribute[] {
  const out: FootprintAttribute[] = [];
  if (v.footprintType === 'smd') out.push('smd');
  if (v.footprintType === 'through_hole') out.push('through_hole');
  if (v.notInSchematic) out.push('board_only');
  if (v.excludeFromPosFiles) out.push('exclude_from_pos_files');
  if (v.excludeFromBom) out.push('exclude_from_bom');
  if (v.allowMissingCourtyard) out.push('allow_missing_courtyard');
  if (v.doNotPopulate) out.push('dnp');
  if (v.allowSolderMaskBridges) out.push('allow_soldermask_bridges');
  return out;
}

// ---------------------------------------------------------------------------
// DIALOG_FOOTPRINT_PROPERTIES over the live FOOTPRINT (#636 stage 6)

/** `m_ZoneConnectionChoice`'s four entries, in order (:81-88, :642-649). */
const ZONE_CHOICE: readonly [FootprintValues['zoneConnection'], ZONE_CONNECTION][] = [
  ['inherited', ZONE_CONNECTION.INHERITED],
  ['full', ZONE_CONNECTION.FULL],
  ['thermal', ZONE_CONNECTION.THERMAL],
  ['none', ZONE_CONNECTION.NONE],
];

/**
 * `DIALOG_FOOTPRINT_PROPERTIES` (dialog_footprint_properties.cpp) on a live
 * FOOTPRINT. OK is one BOARD_COMMIT, "Edit Footprint Properties":
 * the overrides, position and lock, the attribute bits (DNP and the two
 * exclusions per variant when a variant is current), solder-mask bridges,
 * a Rotate about the position to the new orientation, then a Flip in the
 * frame's flip direction when the side changed.
 *
 * The React dialog edits Reference and Value where upstream's field grid
 * edits every field; those two are written the way the grid writes a field
 * (cross-references converted, a variant's value kept on the variant).
 * "Exempt From Courtyard Requirement" is not this dialog's in 10.0.5 and is
 * left alone.
 */
export class DIALOG_FOOTPRINT_PROPERTIES {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_footprint: FOOTPRINT;

  constructor(aFrame: PCB_BASE_EDIT_FRAME, aFootprint: FOOTPRINT) {
    this.m_frame = aFrame;
    this.m_footprint = aFootprint;
  }

  /** `m_footprint`: the footprint the dialog edits. */
  GetFootprint(): FOOTPRINT {
    return this.m_footprint;
  }

  TransferDataToWindow(): FootprintValues {
    const fp = this.m_footprint;
    const board = fp.GetBoard();
    const variantName = board?.GetCurrentVariant() ?? '';
    const attrs = fp.GetAttributes();
    const zc = ZONE_CHOICE.find(([, z]) => z === fp.GetLocalZoneConnection());
    const conv = (t: string) => (board ? board.ConvertKIIDsToCrossReferences(t) : t);

    return {
      reference: conv(fp.GetReference()),
      value: conv(fp.GetValue()),
      x: fp.GetPosition().x,
      y: fp.GetPosition().y,
      orientation: new EDA_ANGLE(fp.GetOrientation().AsDegrees()).Normalize180().AsDegrees(),
      side: fp.GetLayer() === PCB_LAYER_ID.B_Cu ? 'back' : 'front',
      locked: fp.IsLocked(),
      footprintType:
        attrs & FP_THROUGH_HOLE ? 'through_hole' : attrs & FP_SMD ? 'smd' : 'unspecified',
      notInSchematic: (attrs & FP_BOARD_ONLY) !== 0,
      doNotPopulate: fp.GetDNPForVariant(variantName),
      excludeFromBom: fp.GetExcludedFromBOMForVariant(variantName),
      excludeFromPosFiles: fp.GetExcludedFromPosFilesForVariant(variantName),
      allowMissingCourtyard: fp.AllowMissingCourtyard(),
      allowSolderMaskBridges: fp.AllowSolderMaskBridges(),
      localClearance: fp.GetLocalClearance() ?? null,
      localSolderMaskMargin: fp.GetLocalSolderMaskMargin() ?? null,
      localSolderPasteMargin: fp.GetLocalSolderPasteMargin() ?? null,
      localSolderPasteMarginRatio: fp.GetLocalSolderPasteMarginRatio() ?? null,
      zoneConnection: zc ? zc[0] : 'inherited',
    };
  }

  /** The grid's write of one field, variant-aware (:545-574). */
  private writeField(aName: string, aText: string, aBaseText: string, aVariant: string): void {
    const fp = this.m_footprint;
    const board = fp.GetBoard()!;
    const field = fp.GetField(aName);

    if (!field) return;

    const newText = board.ConvertCrossReferencesToKIIDs(aText);

    if (aVariant !== '') {
      const variant = fp.GetVariant(aVariant) ?? fp.AddVariant(aVariant);

      if (variant) variant.SetFieldValue(aName, newText);

      field.SetText(aBaseText);
    } else {
      field.SetText(newText);
    }
  }

  TransferDataFromWindow(v: FootprintValues): TransferResult {
    // Validate(): m_netClearance.Validate( 0, INT_MAX )
    if (v.localClearance !== null && v.localClearance < 0) return { ok: false };

    const fp = this.m_footprint;
    const board = fp.GetBoard();
    const commit = new BOARD_COMMIT(this.m_frame);
    commit.Modify(fp);

    const variantName = board?.GetCurrentVariant() ?? '';

    this.writeField('Reference', v.reference, fp.GetReference(), variantName);
    this.writeField('Value', v.value, fp.GetValue(), variantName);

    // Initialize masks clearances
    fp.SetLocalClearance(v.localClearance ?? undefined);
    fp.SetLocalSolderMaskMargin(v.localSolderMaskMargin ?? undefined);
    fp.SetLocalSolderPasteMargin(v.localSolderPasteMargin ?? undefined);
    fp.SetLocalSolderPasteMarginRatio(v.localSolderPasteMarginRatio ?? undefined);

    const zc = ZONE_CHOICE.find(([name]) => name === v.zoneConnection);
    fp.SetLocalZoneConnection(zc ? zc[1] : ZONE_CONNECTION.INHERITED);

    // Set Footprint Position
    fp.SetPosition({ x: v.x, y: v.y });
    fp.SetLocked(v.locked);

    let attributes = 0;

    if (v.footprintType === 'through_hole') attributes |= FP_THROUGH_HOLE;
    else if (v.footprintType === 'smd') attributes |= FP_SMD;

    if (v.notInSchematic) attributes |= FP_BOARD_ONLY;

    if (variantName !== '') {
      const variant = fp.GetVariant(variantName) ?? fp.AddVariant(variantName);

      if (variant) {
        variant.SetExcludedFromPosFiles(v.excludeFromPosFiles);
        variant.SetExcludedFromBOM(v.excludeFromBom);
        variant.SetDNP(v.doNotPopulate);
      }

      // Preserve base attribute flags for these three properties
      attributes |= fp.GetAttributes() & (FP_EXCLUDE_FROM_POS_FILES | FP_EXCLUDE_FROM_BOM | FP_DNP);
    } else {
      if (v.excludeFromPosFiles) attributes |= FP_EXCLUDE_FROM_POS_FILES;
      if (v.excludeFromBom) attributes |= FP_EXCLUDE_FROM_BOM;
      if (v.doNotPopulate) attributes |= FP_DNP;
    }

    fp.SetAttributes(attributes);

    fp.SetAllowSolderMaskBridges(v.allowSolderMaskBridges);

    const orient = new EDA_ANGLE(v.orientation).Normalize();

    if (!fp.GetOrientation().equals(orient))
      fp.Rotate(fp.GetPosition(), orient.sub(fp.GetOrientation()));

    // Set component side, that also have effect on the fields positions on board
    const change_layer =
      v.side === 'front'
        ? fp.GetLayer() === PCB_LAYER_ID.B_Cu
        : fp.GetLayer() === PCB_LAYER_ID.F_Cu;

    if (change_layer) fp.Flip(fp.GetPosition(), this.m_frame.GetPcbNewSettings().m_FlipDirection);

    // Copy the models from the panel to the footprint
    if (v.models) {
      const fpList = fp.Models();
      fpList.length = 0;
      fpList.push(...v.models.map((m) => m.clone()));
    }

    // This is a simple edit, we must create an undo entry
    if (fp.GetEditFlags() === 0) commit.Push('Edit Footprint Properties');

    return { ok: true };
  }
}
