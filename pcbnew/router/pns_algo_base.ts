// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::ALGO_BASE` (`pns_algo_base.h` + `.cpp`), ported whole: the base every
 * P&S algorithm (shoving, walkaround, line placement, dragging, ...) shares —
 * the parent router, the settings accessor that forwards to it, and a logger
 * / debug-decorator pair for the visual debugger.
 *
 * Generic over the host type `THost`, because this repo has no single
 * `PNS::ROUTER` port: each algorithm that extends this class supplies its own
 * narrow seam interface (`PnsDragAlgo`'s `PnsRouterHost`, for the one
 * subclass ported so far) rather than the real 3000-line class. A concrete
 * `PnsAlgoBase<PnsRouterHost>` import would create a cycle with whichever
 * file declares `PnsRouterHost` and extends this class; the generic keeps the
 * dependency one-way (subclass file imports this one, never the reverse).
 *
 * `VisibleViewArea()` is not ported: it forwards to `ROUTER::VisibleViewArea()`,
 * which answers a `KIGFX::VIEW`'s visible bounds, and no host in this port has
 * a view to ask. `Logger()`/`SetLogger()` and `Dbg()`/`SetDebugDecorator()` are
 * ported as opaque value carriers, the same way `PnsDragAlgo` already carried
 * the debug decorator before this file existed: the concrete `LOGGER` and
 * `DEBUG_DECORATOR` classes feed `PNS_DBG`, compiled out of a release build,
 * so nothing here needs to know their shape, only to hold and hand them back.
 *
 * ## Which algorithms extend this, and which do not
 *
 * Upstream's four direct subclasses are `DRAG_ALGO`, `PLACEMENT_ALGO`,
 * `SHOVE` and `WALKAROUND`. Only `PnsDragAlgo` (`pns_drag_algo.ts`) is ported
 * in a shape this class can actually sit under: its constructor already took
 * exactly one `PnsRouterHost` argument and implemented `router()`/`settings()`/
 * `setDebugDecorator()`/`dbg()` inline, matching this class member-for-member.
 * The other three are not extended here, each for a reason specific to it,
 * not a shortcut:
 *
 *  - `PLACEMENT_ALGO` — the abstract base `LINE_PLACER`/`DIFF_PAIR_PLACER`/
 *    `MEANDER_PLACER_BASE` all extend upstream — is not itself ported (no
 *    `pns_placement_algo.ts`); porting it is a separate, larger placement-algo
 *    file-structure gap than this one.
 *  - `PnsShove` (`pns_shove.ts`) takes a `PnsNode` and its own
 *    `PnsShoveSettings` in its constructor, not a router host, and has no
 *    logger or debug-decorator field at all. Extending `PnsAlgoBase` would
 *    mean *inventing* a router reference and two new fields nothing currently
 *    reads — a behaviour change, not a move.
 *  - `WALKAROUND` has no class in this port (`pns_walkaround.ts` is free
 *    functions over a collision callback); there is no instance to extend.
 */

export abstract class PnsAlgoBase<THost extends { settings(): unknown }> {
  /** `ALGO_BASE::m_debugDecorator`. Opaque: see the module doc comment. */
  protected mDebugDecorator: unknown = null;

  /** `ALGO_BASE::m_logger`. Opaque: see the module doc comment. */
  protected mLogger: unknown = null;

  constructor(protected readonly mRouter: THost) {}

  /** `ALGO_BASE::Router()`. */
  router(): THost {
    return this.mRouter;
  }

  /** `ALGO_BASE::Settings()`, which forwards to `Router()->Settings()`. */
  settings(): ReturnType<THost['settings']> {
    return this.mRouter.settings() as ReturnType<THost['settings']>;
  }

  /** `ALGO_BASE::SetLogger( LOGGER* )`. */
  setLogger(aLogger: unknown): void {
    this.mLogger = aLogger;
  }

  /** `ALGO_BASE::Logger()`. */
  logger(): unknown {
    return this.mLogger;
  }

  /**
   * `ALGO_BASE::SetDebugDecorator( DEBUG_DECORATOR* )`: assign a debug
   * decorator allowing this algo to draw extra graphics for visual debugging.
   */
  setDebugDecorator(aDecorator: unknown): void {
    this.mDebugDecorator = aDecorator;
  }

  /** `ALGO_BASE::Dbg()`. */
  dbg(): unknown {
    return this.mDebugDecorator;
  }
}
