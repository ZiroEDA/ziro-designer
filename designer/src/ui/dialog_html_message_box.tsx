// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `HTML_MESSAGE_BOX` (`common/dialogs/html_message_box.cpp`) — the box KiCad
 * puts up when a batch of work has things to say afterwards. GerbView's file
 * loader is one of many callers:
 *
 *     HTML_MESSAGE_BOX mbox( this, _( "Errors" ) );
 *     mbox.ListSet( reporter.GetMessages() );
 *     mbox.ShowModal();                              gerbview/files.cpp:417-420
 *
 * `ListSet` is the whole of the layout — a `<ul>` with one `<li>` per message
 * (`html_message_box.cpp:138-152`) — and the messages arrive carrying their own
 * `<b>` and `<i>`, which is where the bold heading and italic filename in a
 * live Errors box come from. So this renders a list and lets each message's
 * own markup through; it does not decide either.
 *
 * Shared rather than GerbView-local because upstream's is in `common/` and has
 * dozens of callers.
 */

import { useEffect, useRef, type JSX } from 'react';
import { useModalEscape } from './useModalEscape.js';

/**
 * One message's markup, as `<li>` content.
 *
 * The only tags upstream's callers emit are `<b>`, `<i>` and `<br>`, so those
 * three are rendered and anything else is shown as text. That is deliberate:
 * a message can carry a filename a person chose, and handing arbitrary markup
 * to a renderer because it arrived in an error string is how a filename
 * becomes an injection.
 */
export function htmlMessageParts(message: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  const re = /<(b|i)>([\s\S]*?)<\/\1>|<br\s*\/?>/gi;
  let last = 0;
  let m: RegExpExecArray | null = re.exec(message);
  let key = 0;
  const text = (s: string): void => {
    if (s !== '') out.push(<span key={key++}>{s}</span>);
  };
  while (m !== null) {
    text(message.slice(last, m.index));
    if (m[1] === undefined) out.push(<br key={key++} />);
    else if (m[1].toLowerCase() === 'b') out.push(<b key={key++}>{m[2]}</b>);
    else out.push(<i key={key++}>{m[2]}</i>);
    last = m.index + m[0].length;
    m = re.exec(message);
  }
  text(message.slice(last));
  return out;
}

export function HtmlMessageBox({
  caption,
  messages,
  onClose,
}: {
  /** The dialog title — `_( "Errors" )` for the file loader. */
  caption: string;
  /** `reporter.GetMessages()`, one per `<li>`. */
  messages: readonly string[];
  onClose: () => void;
}): JSX.Element {
  useModalEscape(onClose);

  // wxID_OK is the only button and has the focus, so Enter closes.
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    okRef.current?.focus();
  }, []);

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-htmlmsg" role="dialog" aria-modal="true">
        <div className="ze-modal-header">{caption}</div>
        <div className="ze-htmlmsg-body">
          <ul>
            {messages.map((msg, i) => (
              // The messages are a report in order, and two files can fail the
              // same way with the same text, so the index is the identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: report order IS the identity
              <li key={i}>{htmlMessageParts(msg)}</li>
            ))}
          </ul>
        </div>
        <div className="ze-msgdlg-buttons">
          <button ref={okRef} type="button" className="ze-btn default" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
