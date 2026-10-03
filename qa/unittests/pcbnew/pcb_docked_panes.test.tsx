// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_EDIT_FRAME`'s three docked panes, wired: the View > Panels rows that
 * show them (`menubar_pcb_editor.cpp:216-222`, `ToggleSearch` /
 * `ToggleNetInspector`, `pcb_edit_frame.cpp:1127-1131`), the Search pane over a
 * real BOARD, and an Edit Vertices commit (`vertex_editor_pane.cpp`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { SEARCH_PANE } from '@ziroeda/common/settings/app_settings.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import type { Menu, MenuItem } from '@ziroeda/common/tool/action_menu_types.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM_CONTAINER } from '@ziroeda/pcbnew/board_item_container.js';
import { buildPcbMenus } from '@ziroeda/pcbnew/menubar_pcb_editor.js';
import { PCB_BASE_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_base_edit_frame.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from '@ziroeda/pcbnew/pcb_base_frame.js';
import {
  applyToggle,
  foldPcbToggle,
  isStoredPcbToggle,
  pcbTogglesFromSettings,
} from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { boardFromBOARD } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/board_view.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PcbNetInspectorPane } from '@ziroeda/pcbnew/widgets/pcb_net_inspector_panel_ui.js';
import {
  PcbBottomDock,
  bottomDockHeight,
  legacyIdsOf,
  makePcbSearchWiring,
  makeVertexEditorFrame,
  selectionHasEditableCorners,
} from '@ziroeda/pcbnew/pcb_edit_frame_ui.js';
import { PcbSearchPane } from '@ziroeda/pcbnew/widgets/pcb_search_pane.js';
import type { PcbSearchWiring } from '@ziroeda/pcbnew/widgets/search_handlers.js';
import { PCB_VERTEX_EDITOR_PANE } from '@ziroeda/pcbnew/widgets/vertex_editor_pane.js';
import { PCBNEW_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';

afterEach(cleanup);

// happy-dom's `import.meta.url` is not a file: URL, and vitest runs from `qa/`.
const RESAVE = `${resolve(process.cwd(), 'data/pcbnew/resave')}/`;
const MM = 1_000_000;

function realBoard(): BOARD {
  const f = `${RESAVE}ecc83-pp.kicad_pcb`;
  const board = new PCB_IO_KICAD_SEXPR_PARSER(readFileSync(f, 'utf8'), f).Parse() as BOARD;
  board.BuildConnectivity();
  return board;
}

/** A PCB_EDIT_FRAME without the window: the model, the settings and the tool manager. */
class TEST_FRAME extends PCB_BASE_EDIT_FRAME {
  readonly settings = new PCBNEW_SETTINGS();

  constructor(board: BOARD) {
    super(FRAME_T.FRAME_PCB_EDITOR);
    this.SetBoard(board);
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(board, null, null, this.settings, this);
  }

  GetName(): string {
    return 'PcbFrame';
  }
  GetModel(): BOARD_ITEM_CONTAINER | null {
    return this.m_pcb;
  }
  GetPcbNewSettings(): PCBNEW_SETTINGS {
    return this.settings;
  }
  GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return {
      m_DisplayInvertXAxis: false,
      m_DisplayInvertYAxis: false,
      m_AngleSnapMode: LEADER_MODE.DIRECT,
    };
  }
}

// ----- View > Panels ----------------------------------------------------------

const STATE = {
  hasSchematic: true,
  hasFootprintEditor: true,
  highContrast: false,
  flipBoard: false,
};

function panelsMenu(
  toggle: (id: string) => void,
  checks: Record<string, boolean> = {},
): MenuItem[] {
  const menus: Menu[] = buildPcbMenus(
    {
      action: () => {},
      tool: () => {},
      toggle,
      language: 'Default',
      onSelectLanguage: () => {},
      showHotkeys: () => {},
      showAbout: () => {},
    },
    STATE,
    checks,
  );
  const view = menus.find((m) => m.label === 'View')!;

  return view.items.find((i) => 'submenu' in i && i.label === 'Panels')!.submenu!;
}

const row = (items: MenuItem[], label: string): MenuItem => items.find((i) => i.label === label)!;

/** The frame's shape in miniature: the toggle set, the menu that flips it, the dock it shows. */
function Harness({ board }: { board: BOARD }) {
  const [toggles, setToggles] = useState<Set<string>>(new Set());
  const [height, setHeight] = useState(-1);
  const menu = panelsMenu(
    (id) => setToggles((prev) => applyToggle(prev, id)),
    Object.fromEntries([...toggles].map((t) => [t, true])),
  );
  const wiring: PcbSearchWiring = makePcbSearchWiring({
    getBoard: () => boardFromBOARD(board),
    setSelection: () => {},
    frameView: () => {},
    refresh: () => {},
    properties: () => {},
    highlightNets: () => {},
    showBoardSetupDialog: () => {},
  });

  return (
    <div>
      {menu.map((m) => (
        <button
          key={m.label}
          type="button"
          data-testid={`row-${m.label}`}
          data-checked={String(!!m.checked)}
          disabled={m.disabled}
          onClick={() => m.action?.()}
        >
          {m.label}
        </button>
      ))}
      <PcbBottomDock
        showSearch={toggles.has('showSearch')}
        showNetInspector={toggles.has('showNetInspector')}
        height={height}
        onHeightChange={setHeight}
        onCloseSearch={() => setToggles((p) => applyToggle(p, 'showSearch'))}
        onCloseNetInspector={() => setToggles((p) => applyToggle(p, 'showNetInspector'))}
        netInspector={
          <PcbNetInspectorPane
            board={boardFromBOARD(board)}
            netClassesOf={() => ['Default']}
            onHighlightNets={() => {}}
          />
        }
        search={
          <PcbSearchPane
            frame={{
              GetBoard: () => board,
              MessageTextFromValue: (v) => String(v),
              GetOriginTransforms: () => ({ ToDisplay: (v: number) => v }) as never,
            }}
            board={board}
            wiring={wiring}
            menuState={{ selectionZoom: 'pan', searchHiddenFields: true, searchMetadata: false }}
            onMenuStateChange={() => {}}
            units="mm"
          />
        }
      />
    </div>
  );
}

const q = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);
const click = (id: string): void => {
  act(() => {
    fireEvent.click(q(id)!);
  });
};

describe('View > Panels', () => {
  it('Search and Net Inspector are live CHECK rows, not greyed', () => {
    const items = panelsMenu(() => {});

    expect(row(items, 'Search').disabled).toBeFalsy();
    expect(row(items, 'Net Inspector').disabled).toBeFalsy();
    // ACTIONS::showSearch's default hotkey, printed on the row.
    expect(row(items, 'Search').shortcut).toBe('Ctrl+G');
  });

  it('a CHECK row draws the pane state it is given', () => {
    const on = panelsMenu(() => {}, { showSearch: true, showNetInspector: true });
    const off = panelsMenu(() => {});

    expect([row(on, 'Search').checked, row(on, 'Net Inspector').checked]).toEqual([true, true]);
    expect([row(off, 'Search').checked, row(off, 'Net Inspector').checked]).toEqual([false, false]);
  });

  it('Search toggles the Search pane and nothing else', () => {
    render(<Harness board={realBoard()} />);
    expect(q('pcb-search-pane')).toBeNull();

    click('row-Search');
    expect(q('pcb-search-pane')).not.toBeNull();
    expect(q('pcb-net-inspector')).toBeNull();
    expect(q('row-Search')!.dataset.checked).toBe('true');

    click('row-Search');
    expect(q('pcb-search-pane')).toBeNull();
  });

  it('Net Inspector toggles the Net Inspector pane and nothing else', () => {
    render(<Harness board={realBoard()} />);

    click('row-Net Inspector');
    expect(q('pcb-net-inspector')).not.toBeNull();
    expect(q('pcb-search-pane')).toBeNull();

    click('row-Net Inspector');
    expect(q('pcb-net-inspector')).toBeNull();
  });

  it('a pane closes from its own close box, and the row follows', () => {
    render(<Harness board={realBoard()} />);
    click('row-Search');
    click('row-Net Inspector');
    // Net Inspector is added first, so it is the first caption in the dock.
    const closes = document.querySelectorAll('.ze-pane-close');
    expect(closes).toHaveLength(2);

    act(() => {
      fireEvent.click(q('pcb-search-pane')!.querySelector('.ze-pane-close')!);
    });
    expect(q('pcb-search-pane')).toBeNull();
    expect(q('row-Search')!.dataset.checked).toBe('false');
    expect(q('pcb-net-inspector')).not.toBeNull();
  });

  it('the dock opens at the tallest BestSize of what is shown until dragged', () => {
    // .BestSize( 180, 100 ) and .BestSize( 300, 200 ), pcb_edit_frame.cpp:399-409.
    expect(bottomDockHeight(true, false, -1)).toBe(100);
    expect(bottomDockHeight(false, true, -1)).toBe(200);
    expect(bottomDockHeight(true, true, -1)).toBe(200);
    expect(bottomDockHeight(true, true, 140)).toBe(140);
  });
});

// ----- persistence ------------------------------------------------------------

describe('the panes persist in pcbnew.json aui.*', () => {
  const cfg = () => structuredClone(PCBNEW_DEFAULTS);

  it('both panes default hidden, as AUI_PANELS', () => {
    const c = cfg();

    expect(c.aui).toEqual({
      show_search: false,
      show_net_inspector: false,
      search_panel_height: -1,
    });
    expect(pcbTogglesFromSettings(c).has('showSearch')).toBe(false);
    expect(pcbTogglesFromSettings(c).has('showNetInspector')).toBe(false);
  });

  it('a stored shown flag opens the frame with the pane on (LoadSettings)', () => {
    const c = cfg();
    c.aui.show_search = true;
    c.aui.show_net_inspector = true;
    const t = pcbTogglesFromSettings(c);

    expect(t.has('showSearch')).toBe(true);
    expect(t.has('showNetInspector')).toBe(true);
  });

  it('toggling from the menu writes the flag back (SaveSettings)', () => {
    const c = cfg();

    expect(isStoredPcbToggle('showSearch')).toBe(true);
    expect(isStoredPcbToggle('showNetInspector')).toBe(true);
    expect(foldPcbToggle(c, 'showSearch')).toBe(true);
    expect(c.aui.show_search).toBe(true);
    expect(c.aui.show_net_inspector).toBe(false);
    expect(foldPcbToggle(c, 'showNetInspector')).toBe(true);
    expect(c.aui.show_net_inspector).toBe(true);
    foldPcbToggle(c, 'showSearch');
    expect(c.aui.show_search).toBe(false);
  });
});

// ----- the Search pane over a real BOARD --------------------------------------

describe('PCB_SEARCH_PANE on a real board', () => {
  function mount() {
    const board = realBoard();
    const selected: string[][] = [];
    const wiring = makePcbSearchWiring({
      getBoard: () => boardFromBOARD(board),
      setSelection: (ids) => selected.push([...ids]),
      frameView: () => {},
      refresh: () => {},
      properties: () => {},
      highlightNets: () => {},
      showBoardSetupDialog: () => {},
    });
    const pane = new SEARCH_PANE();

    void pane;
    render(
      <PcbSearchPane
        frame={{
          GetBoard: () => board,
          MessageTextFromValue: (v) => String(v),
          GetOriginTransforms: () => ({ ToDisplay: (v: number) => v }) as never,
        }}
        board={board}
        wiring={wiring}
        menuState={{ selectionZoom: 'none', searchHiddenFields: true, searchMetadata: false }}
        onMenuStateChange={() => {}}
        units="mm"
      />,
    );

    return { board, selected };
  }

  const rows = (): string[] =>
    Array.from(document.querySelectorAll('.ze-search-row')).map(
      (r) => r.querySelector('td')?.textContent ?? '',
    );

  it('lists the footprints, and a query narrows them by reference', () => {
    const { board } = mount();
    const all = rows();

    expect(all).toHaveLength(board.Footprints().length);
    expect(all, JSON.stringify(all)).toContain('C1');

    fireEvent.change(document.querySelector('input.ze-search')!, { target: { value: 'C1' } });
    expect(rows()).toEqual(['C1']);
  });

  it('a board edit refreshes the rows, even when the row count is unchanged', () => {
    // PCB_SEARCH_PANE::OnBoardItemChanged -> RefreshSearch. Same 15 rows, one
    // of them renamed: the pane must show the new reference, not blank cells.
    const { board } = mount();
    const fp = board.Footprints().find((f) => f.GetReference() === 'C1')!;

    act(() => {
      fp.SetReference('ZZ9');
      board.OnItemChanged(fp);
    });

    const after = rows();
    expect(after).toHaveLength(board.Footprints().length);
    expect(after).toContain('ZZ9');
    expect(after).not.toContain('C1');
  });

  it('picking a row selects that footprint in the editor', () => {
    const { board, selected } = mount();

    fireEvent.change(document.querySelector('input.ze-search')!, { target: { value: 'C2' } });
    fireEvent.click(document.querySelector('.ze-search-row')!);

    const view = boardFromBOARD(board);
    const c2 = view.footprints.findIndex((f) => f.reference === 'C2');

    expect(c2).toBeGreaterThanOrEqual(0);
    expect(selected.at(-1)).toEqual([`footprint:${c2}`]);
  });

  it('legacyIdsOf maps live items to selection ids and drops what the view lacks', () => {
    const board = realBoard();
    const view = boardFromBOARD(board);
    const fp = board.Footprints()[1]!;
    const pad = board.Footprints()[0]!.Pads()[0]!;

    expect(legacyIdsOf(view, [fp, pad, fp])).toEqual(['footprint:1', 'pad:0:0']);
    expect(legacyIdsOf(view, [board.FindNet('GND')!])).toEqual([]);
  });
});

// ----- the Net Inspector ------------------------------------------------------

describe('PCB_NET_INSPECTOR_PANEL', () => {
  it('lists the real nets with their counts, and Filter narrows by name', () => {
    const board = realBoard();
    const view = boardFromBOARD(board);
    render(
      <PcbNetInspectorPane
        board={view}
        netClassesOf={() => ['Default']}
        onHighlightNets={() => {}}
      />,
    );
    const text = (): string => document.body.textContent ?? '';

    expect(text()).toContain('GND');
    expect(text()).toContain('Net Inspector'.length ? 'Pad Count' : '');

    fireEvent.change(document.querySelector('.ze-net-inspector-panel input')!, {
      target: { value: 'GND' },
    });
    expect(text()).toContain('GND');
    expect(text()).not.toContain('Net-(P2-P1)');
  });
});

// ----- Edit Vertices ----------------------------------------------------------

describe('Edit Vertices commits through BOARD_COMMIT', () => {
  function polyBoard() {
    const board = new BOARD();
    const shape = new PCB_SHAPE(board, SHAPE_T.POLY);

    shape.SetPolyPoints([
      { x: 0, y: 0 },
      { x: 2 * MM, y: 0 },
      { x: 2 * MM, y: 3 * MM },
      { x: 0, y: 3 * MM },
    ]);
    board.Add(shape);
    board.BuildConnectivity();

    return { board, shape };
  }

  it('one cell edit is one undoable commit and moves the vertex', () => {
    const { board, shape } = polyBoard();
    const frame = new TEST_FRAME(board);
    let refreshed = 0;
    const pane = new PCB_VERTEX_EDITOR_PANE(
      makeVertexEditorFrame(
        frame,
        () => refreshed++,
        () => {},
      ),
    );

    pane.SetItem(shape);
    expect(frame.GetUndoCommandCount()).toBe(0);

    pane.OnGridCellChange(1, 0, '4');

    expect(shape.GetPolyShape().CVertex(1).x).toBe(4 * MM);
    expect(frame.GetUndoCommandCount()).toBe(1);
    expect(frame.GetUndoActionDescription()).toBe('Edit Vertex');
    expect(refreshed).toBeGreaterThan(0);

    frame.RestoreCopyFromUndoList();
    expect(shape.GetPolyShape().CVertex(1).x).toBe(2 * MM);
  });

  it('closing the pane tells the frame it is gone', () => {
    const { board } = polyBoard();
    const closed: unknown[] = [];
    const pane = new PCB_VERTEX_EDITOR_PANE(
      makeVertexEditorFrame(
        new TEST_FRAME(board),
        () => {},
        (p) => closed.push(p),
      ),
    );

    pane.Destroy();
    expect(closed).toEqual([pane]);
  });

  it('EditVertices is offered for one polygon and for nothing else', () => {
    const { board, shape } = polyBoard();
    const view = boardFromBOARD(board);
    const id = legacyIdsOf(view, [shape])[0]!;

    expect(id).toBe('shape:0');
    expect(selectionHasEditableCorners(view, new Set([id]))).toBe(true);
    expect(selectionHasEditableCorners(view, new Set())).toBe(false);
    expect(selectionHasEditableCorners(view, new Set([id, 'shape:0']))).toBe(true);
    expect(selectionHasEditableCorners(view, new Set([id, 'track:0']))).toBe(false);
  });

  it('a rectangle has no corner table', () => {
    const board = new BOARD();
    board.Add(new PCB_SHAPE(board, SHAPE_T.RECTANGLE));
    const view = boardFromBOARD(board);

    expect(selectionHasEditableCorners(view, new Set(['shape:0']))).toBe(false);
  });
});
