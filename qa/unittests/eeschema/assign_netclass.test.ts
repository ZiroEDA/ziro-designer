// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Assign Netclass's pattern rule, counterpart SCH_EDITOR_CONTROL::AssignNetclass
 * and its getNetNamePattern lambda.
 *
 * A netclass attaches to a *pattern*, not to a net, so this rule is the whole
 * of the action's logic — the dialog only picks a name afterwards.
 */
import { describe, it, expect } from 'vitest';
import {
  addNetclassAssignment,
  busMemberPatterns,
  netNamePattern,
  planNetclassAssignment,
  selectedNets,
  type SelectedNet,
} from '@ziroeda/eeschema/src/tools/assign_netclass.js';
import { Priority } from '@ziroeda/eeschema/src/connectivity/nets.js';

const net = (over: Partial<SelectedNet> = {}): SelectedNet => ({
  name: 'CLK',
  isBus: false,
  driverPriority: Priority.LocalLabel,
  ...over,
});

describe('a plain net', () => {
  it('is its own pattern', () => {
    expect(netNamePattern(net({ name: 'VCC' }))).toBe('VCC');
  });

  it('keeps a sheet-path qualified name intact', () => {
    expect(netNamePattern(net({ name: '/Child/CLK' }))).toBe('/Child/CLK');
  });
});

describe('a bus becomes a wildcard, not its own name', () => {
  it('a vector bus takes the prefix and a star', () => {
    // D[0..7] -> D*, so the class covers the members rather than the bus.
    expect(netNamePattern(net({ name: 'D[0..7]', isBus: true }))).toBe('D*');
  });

  it('a group bus takes the prefix and a dotted star', () => {
    // {USB SDA SCL} members are qualified PREFIX.MEMBER, so the pattern is
    // PREFIX.* — a bare star would not match them.
    const pattern = netNamePattern(net({ name: 'USB{SDA SCL}', isBus: true }));
    expect(pattern).toBe('USB.*');
  });

  it('the two forms produce different patterns', () => {
    const vector = netNamePattern(net({ name: 'D[0..7]', isBus: true }));
    const group = netNamePattern(net({ name: 'USB{SDA SCL}', isBus: true }));
    expect(vector).not.toBe(group);
  });

  it('a bus that parses as neither falls through to the driver check', () => {
    // Upstream's if/else-if chain has no final else: an unparsable bus is
    // treated like any other connection.
    expect(netNamePattern(net({ name: 'NOTABUS', isBus: true }))).toBe('NOTABUS');
    expect(
      netNamePattern(net({ name: 'NOTABUS', isBus: true, driverPriority: Priority.Pin })),
    ).toBeNull();
  });
});

describe('an unlabeled net has no pattern', () => {
  it('is refused below sheet-pin priority', () => {
    // A weaker driver means an auto-generated name that changes on the next
    // edit; assigning a class to it would not survive.
    expect(netNamePattern(net({ driverPriority: Priority.Pin }))).toBeNull();
    expect(netNamePattern(net({ driverPriority: Priority.None }))).toBeNull();
  });

  it('is accepted at sheet-pin priority and above', () => {
    // The boundary is `< PRIORITY::SHEET_PIN`, so SheetPin itself passes.
    expect(netNamePattern(net({ driverPriority: Priority.SheetPin }))).toBe('CLK');
    expect(netNamePattern(net({ driverPriority: Priority.HierLabel }))).toBe('CLK');
    expect(netNamePattern(net({ driverPriority: Priority.Global }))).toBe('CLK');
  });
});

describe('the plan over a whole selection', () => {
  it('refuses an empty selection', () => {
    expect(planNetclassAssignment([])).toEqual({
      patterns: [],
      error: 'No nets selected.',
    });
  });

  it('collects patterns, de-duplicated and sorted', () => {
    // std::set<wxString>: unique and ordered.
    const plan = planNetclassAssignment([
      net({ name: 'VCC' }),
      net({ name: 'GND' }),
      net({ name: 'VCC' }),
    ]);
    expect(plan.error).toBeUndefined();
    expect(plan.patterns).toEqual(['GND', 'VCC']);
  });

  it('refuses the whole action if ANY net is unlabeled', () => {
    // All-or-nothing on purpose: upstream's comment calls it out as a choice,
    // so a partial assignment is not silently substituted.
    const plan = planNetclassAssignment([
      net({ name: 'VCC' }),
      net({ driverPriority: Priority.Pin }),
    ]);
    expect(plan.patterns).toEqual([]);
    expect(plan.error).toBe('All selected nets must be labeled to assign a netclass.');
  });

  it('mixes buses and plain nets in one plan', () => {
    const plan = planNetclassAssignment([
      net({ name: 'D[0..7]', isBus: true }),
      net({ name: 'CLK' }),
    ]);
    expect(plan.patterns).toEqual(['CLK', 'D*']);
  });
});

describe('bus patterns expand before they are stored', () => {
  it('a vector expands to its members', () => {
    // The matchers read [ as a regex character class, so an unexpanded
    // D[0..2] would never match D0.
    expect(busMemberPatterns('D[0..2]')).toEqual(['D0', 'D1', 'D2']);
  });

  it('a group expands its members, recursively', () => {
    // A group member may itself be a vector, so the expansion recurses.
    expect(busMemberPatterns('USB{D[0..1] SCL}')).toEqual(['D0', 'D1', 'SCL']);
  });

  it('a plain pattern is itself', () => {
    expect(busMemberPatterns('VCC')).toEqual(['VCC']);
    expect(busMemberPatterns('D*')).toEqual(['D*']);
  });
});

describe('storing an assignment', () => {
  const start = [{ pattern: 'VCC', netClass: 'Power' }];

  it('appends a new one', () => {
    expect(addNetclassAssignment(start, 'GND', 'Power')).toEqual([
      { pattern: 'VCC', netClass: 'Power' },
      { pattern: 'GND', netClass: 'Power' },
    ]);
  });

  it('skips an exact duplicate', () => {
    expect(addNetclassAssignment(start, 'VCC', 'Power')).toEqual(start);
  });

  it('does NOT replace a different class for the same pattern', () => {
    // addSinglePatternAssignment compares pattern *and* netclass, so this is an
    // append. Replacing would be the intuitive guess and would silently drop
    // the user's earlier rule.
    expect(addNetclassAssignment(start, 'VCC', 'HighSpeed')).toEqual([
      { pattern: 'VCC', netClass: 'Power' },
      { pattern: 'VCC', netClass: 'HighSpeed' },
    ]);
  });

  it('stores one row per bus member', () => {
    const out = addNetclassAssignment([], 'D[0..2]', 'Fast');
    expect(out).toEqual([
      { pattern: 'D0', netClass: 'Fast' },
      { pattern: 'D1', netClass: 'Fast' },
      { pattern: 'D2', netClass: 'Fast' },
    ]);
  });

  it('leaves the input untouched', () => {
    const input = [...start];
    addNetclassAssignment(input, 'GND', 'Power');
    expect(input).toEqual(start);
  });
});

describe('resolving a selection to connections', () => {
  const netlist = {
    nets: [
      { code: 1, name: 'VCC', driverPriority: Priority.LocalLabel },
      { code: 2, name: 'GND', driverPriority: Priority.LocalLabel },
    ],
    netByItem: new Map([
      ['line:w1', 1],
      ['line:w2', 1],
      ['line:w3', 2],
    ]),
    buses: [
      { name: 'D[0..7]', items: ['line:b1'] },
      { name: '', items: ['line:b2'] },
    ],
  };

  it('maps items to their nets', () => {
    expect(selectedNets(netlist, ['line:w1'])).toEqual([
      { name: 'VCC', isBus: false, driverPriority: Priority.LocalLabel },
    ]);
  });

  it('reports one entry per net, not per item', () => {
    // Two wires on the same net are one connection.
    expect(selectedNets(netlist, ['line:w1', 'line:w2'])).toHaveLength(1);
    expect(selectedNets(netlist, ['line:w1', 'line:w3'])).toHaveLength(2);
  });

  it('ignores an item with no connection', () => {
    // Upstream's loop `continue`s past those rather than failing, so a symbol
    // body selected alongside a wire does not break the action.
    expect(selectedNets(netlist, ['symbol:s1', 'line:w1'])).toHaveLength(1);
    expect(selectedNets(netlist, ['symbol:s1'])).toEqual([]);
  });

  it('finds a bus, which is not in netByItem', () => {
    expect(selectedNets(netlist, ['line:b1'])).toEqual([
      { name: 'D[0..7]', isBus: true, driverPriority: Priority.LocalLabel },
    ]);
  });

  it('an unnamed bus is refused by the pattern rule', () => {
    // Reported at Priority.None: there is no label on it to assign a class to.
    const nets = selectedNets(netlist, ['line:b2']);
    expect(nets[0]!.driverPriority).toBe(Priority.None);
    expect(planNetclassAssignment(nets).error).toBe(
      'All selected nets must be labeled to assign a netclass.',
    );
  });

  it('feeds the plan end to end', () => {
    const plan = planNetclassAssignment(selectedNets(netlist, ['line:w1', 'line:w3', 'line:b1']));
    expect(plan.error).toBeUndefined();
    expect(plan.patterns).toEqual(['D*', 'GND', 'VCC']);
  });
});
