// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TRACE_MANAGER` / `KI_TRACE` (include/trace_helpers.h, common/trace_helpers.cpp)
 * and the trace masks the ported code prints under.
 *
 * KiCad reads the `KICAD_TRACE` environment variable — a comma list of masks,
 * or `all` — once, and a trace whose mask is not in it costs nothing. The
 * browser's environment is `localStorage`: `localStorage.KICAD_TRACE =
 * 'KICAD_GAL_PROFILE'` before a reload turns the same traces on, printed with
 * `console.debug` in the C++'s ` %-30s | %s` shape.
 */

// The timer the traces print, for the packages that reach core through common.
export { PROF_TIMER } from '@ziroeda/core/profile.js';

/** Flag to enable GAL profile tracing (`traceGalProfile`). */
export const traceGalProfile = 'KICAD_GAL_PROFILE';

/** Flag to enable draw panel tracing (draw_panel_gal.cpp's `traceDrawPanel`). */
export const traceDrawPanel = 'KICAD_DRAW_PANEL';

/** Flag to enable Allegro import / open-time profiling (`traceAllegroPerf`). */
export const traceAllegroPerf = 'KICAD_ALLEGRO_PERF';

export class TRACE_MANAGER {
  private m_enabledTraces = new Map<string, boolean>();
  private m_globalTraceEnabled = false;
  private m_printAllTraces = false;

  private static s_instance: TRACE_MANAGER | null = null;

  static Instance(): TRACE_MANAGER {
    if (!TRACE_MANAGER.s_instance) {
      TRACE_MANAGER.s_instance = new TRACE_MANAGER();
      TRACE_MANAGER.s_instance.init();
    }

    return TRACE_MANAGER.s_instance;
  }

  IsTraceEnabled(aWhat: string): boolean {
    if (!this.m_printAllTraces) {
      if (!this.m_globalTraceEnabled) return false;

      if (!this.m_enabledTraces.has(aWhat)) return false;
    }

    return true;
  }

  Trace(aWhat: string, aMessage: string): void {
    if (!this.IsTraceEnabled(aWhat)) return;

    console.debug(` ${aWhat.padEnd(30)} | ${aMessage}`);
  }

  private init(): void {
    const traceVars = readEnv('KICAD_TRACE');
    this.m_globalTraceEnabled = traceVars !== null;
    this.m_printAllTraces = false;

    if (!this.m_globalTraceEnabled) return;

    for (const token of traceVars!.split(',')) {
      this.m_enabledTraces.set(token, true);

      if (token.toLowerCase() === 'all') this.m_printAllTraces = true;
    }
  }
}

/** `KI_TRACE( aWhat, ... )`: the message is built only when the mask is on. */
export function KI_TRACE(aWhat: string, aMessage: () => string): void {
  if (TRACE_MANAGER.Instance().IsTraceEnabled(aWhat))
    TRACE_MANAGER.Instance().Trace(aWhat, aMessage());
}

/**
 * `wxLogTrace( mask, ... )`: wx's own trace, on when the mask is in `WXTRACE`
 * (the environment variable wx reads). The same store as `KICAD_TRACE`.
 */
export function wxLogTrace(aMask: string, aMessage: () => string): void {
  if (wxTraceMasks().has(aMask)) console.debug(`Trace: ${aMessage()}`);
}

let g_wxTraceMasks: Set<string> | null = null;

function wxTraceMasks(): Set<string> {
  if (!g_wxTraceMasks)
    g_wxTraceMasks = new Set((readEnv('WXTRACE') ?? '').split(',').filter(Boolean));

  return g_wxTraceMasks;
}

/** `wxGetEnv`: the browser's environment is `localStorage`. */
function readEnv(aName: string): string | null {
  try {
    return globalThis.localStorage?.getItem(aName) ?? null;
  } catch {
    return null;
  }
}
