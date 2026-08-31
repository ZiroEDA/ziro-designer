// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SPACEMOUSE` (common/dialogs/panel_spacemouse_base.cpp) — the
 * 3Dconnexion device page.
 *
 * One group, "Pan and Rotate", holding a slider and a checkbox for each axis:
 *
 *     _("Rotation speed:")               _("Reverse rotation direction")
 *     _("Pan speed:")                    _("Reverse vertical pan direction")
 *                                        _("Reverse horizontal pan direction")
 *                                        _("Reverse zoom direction")
 *
 * The book adds it inside `#if defined(__linux__) || defined(__FreeBSD__)`
 * (`common/eda_base_frame.cpp:1590-1596`), and the parity target is a Linux
 * build, so the row is in the tree.
 *
 * The controls are drawn and disabled. A SpaceMouse reaches KiCad through
 * 3Dconnexion's own daemon and the 3dxware SDK, which is a native library; no
 * browser API exposes the device. So there is nothing behind these to set —
 * and a page KiCad shows, missing entirely from ours, is a worse answer than
 * one that shows what it would control and says why it cannot.
 */
import type { JSX } from 'react';
import { Check, Group, Num } from '../widgets.js';

const WHY =
  'A SpaceMouse reaches KiCad through 3Dconnexion’s native driver and the 3dxware SDK. ' +
  'No browser API exposes the device, so there is nothing behind these settings.';

/** The two sliders' own tooltips, upstream's text. [data] */
const ROTATION_TIP = 'How far to zoom in for each rotation of the mouse wheel';
const PAN_TIP = 'How fast to pan when moving an object off the edge of the screen';

export function PanelSpacemouse(): JSX.Element {
  return (
    <>
      <div className="ze-pref-hint">{WHY}</div>
      <Group title="Pan and Rotate">
        <Num
          label="Rotation speed:"
          value={5}
          onChange={() => {}}
          disabled
          title={`${ROTATION_TIP}\n\n${WHY}`}
        />
        <Check
          label="Reverse rotation direction"
          checked={false}
          onChange={() => {}}
          disabled
          title={`Swap the direction of rotation\n\n${WHY}`}
        />
        <Num
          label="Pan speed:"
          value={5}
          onChange={() => {}}
          disabled
          title={`${PAN_TIP}\n\n${WHY}`}
        />
        <Check
          label="Reverse vertical pan direction"
          checked={false}
          onChange={() => {}}
          disabled
          title={WHY}
        />
        <Check
          label="Reverse horizontal pan direction"
          checked={false}
          onChange={() => {}}
          disabled
          title={WHY}
        />
        <Check
          label="Reverse zoom direction"
          checked={false}
          onChange={() => {}}
          disabled
          title={WHY}
        />
      </Group>
    </>
  );
}
