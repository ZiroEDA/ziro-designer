// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_JUNCTION_PROPS` (eeschema/dialogs/dialog_junction_props.cpp) over
 * DIALOG_JUNCTION_PROPS_BASE: the live junctions' diameter through `m_diameter`, a UNIT_BINDER in
 * the frame's units ("-- leave unchanged --" when they differ), their colour, Default
 * (`resetDefaults`), and the one SCH_COMMIT its OK makes.
 */
import { type JSX, useRef, useState } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { COLOR4D_UNSPECIFIED, type Color4d } from '@ziroeda/common/gal/color4d.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { INDETERMINATE_ACTION } from '@ziroeda/common/widgets/ui_common.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_JUNCTION } from '../sch_junction.js';
import { DIALOG_JUNCTION_PROPS_BASE } from './dialog_junction_props_base.js';
import { _ } from '@ziroeda/wx/translation.js';

const sameColor = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

export interface JUNCTION_DIALOG_VALUES {
  /** `m_textCtrlDiameter`'s text. */
  diameter: string;
  color: Color4d;
}

export class DIALOG_JUNCTION_PROPS {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_junctions: readonly SCH_JUNCTION[];
  private readonly m_diameter: UNIT_BINDER;

  constructor(aParent: SCH_EDIT_FRAME, aJunctions: readonly SCH_JUNCTION[]) {
    this.m_frame = aParent;
    this.m_junctions = aJunctions;
    this.m_diameter = new UNIT_BINDER(aParent, _('Diameter:'), (m) => DisplayErrorMessage(m));
  }

  /** `SetSwatchBackground( canvas )`. */
  SwatchBackground(): Color4d {
    return this.m_frame.GetDrawBgColor();
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): JUNCTION_DIALOG_VALUES {
    const first = this.m_junctions[0]!;
    const rest = this.m_junctions.slice(1);

    if (rest.every((r) => r.GetDiameter() === first.GetDiameter()))
      this.m_diameter.SetValue(first.GetDiameter());
    else this.m_diameter.SetText(INDETERMINATE_ACTION);

    return {
      diameter: this.m_diameter.GetText(),
      color: rest.every((r) => sameColor(r.GetColor(), first.GetColor()))
        ? first.GetColor()
        : { ...COLOR4D_UNSPECIFIED },
    };
  }

  /** `resetDefaults()`: diameter 0, colour unspecified. */
  ResetDefaults(): JUNCTION_DIALOG_VALUES {
    this.m_diameter.SetValue(0);
    return { diameter: this.m_diameter.GetText(), color: { ...COLOR4D_UNSPECIFIED } };
  }

  /** `TransferDataFromWindow()`. */
  TransferDataFromWindow(aValues: JUNCTION_DIALOG_VALUES): boolean {
    this.m_diameter.SetText(aValues.diameter);
    const commit = new SCH_COMMIT(this.m_frame);

    for (const junction of this.m_junctions) {
      commit.Modify(junction, this.m_frame.GetScreen());

      if (!this.m_diameter.IsIndeterminate()) junction.SetDiameter(this.m_diameter.GetValue());

      junction.SetColor(aValues.color);

      this.m_frame.GetCanvas()?.GetView().Update(junction);
    }

    commit.Push(this.m_junctions.length === 1 ? _('Edit Junction') : _('Edit Junctions'));

    return true;
  }
}

export function DialogJunctionProps({
  dlg,
  initial,
  units,
  onOk,
  onCancel,
}: {
  dlg: DIALOG_JUNCTION_PROPS;
  initial: JUNCTION_DIALOG_VALUES;
  /** The frame's units, which `m_diameter` labels its entry with. */
  units: StatusUnits;
  onOk: (aValues: JUNCTION_DIALOG_VALUES) => void;
  onCancel: () => void;
}): JSX.Element {
  const [v, setV] = useState(initial);
  const diameterRef = useRef<HTMLInputElement>(null);

  return (
    <DIALOG_JUNCTION_PROPS_BASE
      m_textCtrlDiameter={v.diameter}
      onDiameter={(t) => setV((p) => ({ ...p, diameter: t }))}
      diameterRef={diameterRef}
      units={unitLabel(units)}
      m_colorSwatch={v.color}
      swatchBackground={dlg.SwatchBackground()}
      onColor={(c) => setV((p) => ({ ...p, color: c }))}
      onApply={() => setV(dlg.ResetDefaults())}
      onOK={() => onOk(v)}
      onCancel={onCancel}
    />
  );
}
