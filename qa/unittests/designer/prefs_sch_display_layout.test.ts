// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Display Options —
 * `PANEL_EESCHEMA_DISPLAY_OPTIONS`
 * (`eeschema/dialogs/panel_eeschema_display_options_base.cpp`).
 *
 * The page was one paragraph away from unusable. `CrossProbingGroup` took a
 * `note` — four lines of OUR prose saying the schematic's copy of the
 * cross-probing settings is inert — and rendered it as one long unwrapped line,
 * which gave the page a horizontal scrollbar and pushed the whole right-hand
 * column (Appearance, Selection & Highlighting) off the edge of it. KiCad has
 * no such text anywhere, and "this control does nothing" is what `disabled`
 * says.
 *
 * Two controls upstream draws were missing with it — `m_checkShowDirectiveLabels`
 * (`:116`) and `m_collisionMarkerWidthCtrl` (`:271`) — and the one static text
 * this panel really does draw, `m_highlightColorNote` (`:263`), was not there
 * either.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(process.cwd(), '../designer/src');
const read = (rel: string): string => readFileSync(resolve(SRC, rel), 'utf8');

const PANEL = read('editors/schematic/prefs/PanelEeschemaDisplayOptions.tsx');
const GROUP = read('dialogs/prefs/CrossProbingGroup.tsx');
const PCB = read('editors/pcb/prefs/PanelPcbDisplayOptions.tsx');
const CSS = read('ui/shell.css');
/** Comments stripped: prose ABOUT a row is not that row. */
const strip = (t: string): string =>
  t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const CODE = strip(PANEL);

/** A rule body by exact selector, comments stripped. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) return m[2] ?? '';
  }
  return '';
}

/** The props of the JSX element a label opens. */
function props(label: string): string {
  const at = CODE.indexOf(label);
  expect(at, label).toBeGreaterThan(-1);
  return CODE.slice(at, CODE.indexOf('/>', at));
}

describe('the page says nothing KiCad does not say', () => {
  it('has no note under Cross-probing, and the widget cannot take one', () => {
    expect(CODE).not.toContain('note=');
    expect(strip(GROUP)).not.toContain('note');
    expect(strip(GROUP)).not.toContain('ze-muted');
  });

  it('draws the static text upstream DOES have', () => {
    // `m_highlightColorNote` (`:263`), an ordinary wxStaticText in the
    // Selection & Highlighting gridbag sizer.
    expect(CODE).toContain('(selection color can be edited in the "Colors" page)');
    // ...as a label, with no colour or size of its own.
    expect(rule('.ze-pref-note')).not.toMatch(/(^|[;\s])color\s*:/);
    expect(rule('.ze-pref-note')).not.toMatch(/font-size/);
  });
});

describe('the controls upstream draws are all here', () => {
  it.each([
    ['Show directive labels', 'show_directive_labels'],
    ['Net collision marker width:', 'drag_net_collision_width'],
  ])('%s', (label, setting) => {
    expect(props(label), label).toContain(setting);
  });

  it("keeps upstream's order in the Appearance group", () => {
    // `m_checkShowDirectiveLabels` sits between the hidden fields and ERC.
    const order = ['Show hidden fields', 'Show directive labels', 'Show ERC errors'];
    let at = -1;
    for (const label of order) {
      const next = CODE.indexOf(label);
      expect(next, label).toBeGreaterThan(at);
      at = next;
    }
  });
});

/**
 * The cross-probing settings are read on ONE side. `pcbnew.cross_probing` feeds
 * `crossProbeSelection` and `crossProbeNetHighlight`
 * (`editors/pcb/PcbEditor.tsx:3302`, `pcbnew/src/cross_probe.ts:205`, `:287`);
 * `eeschema.cross_probing` — probes arriving in the SCHEMATIC from the board —
 * has no reader at all.
 */
describe('a group is disabled on the side that does not read it', () => {
  it("greys the schematic page's copy", () => {
    const at = CODE.indexOf('<CrossProbingGroup');
    expect(at).toBeGreaterThan(-1);
    expect(CODE.slice(at, CODE.indexOf('/>', at))).toMatch(/\bdisabled\b/);
  });

  it("leaves the board page's copy live", () => {
    const at = strip(PCB).indexOf('<CrossProbingGroup');
    expect(at).toBeGreaterThan(-1);
    expect(strip(PCB).slice(at, strip(PCB).indexOf('/>', at))).not.toMatch(/\bdisabled\b/);
  });
});

/**
 * A row is enabled exactly when something outside Preferences reads its
 * setting. For this page that is `SchematicEditor.tsx` and the painter it feeds.
 */
describe('the rows nothing reads are disabled', () => {
  it.each([
    ['Default font:'],
    ['Show OP voltages'],
    ['Show OP currents'],
    ['Show pin alternate mode indicator icons'],
    ['Draw selected child items'],
    ['Fill selected shapes'],
    ['Net collision marker width:'],
    ['Highlight netclass colors'],
    ['Color highlight thickness:'],
    ['Color highlight opacity:'],
  ])('%s is disabled', (label) => {
    expect(props(label), label).toMatch(/\bdisabled\b/);
  });

  it.each([
    // `sch_painter.cpp:3266` reads it per directive label, and the second half
    // of that line — `&& !aLabel->IsSelected()` — is why a selected one stays
    // visible. Pinned in `sch_directive_labels_setting.test.ts`.
    ['Show directive labels', 'show_directive_labels'],
    ['Show hidden pins', 'show_hidden_pins'],
    ['Show ERC errors', 'show_erc_errors'],
    ['Show page limits', 'show_page_limits'],
    ['Selection thickness:', 'thickness'],
    ['Highlight thickness:', 'highlight_thickness'],
  ])('%s is live, and bound to %s', (label, setting) => {
    const p = props(label);
    expect(p, label).toContain(setting);
    expect(p, label).not.toMatch(/\bdisabled\b/);
  });
});

describe("the two columns are this page's own sizer", () => {
  it("takes the 25 px gutter its Add() states, not Common's 35", () => {
    // `Add( bSizer9, 0, wxEXPAND|wxRIGHT, 5 )` then `Add( 20, 0 )` (`:76-79`).
    expect(CODE).toContain('ze-gutter-25');
    expect(rule('.ze-pref-columns.ze-gutter-25 > div:first-child')).toMatch(/margin-right:\s*25px/);
    // ...and the default is still the 35 the other pages carry.
    expect(rule('.ze-pref-columns > div:first-child')).toMatch(/margin-right:\s*35px/);
  });
});
