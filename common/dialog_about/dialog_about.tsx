// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_ABOUT` (`common/dialog_about/dialog_about.cpp`, `.h`) with
 * `DIALOG_ABOUT_BASE` (`dialog_about_base.cpp`, `.h`) folded in, as every
 * dialog here folds its wxFormBuilder base. `dialog_about_base.fbp` is the
 * FormBuilder project file and has no counterpart.
 *
 * The sizer tree is `dialog_about_base.cpp`'s, and `.ze-about*` in shell.css
 * states each border beside the `Add()` it comes from. The measurements are
 * `qa/probes/dialog_about_probe.cpp`, which builds the same tree with
 * wxWidgets.
 *
 * Divergences, each for a stated reason:
 *
 *   - No Donate button. `m_btDonate` runs `common.SuiteControl.donate`, which
 *     asks for money for KiCad; the Help menu already leaves that action out
 *     for the same reason (eda_base_frame_help_menu.ts), and a button here would
 *     be the one place it came back.
 *   - The contributor pages open with one line saying they are KiCad's credits.
 *     Without it, "Lead Development Team" would read as this program's team.
 *   - `OnNotebookPageChanged` is a wxMac repaint workaround and has nothing to
 *     do here.
 */
import { type JSX, useEffect, useRef, useState } from 'react';
import { svgUrl } from '@ziroeda/bitmaps_png';
import { GetVersionInfoData } from '../build_version.js';
import { PRODUCT, aboutWindowTitle } from '../eda_base_frame_about_titles.js';
import { MessageDialogOk } from '../dialogs/dialog_message.js';
import { useModalEscape } from '../dialogs/use_modal_escape.js';
import { HtmlWindow } from '../widgets/html_window.js';
import type { ABOUT_APP_INFO, CONTRIBUTORS } from './aboutinfo.js';

/** `enum class IMAGES`, in the order the constructor fills the image list. */
export const IMAGES = {
  INFORMATION: 'info',
  VERSION: 'recent',
  DEVELOPERS: 'preference',
  DOCWRITERS: 'editor',
  LIBRARIANS: 'library',
  ARTISTS: 'color_materials',
  TRANSLATORS: 'language',
  PACKAGERS: 'zip',
  LICENSE: 'tools',
} as const;

type Icon = (typeof IMAGES)[keyof typeof IMAGES];

interface NotebookPage {
  caption: string;
  icon: Icon;
  html: string;
  /** `aSelection`: false is `wxHW_NO_SELECTION`, not the selected tab. */
  selectable: boolean;
}

/** Ours: whose credits the contributor pages list. See this file's header. */
const CREDITS_NOTE =
  '<p><i>From the credits of KiCad 10.0.5, on which this program is built.</i></p>';

/**
 * `createNotebookPageByCategory`: one bold, underlined heading per category, in
 * the order each category first appears, with that category's people listed
 * under it; a contributor with a URL becomes a link.
 */
export function contributorsHtml(aContributors: CONTRIBUTORS): string {
  let html = '';
  for (const contributor of aContributors) {
    const category = contributor.GetCategory();

    // to construct the next row we expect to have a category and a contributor
    // that was not considered up to now
    if (category === '' || contributor.IsChecked()) continue;

    html += `<p><b><u>${category}:</u></b><ul>`;

    // Now, all contributors of the same category will follow
    for (const sub of aContributors) {
      if (sub.GetCategory() !== category) continue;
      html +=
        sub.GetUrl() === ''
          ? `<li>${sub.GetName()}</li>`
          : `<li><a href='${sub.GetUrl()}'>${sub.GetName()}</a></li>`;
      // this contributor was added to the GUI, thus can be ignored next time
      sub.SetChecked(true);
    }

    html += '</ul></p>';
  }
  return html;
}

/** `createNotebooks`: the nine pages, in upstream's order. */
export function createNotebooks(info: ABOUT_APP_INFO, untranslatedTitle: string): NotebookPage[] {
  const byCategory = (caption: string, icon: Icon, c: CONTRIBUTORS): NotebookPage => ({
    caption,
    icon,
    html: CREDITS_NOTE + contributorsHtml(c),
    selectable: true,
  });
  return [
    { caption: 'About', icon: IMAGES.INFORMATION, html: info.GetDescription(), selectable: false },
    {
      caption: 'Version',
      icon: IMAGES.VERSION,
      html: GetVersionInfoData(untranslatedTitle, true),
      selectable: true,
    },
    byCategory('Developers', IMAGES.DEVELOPERS, info.GetDevelopers()),
    byCategory('Doc Writers', IMAGES.DOCWRITERS, info.GetDocWriters()),
    byCategory('Librarians', IMAGES.LIBRARIANS, info.GetLibrarians()),
    byCategory('Artists', IMAGES.ARTISTS, info.GetArtists()),
    byCategory('Translators', IMAGES.TRANSLATORS, info.GetTranslators()),
    byCategory('Packagers', IMAGES.PACKAGERS, info.GetPackagers()),
    { caption: 'License', icon: IMAGES.LICENSE, html: info.GetLicense(), selectable: false },
  ];
}

export function DIALOG_ABOUT({
  info,
  titleName,
  reportBug,
  onClose,
}: {
  info: ABOUT_APP_INFO;
  /**
   * `aParent->GetAboutTitle()`. KiCad keeps a translated and an untranslated
   * copy; we have no translations, so they are one string.
   */
  titleName: string;
  /** `common.SuiteControl.reportBug`, run through the parent's tool manager. */
  reportBug: () => void;
  onClose: () => void;
}): JSX.Element {
  useModalEscape(onClose);

  // Built once per dialog, as the constructor builds them once.
  const [pages] = useState(() => createNotebooks(info, titleName));
  const [page, setPage] = useState(0);
  const [copied, setCopied] = useState(false);
  const [clipboardError, setClipboardError] = useState(false);

  // SetFocus() on the dialog, and `m_btOk->SetDefault()`: Enter is OK.
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    okRef.current?.focus();
  }, []);

  // A GtkNotebook whose tabs overflow shows scroll arrows, and an arrow moves
  // to the previous or next page. The nine tabs are wider than the 750px
  // notebook, so the arrows are there in the real dialog too.
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabsRef.current?.children[page]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [page]);

  const onCopyVersionInfo = (): void => {
    const msg = GetVersionInfoData(titleName);
    if (!navigator.clipboard) {
      setClipboardError(true);
      return;
    }
    navigator.clipboard.writeText(msg).then(
      () => setCopied(true),
      () => setClipboardError(true),
    );
  };

  const appIcon = info.GetAppIcon();

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-about" role="dialog" aria-modal="true">
        <div className="ze-modal-header">
          {aboutWindowTitle(titleName)}
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-about-title">
          <span className="ze-about-spacer" />
          <span className="ze-about-bitmap">{appIcon !== '' && <img src={appIcon} alt="" />}</span>
          <div className="ze-about-apptitle">
            <div className="ze-about-name">{titleName}</div>
            <div className="ze-about-build">Version: {info.GetBuildVersion()}</div>
            <div className="ze-about-lib">{info.GetLibVersion()}</div>
          </div>
          <div className="ze-about-actions">
            <span className="ze-about-spacer" />
            <button
              type="button"
              className="ze-btn"
              title={`Copy ${PRODUCT} version info to the clipboard`}
              onClick={onCopyVersionInfo}
            >
              {copied ? 'Copied...' : 'Copy Version Info'}
            </button>
            <button
              type="button"
              className="ze-btn"
              title={`Report a problem with ${PRODUCT}`}
              onClick={reportBug}
            >
              Report Bug
            </button>
            <span className="ze-about-spacer" />
          </div>
          <span className="ze-about-spacer" />
        </div>
        <div className="ze-nb-frame ze-about-notebook">
          <div className="ze-about-tabstrip">
            <button
              type="button"
              className="ze-about-arrow"
              aria-label="Previous page"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ‹
            </button>
            <div className="ze-nb-tabs ze-about-tabs" role="tablist" ref={tabsRef}>
              {pages.map((p, i) => (
                <button
                  key={p.caption}
                  type="button"
                  role="tab"
                  aria-selected={i === page}
                  className={i === page ? 'active' : undefined}
                  onClick={() => setPage(i)}
                >
                  <img src={svgUrl('toolbar', p.icon)} alt="" />
                  {p.caption}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ze-about-arrow"
              aria-label="Next page"
              disabled={page === pages.length - 1}
              onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))}
            >
              ›
            </button>
          </div>
          <div className="ze-nb-body ze-about-body">
            {pages.map((p, i) => (
              <div
                key={p.caption}
                role="tabpanel"
                className="ze-about-page"
                data-nbhide={i === page ? undefined : ''}
              >
                <HtmlWindow html={p.html} selectable={p.selectable} />
              </div>
            ))}
          </div>
        </div>
        <div className="ze-about-buttons">
          <button ref={okRef} type="button" className="ze-btn default" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
      {clipboardError && (
        <MessageDialogOk
          caption="Clipboard Error"
          message="Could not open clipboard to write version information."
          icon="warning"
          onClose={() => setClipboardError(false)}
        />
      )}
    </div>
  );
}
