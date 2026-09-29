// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/router/time_limit.h` + `.cpp` (`PNS::TIME_LIMIT`), ported whole.
 *
 * A deadline the shove main loop checks each iteration so a pathological
 * board cannot hang the router forever. `wxGetLocalTimeMillis()` is
 * `Date.now()` here — both are wall-clock milliseconds since the epoch, and
 * neither claims monotonicity, which upstream does not ask for either.
 *
 * Its one real caller is `SHOVE::shoveMainLoop` (`pns_shove.ts`'s
 * `shoveMainLoop`), which used to compute the deadline inline as
 * `Date.now() + shoveTimeLimit` and compare with `Date.now() > deadline` —
 * strictly greater, where {@link expired} below is `>=`, matching
 * `TIME_LIMIT::Expired`. The two differ only in the single millisecond where
 * elapsed time exactly equals the limit, unobservable in practice; ported
 * faithfully now that the class exists to ask.
 *
 * `pns_routing_settings.ts` already notes `walkaroundTimeLimit` is
 * deliberately absent: upstream declares `WalkaroundTimeLimit()` and the
 * `m_walkaroundTimeLimit` member but never calls it, so there is no second
 * caller to port this against.
 */

export class TimeLimit {
  private mLimitMs: number;
  private mStartTics = 0;

  constructor(aMilliseconds = 0) {
    this.mLimitMs = aMilliseconds;
    this.restart();
  }

  /** `TIME_LIMIT::Expired`: has the deadline passed? */
  expired(): boolean {
    return Date.now() - this.mStartTics >= this.mLimitMs;
  }

  /** `TIME_LIMIT::Restart`: reset the clock, keeping the limit. */
  restart(): void {
    this.mStartTics = Date.now();
  }

  /** `TIME_LIMIT::Set`. */
  set(aMilliseconds: number): void {
    this.mLimitMs = aMilliseconds;
  }

  /** `TIME_LIMIT::Get`. */
  get(): number {
    return this.mLimitMs;
  }
}
