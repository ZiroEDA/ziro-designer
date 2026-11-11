// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The 3D viewer's layer build on a worker (not KiCad's).
 *
 * `RENDER_3D_OPENGL::reload` rebuilds every layer of the board on each `NewDisplay( true )` -
 * a layer shown or hidden in the appearance pane, a board edit, a preference. KiCad does that in
 * C++ on its GUI thread; here the same `BOARD_ADAPTER::createLayers` (board_3d_layers.ts) and
 * the triangulation of its faces take seconds on a large board, and on the window's thread they
 * freeze the whole app for them. So they run here, on a copy of the board parsed from its text
 * (as the DRC and fill jobs do), and the scene on screen stays up until the new one is ready -
 * which is what upstream's reload already does with the previous frame.
 *
 * The board's text is the transport; the answer is the layers' polygons and, in
 * forEachPolygonList's order, each polygon's triangles.
 */
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  CTL_ENUMERATE_LAYERS,
  CTL_FOR_BOARD,
  FormatBoardAsync,
  ParseBoard,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import {
  type Board3dLayers,
  buildBoard3dLayers,
  forEachPolygonList,
  type Layer3dOptions,
  TriangulatePolygon,
} from './board_3d_layers.js';

type Box = Parameters<typeof buildBoard3dLayers>[1];

/** What the job builds from: the board's text and createLayers' inputs. */
interface BOARD_3D_LAYERS_REQUEST {
  id: number;
  boardText: string;
  bbox: Box;
  opts: Omit<Layer3dOptions, 'report'>;
}

type BOARD_3D_LAYERS_MESSAGE =
  | { id: number; t: 'report'; text: string }
  | { id: number; t: 'done'; built: Board3dLayers; tris: (Uint32Array | null)[] }
  | { id: number; t: 'error'; message: string };

/** The layers, and each polygon's triangles in forEachPolygonList's order. */
export interface BOARD_3D_LAYERS_RESULT {
  built: Board3dLayers;
  tris: (Uint32Array | null)[];
}

// ---------------------------------------------------------------------------------------------
// The window's half.
// ---------------------------------------------------------------------------------------------

let s_worker: Worker | null = null;
/** Set once a worker could not be made or died: the scene builds on the window's thread. */
let s_broken = false;
let s_nextId = 1;
let s_inFlight: {
  id: number;
  resolve: (aResult: BOARD_3D_LAYERS_RESULT | null) => void;
  report: (aText: string) => void;
} | null = null;

/** Whether the layers can be built off the window's thread here (not under test, say). */
export function Board3dLayersJobAvailable(): boolean {
  return !s_broken && typeof Worker !== 'undefined';
}

function startWorker(): Worker | null {
  try {
    const worker = new Worker(new URL('./board_3d_layers_job.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e: MessageEvent<BOARD_3D_LAYERS_MESSAGE>): void => {
      const job = s_inFlight;

      if (!job || job.id !== e.data.id) return;

      if (e.data.t === 'report') {
        job.report(e.data.text);
        return;
      }

      s_inFlight = null;

      if (e.data.t === 'done') {
        job.resolve({ built: e.data.built, tris: e.data.tris });
      } else {
        console.error('3D layer job:', e.data.message);
        job.resolve(null);
      }
    };

    // A worker that dies answers its job as a failure, and the scene builds here from now on.
    worker.onerror = (e: ErrorEvent): void => {
      console.error('3D layer job failed:', e.message || 'could not load');
      s_broken = true;
      s_worker = null;
      s_inFlight?.resolve(null);
      s_inFlight = null;
    };

    return worker;
  } catch {
    s_broken = true;
    return null;
  }
}

/**
 * Build \a aBoard's 3D layers on the worker. A job still running when another is asked for is
 * dropped with its worker - only the newest reload is ever shown - and answers null, as does a
 * job that failed; null also when \a aAbort turns true while the board's text is written.
 */
export async function RunBoard3dLayersJob(
  aBoard: BOARD,
  aBbox: Box,
  aOpts: Omit<Layer3dOptions, 'report'>,
  aReport: (aText: string) => void,
  aAbort: () => boolean,
): Promise<BOARD_3D_LAYERS_RESULT | null> {
  const boardText = await FormatBoardAsync(
    aBoard,
    () => new Promise((r) => setTimeout(r, 0)),
    aAbort,
    undefined,
    undefined,
    CTL_FOR_BOARD | CTL_ENUMERATE_LAYERS,
  );

  if (boardText === null || aAbort()) return null;

  if (s_inFlight) {
    s_inFlight.resolve(null);
    s_inFlight = null;
    s_worker?.terminate();
    s_worker = null;
  }

  s_worker ??= startWorker();

  const worker = s_worker;

  if (!worker) return null;

  const id = s_nextId++;

  return new Promise((resolve) => {
    s_inFlight = { id, resolve, report: aReport };
    worker.postMessage({
      id,
      boardText,
      bbox: aBbox,
      opts: aOpts,
    } satisfies BOARD_3D_LAYERS_REQUEST);
  });
}

// ---------------------------------------------------------------------------------------------
// The worker's half.
// ---------------------------------------------------------------------------------------------

interface WorkerScope {
  postMessage(aMessage: BOARD_3D_LAYERS_MESSAGE, aTransfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<BOARD_3D_LAYERS_REQUEST>) => void) | null;
}

const g = globalThis as unknown as { WorkerGlobalScope?: unknown };

if (g.WorkerGlobalScope !== undefined) {
  const scope = globalThis as unknown as WorkerScope;
  // Warmed now; each request awaits InitCodec() itself, so a load that failed is asked for again.
  EMBEDDED_FILES.InitCodec().catch(() => undefined);
  /** The last board parsed, by its text: a reload that only shows or hides a layer reuses it. */
  let last: { text: string; board: BOARD } | null = null;

  scope.onmessage = async (e: MessageEvent<BOARD_3D_LAYERS_REQUEST>): Promise<void> => {
    const { id, boardText, bbox, opts } = e.data;

    try {
      await EMBEDDED_FILES.InitCodec();

      if (last?.text !== boardText) last = { text: boardText, board: ParseBoard(boardText) };

      const built = buildBoard3dLayers(last.board, bbox, {
        ...opts,
        report: (text) => scope.postMessage({ id, t: 'report', text }),
      });
      const tris: (Uint32Array | null)[] = [];

      forEachPolygonList(built, (list) => {
        for (const poly of list) tris.push(TriangulatePolygon(poly));
      });

      scope.postMessage(
        { id, t: 'done', built, tris },
        tris.filter((t): t is Uint32Array => t !== null).map((t) => t.buffer),
      );
    } catch (err) {
      scope.postMessage({
        id,
        t: 'error',
        message: err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
    }
  };
}
