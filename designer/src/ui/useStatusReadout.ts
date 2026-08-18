// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The three `KISTATUSBAR` panes that follow the pointer — zoom (1), absolute
 * coordinates (2) and relative deltas (3) — driven the way upstream drives
 * them.
 *
 * `EDA_DRAW_FRAME::UpdateStatusBar` and its overrides
 * (eeschema/sch_base_frame.cpp:252, pcbnew/pcb_base_frame.cpp:761) run on every
 * cursor motion and write the pane text directly with `SetStatusText`; nothing
 * else on the frame repaints. We do the same: values arrive through the handle
 * this hook returns and are written to the text nodes, so moving the mouse
 * never re-renders the editor frame around them.
 *
 * Lives in `ui/` rather than one editor's tree because the mechanism is
 * `EDA_DRAW_FRAME`'s, not any one frame's.
 */

import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { SCH_IU_PER_MM } from '@ziroeda/common';
import {
  coordsMsg,
  deltasMsg,
  messageTextFromValue,
  type StatusUnits,
  zoomFactorForScale,
  zoomMsg,
} from './status_format.js';

export interface StatusReadoutHandle {
  /** Cursor position in IU, or null when the pointer leaves the canvas. */
  setCursor: (world: { x: number; y: number } | null) => void;
  /** Viewport scale (device px per IU), for the zoom pane. */
  setScale: (scale: number) => void;
}

export interface StatusReadout extends StatusReadoutHandle {
  /** Pane 1's text node. */
  zoomRef: RefObject<HTMLSpanElement>;
  /** Pane 2's text node. */
  coordsRef: RefObject<HTMLSpanElement>;
  /** Pane 3's text node. */
  deltasRef: RefObject<HTMLSpanElement>;
}

export interface StatusReadoutOptions {
  units: StatusUnits;
  /** `BASE_SCREEN::m_LocalOrigin`, the origin the dx/dy/dist pane measures from. */
  localOrigin: { x: number; y: number };
  devicePixelRatio: number;
  /** The frame's `EDA_IU_SCALE` (`SCH_IU_PER_MM`, `PCB_IU_PER_MM`, …). */
  iuPerMM?: number;
}

export function useStatusReadout({
  units,
  localOrigin,
  devicePixelRatio,
  iuPerMM = SCH_IU_PER_MM,
}: StatusReadoutOptions): StatusReadout {
  const zoomRef = useRef<HTMLSpanElement>(null);
  const coordsRef = useRef<HTMLSpanElement>(null);
  const deltasRef = useRef<HTMLSpanElement>(null);

  // Live values, and the options the writer needs, kept in refs so the
  // imperative path never depends on a re-render having happened first.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const scaleRef = useRef(0);
  const optsRef = useRef({ units, localOrigin, devicePixelRatio, iuPerMM });
  optsRef.current = { units, localOrigin, devicePixelRatio, iuPerMM };

  const paint = useCallback(() => {
    const { units: u, localOrigin: o, devicePixelRatio: dpr, iuPerMM: iu } = optsRef.current;
    const fmt = (v: number): string => messageTextFromValue(v / iu, u, iu);
    const c = cursorRef.current;

    if (zoomRef.current) {
      zoomRef.current.textContent = zoomMsg(zoomFactorForScale(scaleRef.current, dpr, iu));
    }

    if (coordsRef.current) {
      coordsRef.current.textContent = c ? coordsMsg(fmt(c.x), fmt(c.y)) : coordsMsg(null);
    }

    if (deltasRef.current) {
      deltasRef.current.textContent = c
        ? deltasMsg(fmt(c.x - o.x), fmt(c.y - o.y), fmt(Math.hypot(c.x - o.x, c.y - o.y)))
        : deltasMsg(null);
    }
  }, []);

  // The panes are re-written whenever the unit, the local origin or the DPR
  // changes, since those change how the held values read. `paint` reads them
  // off optsRef, so the linter cannot see that they are the effect's inputs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: repaint triggers, read via optsRef
  useEffect(() => {
    paint();
  }, [paint, units, localOrigin, devicePixelRatio, iuPerMM]);

  return useMemo(
    (): StatusReadout => ({
      zoomRef,
      coordsRef,
      deltasRef,
      setCursor: (world) => {
        cursorRef.current = world;
        paint();
      },
      setScale: (scale) => {
        if (scale === scaleRef.current) return;
        scaleRef.current = scale;
        paint();
      },
    }),
    [paint],
  );
}
