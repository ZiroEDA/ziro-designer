// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A message about the GitHub connection that ends in a link to GitHub - "Change repository access
 * on GitHub", "Install on GitHub" - which a message box cannot carry: wxRichMessageDialog has no
 * hyperlink, so where KiCad needs one it builds a small dialog with a wxHyperlinkCtrl, and so does
 * this.
 *
 * Two shapes: a notice (OK, and the link opens GitHub in a new tab), and a question whose
 * affirmative button is itself the step to take (`action`) - the click that opens GitHub's window,
 * which a browser lets through only from the gesture itself.
 */
import type { JSX } from 'react';
import { HyperlinkCtrl, StaticText } from '@ziroeda/wx/controls.js';
import { BoxSizer, SizerItem } from '@ziroeda/wx/sizer.js';
import { wxALL, wxLEFT, wxRIGHT, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { _ } from '@ziroeda/wx/translation.js';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';

/** Wrapped as a message box wraps its text, so a paragraph does not make a wide dialog (ours). */
const WRAP = 440;

/** Open a GitHub page in a tab of its own, with no way back into this one. */
export function openGithubPage(aUrl: string): void {
  window.open(aUrl, '_blank', 'noopener,noreferrer');
}

export function DialogGithubNotice({
  caption,
  message,
  detail,
  link,
  action,
  onClose,
}: {
  caption: string;
  message: string;
  /** A second paragraph, as `SetExtendedMessage` adds one. */
  detail?: string;
  /** The link under the text: its words, and the page it opens. */
  link?: { label: string; url: string };
  /** A question rather than a notice: the affirmative button's label and what it does. */
  action?: { label: string; run: () => void };
  onClose: () => void;
}): JSX.Element {
  return (
    <DialogShim title={caption} onClose={onClose}>
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALL} border={10}>
          <StaticText wrap={WRAP} label={message} />
        </SizerItem>
        {detail && (
          <SizerItem flag={wxLEFT | wxRIGHT} border={10}>
            <StaticText wrap={WRAP} label={detail} />
          </SizerItem>
        )}
        {link && (
          <SizerItem flag={wxALL} border={10}>
            <HyperlinkCtrl label={link.label} onClick={() => openGithubPage(link.url)} />
          </SizerItem>
        )}
      </BoxSizer>
      {action ? (
        <StdDialogButtons
          okLabel={action.label}
          onCancel={onClose}
          onOk={() => {
            action.run();
            onClose();
          }}
        />
      ) : (
        <StdDialogButtons okLabel={_('OK')} onOk={onClose} />
      )}
    </DialogShim>
  );
}
