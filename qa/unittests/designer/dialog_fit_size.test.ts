// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A dialog is sized by `Fit()`, not by a number somebody picked.
 *
 * Every wxFormBuilder `_base.cpp` in KiCad ends the same three lines:
 *
 *     this->SetSizer( bMainSizer );
 *     this->Layout();
 *     bMainSizer->Fit( this );
 *
 * and the hand-written `.cpp` on top of it finishes `TransferDataToWindow` with
 * `GetSizer()->SetSizeHints( this )`. `dialog_page_settings_base.cpp:403-405`
 * and `dialog_page_settings.cpp:192` are one instance; the tree repeats it
 * everywhere. The consequence is the thing a user notices: two KiCad dialogs
 * holding the same controls come out the same size, and none of them carries a
 * pixel width at all.
 *
 * Ours carried forty-five. `.ze-modal` declared `width: 860px; height: 580px`
 * — two numbers that appear nowhere in KiCad — and then every single dialog
 * overrode them, 17 in `shell.css` and 28 inline at the call site. They cannot
 * all be right, and two of them prove it: the SAME upstream dialog,
 * `DIALOG_PAGES_SETTINGS`, was 760 px in the schematic's copy and 560 px in the
 * drawing sheet's.
 *
 * This file pins the default and ratchets the pile:
 *
 *  - `.ze-modal` itself must declare no pixel size. That one is absolute; there
 *    is no C++ it could cite, because upstream has no such number.
 *  - the count of dialogs that DO name a size may not grow. A few are real —
 *    `DIALOG_TEMPLATE_SELECTOR` and the hotkey editor genuinely call SetSize,
 *    and their rules carry the citation — so this is a ratchet rather than a
 *    ban. Removing one means lowering the number here in the same commit.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../../../designer/src');
const SHELL = join(SRC, 'ui/shell.css');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Every `className="ze-modal…"` element that also carries an inline width/height. */
function inlineSized(): string[] {
  const hits: string[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/className="ze-modal[^"]*"/g)) {
      // the same JSX element only, i.e. up to its closing angle bracket
      const element = text.slice(m.index, m.index + 600).split('>')[0] ?? '';
      if (/\b(width|height)\s*:/.test(element)) {
        hits.push(`${file.slice(SRC.length + 1)}:${text.slice(0, m.index).split('\n').length}`);
      }
    }
  }
  return hits.sort();
}

/**
 * Every class this tree ever puts on a `.ze-modal` element, so a rule written
 * `.ze-foo-dialog` is scanned as well as one written `.ze-modal.ze-foo-dialog`.
 *
 * That distinction hid NINE dialogs from this census - update-pcb, pns,
 * message, teardrops, tvp, zone, fpprops, padprops and graphic - every one of
 * them applied as `className="ze-modal ze-x-dialog"` and every one of them
 * styled with a bare `.ze-x-dialog { width: … }`. The count read 4 while the
 * real pile was 13, which is a ratchet that was not ratcheting.
 */
let modalVariantsCache: Set<string> | undefined;

function modalVariants(): Set<string> {
  // Memoised: this walks every .tsx in the tree, and `cssSized()` asks for it
  // once per CSS rule. Called fresh each time it took 26 s and timed out - the
  // same shape as the flex-direction guard, which had the same bug.
  if (modalVariantsCache) return modalVariantsCache;
  const out = new Set<string>();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const names = (m[1] ?? m[2] ?? '').split(/[\s${}]+/).filter((c) => c && !c.startsWith('$'));
      if (!names.includes('ze-modal')) continue;
      for (const c of names) if (c !== 'ze-modal') out.add(c);
    }
  }
  modalVariantsCache = out;
  return out;
}

/** Every rule in shell.css naming a width or height on a modal or a variant. */
function cssSized(): string[] {
  const css = readFileSync(SHELL, 'utf8');
  const variants = modalVariants();
  const hits: string[] = [];
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? '').trim().split('\n').pop()?.trim() ?? '';
    const first = selector.split(',')[0]?.trim() ?? '';
    // the modal element itself, not something inside it
    // `.ze-modal` or `.ze-modal.<variant>` — the modal element itself. NOT
    // `.ze-modal-header` / `.ze-modal-body`, which are hyphenated siblings
    // inside it and have their own heights for their own reasons.
    // `.ze-modal`, `.ze-modal.<variant>`, or a bare `.<variant>` that the tree
    // puts on a modal element.
    const isModalSelector =
      /(^|\s)\.ze-modal(\.[\w-]+)*$/.test(first) ||
      (/^\.[\w-]+$/.test(first) && variants.has(first.slice(1)));
    if (!isModalSelector) continue;
    if (first === '.ze-modal') continue; // the default, checked separately
    if (/(^|[^-])(width|height)\s*:\s*[0-9]/.test(m[2] ?? '')) hits.push(first);
  }
  return hits.sort();
}

describe('the dialog default is Fit(), not a number', () => {
  it('.ze-modal declares no pixel width or height', () => {
    const css = readFileSync(SHELL, 'utf8');
    const rule = css.match(/\n\.ze-modal \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).not.toBe('');
    const pixels = rule
      .split(';')
      .map((l) => l.trim())
      .filter((l) => /^(width|height)\s*:\s*[0-9]/.test(l));
    expect(pixels).toStrictEqual([]);
  });

  it('.ze-modal sizes to its content in both axes, which is what Fit() does', () => {
    const css = readFileSync(SHELL, 'utf8');
    const rule = css.match(/\n\.ze-modal \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/width:\s*max-content/);
    expect(rule).toMatch(/height:\s*max-content/);
  });
});

describe('the pile of hand-picked dialog sizes does not grow', () => {
  /*
   * Counted from the tree, per occurrence rather than per file, so removing one
   * moves this number and a new one cannot hide behind an old one in the same
   * file. Lower it in the same commit that removes a size; the two lists are
   * printed on failure so the diff is obvious.
   */
  // 32 until GerbView's bespoke DCode table went: "List DCodes" is a stock
  // wxSingleChoiceDialog upstream (`gerbview/tools/gerbview_inspection_tool.cpp:145`),
  // and the shared dialog that replaced it names no size of its own.
  // 31 until the Design Inspector pass. DIALOG_INSPECTOR is wxSize( -1, -1 )
  // with `bSizerMain->Fit( this )` and AutoSizeColumn'd columns
  // (dialog_design_inspector_base.cpp:12, design_inspector.cpp:295-313), so its
  // `width: 720` was a number upstream does not have — it measured 180px wider
  // than a live pl_editor's. One call site fewer.
  // 30 until the two copies of DIALOG_PAGES_SETTINGS became one. The head of
  // this file already named that dialog as the proof the pile is wrong — the
  // SAME upstream class was 760 px in the schematic's copy and 560 px in the
  // drawing sheet's — and the 760 was the survivor of the two. It is gone: the
  // merged component states no size, exactly as `bMainSizer->Fit( this )` and
  // `GetSizer()->SetSizeHints( this )` leave it (dialog_page_settings_base.cpp:
  // 403-405, dialog_page_settings.cpp:192).
  it('1 call site still names its own size', () => {
    // 29 -> 1. The same sweep as the shell.css block below, at the call sites:
    // twenty-five files stated a width or a height inline on a `.ze-modal`,
    // and several also restated the `max-width` / `max-height` caps that
    // `.ze-modal` already carries centrally — which is the duplication, not
    // just the number.
    //
    // Two were real and were NOT removed. `dialog_assign_footprints` takes its
    // size from `FRAME_SIZE`, which is `EDA_BASE_FRAME::defaultSize`'s
    // `FromDIP( wxSize( 1280, 720 ) )` for a cvpcb frame — a cited constant,
    // not a pick, and `cvpcb_window_metrics` catches its loss. And PAGED_DIALOG
    // states a RANGE upstream (paged_dialog.cpp:427-443): floored at 600 x 500,
    // capped at 1500 x 900. That moved out of the call site into
    // `.ze-modal.ze-paged-dialog`, where the ceiling — which we did not have at
    // all — now sits beside the floor.
    expect(inlineSized()).toHaveLength(1);
  });

  it('13 shell.css variants still name their own size', () => {
    // 15 until `.ze-pgs` stopped restating what `.ze-modal` now gets right, and
    // 14 until Open Project became the shared file chooser: `.ze-open-project`
    // named a 920x620 and the window that replaced it is sized by the chooser,
    // not by the dialog. Lowered here rather than on either branch, because
    // neither tree had both changes in it.
    //
    // Back to 14 with `.ze-htmlmsg`, HTML_MESSAGE_BOX. This one is allowed to
    // name a size because upstream's names it too, in the wxFormBuilder base it
    // derives from — `bMainSizer->SetMinSize( wxSize( 540, 240 ) )`
    // (`common/dialogs/dialog_display_html_text_base.cpp:19`) — so the number
    // is KiCad's rather than a pick of ours. That is the bar for adding to this
    // list, and the reason the list is a ratchet and not a ban.
    // Down to 12, in two steps that landed separately.
    //
    // 14 -> 13 was already true at HEAD before this change: an earlier pass on
    // the field dialog removed a size and did not lower the number here. That
    // is the failure mode this ratchet warns about in its own header — a
    // ceiling nobody is under — so it is being recorded rather than quietly
    // absorbed into the next edit.
    //
    // 13 -> 12: `.ze-text-props` named a 560 px width that appears nowhere
    // upstream. `dialog_text_properties_base.cpp:20` is
    // `SetSizeHints( wxDefaultSize, wxDefaultSize )` and its main sizer ends
    // `Fit( this )`, so the dialog is as wide as its content — whose floor is
    // the text control's own `SetMinSize( wxSize( 500, 140 ) )` (:71). The 560
    // was below what the content needed, so the body scrolled sideways instead
    // of the dialog growing. That is the bar named above, inverted: a size may
    // stay only when upstream names one too.
    // 12 -> 4, a sweep of every dialog rather than one at a time. Eight rules
    // stated a size no one upstream wrote, and each is now either gone or
    // reduced to the MINIMUM its base file really states:
    //
    //   .ze-template-dialog   dead - no component carries the class
    //   .ze-props-dialog      SetSizeHints( wxDefaultSize, wxDefaultSize )
    //   .ze-label-props       the same
    //   .ze-fields-table      SetSizeHints( wxSize( -1,-1 ), ... )
    //   .ze-newprjfolder      no size named anywhere
    //   .ze-select-columns    the same
    //   .ze-hotkeys           kept min 600x400 (dialog_hotkey_list.cpp:79),
    //                         dropped a 1000x560 derived from column totals
    //   .ze-tplsel            kept min 500x400 (base.cpp:14), dropped a
    //                         652x440 that was that minimum with our border
    //                         and an extra row added back by hand
    //
    // A minimum a base file states is not a picked size, which is why the two
    // above survive as `min-*`. What remains is the four that cite a real
    // number: HTML_MESSAGE_BOX, the message dialog, the symbol chooser's saved
    // default, and the library viewer, which is a FRAME and not a dialog.
    //
    // 4 -> 5: `.ze-fpchooser-frame`, FOOTPRINT_CHOOSER_FRAME. It clears the bar
    // named above - the number is KiCad's, not a pick of ours. The frame itself
    // states no size; its PANEL does, and only when the saved config holds
    // nothing usable (panel_footprint_chooser.cpp:257-272):
    //
    //     auto horizPixelsFromDU = [&]( int x ) { wxSize sz( x, 0 );
    //                                return ConvertDialogToPixels( sz ).x; };
    //     int w = cfg.width  > 40 ? FromDIP( cfg.width )  : horizPixelsFromDU( 440 );
    //     int h = cfg.height > 40 ? FromDIP( cfg.height ) : horizPixelsFromDU( 340 );
    //
    // Note `.x` twice: the HORIZONTAL conversion is used for both axes, so both
    // go through `du * charWidth / 4`. `qa/probes/swatch_probe.cpp` measures
    // GetCharWidth() = 8 on this machine, so the factor is 2 and the default is
    // 880 x 680 - derived from the source through a measurement, not sampled
    // off a screenshot and not borrowed from the symbol chooser, whose
    // identical 880 x 680 comes from a different default entirely.
    //
    // This entry is what the ratchet is FOR: it went up deliberately, in the
    // commit that added the rule, with the citation beside it.
    // 5 -> 13, and NOT because anything was added: the scan was blind.
    //
    // It only matched selectors written `.ze-modal` or `.ze-modal.<variant>`,
    // and nine dialogs style themselves with a BARE `.ze-x-dialog { width: … }`
    // while rendering `className="ze-modal ze-x-dialog"`. So update-pcb, pns,
    // message, teardrops, tvp, zone, fpprops, padprops and graphic each named a
    // width that this census reported as 4. A ratchet that was not ratcheting.
    //
    // `modalVariants()` now reads the class names the tree actually puts on a
    // modal, so a bare variant is scanned too. One of the nine is already gone
    // - `.ze-update-pcb-dialog`'s 700px, which `dialog_update_pcb_base.cpp:16`
    // and `:107` contradict: `SetSizeHints( wxSize( -1,-1 ), … )` then
    // `bMainSizer->Fit( this )`, so the dialog is as wide as its longest
    // checkbox label. 9 - 1 = 8 remain, plus the 5 already counted.
    //
    // The eight are the sweep still to do, each to be checked against its own
    // base file the way this one was.
    expect(cssSized()).toHaveLength(13);
  });

  it('and every one of them is a dialog, so the scan is really finding them', () => {
    // A hit is either an inline site (`path.tsx:line`), a `.ze-modal…`
    // selector, or a bare variant class the tree puts on a modal - which is
    // what the widened scan added and what this check has to allow, or it
    // rejects the very rules it was extended to find.
    const variants = modalVariants();
    for (const where of [...inlineSized(), ...cssSized()]) {
      const ok =
        /ze-modal|\.tsx:\d+/.test(where) ||
        (/^\.[\w-]+$/.test(where) && variants.has(where.slice(1)));
      expect(ok, `${where} is neither a call site nor a modal selector`).toBe(true);
    }
    expect(inlineSized().length + cssSized().length).toBeGreaterThan(0);
  });
});
