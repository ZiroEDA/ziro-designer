// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * useSchematicTheme hands back one object per set of colours - the theme's id, the user's own
 * colours, the themes made - not per settings version. The schematic frame raises
 * CommonSettingsChanged - every colour reloaded, every item recached - whenever its theme
 * changes, and a theme with a file (wDark, the default) is rebuilt by every resolveTheme():
 * a fresh object per render recached the whole sheet on every click (measured on CM5: 287
 * symbols, 1,880 fields and 552 pins updated by one selection).
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { settings } from '@ziroeda/designer/src/prefs/settings.js';
import {
  usePlEditorColors,
  useSchematicTheme,
  useSymbolEditorTheme,
} from '@ziroeda/designer/src/prefs/useSettings.js';

afterEach(cleanup);

describe('useSchematicTheme', () => {
  it('is the same object across renders until a setting changes', () => {
    const seen: unknown[] = [];
    let rerender: () => void = () => {};
    function Probe() {
      const [, setN] = useState(0);
      rerender = () => setN((n) => n + 1);
      seen.push(useSchematicTheme());
      return null;
    }

    act(() =>
      settings.updateEeschema((s) => {
        s.appearance.color_theme = 'stock:wdark';
      }),
    );
    render(<Probe />);
    act(() => rerender());
    act(() => rerender());
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen).size).toBe(1);

    // A theme picked in Preferences is a new object, which the frame's effect is keyed on.
    act(() =>
      settings.updateEeschema((s) => {
        s.appearance.color_theme = '_builtin_classic';
      }),
    );
    expect(seen.at(-1)).not.toBe(seen[0]);
  });
});

/**
 * 2026-10-28: opening the Design Blocks pane took a second and more on a large sheet. Every
 * settings write - the left dock's positions as a pane opened, a grid toggle, a library table -
 * bumped the version the theme was keyed on, so the frame recached every item.
 */
describe('a settings write that is not a colour', () => {
  const unrelated = () => {
    settings.updateEeschema((s) => {
      s.window.left_dock_pos = { ...s.window.left_dock_pos, properties: 7 };
    });
    settings.updatePcbnew((s) => {
      s.printing.scale = 1.5;
    });
  };

  it.each([
    ['useSchematicTheme', () => useSchematicTheme()],
    ['useSymbolEditorTheme', () => useSymbolEditorTheme()],
    ['usePlEditorColors', () => usePlEditorColors()],
  ])('%s keeps its object; a user colour is a new one', (_name, hook) => {
    act(() => {
      settings.updateEeschema((s) => {
        s.appearance.color_theme = 'user';
      });
      settings.updatePlEditor((s) => {
        s.appearance.color_theme = 'user';
      });
    });
    const seen: unknown[] = [];
    function Probe() {
      seen.push(hook());
      return null;
    }
    render(<Probe />);
    const first = seen.at(-1);

    act(() => unrelated());
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(first);

    act(() => settings.setUserColors({ ...settings.userColors, wire: 'rgb(1, 2, 3)' }));
    expect(seen.at(-1)).not.toBe(first);
  });
});
