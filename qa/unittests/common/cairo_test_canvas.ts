// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A recording Canvas 2D context for the Cairo GAL tests: Node has no canvas and
 * happy-dom's is a stub, so every call and every property set is logged, and
 * {@link paints} replays the log the way a canvas would, into the list of
 * paint operations with their paths in DEVICE coordinates.
 *
 * The replay is a model of the Canvas 2D spec (a path point is transformed by
 * the matrix current when it is added; `fill` / `stroke` paint with the state
 * current when they are called), not of the adapter, so an expectation built
 * from the C++'s Cairo calls can be compared with it.
 */

import {
  type CAIRO_SURFACE_BACKING,
  type CANVAS_2D,
  cairo_set_surface_factory,
} from '@ziroeda/common/gal/cairo/cairo_api.js';

export type LogEntry = [string, ...unknown[]];

export interface FakeCanvas extends CAIRO_SURFACE_BACKING {
  readonly name: string;
  readonly log: LogEntry[];
  /** What `getImageData` answers with, when set. */
  pixels: Uint8ClampedArray | null;
}

export function fakeCanvas(aName: string): FakeCanvas {
  const log: LogEntry[] = [];
  const props: Record<string, unknown> = {
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  };
  const fc: FakeCanvas = {
    name: aName,
    log,
    pixels: null,
    image: { fake: aName } as unknown as CanvasImageSource,
    ctx: null as unknown as CANVAS_2D,
  };

  const ctx = new Proxy(props, {
    get(target, p) {
      if (typeof p !== 'string') return undefined;

      if (p in target) return target[p];

      return (...args: unknown[]) => {
        log.push([p, ...args]);

        if (p === 'createImageData') {
          const [w, h] = args as [number, number];
          return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
        }

        if (p === 'getImageData') {
          const [, , w, h] = args as [number, number, number, number];
          return { data: fc.pixels ?? new Uint8ClampedArray(w * h * 4), width: w, height: h };
        }

        return undefined;
      };
    },
    set(target, p, v) {
      log.push([`=${String(p)}`, v]);
      target[p as string] = v;
      return true;
    },
  });

  (fc as { ctx: CANVAS_2D }).ctx = ctx as unknown as CANVAS_2D;
  return fc;
}

/** Surfaces made by `cairo_image_surface_create`, in order, with their sizes. */
export function installSurfaceFactory(): {
  surfaces: { canvas: FakeCanvas; w: number; h: number }[];
  restore: () => void;
} {
  const surfaces: { canvas: FakeCanvas; w: number; h: number }[] = [];
  const previous = cairo_set_surface_factory((w, h) => {
    const canvas = fakeCanvas(`surface${surfaces.length}`);
    surfaces.push({ canvas, w, h });
    return canvas;
  });

  return { surfaces, restore: () => cairo_set_surface_factory(previous) };
}

/** Round away float noise (and -0) so device coordinates compare exactly. */
export const r9 = (v: number): number => Math.round(v * 1e9) / 1e9 + 0;

export type PathOp = (string | number | boolean)[];

export interface Paint {
  kind: 'fill' | 'stroke';
  path: PathOp[];
  style: unknown;
  op: unknown;
  alpha: unknown;
  lineWidth?: unknown;
  cap?: unknown;
  join?: unknown;
  rule?: unknown;
}

/**
 * The paints a log amounts to. A paint of an empty path is dropped: it
 * covers nothing, in Cairo or on a canvas.
 */
export function paints(aLog: readonly LogEntry[]): Paint[] {
  let m = [1, 0, 0, 1, 0, 0];
  let path: PathOp[] = [];
  const state: Record<string, unknown> = {
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  };
  const out: Paint[] = [];

  const pt = (x: number, y: number): [number, number] => [
    r9(m[0]! * x + m[2]! * y + m[4]!),
    r9(m[1]! * x + m[3]! * y + m[5]!),
  ];

  for (const [name, ...args] of aLog) {
    if (name.startsWith('=')) {
      state[name.slice(1)] = args[0];
      continue;
    }

    const a = args as number[];

    switch (name) {
      case 'setTransform':
        m = a.slice(0, 6);
        break;
      case 'beginPath':
        path = [];
        break;
      case 'moveTo':
        path.push(['M', ...pt(a[0]!, a[1]!)]);
        break;
      case 'lineTo':
        path.push(['L', ...pt(a[0]!, a[1]!)]);
        break;
      case 'bezierCurveTo':
        path.push(['C', ...pt(a[0]!, a[1]!), ...pt(a[2]!, a[3]!), ...pt(a[4]!, a[5]!)]);
        break;
      case 'closePath':
        path.push(['Z']);
        break;
      case 'arc': {
        // a translation and a uniform scale are all the tests put under an arc
        const scale = Math.sqrt(Math.abs(m[0]! * m[3]! - m[1]! * m[2]!));
        path.push([
          'A',
          ...pt(a[0]!, a[1]!),
          r9(a[2]! * scale),
          r9(a[3]!),
          r9(a[4]!),
          Boolean(args[5]),
        ]);
        break;
      }
      case 'fill':
        if (path.length > 0)
          out.push({
            kind: 'fill',
            path: [...path],
            style: state.fillStyle,
            op: state.globalCompositeOperation,
            alpha: state.globalAlpha,
            rule: args[0] ?? 'nonzero',
          });
        break;
      case 'stroke':
        if (path.length > 0)
          out.push({
            kind: 'stroke',
            path: [...path],
            style: state.strokeStyle,
            op: state.globalCompositeOperation,
            alpha: state.globalAlpha,
            lineWidth: state.lineWidth,
            cap: state.lineCap,
            join: state.lineJoin,
          });
        break;
    }
  }

  return out;
}

/** The log entries with one of the given names. */
export function calls(aLog: readonly LogEntry[], ...aNames: string[]): LogEntry[] {
  return aLog.filter(([n]) => aNames.includes(n));
}
