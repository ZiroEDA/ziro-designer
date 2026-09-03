// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A customised toolbar changes what is drawn.
 *
 * `toolbar_store.test.ts` pins the store; this pins the only thing that makes
 * the store worth having. The failure mode it exists for is specific and has
 * happened here before: a Preferences page that edits a settings key nothing
 * reads looks completely correct — it opens, it lists, it saves, it reloads —
 * and changes nothing at all. The Grids page had it until `window.grid.sizes`
 * was made to feed the canvas; the Toolbars page would have it if any editor
 * kept passing its module constant straight to `<Toolbar>`.
 *
 * So there are two halves, and both are needed:
 *
 *  - the **rendered** half, which drives `useToolbarEntries` through a real
 *    `<Toolbar>` and asserts on the buttons in the DOM. It is the only form
 *    that can see the hook, the store and the renderer disagree;
 *  - the **call-site** half, in `toolbar_frame_wiring.test.ts`, which requires
 *    every `<Toolbar entries={…}>` in every editor with a Toolbars page to be
 *    fed from the hook. It is a separate file because it reads the sources off
 *    disk, and this one runs in happy-dom where `import.meta.url` is not a
 *    `file:` URL.
 *
 * `EDA_BASE_FRAME::RecreateToolbars` (`common/eda_base_frame.cpp:1728-1843`) is
 * what makes this true upstream: the frame asks
 * `GetToolbarConfig( loc, config()->m_CustomToolbars )` and never reads
 * `DefaultToolbarConfig` itself.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { Toolbar } from '@ziroeda/designer/src/ui/Toolbar.js';
import { useToolbarEntries } from '@ziroeda/designer/src/ui/useToolbarEntries.js';
import { settings } from '@ziroeda/designer/src/prefs/settings.js';
import {
  configFromEntries,
  setStoredToolbarConfig,
  type ToolbarSettings,
} from '@ziroeda/designer/src/ui/toolbar_config.js';
import {
  DS_DEFAULT_TOOLBARS,
  DS_LEFT_TOOLBAR,
} from '@ziroeda/designer/src/editors/drawingsheet/drawingSheetToolbars.js';
import { SCH_DEFAULT_TOOLBARS } from '@ziroeda/designer/src/editors/schematic/toolbars_sch_editor.js';

afterEach(cleanup);

/** The Drawing Sheet Editor's LEFT toolbar, through the hook the frame uses. */
function LeftBar(): JSX.Element {
  const entries = useToolbarEntries('pl_editor', 'LEFT', DS_DEFAULT_TOOLBARS);
  return <Toolbar entries={entries} app="pl_editor" orientation="vertical" side="left" />;
}

/** Every button's accessible name, in drawn order. */
const drawn = (): string[] =>
  screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? '');

describe('the Drawing Sheet Editor’s left toolbar reads the store', () => {
  let before: { custom: boolean; store: ToolbarSettings };

  beforeEach(() => {
    before = {
      custom: settings.plEditor.appearance.custom_toolbars,
      store: structuredClone(settings.toolbars.pl_editor),
    };
  });

  afterEach(() => {
    settings.updatePlEditor((s) => {
      s.appearance.custom_toolbars = before.custom;
    });
    settings.updateToolbars('pl_editor', (s) => {
      s.toolbars = structuredClone(before.store).toolbars;
    });
  });

  /** Store a LEFT toolbar of just the three unit actions, ungrouped. */
  const storeUnitsOnly = (): void => {
    settings.updateToolbars('pl_editor', (s) => {
      setStoredToolbarConfig(s, 'LEFT', [
        { type: 'TOOL', name: 'unitsMils' },
        { type: 'SEPARATOR' },
        { type: 'TOOL', name: 'unitsMm' },
      ]);
    });
  };

  it('draws DefaultToolbarConfig with no customisation stored', () => {
    render(<LeftBar />);
    // `toolbars_pl_editor.cpp:45-59`: the grid toggle, then the Units group,
    // which is one button.
    expect(drawn()).toEqual(['Show Grid', 'Units in millimetres']);
  });

  it('still draws the default when a configuration is stored but custom_toolbars is off', () => {
    // `GetToolbarConfig( loc, aAllowCustom )`: with `m_CustomToolbars` false the
    // stored file is not even looked at, so switching the checkbox off restores
    // the stock toolbars without discarding what the user built.
    storeUnitsOnly();
    settings.updatePlEditor((s) => {
      s.appearance.custom_toolbars = false;
    });
    render(<LeftBar />);
    expect(drawn()).toEqual(['Show Grid', 'Units in millimetres']);
  });

  it('draws the stored configuration when custom_toolbars is on', () => {
    storeUnitsOnly();
    settings.updatePlEditor((s) => {
      s.appearance.custom_toolbars = true;
    });
    render(<LeftBar />);
    expect(drawn()).toEqual(['Units in mils', 'Units in millimetres']);
    // The separator is drawn too, and it is not a button.
    expect(document.querySelectorAll('.ze-sep')).toHaveLength(1);
  });

  it('goes back to the default the moment custom_toolbars is switched off', () => {
    storeUnitsOnly();
    settings.updatePlEditor((s) => {
      s.appearance.custom_toolbars = true;
    });
    const view = render(<LeftBar />);
    expect(drawn()).toEqual(['Units in mils', 'Units in millimetres']);

    settings.updatePlEditor((s) => {
      s.appearance.custom_toolbars = false;
    });
    view.rerender(<LeftBar />);
    expect(drawn()).toEqual(['Show Grid', 'Units in millimetres']);
  });

  it('survives a reload: what was stored is what the next session reads', () => {
    // The store is localStorage-backed, so this is the round trip a user gets.
    storeUnitsOnly();
    settings.updatePlEditor((s) => {
      s.appearance.custom_toolbars = true;
    });
    const raw = localStorage.getItem('ziroeda.pl_editor-toolbars');
    expect(raw, 'the toolbar store is persisted under its own KiCad file name').toBeTruthy();
    expect(JSON.parse(raw as string)).toEqual({
      toolbars: [
        {
          name: 'LEFT',
          contents: [
            { type: 'TOOL', name: 'unitsMils' },
            { type: 'SEPARATOR' },
            { type: 'TOOL', name: 'unitsMm' },
          ],
        },
      ],
    });
  });

  it('drops a stored action the editor no longer has, rather than drawing nothing', () => {
    settings.updateToolbars('pl_editor', (s) => {
      setStoredToolbarConfig(s, 'LEFT', [
        { type: 'TOOL', name: 'anActionThatWasRemoved' },
        { type: 'TOOL', name: 'toggleGrid' },
      ]);
    });
    settings.updatePlEditor((s) => {
      s.appearance.custom_toolbars = true;
    });
    render(<LeftBar />);
    expect(drawn()).toEqual(['Show Grid']);
  });

  it('a stored copy of the default draws exactly the default', () => {
    // What pressing OK on the Toolbars page without touching anything does:
    // `TransferDataFromWindow` writes every toolbar back, changed or not.
    settings.updateToolbars('pl_editor', (s) => {
      setStoredToolbarConfig(s, 'LEFT', configFromEntries(DS_LEFT_TOOLBAR));
    });
    settings.updatePlEditor((s) => {
      s.appearance.custom_toolbars = true;
    });
    render(<LeftBar />);
    expect(drawn()).toEqual(['Show Grid', 'Units in millimetres']);
  });
});

/**
 * ...and the same for the SCHEMATIC editor, which is the page a user actually
 * opens. The hook is one function and `SchematicEditor.tsx:1261-1263` calls it
 * for all three of its bars, so this is not a second implementation — it is the
 * assertion that eeschema is wired to the same one, on the editor whose
 * Preferences > Toolbars page this work was done against.
 */
describe('the Schematic Editor’s left toolbar reads the store', () => {
  let before: { custom: boolean; store: ToolbarSettings };

  beforeEach(() => {
    before = {
      custom: settings.eeschema.appearance.custom_toolbars,
      store: structuredClone(settings.toolbars.eeschema),
    };
  });

  afterEach(() => {
    settings.updateEeschema((s) => {
      s.appearance.custom_toolbars = before.custom;
    });
    settings.updateToolbars('eeschema', (s) => {
      s.toolbars = structuredClone(before.store).toolbars;
    });
  });

  function SchLeftBar(): JSX.Element {
    const entries = useToolbarEntries('eeschema', 'LEFT', SCH_DEFAULT_TOOLBARS);
    return <Toolbar entries={entries} app="eeschema" orientation="vertical" side="left" />;
  }

  /** A LEFT toolbar cut down to the two grid toggles it opens with. */
  const storeGridsOnly = (): void => {
    settings.updateToolbars('eeschema', (s) => {
      setStoredToolbarConfig(s, 'LEFT', [
        { type: 'TOOL', name: 'toggleGrid' },
        { type: 'SEPARATOR' },
        { type: 'TOOL', name: 'toggleGridOverrides' },
      ]);
    });
  };

  it('draws its whole default with nothing stored', () => {
    render(<SchLeftBar />);
    // The default has more than the two below; the exact list is
    // `toolbars_sch_editor.cpp:60-200` and lives in LEFT_TOOLBAR.
    expect(drawn().length).toBeGreaterThan(3);
  });

  it('draws exactly the stored configuration once custom_toolbars is on', () => {
    storeGridsOnly();
    settings.updateEeschema((s) => {
      s.appearance.custom_toolbars = true;
    });
    render(<SchLeftBar />);
    expect(drawn()).toHaveLength(2);
  });

  it('goes back to the default the moment the checkbox is switched off', () => {
    storeGridsOnly();
    settings.updateEeschema((s) => {
      s.appearance.custom_toolbars = false;
    });
    render(<SchLeftBar />);
    expect(drawn().length).toBeGreaterThan(3);
  });
});
