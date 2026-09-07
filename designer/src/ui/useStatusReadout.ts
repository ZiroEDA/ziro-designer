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
  polarMsg,
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

/** `PCB_ORIGIN_PAGE`'s answer, hoisted so the default is identity-stable. */
const NO_USER_ORIGIN = { x: 0, y: 0 };

export interface StatusReadoutOptions {
  units: StatusUnits;
  /** `BASE_SCREEN::m_LocalOrigin`, the origin the dx/dy/dist pane measures from. */
  localOrigin: { x: number; y: number };
  devicePixelRatio: number;
  /** The frame's `EDA_IU_SCALE` (`SCH_IU_PER_MM`, `PCB_IU_PER_MM`, …). */
  iuPerMM?: number;
  /**
   * `GetShowPolarCoords()` — pane 3 as `r`/`theta` instead of `dx`/`dy`/`dist`
   * (`PCB_BASE_FRAME::UpdateStatusBar`, pcb_base_frame.cpp:773-785).
   *
   * A pcbnew-side branch on the SAME pane rather than a second readout, which
   * is how upstream has it: one `UpdateStatusBar` with an `if`. eeschema's
   * `SCH_BASE_FRAME` has no polar mode and simply never passes this.
   */
  polar?: boolean;
  /**
   * `PCB_ORIGIN_TRANSFORMS::invertXAxis()` / `invertYAxis()`
   * (`pcbnew/pcb_origin_transforms.cpp:140-155`) — Preferences > Origins &
   * Axes' "Increases left" and "Increases up".
   *
   * `PCB_BASE_FRAME::UpdateStatusBar` does not print the cursor position: it
   * prints `m_originTransforms.ToDisplayAbsX( … )` and, for pane 3,
   * `ToDisplayRelX( … )` (`pcb_base_frame.cpp:788-812`), and those are
   * `value - userOrigin` and `value` respectively with the sign flipped when
   * the axis is inverted (`include/origin_transforms.h:111-145`). So this
   * changes the READOUT and nothing about the geometry, the canvas or which way
   * the view faces — which is why it belongs here and not in a canvas.
   *
   * eeschema and the drawing sheet have no such preference and never pass it;
   * `invertXAxis()` itself branches on the frame type, pcbnew's copy of the two
   * flags against the footprint editor's.
   */
  invertX?: boolean;
  invertY?: boolean;
  /**
   * `PCB_BASE_FRAME::GetUserOrigin()` (`pcbnew/pcb_base_frame.cpp`), the point
   * `ToDisplayAbsX/Y` subtracts before printing — Preferences > PCB Editor >
   * Origins & Axes' Display Origin group:
   *
   *     PCB_ORIGIN_PAGE  -> ( 0, 0 )
   *     PCB_ORIGIN_AUX   -> GetDesignSettings().GetAuxOrigin()
   *     PCB_ORIGIN_GRID  -> GetDesignSettings().GetGridOrigin()
   *
   * Resolved by the caller rather than passed as the enum, because only the
   * frame knows where its two origins are; this hook is given the point.
   *
   * NOT `localOrigin`, which is `BASE_SCREEN::m_LocalOrigin` and belongs to
   * pane 3 alone. `ToDisplayRel` deliberately does not subtract the user
   * origin (`include/origin_transforms.h:111-145`), so a delta is unaffected
   * by this and an absolute position is — which is why they are two options
   * and not one.
   */
  userOrigin?: { x: number; y: number };
}

export function useStatusReadout({
  units,
  localOrigin,
  devicePixelRatio,
  iuPerMM = SCH_IU_PER_MM,
  polar = false,
  invertX = false,
  invertY = false,
  userOrigin = NO_USER_ORIGIN,
}: StatusReadoutOptions): StatusReadout {
  const zoomRef = useRef<HTMLSpanElement>(null);
  const coordsRef = useRef<HTMLSpanElement>(null);
  const deltasRef = useRef<HTMLSpanElement>(null);

  // Live values, and the options the writer needs, kept in refs so the
  // imperative path never depends on a re-render having happened first.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const scaleRef = useRef(0);
  const optsRef = useRef({
    units,
    localOrigin,
    devicePixelRatio,
    iuPerMM,
    polar,
    invertX,
    invertY,
    userOrigin,
  });
  optsRef.current = {
    units,
    localOrigin,
    devicePixelRatio,
    iuPerMM,
    polar,
    invertX,
    invertY,
    userOrigin,
  };

  const paint = useCallback(() => {
    const {
      units: u,
      localOrigin: o,
      devicePixelRatio: dpr,
      iuPerMM: iu,
      polar: pol,
      invertX: invX,
      invertY: invY,
      userOrigin: uo,
    } = optsRef.current;
    const fmt = (v: number): string => messageTextFromValue(v / iu, u, iu);
    const c = cursorRef.current;
    /**
     * `ORIGIN_TRANSFORMS::ToDisplayRel`/`ToDisplayAbs`
     * (`include/origin_transforms.h:111-145`): flip the sign when the axis is
     * inverted, and leave an exact zero alone — upstream guards
     * `aValue != static_cast<T>( 0 )` so the pane never reads "-0".
     */
    const disp = (v: number, invert: boolean | undefined): number => (invert && v !== 0 ? -v : v);

    if (zoomRef.current) {
      zoomRef.current.textContent = zoomMsg(zoomFactorForScale(scaleRef.current, dpr, iu));
    }

    if (coordsRef.current) {
      // `ToDisplayAbsX/Y` — `aValue - m_userOrigin`, THEN the sign flip
      // (`include/origin_transforms.h:125-145`). Every frame but the board
      // editor leaves `userOrigin` at (0, 0), which is what
      // `PCB_BASE_FRAME::GetUserOrigin` answers for PCB_ORIGIN_PAGE.
      coordsRef.current.textContent = c
        ? coordsMsg(fmt(disp(c.x - uo.x, invX)), fmt(disp(c.y - uo.y, invY)))
        : coordsMsg(null);
    }

    if (deltasRef.current) {
      // Both branches measure from `m_LocalOrigin`, which is the whole point of
      // pane 3: `dx = cursorPos.x - screen->m_LocalOrigin.x` and the polar
      // `theta = RAD2DEG( atan2( -dy, dx ) )` over the same dx/dy
      // (pcb_base_frame.cpp:774-777, :798-806). Y is negated for theta because
      // screen Y grows downward and the reported angle is the mathematical one.
      // `ToDisplayRelX/Y`, applied to the delta as upstream does at
      // `pcb_base_frame.cpp:804-805`.
      const dx = disp(c ? c.x - o.x : 0, invX);
      const dy = disp(c ? c.y - o.y : 0, invY);
      if (pol) {
        deltasRef.current.textContent = c
          ? polarMsg(fmt(Math.hypot(dx, dy)), (Math.atan2(-dy, dx) * 180) / Math.PI)
          : polarMsg(null);
      } else {
        deltasRef.current.textContent = c
          ? deltasMsg(fmt(dx), fmt(dy), fmt(Math.hypot(dx, dy)))
          : deltasMsg(null);
      }
    }
  }, []);

  // The panes are re-written whenever the unit, the local origin or the DPR
  // changes, since those change how the held values read. `paint` reads them
  // off optsRef, so the linter cannot see that they are the effect's inputs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: repaint triggers, read via optsRef
  useEffect(() => {
    paint();
  }, [paint, units, localOrigin, devicePixelRatio, iuPerMM, polar, invertX, invertY, userOrigin]);

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
