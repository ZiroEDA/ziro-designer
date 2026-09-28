// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `INDICATOR_ICON` and `ROW_ICON_PROVIDER` (`include/widgets/indicator_icon.h`,
 * `common/widgets/indicator_icon.cpp`): the small state icon at the head of a
 * layer row - the blue right arrow on the active layer in pcbnew's appearance
 * panel and GerbView's layer list, blank on every other row.
 *
 * `ROW_ICON_PROVIDER::GetIndicatorIcon` maps a state to one of seven bitmaps
 * it builds pixel by pixel. OFF and ON are drawn (`.ze-layer-indicator` and
 * `.on` in shell.css, the arrow being `createArrow( size, scale, 1,
 * wxColour( 64, 72, 255 ) )`); the other five have no caller here and draw
 * as OFF.
 */

import type { JSX } from 'react';

/** `ROW_ICON_PROVIDER::STATE`. */
export enum ROW_ICON_STATE {
  /** Row "off" or "deselected" */
  OFF,
  /** Row "dimmed" */
  DIMMED,
  /** Row "on" or "selected" */
  ON,
  /** Row above design alpha */
  UP,
  /** Row below design alpha */
  DOWN,
  OPEN,
  CLOSED,
}

export interface IndicatorIconProps {
  /** `SetIndicatorState( aIconId )`. */
  state: ROW_ICON_STATE;
}

export function IndicatorIcon({ state }: IndicatorIconProps): JSX.Element {
  return (
    <span
      className={`ze-layer-indicator${state === ROW_ICON_STATE.ON ? ' on' : ''}`}
      aria-hidden="true"
    />
  );
}
