// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * WX_INFOBAR's close button (`AddCloseButton`, wx_infobar.cpp:375-382): it hides the bar, and a
 * caller that keeps state of its own about the message - the app's new-version notice, which
 * yields the strip back to the demo's message - hears that it did.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';

afterEach(cleanup);

describe('Infobar', () => {
  it('hides on its close button, and tells the caller', () => {
    const onClose = vi.fn();
    const onAction = vi.fn();
    render(
      <Infobar
        icon="information"
        message="A new version of ZiroEDA is available."
        actionLabel="Reload Now"
        onAction={onAction}
        closable
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText('Reload Now'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Hide this message.'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('still hides with no one listening', () => {
    render(<Infobar message="Schematic is read only." closable />);

    fireEvent.click(screen.getByLabelText('Hide this message.'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('the bar in shell.css', () => {
  const CSS = readFileSync(resolve(__dirname, '../../../common/widgets/shell.css'), 'utf8');
  const rule = (aSelector: string) => {
    const at = CSS.indexOf(`\n${aSelector} {`);
    return at < 0 ? null : CSS.slice(at, CSS.indexOf('}', at));
  };

  it("pushes the buttons and the close button to the right edge on every bar, as the sizer's spacer does (11-17)", () => {
    // The update notice is a plain Infobar: with the spacer on the read-only bar alone, its x
    // sat beside its Reload Now button.
    expect(rule('.ze-infobar .msg')).toMatch(/margin-right: auto;/);
    expect(rule('.ze-readonly-infobar .msg')).toBeNull();
    expect(rule('.ze-infobar button:not(.ze-infobar-close)')).toMatch(/padding: 3px 12px;/);
  });
});
