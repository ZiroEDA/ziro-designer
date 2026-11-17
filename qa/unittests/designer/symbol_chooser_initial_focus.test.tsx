// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Choose Symbol opens with the Filter focused, so you press A and type.
 *
 * `DIALOG_SYMBOL_CHOOSER` calls `SetInitialFocus( m_chooserPanel->GetFocusTarget() )`
 * (dialog_symbol_chooser.cpp:102), and `LIB_TREE::GetFocusTarget()` is the query control
 * (lib_tree.cpp:503). Ours relied on the tree focusing its search box as it mounted - while the
 * dialog is still `visibility: hidden` for its first layout, where a browser gives no focus - so
 * what was typed after A went nowhere (blinky555, I-3). `hiddenTakesNoFocus` gives the test the
 * browser's rule.
 */
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibTreeModelAdapter } from '@ziroeda/common/lib_tree_model_adapter.js';
import { LibTree } from '@ziroeda/common/widgets/lib_tree.js';
import { hiddenTakesNoFocus } from '../common/support/hidden_takes_no_focus.js';

vi.mock('@ziroeda/eeschema/widgets/panel_symbol_chooser.js', () => ({
  // The panel's own job is tested elsewhere; here it is what the dialog asks for the target.
  PanelSymbolChooser: forwardRef(function FakePanel(_props: unknown, ref) {
    const input = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => ({
      getSelected: () => null,
      GetFocusTarget: () => input.current,
    }));
    return <input ref={input} aria-label="Filter" />;
  }),
}));

const { DialogSymbolChooser } = await import(
  '@ziroeda/designer/src/editors/schematic/dialogs/dialog_symbol_chooser.js'
);

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
  cleanup();
});

describe('the symbol chooser opens with the filter focused', () => {
  it("DIALOG_SYMBOL_CHOOSER gives the focus to the panel's GetFocusTarget once it is shown", () => {
    restore = hiddenTakesNoFocus();
    render(<DialogSymbolChooser onOk={() => {}} onCancel={() => {}} />);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Filter');
  });

  it("LIB_TREE's GetFocusTarget is its query control", () => {
    const target = { current: null as HTMLInputElement | null };
    const { container } = render(
      <LibTree
        adapter={new LibTreeModelAdapter()}
        onSelect={() => {}}
        onChoose={() => {}}
        focusTargetRef={target}
      />,
    );
    expect(target.current).not.toBeNull();
    expect(target.current).toBe(container.querySelector('.ze-libtree input'));
  });
});
