// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_JUNCTION_PROPS` (eeschema/dialogs/dialog_junction_props.cpp), the model half: what the
 * dialog shows for the live junctions (TransferDataToWindow) and the one SCH_COMMIT its OK makes
 * (TransferDataFromWindow). The window draws it with DialogLineProperties' junction form.
 *
 * Difference, forced: the form has no UNIT_BINDER indeterminate state, so a selection whose
 * diameters differ shows the first one, and its diameter is written only when the user changed it
 * (`if( !m_diameter.IsIndeterminate() )`).
 */
import { COLOR4D_UNSPECIFIED, type Color4d } from '@ziroeda/common/gal/color4d.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_JUNCTION } from '../sch_junction.js';

const sameColor = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

export class DIALOG_JUNCTION_PROPS {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_junctions: readonly SCH_JUNCTION[];

  constructor(aParent: SCH_EDIT_FRAME, aJunctions: readonly SCH_JUNCTION[]) {
    this.m_frame = aParent;
    this.m_junctions = aJunctions;
  }

  /** `TransferDataToWindow()`: the diameter (null when they differ) and the colour. */
  TransferDataToWindow(): { diameter: number | null; color: Color4d } {
    const first = this.m_junctions[0]!;
    const rest = this.m_junctions.slice(1);

    return {
      diameter: rest.every((r) => r.GetDiameter() === first.GetDiameter())
        ? first.GetDiameter()
        : null,
      color: rest.every((r) => sameColor(r.GetColor(), first.GetColor()))
        ? first.GetColor()
        : { ...COLOR4D_UNSPECIFIED },
    };
  }

  /** `TransferDataFromWindow()`: \a aDiameter null is the indeterminate binder, left alone. */
  TransferDataFromWindow(aDiameter: number | null, aColor: Color4d): boolean {
    const commit = new SCH_COMMIT(this.m_frame);

    for (const junction of this.m_junctions) {
      commit.Modify(junction, this.m_frame.GetScreen());

      if (aDiameter !== null) junction.SetDiameter(aDiameter);

      junction.SetColor(aColor);

      this.m_frame.GetCanvas()?.GetView().Update(junction);
    }

    commit.Push(this.m_junctions.length === 1 ? 'Edit Junction' : 'Edit Junctions');

    return true;
  }
}
