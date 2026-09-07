// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIDIALOG` drawn — and, more to the point, drawn as the RIGHT dialog.
 *
 * `KICAD_MESSAGE_DIALOG` is `wxMessageDialog`, the platform's own message box.
 * `KIDIALOG` derives from `wxRichMessageDialog`, which `wx/richmsgdlg.h`
 * resolves to `wxGenericRichMessageDialog` on every platform but MSW — a plain
 * wxDialog that wx lays out itself. They are different widgets: a 48 px icon
 * against 44, a `wxStaticLine` the message box has not got, and buttons
 * right-aligned in a `wxStdDialogButtonSizer` rather than GTK's full-width row.
 *
 * All of the geometry asserted here is read off the built widget by
 * `qa/probes/kidialog_probe.cpp` — four variants of the same dialog, so each
 * border is a difference between two measurements rather than one reading.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { JSX } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  KiDialog,
  DO_NOT_SHOW_AGAIN_LABEL,
  useKiDialog,
} from '@ziroeda/designer/src/ui/kidialog.js';
import {
  clearDoNotShowAgainDialogs,
  rememberDoNotShowAgain,
} from '@ziroeda/designer/src/ui/do_not_show_again.js';

afterEach(cleanup);

const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');

/** A rule body by exact selector, comments stripped. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) return m[2] ?? '';
  }
  return '';
}

const PIN_CLASH = {
  caption: 'Confirmation',
  message: 'This position is already occupied by another pin, in unit 2.',
  extendedMessage: "Disable the 'Synchronized Pins Mode' option to avoid this message.",
  icon: 'warning' as const,
  labels: { ok: 'Place Pin Anyway' },
  doNotShowKey: 'test/key',
};

describe('the checkbox', () => {
  it('is drawn, with upstream’s label, when the dialog declares a key', () => {
    // `ShowCheckBox( _( "Do not show again" ), false )` (`kidialog.cpp:57`).
    render(<KiDialog request={PIN_CLASH} onResult={() => {}} />);
    const box = screen.getByLabelText(DO_NOT_SHOW_AGAIN_LABEL) as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(false); // the `false` in that call.
  });

  it('is absent when it is not — a KIDIALOG that never calls it has none', () => {
    const { doNotShowKey, ...noKey } = PIN_CLASH;
    render(<KiDialog request={noKey} onResult={() => {}} />);
    expect(screen.queryByLabelText(DO_NOT_SHOW_AGAIN_LABEL)).toBeNull();
  });

  it('reports its state with the answer, which is what decides remembering', () => {
    const got: [string, boolean][] = [];
    render(<KiDialog request={PIN_CLASH} onResult={(r, c) => got.push([r, c])} />);
    fireEvent.click(screen.getByLabelText(DO_NOT_SHOW_AGAIN_LABEL));
    fireEvent.click(screen.getByText('Place Pin Anyway'));
    expect(got).toEqual([['ok', true]]);
  });
});

describe('the buttons', () => {
  it('are GTK order — the affirmative LAST', () => {
    // [px] the probe reads Cancel at x=323 and "Place Pin Anyway" at x=414.
    render(<KiDialog request={PIN_CLASH} onResult={() => {}} />);
    const labels = [...document.querySelectorAll('.ze-kidialog-buttons .ze-btn')].map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(['Cancel', 'Place Pin Anyway']);
  });

  it('answer ok and cancel, whatever they are called', () => {
    const got: string[] = [];
    render(<KiDialog request={PIN_CLASH} onResult={(r) => got.push(r)} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(got).toEqual(['cancel']);
  });
});

describe('it is the generic dialog, not the message box', () => {
  it('draws the wxStaticLine the message box has not got', () => {
    // [px] `line(10,121 568x2)`. `.ze-msgdlg` has no such element at all: a
    // native GTK message box separates its buttons with hairlines between them.
    render(<KiDialog request={PIN_CLASH} onResult={() => {}} />);
    expect(document.querySelector('.ze-kidialog-line')).not.toBeNull();
    expect(rule('.ze-kidialog-line')).toMatch(/height:\s*2px;/);
  });

  it('takes its own chrome rather than .ze-msgdlg’s', () => {
    render(<KiDialog request={PIN_CLASH} onResult={() => {}} />);
    const modal = document.querySelector('.ze-modal');
    expect(modal?.classList.contains('ze-kidialog')).toBe(true);
    expect(modal?.classList.contains('ze-msgdlg')).toBe(false);
  });

  it('has a 48 px icon where the message box has 44', () => {
    // [px] `icon(10,10 48x48)` against `.ze-msgdlg-icon`'s measured 44.
    render(<KiDialog request={PIN_CLASH} onResult={() => {}} />);
    expect(document.querySelector('.ze-kidialog-icon')).not.toBeNull();
    expect(rule('.ze-kidialog-icon')).toMatch(/width:\s*48px;/);
    expect(rule('.ze-msgdlg-icon')).toMatch(/width:\s*44px;/);
  });
});

describe('the measured borders', () => {
  it('put the checkbox at the DIALOG’s left margin, not the text column’s', () => {
    // [px] `checkbox(10,86 …)` — the same x as the icon, not the message's 78.
    // A checkbox indented under the message is what this ruled out.
    const r = rule('.ze-kidialog-check');
    expect(r).toMatch(/margin:\s*10px 10px 0;/);
  });

  it('take the box-to-label spacing from the shared checkbox rule', () => {
    // GTK's, the same on every checkbox in the app, and already stated once by
    // `.ze-pref-check`. Restating it here is how the two drift.
    render(<KiDialog request={PIN_CLASH} onResult={() => {}} />);
    const row = document.querySelector('.ze-kidialog-check');
    expect(row?.classList.contains('ze-pref-check')).toBe(true);
    expect(rule('.ze-kidialog-check')).not.toMatch(/\bgap\b/);
  });

  it('space the icon, the two text lines and the button row as wx does', () => {
    // [px] 78 - (10 + 48) = 20 between icon and text; message bottom 35 to
    // extended top 55 = 20; rule bottom 123 to buttons top 135 = 12, and the
    // row is inset 12 from the content's right edge where everything else is 10.
    expect(rule('.ze-kidialog-body')).toMatch(/gap:\s*20px;/);
    expect(rule('.ze-kidialog-body')).toMatch(/padding:\s*10px 10px 0;/);
    expect(rule('.ze-kidialog-extended')).toMatch(/margin-top:\s*20px;/);
    expect(rule('.ze-kidialog-buttons')).toMatch(/padding:\s*12px 22px 10px;/);
    expect(rule('.ze-kidialog-buttons')).toMatch(/gap:\s*6px;/);
  });

  it('do not dim the extended message — the probe reads one foreground', () => {
    // Message, extended message, checkbox and both buttons all come back with
    // the same fg. `.ze-msgdlg-extended` greys its own because GTK's NATIVE
    // message box greys secondary text; carrying that across would be an
    // invention, and it is the shape of invention that looks like consistency.
    expect(rule('.ze-kidialog-extended')).not.toMatch(/\bcolor\b/);
    expect(rule('.ze-msgdlg-extended')).toMatch(/\bcolor\b/);
  });

  it('scale the primary line off the font token, not off a px', () => {
    // [px] 13pt against 11 everywhere else, and `--ui-font-size` IS 11pt — so
    // the ratio is the measurement and the token is the base.
    const r = rule('.ze-kidialog-message');
    expect(r).toMatch(/font-size:\s*calc\(var\(--ui-font-size\) \* 13 \/ 11\)/);
    expect(r).toMatch(/font-weight:\s*700/);
    // ...and the rule has to reach the element, which a class stated only in
    // the stylesheet does not.
    render(<KiDialog request={PIN_CLASH} onResult={() => {}} />);
    expect(document.querySelector('.ze-kidialog-message')?.textContent).toBe(PIN_CLASH.message);
  });

  it('size the dialog to its content, because wx never wraps the message', () => {
    // [px] a 200-character message measured 1446 px of client, on ONE line.
    expect(rule('.ze-modal.ze-kidialog')).toMatch(/width:\s*max-content;/);
    // ...capped, which is ours: a dialog wider than the window is reachable on
    // a desktop and is not in a browser.
    expect(rule('.ze-modal.ze-kidialog')).toMatch(/max-width:\s*92vw;/);
  });
});

/** A frame with one KIDIALOG host, the way an editor mounts it. */
function Host({ onAnswer }: { onAnswer: (r: string) => void }): JSX.Element {
  const { ask, node } = useKiDialog();
  return (
    <div>
      <button type="button" onClick={() => void ask(PIN_CLASH).then(onAnswer)}>
        provoke
      </button>
      {node}
    </div>
  );
}

describe('ShowModal’s early return', () => {
  afterEach(clearDoNotShowAgainDialogs);

  it('does not draw a dialog the user has silenced, and answers as they did', async () => {
    // `auto it = g_doNotShowAgainDlgs.find( m_hash ); if( … ) return it->second;`
    // The whole point of the feature: no dialog, and the remembered answer.
    rememberDoNotShowAgain(PIN_CLASH.doNotShowKey, 'cancel', {
      checked: true,
      cancelMeansCancel: false,
    });

    const answers: string[] = [];
    render(<Host onAnswer={(r) => answers.push(r)} />);
    fireEvent.click(screen.getByText('provoke'));
    await waitFor(() => expect(answers).toEqual(['cancel']));
    expect(document.querySelector('.ze-kidialog')).toBeNull();
  });

  it('draws it when nothing has been remembered', async () => {
    const answers: string[] = [];
    render(<Host onAnswer={(r) => answers.push(r)} />);
    fireEvent.click(screen.getByText('provoke'));
    expect(document.querySelector('.ze-kidialog')).not.toBeNull();
    expect(answers).toEqual([]);

    fireEvent.click(screen.getByText('Place Pin Anyway'));
    await waitFor(() => expect(answers).toEqual(['ok']));
  });

  it('remembers through the host, applying m_cancelMeansCancel', async () => {
    // PIN_CLASH names only `ok`, as `SetOKLabel` does, so the flag stays true
    // and a ticked Cancel is NOT stored — the next ask must draw the dialog.
    const answers: string[] = [];
    render(<Host onAnswer={(r) => answers.push(r)} />);
    fireEvent.click(screen.getByText('provoke'));
    fireEvent.click(screen.getByLabelText(DO_NOT_SHOW_AGAIN_LABEL));
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(answers).toEqual(['cancel']));

    fireEvent.click(screen.getByText('provoke'));
    expect(document.querySelector('.ze-kidialog')).not.toBeNull();
  });

  it('...and does store a ticked OK, so the second ask never draws', async () => {
    const answers: string[] = [];
    render(<Host onAnswer={(r) => answers.push(r)} />);
    fireEvent.click(screen.getByText('provoke'));
    fireEvent.click(screen.getByLabelText(DO_NOT_SHOW_AGAIN_LABEL));
    fireEvent.click(screen.getByText('Place Pin Anyway'));
    await waitFor(() => expect(answers).toEqual(['ok']));

    fireEvent.click(screen.getByText('provoke'));
    expect(document.querySelector('.ze-kidialog')).toBeNull();
    await waitFor(() => expect(answers).toEqual(['ok', 'ok']));
  });
});

describe('the one call site this port has', () => {
  /**
   * `SYMBOL_EDITOR_PIN_TOOL::PlacePin`
   * (`eeschema/tools/symbol_editor_pin_tool.cpp:225-241`) — the pin-position
   * clash under Synchronized Pins Mode. A source check, because the frame is
   * one large component and what is being pinned is which arguments the call
   * carries, not what the editor renders.
   */
  const FRAME = readFileSync(
    resolve(process.cwd(), '../designer/src/editors/symbol/SymbolEditor.tsx'),
    'utf8',
  )
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const call = (): string => {
    const at = FRAME.indexOf('askKiDialog({');
    expect(at, 'the pin clash does not raise a KIDIALOG').toBeGreaterThan(-1);
    return FRAME.slice(at, FRAME.indexOf('});', at));
  };

  it('is a KIDIALOG and not a window.confirm', () => {
    // A browser confirm has no checkbox, no extended message and no way to
    // rename OK, so the one question upstream lets you silence could not be.
    expect(FRAME).not.toMatch(/window\.confirm\([^)]*already occupied/);
  });

  it('carries the key, so the checkbox is drawn and the answer is kept', () => {
    expect(call()).toMatch(/doNotShowKey: DO_NOT_SHOW_KEYS\.symbolEditorPinClash/);
  });

  it('renames OK ONLY, which is what SetOKLabel does', () => {
    // Naming the Cancel button too would be `SetOKCancelLabels`, and that
    // clears `m_cancelMeansCancel` -- a ticked Cancel would then be remembered
    // and the user would never be asked again about a thing they refused.
    const c = call();
    expect(c).toMatch(/labels: \{ ok: 'Place Pin Anyway' \}/);
    expect(c).not.toMatch(/cancel:/);
  });

  it('keeps upstream’s extended message, which names the setting to turn off', () => {
    expect(call()).toMatch(/Disable the 'Synchronized Pins Mode' option to avoid this message\./);
  });
});
