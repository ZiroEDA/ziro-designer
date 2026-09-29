// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::ALGO_BASE`: the router/settings/logger/debug-decorator carrier every
 * P&S algorithm shares. `PnsDragAlgo` (`pns_drag_algo.test.ts` and friends,
 * through its concrete subclasses) is the one production consumer; this file
 * pins the base class directly against a minimal host, the way upstream's own
 * `ALGO_BASE` has no test of its own separate from its subclasses' — a
 * concrete instance is the simplest way to check the base in isolation.
 */
import { describe, expect, it } from 'vitest';
import { PnsAlgoBase } from '@ziroeda/pcbnew/router/pns_algo_base.js';

interface FakeSettings {
  shoveIterationLimit: number;
}

interface FakeHost {
  settings(): FakeSettings;
}

class ConcreteAlgo extends PnsAlgoBase<FakeHost> {}

const makeHost = (limit = 5): FakeHost => ({ settings: () => ({ shoveIterationLimit: limit }) });

describe('PnsAlgoBase', () => {
  it('`Router()`: hands back the exact host it was constructed with', () => {
    const host = makeHost();
    const algo = new ConcreteAlgo(host);

    expect(algo.router()).toBe(host);
  });

  it('`Settings()`: forwards to `Router()->Settings()`', () => {
    const algo = new ConcreteAlgo(makeHost(7));

    expect(algo.settings()).toEqual({ shoveIterationLimit: 7 });
  });

  it('`Logger()` defaults to null and `SetLogger` changes it', () => {
    const algo = new ConcreteAlgo(makeHost());

    expect(algo.logger()).toBeNull();

    const logger = { tag: 'a logger' };
    algo.setLogger(logger);
    expect(algo.logger()).toBe(logger);
  });

  it('`Dbg()` defaults to null and `SetDebugDecorator` changes it', () => {
    const algo = new ConcreteAlgo(makeHost());

    expect(algo.dbg()).toBeNull();

    const decorator = { tag: 'a decorator' };
    algo.setDebugDecorator(decorator);
    expect(algo.dbg()).toBe(decorator);
  });

  it('logger and debug decorator are independent carriers', () => {
    const algo = new ConcreteAlgo(makeHost());
    const logger = { tag: 'logger' };
    const decorator = { tag: 'decorator' };

    algo.setLogger(logger);
    algo.setDebugDecorator(decorator);

    expect(algo.logger()).toBe(logger);
    expect(algo.dbg()).toBe(decorator);
    expect(algo.logger()).not.toBe(algo.dbg());
  });

  it('two instances over different hosts do not share state', () => {
    const a = new ConcreteAlgo(makeHost(1));
    const b = new ConcreteAlgo(makeHost(2));

    a.setDebugDecorator({ tag: 'only a' });

    expect(a.settings().shoveIterationLimit).toBe(1);
    expect(b.settings().shoveIterationLimit).toBe(2);
    expect(b.dbg()).toBeNull();
  });
});
