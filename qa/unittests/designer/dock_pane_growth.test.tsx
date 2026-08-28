// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A docked pane fills its dock unless the frame says it must not.
 *
 * wxAUI divides a dock row's length between the panes sharing it in
 * `wxAuiPaneInfo::dock_proportion` ("proportion while docked",
 * `wx/aui/framemanager.h:391`). Every `AddPane` in KiCad leaves that at the
 * value `DefaultPane()` gives it, so GROWING is what a docked pane does. Not
 * growing is declared, and across the whole of KiCad 10.0.5 it is declared
 * exactly four times — all four of them the Selection Filter:
 *
 *   eeschema/sch_edit_frame.cpp:324-325
 *     // The selection filter doesn't need to grow in the vertical direction
 *     // when docked
 *     selectionFilterPane.dock_proportion = 0;
 *   eeschema/symbol_editor/symbol_edit_frame.cpp:245
 *   pcbnew/pcb_edit_frame.cpp:422
 *   pcbnew/footprint_edit_frame.cpp:267
 *
 * The project manager's tree declares nothing of the kind:
 *
 *   m_auimgr.AddPane( m_projectTreePane,
 *                     EDA_PANE().Palette().Name( "ProjectTree" ).Left().Layer( 1 )
 *                               .Caption( PROJECT_FILES_CAPTION ).PaneBorder( false )
 *                               .MinSize( m_leftWinWidth, -1 ).Floatable( false )
 *                               .Movable( false ) );
 *                                        (kicad/kicad_manager_frame.cpp:236-239)
 *
 * `MinSize( m_leftWinWidth, -1 )` fixes a WIDTH and leaves the height to the
 * dock, so the pane runs the full column.
 *
 * The regression this pins: shell.css stated the OPPOSITE polarity as
 * `.ze-leftdock .ze-panel:not(.grow) { flex: 0 0 auto }`. At (0,3,0) that
 * outranked `.ze-leftdock > .ze-panel { flex: 1 1 0 }` further down the file,
 * so every left-dock pane that had not opted into `.grow` — the project tree
 * among them — collapsed to the height of its content.
 *
 * These are cascade tests, not text greps: the real `shell.css` goes into the
 * document and each pane's `flex-grow` is read back off the real markup, so a
 * rule that loses on specificity fails here the way it failed on screen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { ProjectTreePane } from '@ziroeda/designer/src/home/project_tree_pane.js';
import { SelectionFilterPanel } from '@ziroeda/designer/src/ui/SelectionFilterPanel.js';
import { defaultSelectionFilter } from '@ziroeda/eeschema/src/tools/sch_selection_filter.js';

// `import.meta.url` is not a file: URL under happy-dom, so paths go through
// the repo root instead — the same workaround chooser_shell_metrics.test.tsx uses.
const src = (rel: string): string => readFileSync(resolve(process.cwd(), '..', rel), 'utf8');

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = src('designer/src/ui/shell.css');
  document.head.appendChild(style);
});

/** The `.ze-panel` div that wraps a given caption, taken from the real JSX. */
function paneClassOf(file: string, caption: string): string {
  const text = src(file);
  const at = text.indexOf(caption);
  expect(at, `${caption} not found in ${file}`).toBeGreaterThan(-1);
  const before = text.slice(0, at);
  const opens = [...before.matchAll(/className="(ze-panel(?: [^"]*)?)"/g)];
  const last = opens.at(-1)?.[1];
  expect(last, `no .ze-panel wrapper before ${caption}`).toBeTypeOf('string');
  return last as string;
}

/** Puts `pane` in a dock of its own and reports the flex the cascade gives it. */
function flexOf(dockClass: string, pane: HTMLElement | string): CSSStyleDeclaration {
  const dock = document.createElement('div');
  dock.className = dockClass;
  if (typeof pane === 'string') {
    const el = document.createElement('div');
    el.className = pane;
    dock.appendChild(el);
  } else {
    dock.appendChild(pane);
  }
  document.body.appendChild(dock);
  return getComputedStyle(dock.firstElementChild as HTMLElement);
}

describe('the project manager: kicad_manager_frame.cpp:236-239', () => {
  /**
   * The bug as the user saw it: "Project Files" stopped running to the bottom
   * of the window and snapped to the height of its three tree rows.
   */
  it('gives the project tree pane the whole left dock', () => {
    const { container } = render(
      <ProjectTreePane
        picked={[{ name: 'p.kicad_pro', text: '' }]}
        dirRoot={null}
        rootLabel="p.kicad_pro"
        projectNames={new Set(['p'])}
        width={240}
        expanded={new Set()}
        onToggleDir={() => {}}
        selected={new Set()}
        onSelect={() => {}}
        rootOpen={true}
        onToggleRoot={() => {}}
      />,
    );
    const pane = container.querySelector('.ze-projecttree') as HTMLElement;
    expect(pane).not.toBeNull();
    const flex = flexOf('ze-leftdock', pane);
    expect(flex.flexGrow).toBe('1');
    expect(flex.flexShrink).toBe('1');
    // Not `auto`: a basis of auto is content height, which is the bug.
    expect(flex.flexBasis).toBe('0px');
  });

  /**
   * The pane declares NEITHER class. Growing has to be what a plain docked
   * pane does, or the fix is a special case for this one launcher.
   */
  it('does so without opting in — the tree pane carries no size class', () => {
    const text = src('designer/src/home/project_tree_pane.tsx');
    expect(text).toContain('className="ze-panel left ze-projecttree"');
  });
});

describe('the Selection Filter: dock_proportion = 0', () => {
  const filterPane = (): HTMLElement => {
    const { container } = render(
      <SelectionFilterPanel
        frame="FRAME_SCH"
        filter={defaultSelectionFilter()}
        onChange={() => {}}
      />,
    );
    return container.querySelector('.ze-panel') as HTMLElement;
  };

  it('does not grow in eeschema (sch_edit_frame.cpp:325)', () => {
    const flex = flexOf('ze-leftdock sch-leftdock', filterPane());
    expect(flex.flexGrow).toBe('0');
    expect(flex.flexShrink).toBe('0');
    expect(flex.flexBasis).toBe('auto');
  });

  it('does not grow in the symbol editor either (symbol_edit_frame.cpp:245)', () => {
    expect(flexOf('ze-leftdock', filterPane()).flexGrow).toBe('0');
  });

  it("does not grow in pcbnew's right dock (pcb_edit_frame.cpp:422)", () => {
    const cls = paneClassOf(
      'designer/src/editors/pcb/PcbEditor.tsx',
      '<div className="ze-panel-header">Selection Filter</div>',
    );
    expect(flexOf('ze-rightdock', cls).flexGrow).toBe('0');
  });
});

describe('every other docked pane keeps the default proportion', () => {
  /**
   * `defaultPropertiesPaneInfo` (eeschema/eeschema_settings.cpp:89-107) is
   * `MinSize( 240, 60 )` / `BestSize( 300, 200 )` and no `dock_proportion`, and
   * `symbol_edit_frame.cpp:227` adds the panel with it unchanged. It grows, and
   * it may not be squeezed below the 60 its MinSize asks for.
   */
  it('the symbol editor Properties pane grows', () => {
    const cls = paneClassOf(
      'designer/src/editors/symbol/SymbolEditor.tsx',
      // The caption gained its `.CloseButton( true )` box, so the title is a
      // `<span>` beside the button rather than the caption's only content —
      // the same shape the schematic's captions already have.
      '<span>Properties</span>',
    );
    const flex = flexOf('ze-leftdock', cls);
    expect(flex.flexGrow).toBe('1');
    expect(flex.flexBasis).toBe('0px');
  });

  it('the schematic hierarchy pane grows, floored at its MinSize height', () => {
    const cls = paneClassOf(
      'designer/src/editors/schematic/SchematicEditor.tsx',
      '<span>Schematic Hierarchy</span>',
    );
    const flex = flexOf('ze-leftdock sch-leftdock', cls);
    expect(flex.flexGrow).toBe('1');
    expect(flex.minHeight).toBe('60px');
  });

  /**
   * The polarity itself, stated once: a docked pane with no size class at all
   * grows. This is the assertion the old `:not(.grow)` rule inverted.
   */
  it('a bare .ze-panel in a left dock grows', () => {
    expect(flexOf('ze-leftdock', 'ze-panel').flexGrow).toBe('1');
  });
});
