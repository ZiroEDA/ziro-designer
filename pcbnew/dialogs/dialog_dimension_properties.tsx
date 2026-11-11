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
import { type JSX, useMemo, useState } from 'react';
import { GetPenSizeForBold, GetPenSizeForNormal } from '@ziroeda/common/gr_text.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import { DIALOG_DIMENSION_PROPERTIES_BASE } from './dialog_dimension_properties_base.js';
import type { FIELD } from './dialog_text_properties_base.js';
import { IN_EDIT } from '@ziroeda/common/eda_item_flags.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
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
} from '../pcb_dimension.js';
import type { TransferResult } from './dialog_text_properties.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { _ } from '@ziroeda/wx/translation.js';

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
  /** `m_fontCtrl`; '' is the stroke font. */
  face: string;
  /** `m_alignLeft` / `m_alignCenter` / `m_alignRight`. */
  hJustify: 'left' | 'center' | 'right';
}

/** The single selected dimension's index, or null. */
/** `TransferDataToWindow`: the dialog's starting values. */
// --- DIALOG_DIMENSION_PROPERTIES's constructor field visibility (was dimension_tools.ts) ---

/** Which groups of controls the properties dialog shows, by kind. */
export interface DimensionDialogFields {
  /** `m_sizerLeader`: a leader's text, frame and layer. */
  leader: boolean;
  /** `m_sizerCenter`: a center mark's layer. */
  center: boolean;
  /** `m_sizerFormat`: value, override, prefix, suffix, units, precision, layer, preview. */
  format: boolean;
  /** `m_sizerText`. */
  text: boolean;
  /** `m_lblTextPositionMode` / `m_cbTextPositionMode`. */
  textPositionMode: boolean;
  arrowLength: boolean;
  extensionOffset: boolean;
  /** `m_extensionOvershoot.Show( false )` unless the item is a PCB_DIM_ALIGNED. */
  extensionOvershoot: boolean;
}

/** The constructor's `switch( m_dimension->Type() )` and TransferDataToWindow's overshoot cast. */
export function dimensionDialogFields(aType: KICAD_T): DimensionDialogFields {
  const aligned = aType === KICAD_T.PCB_DIM_ALIGNED_T || aType === KICAD_T.PCB_DIM_ORTHOGONAL_T;
  const centre = aType === KICAD_T.PCB_DIM_CENTER_T;
  const leader = aType === KICAD_T.PCB_DIM_LEADER_T;

  return {
    leader,
    center: centre,
    format: !centre && !leader,
    text: !centre,
    textPositionMode: !leader,
    arrowLength: !centre,
    extensionOffset: !centre,
    extensionOvershoot: aligned,
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
      face: d.GetFont()?.GetName() ?? '',
      hJustify:
        d.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
          ? 'left'
          : d.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
            ? 'right'
            : 'center',
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

    // m_fontCtrl->GetFontSelection( bold, italic )
    aTarget.SetFont(v.face === '' ? null : FONT.GetFont(v.face, v.bold, v.italic));

    // Must come after SetTextWidth/Height()
    aTarget.SetBold(v.bold);
    aTarget.SetItalic(v.italic);
    aTarget.SetHorizJustify(
      v.hJustify === 'left'
        ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
        : v.hJustify === 'center'
          ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER
          : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT,
    );

    aTarget.SetMirrored(v.mirrored);

    aTarget.SetLineThickness(v.lineThickness);
    aTarget.SetArrowLength(v.arrowLength);
    aTarget.SetExtensionOffset(v.extensionOffset);

    if (aTarget instanceof PCB_DIM_ALIGNED) aTarget.SetExtensionHeight(v.extensionOvershoot);

    if (aTarget instanceof PCB_DIM_LEADER)
      aTarget.SetTextBorder(v.textFrame as number as DIM_TEXT_BORDER);

    aTarget.Update();
  }

  /** `m_dimension->GetValueText()`: the measurement, for m_txtValue when not overridden. */
  GetValueText(): string {
    return this.m_dimension.GetValueText();
  }

  /** updatePreviewText(): `m_previewDimension` updated from the dialog, its shown text. */
  GetPreviewText(v: DimensionValues): string {
    const preview = this.m_dimension.Clone() as PCB_DIMENSION_BASE;
    preview.SetParent(this.m_frame.GetBoard());
    this.updateDimensionFromDialog(preview, v);
    return preview.GetShownText(true);
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

    if (pushCommit) commit.Push(_('Edit Dimension Properties'));

    return { ok: true };
  }
}

type LengthKey =
  | 'lineThickness'
  | 'arrowLength'
  | 'extensionOffset'
  | 'extensionOvershoot'
  | 'textWidth'
  | 'textHeight'
  | 'textThickness'
  | 'textX'
  | 'textY';

/** `m_cbTextOrientation`'s text: one of rot_list's entries when the angle is one of them. */
function orientationText(aDegrees: number): string {
  const turn = (a: number): number => ((a % 360) + 360) % 360;
  return ([0, 90, -90, 180].find((o) => turn(o) === turn(aDegrees)) ?? aDegrees).toFixed(1);
}

/** `ShowModal()` of DIALOG_DIMENSION_PROPERTIES: its base over the dimension's values. */
export function DialogDimensionProperties({
  dialog,
  units,
  layers,
  layerColor,
  onApply,
  onClose,
}: {
  dialog: DIALOG_DIMENSION_PROPERTIES;
  units: StatusUnits;
  layers: readonly string[];
  /** The board colour of a layer, for PCB_LAYER_BOX_SELECTOR's swatch. */
  layerColor: (layer: string) => string;
  onApply: (v: DimensionValues) => void;
  onClose: () => void;
}): JSX.Element {
  const [v, setV] = useState<DimensionValues>(() => dialog.TransferDataToWindow());
  const [texts, setTexts] = useState<Partial<Record<LengthKey | 'orientation', string>>>({});
  // onFontSelected's m_textThickness.Show().
  const [strokeShown, setStrokeShown] = useState(true);

  const show = dimensionDialogFields(dialog.GetDimensionType());
  const set = (patch: Partial<DimensionValues>): void => setV((p) => ({ ...p, ...patch }));
  const preview = useMemo(() => dialog.GetPreviewText(v), [dialog, v]);

  /** onThickness / onFontSelected: bold is whichever pen the thickness is nearer. */
  const boldFor = (aValues: DimensionValues): boolean => {
    const textSize = Math.min(aValues.textWidth, aValues.textHeight);
    return (
      Math.abs(aValues.textThickness - GetPenSizeForBold(textSize)) <
      Math.abs(aValues.textThickness - GetPenSizeForNormal(textSize))
    );
  };

  const length = (aKey: LengthKey, aLabel: string, aTitle?: string): FIELD => ({
    label: aLabel,
    title: aTitle,
    value: texts[aKey] ?? pcbUnitText(v[aKey], units),
    units: unitLabel(units),
    onChange: (aText) => {
      setTexts((t) => ({ ...t, [aKey]: aText }));
      const iu = pcbUnitValue(aText, units);
      if (!Number.isFinite(iu)) return;
      setV((p) => {
        const next = { ...p, [aKey]: iu };
        if (aKey === 'textThickness') next.bold = boldFor(next);
        return next;
      });
    },
    onBlur: () => setTexts((t) => ({ ...t, [aKey]: undefined })),
  });

  const layerBox = {
    rows: layers.map((l) => ({ value: l, label: l, swatch: layerColor(l) })),
    value: v.layer,
    onChange: (aLayer: string) => set({ layer: aLayer }),
  };

  const manual = v.textPositionMode === 2;
  const overridden = v.overrideValue !== undefined;
  // m_txtValueActual: the override when there is one, else the measurement.
  const valueText = v.overrideValue ?? dialog.GetValueText();

  return (
    <DIALOG_DIMENSION_PROPERTIES_BASE
      m_sizerLeader={show.leader}
      m_sizerCenter={show.center}
      m_sizerFormat={show.format}
      m_sizerText={show.text}
      m_txtLeaderValue={{ value: valueText, onChange: (aText) => set({ overrideValue: aText }) }}
      m_cbTextFrame={{
        value: v.textFrame,
        onChange: (aIndex) => set({ textFrame: aIndex as DimTextBorder }),
      }}
      m_cbLeaderLayer={layerBox}
      m_cbCenterLayer={layerBox}
      m_txtValue={{
        value: valueText,
        enabled: overridden,
        onChange: (aText) => set({ overrideValue: aText }),
      }}
      m_cbOverrideValue={{
        value: overridden,
        // Unchecked, m_txtValue goes back to the measurement.
        onChange: (aOn) => set({ overrideValue: aOn ? dialog.GetValueText() : undefined }),
      }}
      m_cbUnits={{ value: v.units, onChange: (aIndex) => set({ units: aIndex as DimUnitsMode }) }}
      m_txtPrefix={{ value: v.prefix, onChange: (aText) => set({ prefix: aText }) }}
      m_cbUnitsFormat={{
        value: v.unitsFormat,
        onChange: (aIndex) => set({ unitsFormat: aIndex as DimUnitsFormat }),
      }}
      m_txtSuffix={{ value: v.suffix, onChange: (aText) => set({ suffix: aText }) }}
      m_cbPrecision={{
        value: v.precision,
        onChange: (aIndex) => set({ precision: aIndex as DimPrecision }),
      }}
      m_cbLayer={layerBox}
      m_cbSuppressZeroes={{
        value: v.suppressZeroes,
        onChange: (aOn) => set({ suppressZeroes: aOn }),
      }}
      m_staticTextPreview={preview}
      m_fontCtrl={{
        face: v.face,
        onChange: (aFace) => {
          const stroke = FONT.IsStrokeName(aFace === '' ? _('KiCad Font') : aFace);
          setStrokeShown(stroke);
          setV((p) => ({ ...p, face: aFace, ...(stroke ? { bold: boldFor(p) } : {}) }));
        },
      }}
      m_bold={{
        checked: v.bold,
        onClick: () => {
          // onBoldToggle: the thickness follows the new state.
          setV((p) => {
            const textSize = Math.min(p.textWidth, p.textHeight);
            const bold = !p.bold;
            return {
              ...p,
              bold,
              textThickness: bold ? GetPenSizeForBold(textSize) : GetPenSizeForNormal(textSize),
            };
          });
          setTexts((t) => ({ ...t, textThickness: undefined }));
        },
      }}
      m_italic={{ checked: v.italic, onClick: () => set({ italic: !v.italic }) }}
      hAlign={v.hJustify}
      onHAlign={(aAlign) => set({ hJustify: aAlign })}
      m_mirrored={{ checked: v.mirrored, onClick: () => set({ mirrored: !v.mirrored }) }}
      m_textWidth={length('textWidth', _('Width:'), _('Text width'))}
      m_textPosX={{ ...length('textX', _('Position X:'), _('Text pos X')), enabled: manual }}
      m_textHeight={length('textHeight', _('Height:'), _('Text height'))}
      m_textPosY={{ ...length('textY', _('Position Y:'), _('Text pos Y')), enabled: manual }}
      m_textThickness={{
        ...length('textThickness', _('Thickness:'), _('Text thickness')),
        shown: strokeShown,
      }}
      m_cbTextOrientation={{
        value: texts.orientation ?? orientationText(v.textOrientation),
        enabled: !v.keepTextAligned,
        onChange: (aText) => {
          setTexts((t) => ({ ...t, orientation: aText }));
          const n = Number(aText);
          if (aText.trim() !== '' && Number.isFinite(n)) set({ textOrientation: n });
        },
      }}
      m_cbTextPositionMode={{
        value: v.textPositionMode,
        shown: show.textPositionMode,
        onChange: (aIndex) => set({ textPositionMode: aIndex as DimTextPosition }),
      }}
      m_cbKeepAligned={{
        value: v.keepTextAligned,
        onChange: (aOn) => set({ keepTextAligned: aOn }),
      }}
      m_lineThickness={length(
        'lineThickness',
        _('Line thickness:'),
        _('Thickness of the dimension lines'),
      )}
      m_arrowLength={{ ...length('arrowLength', _('Arrow length:')), shown: show.arrowLength }}
      m_extensionOffset={{
        ...length(
          'extensionOffset',
          _('Extension line offset:'),
          _('Gap between the measured points and the start of the extension lines'),
        ),
        shown: show.extensionOffset,
      }}
      m_extensionOvershoot={{
        ...length('extensionOvershoot', _('Extension line overshoot:')),
        shown: show.extensionOvershoot,
      }}
      m_cbArrowDirection={{
        value: v.arrowDirection === 'inward' ? 0 : 1,
        onChange: (aIndex) => set({ arrowDirection: aIndex === 0 ? 'inward' : 'outward' }),
      }}
      onOK={() => onApply(v)}
      onCancel={onClose}
    />
  );
}
