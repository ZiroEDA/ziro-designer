// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * WX_PROGRESS_REPORTER's dialog, as a wxProgressDialog and not as a card.
 *
 * What the dialog is made of comes from `qa/probes/progress_dialog_probe.py`,
 * which builds it with wxWidgets: a caption, one wxStaticText, one wxGauge
 * ranged 1000, "Elapsed time:" with a `%lu:%02lu:%02lu` clock, and a Cancel
 * button when PR_CAN_ABORT. There is no spinner and no second line, which is
 * what the widget this replaced drew.
 *
 * The width ratchet is `WX_PROGRESS_REPORTER::updateUI`
 * (`wx_progress_reporters.cpp:94-98`):
 *
 *     if( newWidth > m_messageWidth ) { m_messageWidth = newWidth; Fit(); }
 *
 * one-directional on purpose, because a dialog that fits itself to each
 * message pulses once per tick. happy-dom has no layout, so `offsetWidth` is 0
 * for everything and the ratchet would be untestable — the width is supplied
 * here, which is the only part layout would have contributed anyway.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ProgressDialog, formatElapsed } from '@ziroeda/designer/src/ui/ProgressDialog.js';

/** Width the fake layout reports for the next render. */
let measured = 0;
let originalOffsetWidth: PropertyDescriptor | undefined;

beforeEach(() => {
  originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains('ze-progress-dialog') ? measured : 0;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalOffsetWidth) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
  }
});

const dialog = (c: HTMLElement): HTMLElement =>
  c.querySelector('.ze-progress-dialog') as HTMLElement;
const gauge = (c: HTMLElement): HTMLProgressElement =>
  c.querySelector('progress.ze-gauge') as HTMLProgressElement;

describe('what the dialog is made of', () => {
  it('is the shared dialog: caption, one message, one gauge, the clock, Cancel', () => {
    const { container } = render(
      <ProgressDialog
        title="Load PCB"
        label={{ message: 'Loading amp.kicad_pcb...', value: 0.371 }}
        onCancel={() => {}}
      />,
    );
    const d = dialog(container);
    expect(d.classList.contains('ze-modal')).toBe(true);
    expect(d.querySelector('.ze-modal-header')?.textContent).toBe('Load PCB');
    expect(d.querySelector('.msg')?.textContent).toBe('Loading amp.kicad_pcb...');
    // `SetRange( 1000 )` then `Update( cur, message )` with cur = CurrentProgress().
    expect(gauge(container).max).toBe(1000);
    expect(gauge(container).value).toBe(371);
    expect(d.querySelector('.times')?.textContent).toBe('Elapsed time:0:00:00');
    expect(d.querySelector('.ze-modal-footer .ze-btn')?.textContent).toBe('Cancel');
    // Nothing the card had.
    expect(container.querySelector('.ze-spinner')).toBeNull();
    expect(container.textContent).not.toMatch(/%/);
  });

  it('shows an EMPTY gauge, not a pulse, for a phase with no max', () => {
    // CurrentProgress() with m_maxProgress 0 is a division by zero, and
    // updateUI clamps anything outside 0..1000 to 0 (:65-66).
    const { container } = render(<ProgressDialog title="Load Files" label="Reading files..." />);
    expect(gauge(container)).not.toBeNull();
    expect(gauge(container).value).toBe(0);
  });

  it('has no Cancel without PR_CAN_ABORT', () => {
    const { container } = render(<ProgressDialog title="Load PCB" label="Loading..." />);
    expect(container.querySelector('.ze-modal-footer')).toBeNull();
  });

  it('greys Cancel the moment it is pressed, and presses it once', () => {
    // OnCancel: `m_state = Canceled; m_btnAbort->Disable();`
    const onCancel = vi.fn();
    const { container } = render(
      <ProgressDialog title="Load Schematic" label="Loading..." onCancel={onCancel} />,
    );
    const btn = container.querySelector('.ze-modal-footer .ze-btn') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps wxPD_ELAPSED_TIME, whole seconds from creation', () => {
    vi.useFakeTimers();
    const { container } = render(<ProgressDialog title="Load PCB" label="Loading..." />);
    expect(dialog(container).querySelector('.val')?.textContent).toBe('0:00:00');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(dialog(container).querySelector('.val')?.textContent).toBe('0:00:03');
  });

  it('prints the clock as SetTimeLabel does: %lu:%02lu:%02lu', () => {
    expect(formatElapsed(0)).toBe('0:00:00');
    expect(formatElapsed(59)).toBe('0:00:59');
    expect(formatElapsed(61)).toBe('0:01:01');
    expect(formatElapsed(3600 * 12 + 5)).toBe('12:00:05');
  });
});

describe('the dialog never narrows', () => {
  it('holds the widest message it has shown', () => {
    measured = 320;
    const { container, rerender } = render(
      <ProgressDialog title="Download Demo" label={{ message: 'Downloading demo', value: 0.1 }} />,
    );
    expect(dialog(container).style.minWidth).toBe('320px');

    // A longer message widens it, exactly as `Fit()` does upstream.
    measured = 480;
    rerender(
      <ProgressDialog
        title="Download Demo"
        label={{ message: 'Downloading a much longer demo', value: 0.5 }}
      />,
    );
    expect(dialog(container).style.minWidth).toBe('480px');

    // A shorter one must NOT shrink it back. With a plain min-width floor the
    // dialog would return to 320 here and pulse for the rest of the download.
    measured = 300;
    rerender(<ProgressDialog title="Download Demo" label={{ message: 'Done', value: 0.9 }} />);
    expect(dialog(container).style.minWidth).toBe('480px');
  });

  it('starts fresh for the next job rather than inheriting the last width', () => {
    measured = 500;
    const { container, rerender } = render(
      <ProgressDialog title="Load Files" label={{ message: 'First job', value: 0.5 }} />,
    );
    expect(dialog(container).style.minWidth).toBe('500px');

    // Dismissed: `m_messageWidth` goes with the dialog.
    rerender(<ProgressDialog title="Load Files" label={null} />);
    expect(container.querySelector('.ze-progress-dialog')).toBeNull();

    measured = 280;
    rerender(<ProgressDialog title="Load Files" label={{ message: 'Second job', value: 0.2 }} />);
    expect(dialog(container).style.minWidth).toBe('280px');
  });
});
