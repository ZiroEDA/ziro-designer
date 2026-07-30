/**
 * The zoom / absolute-coordinate / relative-coordinate fields of the schematic
 * status bar (KISTATUSBAR panes 2-4, eda_draw_frame.cpp
 * `EDA_DRAW_FRAME::UpdateStatusBar`).
 *
 * These are the only things on screen that follow the pointer, and upstream
 * updates them by writing the pane text directly. We do the same: the values
 * arrive through an imperative handle and are written to the text nodes, so
 * moving the mouse never re-renders the editor frame around them.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type JSX } from 'react';
import type { Vec2 } from '@ziroeda/kimath';
import { iuToMM } from '@ziroeda/common';
import { STATUS_FIELD_TEMPLATES, StatusField } from '../../../ui/StatusField.js';

/** The unit the status bar reports in (ACTIONS::toggleUnits). */
export type StatusUnits = 'mm' | 'in' | 'mils';

export interface StatusReadoutHandle {
  /** Cursor position in IU, or null when the pointer leaves the canvas. */
  setCursor: (world: Vec2 | null) => void;
  /** Viewport scale (device px per IU), for the zoom pane. */
  setScale: (scale: number) => void;
}

interface Props {
  units: StatusUnits;
  /** SCH_SCREEN::m_LocalOrigin, the origin the dx/dy/dist pane measures from. */
  localOrigin: Vec2;
  devicePixelRatio: number;
}

/** 100% zoom: CSS px per mm (EDA_DRAW_FRAME's zoom-percentage reference). */
const PX_PER_MM_100 = 3.7795;

function format(iu: number, units: StatusUnits): string {
  const mm = iuToMM(iu);
  if (units === 'mm') return mm.toFixed(4);
  if (units === 'mils') return (mm / 0.0254).toFixed(2);
  return (mm / 25.4).toFixed(4);
}

export const StatusReadout = forwardRef<StatusReadoutHandle, Props>(function StatusReadout(
  { units, localOrigin, devicePixelRatio },
  ref,
): JSX.Element {
  const zoomRef = useRef<HTMLSpanElement>(null);
  const coordsRef = useRef<HTMLSpanElement>(null);
  const deltasRef = useRef<HTMLSpanElement>(null);

  // Live values, and the props the writer needs, kept in refs so the imperative
  // path never depends on a re-render having happened first.
  const cursorRef = useRef<Vec2 | null>(null);
  const scaleRef = useRef(1);
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const originRef = useRef(localOrigin);
  originRef.current = localOrigin;
  const dprRef = useRef(devicePixelRatio);
  dprRef.current = devicePixelRatio;

  const paint = useCallback(() => {
    const u = unitsRef.current;
    const c = cursorRef.current;
    const o = originRef.current;
    const pct = Math.round(((scaleRef.current * 10000 * dprRef.current) / PX_PER_MM_100) * 100);
    if (zoomRef.current) {
      zoomRef.current.textContent = `Z ${Number.isFinite(pct) ? (pct / 100).toFixed(2) : '1.00'}`;
    }
    if (coordsRef.current) {
      coordsRef.current.textContent = c ? `X ${format(c.x, u)} Y ${format(c.y, u)}` : 'X, Y, ';
    }
    if (deltasRef.current) {
      deltasRef.current.textContent = c
        ? `dx ${format(c.x - o.x, u)} dy ${format(c.y - o.y, u)} dist ${format(
            Math.hypot(c.x - o.x, c.y - o.y),
            u,
          )}`
        : 'dx, dy, dist, ';
    }
  }, []);

  useImperativeHandle(
    ref,
    (): StatusReadoutHandle => ({
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

  // The panes are re-written on mount and whenever the unit or the local origin
  // changes (Ctrl+U / Space), since those change how the held values read.
  useEffect(() => {
    paint();
  }, [paint, units, localOrigin, devicePixelRatio]);

  return (
    <>
      <StatusField template={STATUS_FIELD_TEMPLATES.zoom}>
        <span ref={zoomRef} />
      </StatusField>
      <StatusField template={STATUS_FIELD_TEMPLATES.coords}>
        <span ref={coordsRef} />
      </StatusField>
      <StatusField template={STATUS_FIELD_TEMPLATES.deltas}>
        <span ref={deltasRef} />
      </StatusField>
    </>
  );
});
