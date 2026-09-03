// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which widget owns each line in a docked pane.
 *
 * A pane is a caption plus a control, and every rule in it belongs to one or
 * the other. We had them confused in both directions, and the result was a
 * line in the wrong place every time:
 *
 *   - `.ze-panel-header` drew a `border-bottom`, so the line that is really
 *     the CONTROL's top edge appeared directly under the caption. In the
 *     Properties pane, where a 28px wxStaticText sits between the caption and
 *     the wxPropertyGrid, that put the grid's frame 28px too high and left the
 *     grid with no left, right or bottom edge at all;
 *   - `.ze-rightdock .ze-panel` painted the whole pane in `m_layerPanelColour`,
 *     which upstream sets on the layers SCROLLER inside the notebook
 *     (`appearance_controls.cpp:1242`), so the tab strip, the Presets block and
 *     the Selection Filter all came out list-grey;
 *   - `.ze-collapsepane` and `.ze-appearance-bottom` each drew a rule of their
 *     own on an edge the notebook's frame already owns.
 *
 * [px] every number below is off one capture: a live pcbnew 10.0.5 at
 * 1920x1200 on 2026-09-03, with a footprint selected so the Properties pane is
 * full. Two columns give the whole story.
 *
 *     x=345, down the Properties pane          x=1915, down the Appearance pane
 *     ------------------------------------     ---------------------------------
 *     171..187  #2e2e2e  caption, 17 rows      171..187  #2e2e2e  caption
 *     188..215  #373737  "Footprint" label     188..192  #373737  pane face
 *     216       #181818  the grid's top edge   193       #181818  notebook frame
 *     217..     #272727 / #373737  the grid    194..229  #373737  tab strip
 *     ...                                      230       #181818  under the tabs
 *     1140      #181818  the grid's bottom     231..808  #4b4b4b  the layer list
 *                                              809..833  #272727  Layer Display
 *                                              834       #181818  frame, bottom
 *                                              835..     #373737  Presets, filter
 *
 * Neither column has a pixel of #1e1e1e in it, which is what we were drawing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(rel: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)),
    'utf8',
  );
}

const SHELL = read('ui/shell.css');
const PROPS = read('widgets/properties_panel.css');
const APPEAR = read('widgets/appearance_controls.css');

/**
 * A rule's DECLARATIONS, by exact selector, with the comments stripped.
 *
 * Every rule in these files carries the citation for its number, and a
 * `not.toMatch(/border/)` over the raw text matches the prose explaining why
 * there is no border. Comments out, so an assertion reads the CSS.
 */
function body(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('the pane caption', () => {
  it('is 17px of fill and nothing else', () => {
    // wxAUI_DOCKART_CAPTION_SIZE (qa/probes/aui_sash_probe.cpp), and the three
    // captions in the capture all fill y 171..187. It said 18 because it was
    // also drawing a rule; both halves of that are wrong.
    const rule = body(SHELL, '.ze-panel-header');
    expect(rule).toMatch(/min-height:\s*17px/);
    expect(rule).not.toMatch(/border/);
  });

  it('and the control below it carries its own frame instead', () => {
    // Local History's wxListCtrl used to get its top edge from the caption's
    // border-bottom; it has all four sides of its own now.
    expect(body(SHELL, '.ze-lhist-head')).toMatch(/border-top:\s*1px solid var\(--ctl-border\)/);
  });
});

describe('PROPERTIES_PANEL', () => {
  it('frames the wxPropertyGrid, on all four sides', () => {
    // A view control gets GTK's 1px frame, the same one a wxListCtrl and a
    // wxTextCtrl get. [px] #181818 at x=66 and x=365 on every property row,
    // at y=216 under the caption and at y=1140 at the bottom of the pane.
    const rule = body(PROPS, '.ze-pgrid');
    expect(rule).toMatch(/border:\s*1px solid var\(--ctl-border\)/);
    // Edge to edge inside the pane: `mainSizer->Add( m_grid, 1, wxEXPAND, 5 )`
    // (properties_panel.cpp:115) passes no wxALL, so the 5 is never applied.
    expect(rule).not.toMatch(/^\s*margin(-\w+)?\s*:/m);
  });

  it('centres the category expander in the 15px margin', () => {
    // wxRendererNative centres GTK's expander in the rect it is handed, and
    // the rect is the whole gutter. [px] margin x 67..81, chevron ink 68..78.
    const rule = body(PROPS, '.ze-pgrid-twisty::before');
    expect(rule).toMatch(
      /left:\s*calc\(\(var\(--pgrid-margin-width\) - var\(--pgrid-icon-width\)\) \/ 2\)/,
    );
    expect(PROPS).toMatch(/--pgrid-icon-width:\s*9px/);
    // and it takes that same token for its size, rather than a second 9.
    expect(rule).toMatch(/width:\s*var\(--pgrid-icon-width\)/);
    expect(rule).toMatch(/height:\s*var\(--pgrid-icon-width\)/);
  });

  it('carries the caption close box, which is the pane that asks for one', () => {
    // `.CloseButton( true )` on Properties (pcb_edit_frame.cpp:387) and
    // `.CloseButton( false )` on Appearance and Selection Filter (:356, :365).
    const pcb = read('editors/pcb/PcbEditor.tsx');
    const at = pcb.indexOf(
      '<div className="ze-panel-header">\n                  <span>Properties</span>',
    );
    expect(at, 'the Properties caption has no close box').toBeGreaterThanOrEqual(0);
    const caption = pcb.slice(at, pcb.indexOf('</div>', at));
    expect(caption).toContain('className="ze-pane-close"');
    // The shared one, the same box eeschema's palettes and Local History use.
    expect(SHELL).toContain('.ze-pane-close {');
    // Closing a pane is the state the View > Panels check item drives.
    expect(caption).toContain("onLeftToggle('showProperties')");
  });
});

describe('APPEARANCE_CONTROLS', () => {
  it('the pane is a plain wxPanel, not the layer list', () => {
    // `m_layerPanelColour` is set on `m_windowLayers` and on each row's panel
    // (appearance_controls.cpp:1242-1269) — the scroller inside the notebook.
    const rule = body(SHELL, '.ze-rightdock .ze-panel');
    expect(rule).toMatch(/background:\s*var\(--content-bg\)/);
    // and no rule between the two panes: what wxAUI puts there is a sash, and
    // a sash is the same #373737 as the panes it separates.
    expect(rule).not.toMatch(/border/);
    // and only the LAYERS page wears it: `m_windowObjects` is not in that
    // function at all, so the Objects and Nets pages keep the notebook page's
    // own #272727. [px] #4b4b4b behind a layer row, #272727 behind an object
    // row and behind the whole Nets tab.
    expect(body(APPEAR, '.ze-appearance > .ze-nb-frame > .page-layers')).toMatch(
      /background:\s*var\(--panel-list-bg\)/,
    );
    expect(
      body(
        APPEAR,
        '.ze-appearance > .ze-nb-frame > .page-objects,\n.ze-appearance > .ze-nb-frame > .page-nets',
      ),
    ).toMatch(/background:\s*var\(--panel-bg\)/);
  });

  it('the notebook is a box around the strip AND the page', () => {
    // [px] the frame's top edge at y=193, five pixels under the caption, and
    // its bottom at y=834 below the collapsed Layer Display Options strip.
    expect(body(APPEAR, '.ze-appearance > .ze-nb-frame')).toMatch(/margin:\s*5px 0/);
    // The shared notebook box, the same one PANEL_SYMBOL_PROPS takes.
    expect(SHELL).toContain('.ze-nb-frame {');
    const tsx = read('widgets/appearance_controls.tsx');
    expect(tsx).toContain('className="ze-nb-frame ze-appearance-nb"');
  });

  it('the collapsible pane is inside it, and changes colour rather than ruling', () => {
    // `new WX_COLLAPSIBLE_PANE( m_panelLayers, ... )` with
    // `SetBackgroundColour( m_notebook->GetThemeBackgroundColour() )`
    // (appearance_controls.cpp:625-629). [px] #4b4b4b to y=808, #272727 from
    // 809, no line between.
    expect(body(APPEAR, '.ze-appearance > .ze-nb-frame > .ze-collapsepane')).toMatch(
      /background:\s*var\(--panel-bg\)/,
    );
    expect(body(SHELL, '.ze-collapsepane')).not.toMatch(/border/);
  });

  it('the Presets block sits outside the notebook and draws no rule', () => {
    // `m_sizerOuter->Add( bBottomMargin, 0, wxEXPAND|wxTOP|wxBOTTOM, 4 )`
    // (appearance_controls_base.cpp:192): a sibling of the notebook, so the
    // line above it is the notebook's own bottom edge.
    expect(body(SHELL, '.ze-appearance-bottom')).not.toMatch(/border/);
  });

  it('and its two choices are Combo, sized by their sizer flags', () => {
    // `bPresets->Add( m_cbLayerPresets, 0, wxALL|wxEXPAND, 2 )`
    // (appearance_controls_base.cpp:169, :186).
    const rule = body(SHELL, '.ze-appearance-bottom .ze-combo');
    expect(rule).toMatch(/margin:\s*2px/);
    expect(rule).toMatch(/width:\s*calc\(100% - 4px\)/);
    // The old native-select styling is gone with the selects.
    expect(SHELL).not.toContain('.ze-appearance-bottom select');
  });
});

describe('the three pages, and the controls on them', () => {
  it('a tab strip is 36px because the rule says so, not because a label was', () => {
    // `qa/probes/appearance_row_probe.cpp` puts a real wxNotebook's first page
    // at y=38 inside the control: 1px of frame, --tab-strip-height of strip,
    // and the 1px line under it. With only the padding stated ours came out at
    // whatever line box the label made - [px] 38, which pushed the whole
    // notebook two pixels down the pane.
    const rule = body(SHELL, '.ze-ds-tabs button,\n.ze-nb-tabs button');
    expect(rule).toMatch(/height:\s*var\(--tab-strip-height\)/);
    expect(rule).toMatch(/box-sizing:\s*border-box/);
    expect(SHELL).toMatch(/--tab-strip-height:\s*36px/);
  });

  it('an Objects row with a slider is one control tall', () => {
    // A wxPanel row is as tall as its tallest child, and on those six rows that
    // is the wxSlider: 34px, the same answer wx gives for a wxTextCtrl, which
    // is why this is --ctl-height. [px] pcbnew repeats those rows every 34 and
    // the slider-less ones every 20; ours was 22 for both.
    expect(body(SHELL, '.ze-object-row.has-slider')).toMatch(/height:\s*var\(--ctl-height\)/);
    expect(SHELL).toMatch(/--ctl-height:\s*34px/);
  });

  it('and the slider on it is the shared one, not a range input of its own', () => {
    const tsx = read('widgets/appearance_controls.tsx');
    expect(tsx).toContain("import { Slider } from '../ui/Slider.js'");
    // The JSX, with the comments stripped: the note at the call site names the
    // input it replaced, and a raw `toContain` matches that prose.
    expect(tsx.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('type="range"');
    // What is left at the call site is where the sizer puts it, and nothing
    // about how it looks: no track colour, no thumb, no radius.
    const rule = body(SHELL, '.ze-opacity');
    expect(rule).not.toMatch(/background|border-radius|appearance/);
    // The track and thumb values it used to spell are all tokens already.
    expect(SHELL).toMatch(/--slider-track-bg:\s*#4b4b4b/);
    expect(SHELL).toMatch(/--slider-thumb-size:\s*20px/);
    expect(SHELL).toMatch(/--slider-thumb-bg:\s*#fcfcfc/);
  });

  it('the Nets tab is a splitter, and the splitter is the shared one', () => {
    // `m_netsTabSplitter->SplitHorizontally( m_panelNets, m_panelNetclasses,
    // 300 )` with `SetMinimumPaneSize( 80 )` (appearance_controls_base.cpp:52,
    // :144). Without it a 220-net board pushed Net Classes off the pane.
    const tsx = read('widgets/appearance_controls.tsx');
    expect(tsx).toContain("import { Sash } from '../ui/Sash.js'");
    expect(tsx).toMatch(/const NETS_SASH_POS = 300;/);
    expect(tsx).toMatch(/const NETS_MIN_PANE = 80;/);
    // The shared sash, which is the wxSplitterWindow one — #181818 and 5px,
    // not wxAUI's #373737. Its geometry is `resizeDock`, the same clamp
    // DockSash uses, so the sign rule is stated once.
    const sash = read('ui/Sash.tsx');
    expect(sash).toContain("from './dock_sash.js'");
    expect(sash).toContain("className={`ze-sash ${vertical ? 'h' : 'v'}`}");
    expect(body(SHELL, '.ze-sash')).toMatch(/background:\s*var\(--splitter-sash\)/);
  });

  it('and its two panels are bare wxPanels', () => {
    // [px] pcbnew's Nets tab is an unbroken #272727 from the tab strip's rule
    // at y=230 to the sash at y=511. This drew a rounded #313438 box with a
    // --chrome-border frame around each half.
    const rule = body(SHELL, '.ze-nets-box');
    expect(rule).not.toMatch(/border|background/);
    // and the list scrolls in its own half rather than being capped by a vh.
    expect(body(SHELL, '.ze-nets-list')).not.toMatch(/max-height/);
  });
});

describe('GerbView', () => {
  it('the layers dock has no canvas-facing rule either', () => {
    // `.PaneBorder( false )` (gerbview_frame.cpp:170), and the dock already
    // renders the 5px sash that separates it from the toolbar.
    expect(body(read('editors/gerbview/gerbview.css'), '.ze-gbr-dock')).not.toMatch(/border/);
  });
});
