// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The progress card does not resize while a job runs.
 *
 * `WX_PROGRESS_REPORTER::updateUI` only ever widens
 * (`wx_progress_reporters.cpp:94-98`):
 *
 *     if( newWidth > m_messageWidth ) { m_messageWidth = newWidth; Fit(); }
 *
 * one-directional on purpose, because a dialog that fits itself to each
 * message pulses once per tick. Ours had a `min-width` floor instead, which is
 * not the same thing: a floor lets the card widen for a long message and snap
 * back on the next short one, which is exactly what a download gauge naming
 * each file in flight produces.
 *
 * happy-dom has no layout, so `offsetWidth` is 0 for everything and the ratchet
 * would be untestable — and a test that never sees a width change is a test
 * that cannot fail. So the width is supplied here, which is the only part
 * layout would have contributed anyway.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LoadingOverlay } from '@ziroeda/designer/src/ui/LoadingOverlay.js';

/** Width the fake layout reports for the next render. */
let measured = 0;
let originalOffsetWidth: PropertyDescriptor | undefined;

beforeEach(() => {
  originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains('ze-loading-card') ? measured : 0;
    },
  });
});

afterEach(() => {
  cleanup();
  if (originalOffsetWidth) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
  }
});

const card = (c: HTMLElement): HTMLElement => c.querySelector('.ze-loading-card') as HTMLElement;

describe('the progress card never narrows', () => {
  it('holds the widest message it has shown', () => {
    measured = 320;
    const { container, rerender } = render(
      <LoadingOverlay label={{ message: 'Downloading demo', value: 0.1 }} />,
    );
    expect(card(container).style.minWidth).toBe('320px');

    // A longer message widens it, exactly as `Fit()` does upstream.
    measured = 480;
    rerender(<LoadingOverlay label={{ message: 'Downloading a much longer demo', value: 0.5 }} />);
    expect(card(container).style.minWidth).toBe('480px');

    // A shorter one must NOT shrink it back. This is the whole fix: with a
    // plain min-width floor the card would return to 320 here and the user
    // would watch it pulse for the rest of the download.
    measured = 300;
    rerender(<LoadingOverlay label={{ message: 'Done', value: 0.9 }} />);
    expect(card(container).style.minWidth).toBe('480px');
  });

  it('starts fresh for the next job rather than inheriting the last width', () => {
    measured = 500;
    const { container, rerender } = render(
      <LoadingOverlay label={{ message: 'First job', value: 0.5 }} />,
    );
    expect(card(container).style.minWidth).toBe('500px');

    // Dismissed: `m_messageWidth` goes with the dialog.
    rerender(<LoadingOverlay label={null} />);
    expect(container.querySelector('.ze-loading-card')).toBeNull();

    measured = 280;
    rerender(<LoadingOverlay label={{ message: 'Second job', value: 0.2 }} />);
    expect(card(container).style.minWidth).toBe('280px');
  });
});

describe('what the card says', () => {
  it('shows a percentage alone when the caller supplies no detail', () => {
    measured = 320;
    const { container } = render(
      <LoadingOverlay label={{ message: 'Downloading', value: 0.37 }} />,
    );
    const detail = container.querySelector('.ze-loading-detail');
    // No filename, no "37 of 89 files" — the two paths count different things
    // and only the fraction is common to both.
    expect(detail?.textContent).toBe('37%');
  });

  it('renders no gauge at all for an indeterminate job', () => {
    measured = 200;
    const { container } = render(<LoadingOverlay label="Reading files..." />);
    expect(container.querySelector('.ze-progress-track')).toBeNull();
    expect(container.querySelector('.ze-loading-detail')).toBeNull();
  });
});
