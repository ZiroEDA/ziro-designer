// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `STATUS_POPUP` / `STATUS_TEXT_POPUP` (common/status_popup.cpp): a window of
 * its own, hidden until `Popup`, placed by `Move`, hidden again by the
 * `Expire` timer, which a second `Expire` restarts (wxTimer::StartOnce).
 */
import { STATUS_TEXT_POPUP } from '@ziroeda/common/status_popup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const windowOf = (): HTMLElement | null => document.querySelector('.ze-status-popup');

describe('STATUS_TEXT_POPUP', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('is its own hidden window until Popup', () => {
    const p = new STATUS_TEXT_POPUP();
    p.SetText('Click over a sheet.');
    expect(windowOf()?.parentElement).toBe(document.body);
    expect(p.IsShown()).toBe(false);
    p.Popup();
    expect(p.IsShown()).toBe(true);
    expect(windowOf()?.textContent).toBe('Click over a sheet.');
  });

  it('keeps a newline as a line break', () => {
    const p = new STATUS_TEXT_POPUP();
    p.SetText('Click on pad 1\nPress <esc> to cancel all; double-click to finish');
    expect(p.GetText().split('\n')).toHaveLength(2);
  });

  it('Move places its top-left in page coordinates', () => {
    const p = new STATUS_TEXT_POPUP();
    p.Move({ x: 120, y: 80 });
    expect(windowOf()?.style.left).toBe('120px');
    expect(windowOf()?.style.top).toBe('80px');
  });

  it('PopupFor hides it when the time is up, not before', () => {
    const p = new STATUS_TEXT_POPUP();
    p.PopupFor(2000);
    vi.advanceTimersByTime(1999);
    expect(p.IsShown()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(p.IsShown()).toBe(false);
  });

  it('a second Expire restarts the timer rather than adding one', () => {
    const p = new STATUS_TEXT_POPUP();
    p.PopupFor(800);
    vi.advanceTimersByTime(700);
    p.Expire(800);
    vi.advanceTimersByTime(700);
    expect(p.IsShown()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(p.IsShown()).toBe(false);
  });

  it('Destroy takes the window away', () => {
    const p = new STATUS_TEXT_POPUP();
    p.Popup();
    p.Destroy();
    expect(windowOf()).toBeNull();
  });
});

describe('KIPLATFORM::UI::GetMousePosition', () => {
  it('knows the pointer anywhere in the page, not only over a canvas', async () => {
    const UI = await import('@ziroeda/common/kiplatform/ui.js');
    const target = document.createElement('div');
    document.body.appendChild(target);
    // A handler that swallows the event does not hide it: the platform listens
    // at the window in the capture phase.
    target.addEventListener('pointermove', (e) => e.stopPropagation());
    target.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 321, clientY: 123 }),
    );
    const at = UI.GetMousePosition();
    expect([at.x, at.y]).toEqual([321, 123]);
  });
});
