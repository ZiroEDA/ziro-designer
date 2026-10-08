// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * @deprecated The plain-object (`PcbDimension`) form, kept for the properties
 * dialog until it moves onto `PCB_DIMENSION_BASE` (#636 stage 6). The class
 * port is `pcb_dimension.ts`; new code uses that one.
 *
 * Reading and writing a dimension's properties.
 * Counterpart: `DIALOG_DIMENSION_PROPERTIES::TransferDataToWindow` and
 * `updateDimensionFromDialog` (pcbnew/dialogs/dialog_dimension_properties.cpp).
 *
 * Headless, like the other properties modules: the dialog is layout, this is
 * the part with decisions in it.
 *
 * ## Override text is a mode, not a string
 *
 * `GetOverrideTextEnabled()` is what decides whether the dimension shows the
 * measurement it computes or a string you typed. Upstream keys it off a radio
 * choice for the measuring kinds and *preserves the existing state* for centre
 * and leader, which have no such choice. In the file the flag has no token of
 * its own — the presence of `(override_value …)` **is** the flag — so an
 * override of the empty string still has to be written, or the dimension
 * silently reverts to its measured value on reload. `overrideValue: undefined`
 * means "show the measurement"; `''` means "show nothing".
 *
 * ## Which fields exist depends on the kind
 *
 * Extension overshoot is aligned/orthogonal only, the text frame is leader
 * only, and a centre dimension has neither a format block nor text. Writing one
 * to the wrong kind produces a file KiCad reads back differently from what was
 * saved.
 */
import { IN_EDIT } from '@ziroeda/common/eda_item_flags.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { type PCB_DIMENSION_BASE, PCB_DIM_ALIGNED, PCB_DIM_LEADER } from '../pcb_dimension.js';
import {
  DIM_ARROW_DIRECTION,
  type DIM_PRECISION,
  type DIM_TEXT_BORDER,
  type DIM_TEXT_POSITION,
  type DIM_UNITS_FORMAT,
  type DIM_UNITS_MODE,
} from '../pcb_dimension_types.js';
import type { TransferResult } from './dialog_text_properties.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';

/** `DIM_PRECISION`: 0-5 fixed digits, 6-9 the scaled `V_*` variants. */
export type DimPrecision = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** `DIM_TEXT_BORDER`: 0 none, 1 rectangle, 2 circle, 3 round rectangle. */
export type DimTextBorder = 0 | 1 | 2 | 3;

/** `DIM_TEXT_POSITION`: 0 outside, 1 inline, 2 manual. */
export type DimTextPosition = 0 | 1 | 2;

/** `DIM_UNITS_FORMAT`: 0 none, 1 bare suffix, 2 parenthesised suffix. */
export type DimUnitsFormat = 0 | 1 | 2;

/** `DIM_UNITS_MODE`: 0 inch, 1 mils, 2 mm, 3 automatic. */
export type DimUnitsMode = 0 | 1 | 2 | 3;

/** Every control on the dialog, flattened. */
export interface DimensionValues {
  layer: string;
  /** The measured value's prefix and suffix (`R `, ` typ.`). */
  prefix: string;
  suffix: string;
  /**
   * The text shown instead of the measurement, or undefined to show the
   * measurement. An empty string is a *set* override, not an absent one.
   */
  overrideValue: string | undefined;
  units: DimUnitsMode;
  unitsFormat: DimUnitsFormat;
  precision: DimPrecision;
  suppressZeroes: boolean;
  textPositionMode: DimTextPosition;
  keepTextAligned: boolean;
  arrowDirection: 'inward' | 'outward';
  lineThickness: number;
  arrowLength: number;
  extensionOffset: number;
  /** Aligned and orthogonal only. */
  extensionOvershoot: number;
  /** Leader only. */
  textFrame: DimTextBorder;
  // --- the text item ---
  textWidth: number;
  textHeight: number;
  textThickness: number;
  textOrientation: number;
  bold: boolean;
  italic: boolean;
  mirrored: boolean;
  /** Only meaningful when textPositionMode is MANUAL (2). */
  textX: number;
  textY: number;
  locked: boolean;
}

/** The single selected dimension's index, or null. */
/** `TransferDataToWindow`: the dialog's starting values. */
// --- DIALOG_DIMENSION_PROPERTIES's constructor field visibility (was dimension_tools.ts) ---

/** Which groups of controls the properties dialog shows, by kind. */
export interface DimensionDialogFields {
  /** Prefix, suffix, units, format, precision, suppress zeroes, override text. */
  format: boolean;
  /** Text size, thickness, orientation, bold/italic/mirrored. */
  text: boolean;
  /** The Outside/Inline/Manual choice, inside the text group. */
  textPositionMode: boolean;
  arrowLength: boolean;
  extensionOffset: boolean;
  /** Extension line overshoot. */
  extensionOvershoot: boolean;
  arrowDirection: boolean;
  /** The leader's text frame (none/rectangle/circle/round rectangle). */
  textFrame: boolean;
}

/**
 * `DIALOG_DIMENSION_PROPERTIES`' constructor switch, which hides whole sizers
 * depending on the dimension's class.
 *
 * - A **centre** mark measures nothing and has no text, so the format and text
 *   groups go, and with them the arrow length and extension offset — it draws
 *   only a cross.
 * - A **leader** shows text you typed rather than a measurement, so the format
 *   group goes and the text-position choice with it, but the text frame appears.
 * - **Extension overshoot** is gated on `dynamic_cast<PCB_DIM_ALIGNED*>`
 *   (`m_extensionOvershoot.Show(false)` otherwise), so radial and leader do not
 *   get it either.
 *
 * **One deliberate divergence.** Upstream leaves the arrow-direction choice
 * visible for radial and leader, but `updateDimensionFromDialog` only ever
 * reaches `SetArrowDirection` through the base pointer while the *serializer*
 * writes `(arrow_direction …)` for aligned and orthogonal alone — so on those
 * kinds the control changes nothing that survives a save. It is hidden here for
 * the same reason Create Array does not offer numbering: a control that quietly
 * does nothing is worse than its absence.
 */
export function dimensionDialogFields(aType: KICAD_T): DimensionDialogFields {
  const aligned = aType === KICAD_T.PCB_DIM_ALIGNED_T || aType === KICAD_T.PCB_DIM_ORTHOGONAL_T;
  const centre = aType === KICAD_T.PCB_DIM_CENTER_T;
  const leader = aType === KICAD_T.PCB_DIM_LEADER_T;
  return {
    format: !centre && !leader,
    text: !centre,
    textPositionMode: !centre && !leader,
    arrowLength: !centre,
    extensionOffset: !centre,
    extensionOvershoot: aligned,
    arrowDirection: aligned,
    textFrame: leader,
  };
}

// ---------------------------------------------------------------------------
// DIALOG_DIMENSION_PROPERTIES over the live PCB_DIMENSION_BASE (#636 stage 6)

/**
 * `DIALOG_DIMENSION_PROPERTIES` (dialog_dimension_properties.cpp) on a live
 * dimension: `TransferDataToWindow` reads it, `TransferDataFromWindow` is
 * `updateDimensionFromDialog` inside one BOARD_COMMIT, "Edit Dimension
 * Properties", ending in `Update()`.
 *
 * The React dialog has no font or horizontal-justification controls, so
 * those two are left as the item has them (upstream writes whatever its
 * controls hold).
 */
export class DIALOG_DIMENSION_PROPERTIES {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_dimension: PCB_DIMENSION_BASE;

  constructor(aFrame: PCB_BASE_EDIT_FRAME, aDimension: PCB_DIMENSION_BASE) {
    this.m_frame = aFrame;
    this.m_dimension = aDimension;
  }

  /** `m_dimension->Type()`, which decides the dialog's controls (the constructor). */
  GetDimensionType(): KICAD_T {
    return this.m_dimension.Type();
  }

  TransferDataToWindow(): DimensionValues {
    const board = this.m_frame.GetBoard()!;
    const d = this.m_dimension;

    return {
      layer: LSET_Name(d.GetLayer()),
      prefix: board.ConvertKIIDsToCrossReferences(d.GetPrefix()),
      suffix: board.ConvertKIIDsToCrossReferences(d.GetSuffix()),
      // m_cbOverrideValue with the override in m_txtValueActual
      overrideValue: d.GetOverrideTextEnabled()
        ? board.ConvertKIIDsToCrossReferences(d.GetOverrideText())
        : undefined,
      units: d.GetUnitsMode() as number as DimUnitsMode,
      unitsFormat: d.GetUnitsFormat() as number as DimUnitsFormat,
      precision: d.GetPrecision() as number as DimPrecision,
      suppressZeroes: d.GetSuppressZeroes(),
      textPositionMode: d.GetTextPositionMode() as number as DimTextPosition,
      keepTextAligned: d.GetKeepTextAligned(),
      arrowDirection: d.GetArrowDirection() === DIM_ARROW_DIRECTION.INWARD ? 'inward' : 'outward',
      lineThickness: d.GetLineThickness(),
      arrowLength: d.GetArrowLength(),
      extensionOffset: d.GetExtensionOffset(),
      extensionOvershoot: d instanceof PCB_DIM_ALIGNED ? d.GetExtensionHeight() : 0,
      textFrame: d instanceof PCB_DIM_LEADER ? (d.GetTextBorder() as number as DimTextBorder) : 0,
      textWidth: d.GetTextSize().x,
      textHeight: d.GetTextSize().y,
      textThickness: d.GetTextThickness(),
      textOrientation: new EDA_ANGLE(d.GetTextAngle().AsDegrees()).Normalize180().AsDegrees(),
      bold: d.IsBold(),
      italic: d.IsItalic(),
      mirrored: d.IsMirrored(),
      textX: d.GetTextPos().x,
      textY: d.GetTextPos().y,
      locked: d.IsLocked(),
    };
  }

  /** `updateDimensionFromDialog( aTarget )`. */
  private updateDimensionFromDialog(aTarget: PCB_DIMENSION_BASE, v: DimensionValues): void {
    const board = this.m_frame.GetBoard()!;

    aTarget.SetOverrideTextEnabled(v.overrideValue !== undefined);

    if (v.overrideValue !== undefined)
      aTarget.SetOverrideText(board.ConvertCrossReferencesToKIIDs(v.overrideValue));

    aTarget.SetPrefix(board.ConvertCrossReferencesToKIIDs(v.prefix));
    aTarget.SetSuffix(board.ConvertCrossReferencesToKIIDs(v.suffix));
    aTarget.SetLayer(LSET_NameToLayer(v.layer));

    aTarget.SetArrowDirection(
      v.arrowDirection === 'inward' ? DIM_ARROW_DIRECTION.INWARD : DIM_ARROW_DIRECTION.OUTWARD,
    );

    aTarget.SetUnitsMode(v.units as number as DIM_UNITS_MODE);
    aTarget.SetUnitsFormat(v.unitsFormat as number as DIM_UNITS_FORMAT);
    aTarget.SetPrecision(v.precision as number as DIM_PRECISION);
    aTarget.SetSuppressZeroes(v.suppressZeroes);

    const tpm = v.textPositionMode as number as DIM_TEXT_POSITION;
    aTarget.SetTextPositionMode(tpm);

    // DIM_TEXT_POSITION::MANUAL
    if (v.textPositionMode === 2) aTarget.SetTextPos({ x: v.textX, y: v.textY });

    aTarget.SetKeepTextAligned(v.keepTextAligned);

    aTarget.SetTextAngle(new EDA_ANGLE(v.textOrientation).Normalize());
    aTarget.SetTextWidth(v.textWidth);
    aTarget.SetTextHeight(v.textHeight);
    aTarget.SetTextThickness(v.textThickness);

    // Must come after SetTextWidth/Height()
    aTarget.SetBold(v.bold);
    aTarget.SetItalic(v.italic);

    aTarget.SetMirrored(v.mirrored);

    aTarget.SetLineThickness(v.lineThickness);
    aTarget.SetArrowLength(v.arrowLength);
    aTarget.SetExtensionOffset(v.extensionOffset);

    if (aTarget instanceof PCB_DIM_ALIGNED) aTarget.SetExtensionHeight(v.extensionOvershoot);

    if (aTarget instanceof PCB_DIM_LEADER)
      aTarget.SetTextBorder(v.textFrame as number as DIM_TEXT_BORDER);

    aTarget.Update();
  }

  TransferDataFromWindow(v: DimensionValues): TransferResult {
    const d = this.m_dimension;
    const commit = new BOARD_COMMIT(this.m_frame);
    commit.Modify(d);

    // If no other command in progress, prepare undo command
    const pushCommit = d.GetEditFlags() === 0;

    if (!pushCommit) d.SetFlags(IN_EDIT);

    this.updateDimensionFromDialog(d, v);

    // DIALOG_DIMENSION_PROPERTIES_BASE has no Locked control, so the lock is
    // not the dialog's to write.

    if (pushCommit) commit.Push('Edit Dimension Properties');

    return { ok: true };
  }
}
