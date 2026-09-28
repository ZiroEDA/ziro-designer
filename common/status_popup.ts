// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `STATUS_POPUP` and `STATUS_TEXT_POPUP` (include/status_popup.h,
 * common/status_popup.cpp): the small borderless window a tool floats beside
 * the cursor - "Click on new member...", "No new hierarchical labels found."
 * - moved by the caller (usually `GetMousePosition() + ( 20, 20 )`) and
 * optionally hidden by a timer.
 *
 * KiCad's tools make and drive one imperatively, so this is an imperative
 * class too, owning its own element the way a `wxPopupWindow` owns its own
 * top-level window. The look is `.ze-status-popup` in shell.css, measured by
 * `qa/probes/status_popup_probe.cpp`: no border, BTNFACE, the text at a 5 px
 * sizer border on every side.
 */

/** `wxPoint` / `VECTOR2I`, in the page's (screen) coordinates. */
export interface POPUP_POINT {
  x: number;
  y: number;
}

export class STATUS_POPUP {
  /** The `wxPopupWindow`. */
  protected readonly m_window: HTMLDivElement | null;
  protected readonly m_panel: HTMLDivElement | null;
  private m_expireTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof document === 'undefined') {
      this.m_window = null;
      this.m_panel = null;
      return;
    }

    this.m_window = document.createElement('div');
    this.m_window.className = 'ze-status-popup';
    this.m_window.hidden = true;

    // m_panel with a horizontal m_topSizer.
    this.m_panel = document.createElement('div');
    this.m_panel.className = 'ze-status-popup-panel';
    this.m_window.appendChild(this.m_panel);

    document.body.appendChild(this.m_window);
  }

  /** `Popup`: show and raise. */
  Popup(): void {
    if (!this.m_window) return;
    this.m_window.hidden = false;
    // Raise(): the most recently shown popup is the top one.
    document.body.appendChild(this.m_window);
  }

  PopupFor(aMsecs: number): void {
    this.Popup();
    this.Expire(aMsecs);
  }

  /** `Move( const wxPoint& )`: the popup's top-left, in screen coordinates. */
  Move(aWhere: POPUP_POINT): void {
    if (!this.m_window) return;
    this.m_window.style.left = `${aWhere.x}px`;
    this.m_window.style.top = `${aWhere.y}px`;
  }

  /** Hide the popup after a specified time. */
  Expire(aMsecs: number): void {
    // wxTimer::StartOnce restarts a running timer.
    if (this.m_expireTimer !== null) clearTimeout(this.m_expireTimer);
    this.m_expireTimer = setTimeout(() => this.onExpire(), aMsecs);
  }

  Hide(): void {
    if (this.m_window) this.m_window.hidden = true;
  }

  IsShown(): boolean {
    return !!this.m_window && !this.m_window.hidden;
  }

  GetPanel(): HTMLDivElement | null {
    return this.m_panel;
  }

  /**
   * The C++ destructor: the `std::unique_ptr` a tool holds is reset, and the
   * window goes with it.
   */
  Destroy(): void {
    if (this.m_expireTimer !== null) clearTimeout(this.m_expireTimer);
    this.m_expireTimer = null;
    this.m_window?.remove();
  }

  /**
   * `updateSize`: `m_topSizer->Fit( m_panel ); SetClientSize( ... )`. The
   * element is sized by its content, so there is nothing to recompute.
   */
  protected updateSize(): void {}

  /** Expire timer event handler. */
  protected onExpire(): void {
    this.m_expireTimer = null;
    this.Hide();
  }
}

export class STATUS_TEXT_POPUP extends STATUS_POPUP {
  protected readonly m_statusLine: HTMLSpanElement | null;

  constructor() {
    super();

    if (!this.m_panel) {
      this.m_statusLine = null;
      return;
    }

    this.m_panel.classList.add('ze-status-text-popup');
    this.m_statusLine = document.createElement('span');
    this.m_statusLine.className = 'ze-status-popup-text';
    this.m_panel.appendChild(this.m_statusLine);
  }

  /** Display a text. A `\n` breaks the line, as a wxStaticText label does. */
  SetText(aText: string): void {
    if (this.m_statusLine) this.m_statusLine.textContent = aText;
    this.updateSize();
  }

  GetText(): string {
    return this.m_statusLine?.textContent ?? '';
  }

  /** Change text color. */
  SetTextColor(aColor: string): void {
    if (this.m_statusLine) this.m_statusLine.style.color = aColor;
  }
}
