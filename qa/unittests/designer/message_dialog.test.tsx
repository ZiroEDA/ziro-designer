// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KICAD_MESSAGE_DIALOG` drawn as what it is on GTK: a GtkMessageDialog.
 *
 * `wxMessageDialog::GTKCreateMsgDialog` (wx 3.2 src/gtk/msgdlg.cpp) calls
 * `gtk_message_dialog_new` and nothing else of note — no image, no sizer — so
 * the box eeschema raises for "An error was found when loading the
 * schematic…" (files-io.cpp:451) is GTK's own: a client-side-decorated window
 * with its title in a 30 px strip of the dialog's colour, the icon theme's
 * 48 px symbolic glyph, a label wrapped at 60 characters, and one full-width
 * row of buttons. Every number here is `qa/probes/msgdlg_probe.py`'s, which
 * builds that same dialog on this machine's theme and reads it back; its
 * screenshot and a running eeschema's differ by 83 anti-aliasing pixels.
 *
 * What this pins is the set of things that were visibly wrong beside the real
 * box: a mutter title bar on a window that has none, bold text on a plain
 * label, a focus ring GTK does not draw until the keyboard is used, and the
 * two spaces after "fixed." collapsed to one.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MessageDialogError,
  MessageDialogOk,
  MessageDialogYesNo,
} from '@ziroeda/common/dialogs/dialog_message.js';
import { UnsavedChangesDialog } from '@ziroeda/common/dialogs/dialog_unsaved_changes.js';
import { LOAD_REPAIRED_MESSAGE } from '@ziroeda/designer/src/editors/schematic/files_io.js';
import { INFO_CAPTION } from '@ziroeda/common/confirm_types.js';

afterEach(cleanup);

const CSS = readFileSync(resolve(process.cwd(), '../common/widgets/shell.css'), 'utf8');

/**
 * Every rule body whose selector list names this exact selector, joined —
 * `.ze-msgdlg-extended` is declared once beside `.ze-msgdlg-message` and once
 * alone, and a declaration in either counts. Comments stripped first.
 */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) out += `${m[2] ?? ''};`;
  }
  return out;
}

/** One declaration of a rule, or undefined when the rule does not state it. */
function decl(selector: string, prop: string): string | undefined {
  const m = rule(selector).match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+);`));
  return m?.[1]?.trim();
}

/**
 * The glyphs, verbatim from the icon theme:
 * /usr/share/icons/Yaru/scalable/status/dialog-{information,warning}-symbolic.svg.
 * GTK loads these names for GTK_MESSAGE_INFO / GTK_MESSAGE_WARNING; copied
 * here so a "tidy-up" of the path data has something to fail against.
 */
const INFORMATION_RING =
  'm8 16a8 8 0 0 1-8-8 8 8 0 0 1 8-8 8 8 0 0 1 8 8 8 8 0 0 1-8 8zm0-1a7 7 0 0 0 7-7 7 7 0 0 0-7-7 7 7 0 0 0-7 7 7 7 0 0 0 7 7z';
const WARNING_TRIANGLE_START =
  'M7.963 0a1.499 1.499 0 0 0-1.277.785l-6.502 12A1.5 1.5 0 0 0 1.5 15.002h13';

const noop = () => {};

describe('the load-repair box, as eeschema raises it', () => {
  it('titles itself in GTK’s own strip, not the window manager’s bar', () => {
    // xwininfo lists the running eeschema's "Information" window with no
    // mutter-x11-frames parent: it is CSD. Its title is a `.titlebar` GtkBox
    // inside the window, the dialog's own colour, 30 px tall.
    render(
      <MessageDialogOk caption={INFO_CAPTION} message={LOAD_REPAIRED_MESSAGE} onClose={noop} />,
    );
    const dlg = document.querySelector('.ze-modal.ze-msgdlg');
    expect(dlg).not.toBeNull();
    expect(dlg?.querySelector('.ze-modal-header')).toBeNull();
    expect(dlg?.querySelector('.ze-msgdlg-title')?.textContent).toBe('Information');
    // [px] title label 18 tall with a 6 px margin above and below.
    expect(decl('.ze-msgdlg-title', 'height')).toBe('30px');
    expect(decl('.ze-msgdlg-title', 'background')).toBe('var(--chrome-bg)');
  });

  it('keeps both of upstream’s spaces after "fixed."', () => {
    // `_( "…automatically fixed.  Please save…" )` — a GtkLabel shows both;
    // an HTML text run collapses them unless the rule says otherwise.
    render(
      <MessageDialogOk caption={INFO_CAPTION} message={LOAD_REPAIRED_MESSAGE} onClose={noop} />,
    );
    expect(document.querySelector('.ze-msgdlg-message')?.textContent).toContain('fixed.  Please');
    expect(decl('.ze-msgdlg-message', 'white-space')).toBe('pre-wrap');
  });

  it('is the plain dialog face — bold only arrives with a secondary text', () => {
    // [gtk] the probe reads NO attributes on the primary label without a
    // secondary text, and `weight 700, scale 1.2` with one. Ours was bold and
    // a size up in both cases.
    expect(decl('.ze-msgdlg-message', 'font-weight')).toBeUndefined();
    expect(decl('.ze-msgdlg-message', 'font-size')).toBe('var(--ui-font-size)');
    const bold = rule('.ze-msgdlg-text:has(.ze-msgdlg-extended) .ze-msgdlg-message');
    expect(bold).toMatch(/font-weight:\s*700;/);
    expect(bold).toMatch(/font-size:\s*calc\(var\(--ui-font-size\) \* 1\.2\);/);
  });

  it('wraps at 60 characters and centres the label in its column', () => {
    // [px] `max-width-chars 60` in Ubuntu Sans 11 is a 469 px label, `xalign
    // 0.5` with `justify left`: as wide as its text, centred, ragged-left.
    expect(decl('.ze-msgdlg-message', 'max-width')).toBe('469px');
    expect(decl('.ze-msgdlg-message', 'width')).toBe('fit-content');
    expect(decl('.ze-msgdlg-message', 'text-align')).toBe('left');
    expect(decl('.ze-msgdlg-text', 'align-items')).toBe('center');
  });

  it('opens with OK focused but NO ring — GTK’s focus is not yet visible', () => {
    // `has_visible_focus() == False` on the default button as the dialog
    // opens; the ring is `button { outline: 2px solid rgba(239,134,97,0.7);
    // outline-offset: -2px }` and appears only after keyboard input, which is
    // :focus-visible. The `.primary:focus` that forced it was the difference.
    render(
      <MessageDialogOk caption={INFO_CAPTION} message={LOAD_REPAIRED_MESSAGE} onClose={noop} />,
    );
    const ok = document.querySelector('.ze-msgdlg-buttons .ze-btn') as HTMLButtonElement;
    expect(document.activeElement).toBe(ok);
    expect(rule('.ze-msgdlg-buttons .ze-btn.primary:focus')).toBe('');
    expect(decl('.ze-msgdlg-buttons .ze-btn:focus', 'outline')).toBe('none');
    expect(decl('.ze-msgdlg-buttons .ze-btn:focus-visible', 'outline')).toBe(
      '2px solid var(--field-focus-border)',
    );
    expect(decl('.ze-msgdlg-buttons .ze-btn:focus-visible', 'outline-offset')).toBe('-2px');
  });
});

describe('the measured frame', () => {
  it('is a 12 px-rounded CSD window with the shadow’s ring and no border of its own', () => {
    // [css] `messagedialog.csd decoration { border-radius: 12px; box-shadow:
    // 0 1px 2px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.65) }`.
    expect(decl('.ze-modal.ze-msgdlg', 'border-radius')).toBe('12px');
    expect(decl('.ze-modal.ze-msgdlg', 'border')).toBe('none');
    expect(decl('.ze-modal.ze-msgdlg', 'width')).toBeUndefined(); // max-content, from .ze-modal
  });

  it('puts the icon at 47 and the text column at 137', () => {
    // [px] image (47,35 48x48) with 12 px margins, label at x=137: 35 of body
    // padding + 12 + 48 + 42.
    expect(decl('.ze-msgdlg-body', 'padding')).toBe('5px 35px 25px');
    expect(decl('.ze-msgdlg-icon', 'width')).toBe('48px');
    expect(decl('.ze-msgdlg-icon', 'height')).toBe('48px');
    expect(decl('.ze-msgdlg-icon', 'margin')).toBe('0 42px 0 12px');
  });

  it('draws the icon theme’s glyph, in the dialog’s foreground', () => {
    render(
      <MessageDialogOk caption={INFO_CAPTION} message={LOAD_REPAIRED_MESSAGE} onClose={noop} />,
    );
    const svg = document.querySelector('.ze-msgdlg-icon');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(INFORMATION_RING);
    expect(decl('.ze-msgdlg-icon', 'color')).toBe('var(--chrome-fg)');
  });

  it('gives every button the full-width row’s 45 px and Yaru’s face', () => {
    // [css] `messagedialog.csd .dialog-action-area button { padding: 10px
    // 14px; border-radius: 0 }` over `button { border: 1px solid #181818;
    // background-image: image(#373737) }`; [px] 1 + 10 + 24 + 10.
    const b = rule('.ze-msgdlg-buttons .ze-btn');
    expect(b).toMatch(/height:\s*45px;/);
    expect(b).toMatch(/padding:\s*10px 14px;/);
    expect(b).toMatch(/border-top:\s*1px solid var\(--ctl-border\);/);
    expect(b).toMatch(/background:\s*var\(--ctl-face\);/);
    expect(b).toMatch(/flex:\s*1 1 0;/);
    expect(decl('.ze-msgdlg-buttons .ze-btn + .ze-btn', 'border-left')).toBe(
      '1px solid var(--ctl-border)',
    );
  });
});

describe('the other shapes share the shell', () => {
  it('Error: the fixed caption in the same strip, the error glyph', () => {
    render(<MessageDialogError message="Nope." onClose={noop} />);
    expect(document.querySelector('.ze-msgdlg .ze-msgdlg-title')?.textContent).toBe('Error');
    expect(document.querySelector('.ze-msgdlg .ze-modal-header')).toBeNull();
    // dialog-error-symbolic: the ring and the cross are one path.
    expect(document.querySelector('.ze-msgdlg-icon path')?.getAttribute('d')).toMatch(
      /^M8 0a8 8 0 0 1 8 8/,
    );
  });

  it('Yes/No: the caller’s caption in the same strip', () => {
    render(
      <MessageDialogYesNo
        caption="Revert"
        message="Revert?"
        icon="question"
        defaultButton="no"
        onResult={noop}
      />,
    );
    expect(document.querySelector('.ze-msgdlg .ze-msgdlg-title')?.textContent).toBe('Revert');
    expect(document.querySelector('.ze-msgdlg .ze-modal-header')).toBeNull();
  });

  it('Save Changes?: the shared warning glyph, and a secondary text that is not dimmed', () => {
    render(<UnsavedChangesDialog message="Save changes?" onResult={noop} />);
    expect(document.querySelector('.ze-msgdlg .ze-msgdlg-title')?.textContent).toBe(
      'Save Changes?',
    );
    expect(document.querySelector('.ze-msgdlg-icon path')?.getAttribute('d')).toContain(
      WARNING_TRIANGLE_START,
    );
    // The probe reads #f7f7f7 on both labels: no `color` on the secondary.
    expect(document.querySelector('.ze-msgdlg-extended')).not.toBeNull();
    expect(decl('.ze-msgdlg-extended', 'color')).toBeUndefined();
    // [px] secondary at y=143 under a primary ending at 133; margin-bottom 2.
    expect(decl('.ze-msgdlg-text', 'gap')).toBe('10px');
    expect(decl('.ze-msgdlg-extended', 'margin-bottom')).toBe('2px');
  });
});
