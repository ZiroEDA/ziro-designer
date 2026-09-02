// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The OpenCascade kernel, off the main thread.
 *
 * Tessellation is seconds of straight-line C++ per model — measured on this
 * machine, 4.5 s for a 2.5 MB connector and 46 s for a 24 MB module. On the
 * main thread that is not a slow load, it is a frozen tab: no repaint, no
 * scroll, no cancel button. KiCad has the same cost and the same answer (its
 * 3D viewer loads models off the UI thread), so this is where it belongs.
 *
 * The protocol is one request per message, answered once. Requests are not
 * multiplexed: OCCT here is a single-threaded WASM instance, so a second
 * concurrent call would queue behind the first anyway, and the caller
 * (`loadmodel.ts`) already serialises through its own promise cache.
 */
import type { CadKind, Tessellation } from './occt_types.js';
import { tessellationBuffers } from './occt_types.js';
import { tessellate } from './occt_tessellate.js';

export interface OcctRequest {
  id: number;
  bytes: Uint8Array;
  kind: CadKind;
}

export interface OcctResponse {
  id: number;
  tess: Tessellation | null;
}

self.onmessage = (e: MessageEvent<OcctRequest>): void => {
  const { id, bytes, kind } = e.data;
  void tessellate(bytes, kind).then((tess) => {
    const reply: OcctResponse = { id, tess };
    // Transfer the geometry rather than copy it; the worker has no further use
    // for the buffers once they are on their way back.
    (self as unknown as Worker).postMessage(reply, tess ? tessellationBuffers(tess) : []);
  });
};
