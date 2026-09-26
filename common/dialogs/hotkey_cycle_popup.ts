// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `HOTKEY_CYCLE_POPUP` (`common/dialogs/hotkey_cycle_popup.cpp` / `.h`) — the
 * transient panel that flashes the list you are cycling through when a
 * single-stroke hotkey steps a setting, and fades away on its own.
 *
 * It lives in `common/dialogs/` upstream because four call sites in two
 * editors share ONE widget, and they cycle four different things:
 *
 *   | caller                                          | title                    | items |
 *   |---|---|---|
 *   | `SCH_EDITOR_CONTROL::GridFeedback` (`eeschema/tools/sch_editor_control.cpp:3360-3382`) | `Grid` | one per `GRID_SETTINGS::grids` |
 *   | `PCB_CONTROL::ContrastModeFeedback` (`pcbnew/tools/pcb_control.cpp:401`) | `Inactive Layer Display` | Normal / Dimmed / Hidden |
 *   | `PCB_CONTROL::LayerPresetFeedback` (`pcbnew/tools/pcb_control.cpp:713`) | `Preset Layer Pairs` | one per stored layer pair |
 *   | `PCB_CONTROL::SnapModeFeedback` (`pcbnew/tools/pcb_control.cpp:2353`) | `Object Snapping` | Active Layer / All Layers |
 *
 * so the signature here is upstream's — a title, a list of strings, and an
 * index — and NOT anything grid-shaped. Every caller is gated on the same
 * preference (`Pgm().GetCommonSettings()->m_Input.hotkey_feedback`, default
 * true at `common/settings/common_settings.cpp:260-261`); the gate is the
 * caller's, upstream, so it stays there rather than being folded in here.
 *
 * The base class it inherits, `EDA_VIEW_SWITCHER_BASE`
 * (`common/dialogs/eda_view_switcher_base.cpp:12-32`), is a vertical box sizer
 * holding a `wxStaticText` title and a borderless `wxListBox`; its dialog style
 * defaults to `wxSTAY_ON_TOP` ALONE, which is why the real thing has no title
 * bar. The geometry that goes with that lives in `shell.css` under `.ze-hkcycle`.
 */

/**
 * `#define SHOW_TIME_MS 500` (`hotkey_cycle_popup.cpp:40`) — how long the panel
 * stays up after the last keystroke.
 */
export const SHOW_TIME_MS = 500;

/** What one `Popup()` call puts on screen. */
export interface HotkeyCyclePopupContents {
  /** `aTitle` — `m_stTitle->SetLabel( aTitle )` (`:77`). */
  readonly title: string;
  /** `aItems` — `m_listBox->InsertItems( aItems, 0 )` (`:79`). */
  readonly items: readonly string[];
  /**
   * `m_listBox->SetSelection( std::min( aSelection, GetCount() - 1 ) )`
   * (`:80-81`). Upstream clamps only the TOP, so an empty list selects -1 and
   * nothing highlights — which is what `wxListBox::SetSelection( -1 )` means.
   */
  readonly selection: number;
}

/**
 * The one thing the popup needs from the frame that owns it:
 * `m_drawFrame->GetCanvas()->SetFocus()`, which it calls when the timer expires
 * (`:48`) to hand the keyboard back after having stolen it with `SetFocus()`
 * (`:103`, `:110`).
 */
export interface HotkeyCyclePopupFrame {
  /** `EDA_DRAW_FRAME::GetCanvas()->SetFocus()`. */
  focusCanvas(): void;
}

/**
 * `HOTKEY_CYCLE_POPUP`, minus the wx window: the contents, the shown flag and
 * `m_showTimer`. Framework-free on purpose — the React shell around it is
 * `HotkeyCyclePopup.tsx`, and the pcbnew callers will want the same object.
 */
export class HotkeyCyclePopup {
  /** `m_showTimer`. Non-null exactly when `wxTimer::IsRunning()` is true. */
  private showTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether `Show( true )` has run and `Show( false )` has not. */
  private shownFlag = false;

  private contentsValue: HotkeyCyclePopupContents | null = null;

  constructor(
    /** `m_drawFrame`. */
    private readonly drawFrame: HotkeyCyclePopupFrame,
    /** Told whenever what a renderer would draw has changed. */
    private readonly onChange: () => void = () => {},
  ) {}

  /** Whether the window is up. */
  get shown(): boolean {
    return this.shownFlag;
  }

  /** `null` before the first `popup()`. */
  get contents(): HotkeyCyclePopupContents | null {
    return this.contentsValue;
  }

  /** `wxTimer::IsRunning()` (`:100`). Exposed so a test can see the restart. */
  get timerRunning(): boolean {
    return this.showTimer !== null;
  }

  /**
   * `HOTKEY_CYCLE_POPUP::Popup( aTitle, aItems, aSelection )` (`:74-111`).
   *
   * The early return at `:100-105` is the whole reason cycling fast does not
   * flicker: when the timer is ALREADY running the contents are replaced, the
   * timer is RESTARTED from zero, and `Show( true )` is skipped because the
   * window is already up. Letting the running timer expire on its old schedule
   * instead would tear the panel down mid-cycle.
   */
  popup(title: string, items: readonly string[], selection: number): void {
    this.contentsValue = {
      title,
      items: [...items],
      // `:80-81`, top clamp only.
      selection: Math.min(selection, items.length - 1),
    };

    if (this.showTimer !== null) {
      this.startOnce(); // `:102`
      this.onChange(); // `SetFocus()` at `:103`, then `return` at `:104`
      return;
    }

    this.startOnce(); // `:107`

    this.shownFlag = true; // `Show( true )` at `:109`
    this.onChange(); // `SetFocus()` at `:110`
  }

  /**
   * `~HOTKEY_CYCLE_POPUP` (`:68-71`) — `delete m_showTimer`, which stops it.
   * Nothing else: an unmount must not run the expiry handler and steal focus.
   */
  destroy(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }

  /** `m_showTimer->StartOnce( SHOW_TIME_MS )`. wx restarts a running timer. */
  private startOnce(): void {
    if (this.showTimer !== null) clearTimeout(this.showTimer);
    this.showTimer = setTimeout(() => {
      // The bound handler at `:48`, in its order: hide first, then hand the
      // keyboard back to the canvas.
      this.showTimer = null;
      this.shownFlag = false;
      this.onChange();
      this.drawFrame.focusCanvas();
    }, SHOW_TIME_MS);
  }
}
