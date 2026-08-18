// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_TEMPLATE_SELECTOR (kicad/dialogs/dialog_template_selector.cpp and
 * dialog_template_selector_base.cpp), ported.
 *
 * KICAD_MANAGER_CONTROL::NewProject runs this and *then* a wxFileDialog titled
 * "New Project Folder" for the name; both are below.
 *
 * The layout is bmainSizer over m_sizerButtons:
 *
 *   m_panelMRU (min width 220) - "Recent project templates" over m_scrolledMRU
 *   m_splitter (sash 300, gravity 0.35, minimum pane 200)
 *     m_panelTemplates - m_searchCtrl, m_filterChoice, the Browse row, and
 *                        m_scrolledTemplates
 *     m_panelPreview   - a webview, created Hidden and only split in on demand
 *   m_sizerButtons - m_btnBack, a stretch, then the OK/Cancel pair
 *
 * and the whole thing turns on a three-state machine, which is the part that
 * makes it behave like the real dialog rather than a list with a description
 * beside it:
 *
 *   Initial        MRU shown,  Go Back disabled, preview unsplit
 *   Preview        MRU HIDDEN, Go Back enabled,  preview split in
 *   MRUWithPreview MRU shown,  Go Back enabled,  preview split in
 *
 * Single-clicking a card runs TEMPLATE_WIDGET::Select -> SetWidget ->
 * SetState( Preview ), so the recents column gives way to the preview.
 * Go Back clears the selection, returns to Initial and shows the welcome page.
 * Double-click selects and closes with wxID_OK.
 *
 * Left out: master's "Browse..." / "Clear" row, which points the list at an
 * arbitrary directory through wxDirDialog, and the wxFileSystemWatcher behind
 * it that re-scans on a 500ms debounce. Neither is in the 10.0 that ships
 * today, and both need a filesystem we do not have.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { sanitizeProjectName } from '../new_project.js';
import type { TemplateMeta } from '../templates.js';
// SetTemplate's fallback when the template has no meta/icon.png:
//   bundle = KiBitmapBundleDef( BITMAPS::icon_kicad, c_bitmapSizes[0] );  // 48
// `default` and STM32H7_DevEBox ship without one, so they wear this.
import kicadIcon from '../../assets/icon_kicad.png';
import { styleTemplatePreview } from './template_preview_styles.js';
import {
  FILTERS,
  PROJECT_FILE_EXT,
  SEARCH_DEBOUNCE_MS,
  projectNameFrom,
  applyFilter,
  sortTemplates,
  truncateDescription,
} from './template_selector.js';
import { useModalEscape } from '../../ui/useModalEscape.js';

export type { TemplateCategory } from './template_selector.js';
export { applyFilter, sortTemplates, truncateDescription } from './template_selector.js';

/** DIALOG_TEMPLATE_SELECTOR::DialogState. */
type DialogState = 'initial' | 'preview' | 'mruWithPreview';

export function TemplateSelectorDialog({
  templates,
  recentTemplates,
  takenNames,
  onCancel,
  onOk,
  onOpenTemplate,
  onDuplicate,
  onDelete,
}: {
  templates: readonly TemplateMeta[];
  /** settings->m_RecentTemplates, newest first. */
  recentTemplates?: readonly string[];
  /** Existing project names, lowercased, so a clash can be caught before Create. */
  takenNames?: ReadonlySet<string>;
  onCancel: () => void;
  /** wxID_OK. `null` when nothing is selected, which upstream allows and the
   *  caller answers with "No project template was selected." */
  onOk: (template: TemplateMeta | null, projectName: string) => void;
  /** wxID_APPLY: onEditTemplate loaded a project instead of creating one. */
  onOpenTemplate?: (template: TemplateMeta) => void;
  /** onDuplicateTemplate, once the new name has been accepted. */
  onDuplicate?: (template: TemplateMeta, newId: string) => Promise<void>;
  /** Removing a stored template; upstream leaves this to the file manager. */
  onDelete?: (template: TemplateMeta) => Promise<void>;
}): JSX.Element {
  // m_filterChoice's selection is persisted as m_TemplateFilterChoice.
  const [filterChoice, setFilterChoice] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('ziro.templateFilterChoice'));
      if (Number.isInteger(saved) && saved >= 0 && saved < FILTERS.length) return saved;
    } catch {
      /* storage blocked */
    }
    return 0;
  });
  const [searchText, setSearchText] = useState('');
  // OnSearchCtrl only restarts a 200ms timer; OnSearchTimer is what filters.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [state, setState] = useState<DialogState>('initial');
  const [selected, setSelected] = useState<TemplateMeta | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** TEMPLATE_WIDGET::onRightClick's wxMenu, which it PopupMenu()s at the cursor. */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; template: TemplateMeta } | null>(
    null,
  );

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts. The context menu takes it first, because a popped-up
  // wxMenu grabs the keyboard and the dialog never sees the key - the same
  // rule the onKeyDown below implemented, now applied wherever focus is rather
  // than only inside the frame.
  useModalEscape(() => {
    if (ctxMenu) setCtxMenu(null);
    else onCancel();
  });
  /**
   * The project name, which upstream asks for in a second window - a
   * wxFileDialog titled "New Project Folder". That dialog is a filesystem
   * browser: a folder tree, a shortcut to the default projects path, and a
   * "Create a new folder for the project" checkbox. None of it means anything
   * against an account, so replacing it with a lone text box left a second
   * window carrying one field. The field lives in this dialog's button row
   * instead, and OK does what OK plus that dialog used to.
   */
  const [projectName, setProjectName] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  /** onDuplicateTemplate's wxTextEntryDialog, defaulted to `<name>_copy`. */
  const [dupFor, setDupFor] = useState<TemplateMeta | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchText), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchText]);

  /**
   * settings->m_TemplateWindowSize, read into the constructor and written back
   * once the dialog is done - not while it is being dragged:
   *
   *     result = ps.ShowModal();
   *     templateWindowSize = ps.GetSize();
   *     ...
   *     settings->m_TemplateWindowSize = templateWindowSize;
   *
   * So the restore happens on mount and the store on unmount, which is what
   * ShowModal returning means here. Its default is wxDefaultSize, which is why
   * a fresh profile opens at the sizer's best fit rather than a stored number.
   * m_TemplateWindowPos is kept alongside it upstream; a modal here is centred
   * by the backdrop, so there is no position to keep.
   */
  const frameRef = useRef<HTMLDivElement>(null);
  const size = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    try {
      const saved = localStorage.getItem('ziro.templateWindowSize');
      if (saved) {
        const { w, h } = JSON.parse(saved) as { w: number; h: number };
        // Clamped to SetSizeHints' floor so a stale or hand-edited value cannot
        // open the dialog smaller than upstream allows - 400 plus the 39px the
        // project-name row adds, which is why this is not upstream's number.
        if (Number.isFinite(w) && Number.isFinite(h) && w >= 500 && h >= 439) {
          el.style.width = `${w}px`;
          el.style.height = `${h}px`;
        }
      }
    } catch {
      /* storage blocked or corrupt: open at the default size */
    }
    // The size has to be sampled while the element is still in the document:
    // by the time the cleanup runs React has already detached it, and reading
    // offsetWidth then yields 0. A resize drag ends in a mouseup, so that is
    // when the current size is worth recording.
    const onMouseUp = (): void => {
      if (el.offsetWidth > 0) size.current = { w: el.offsetWidth, h: el.offsetHeight };
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      const s = size.current;
      if (!s) return;
      try {
        localStorage.setItem('ziro.templateWindowSize', JSON.stringify(s));
      } catch {
        /* storage blocked: the resize still works for this session */
      }
    };
  }, []);

  const sorted = useMemo(() => sortTemplates(templates), [templates]);
  const shown = useMemo(
    () => applyFilter(sorted, filterChoice, debouncedSearch),
    [sorted, filterChoice, debouncedSearch],
  );

  // BuildMRUList skips recents whose directory no longer exists; ours skips ids
  // that are no longer in the manifest, which is the same check.
  const mru = useMemo(
    () =>
      (recentTemplates ?? [])
        .map((id) => templates.find((t) => t.id === id))
        .filter((t): t is TemplateMeta => !!t),
    [recentTemplates, templates],
  );

  // The constructor auto-selects the most recent template with
  // aKeepMRUVisible = true, which selects without entering Preview.
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current || mru.length === 0) return;
    autoSelected.current = true;
    setSelected(mru[0]!);
  }, [mru]);

  /**
   * TEMPLATE_WIDGET::Select -> DIALOG::SetWidget -> SetState( Preview ).
   *
   * The name follows the template until the user types over it, the way the
   * file dialog opened on the template's own name.
   */
  const nameEdited = useRef(false);
  const selectWidget = (t: TemplateMeta): void => {
    setSelected(t);
    setState('preview');
    if (!nameEdited.current) setProjectName(t.id);
  };

  /** SelectTemplateByPath( path, true ): select, keep the MRU, no preview. */
  const selectKeepingMru = (t: TemplateMeta): void => {
    setSelected(t);
    if (!nameEdited.current) setProjectName(t.id);
  };

  const cleanName = sanitizeProjectName(projectNameFrom(projectName));
  const nameTaken = cleanName !== '' && !!takenNames?.has(cleanName.toLowerCase());
  const canCreate = !!selected && cleanName !== '' && !nameTaken;

  /**
   * OnDoubleClick: `m_dialog->EndModal( wxID_OK )`.
   *
   * Upstream could close on the double click alone because the name was still
   * to come, in the file dialog after it. The name is on this window now, so a
   * double click on a template whose name is not usable yet selects it and
   * leaves the name field to be dealt with, rather than closing on a name that
   * would be refused.
   */
  const confirmWith = (t: TemplateMeta): void => {
    const name = sanitizeProjectName(projectNameFrom(nameEdited.current ? projectName : t.id));
    if (name === '' || takenNames?.has(name.toLowerCase())) {
      selectWidget(t);
      return;
    }
    onOk(t, name);
  };

  /** OnBackClicked. */
  const goBack = (): void => {
    setSelected(null);
    setState('initial');
  };

  const mruVisible = state !== 'preview';
  const previewVisible = state !== 'initial';

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div ref={frameRef} className="ze-modal ze-tplsel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Project Template Selector
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-tplsel-body">
          {mruVisible && (
            <div className="ze-tplsel-mru">
              <div className="ze-tplsel-mru-head">Recent project templates</div>
              <div className="ze-tplsel-mru-list">
                {mru.map((t) => (
                  <div
                    key={t.id}
                    className={`ze-tplsel-mru-row${selected?.id === t.id ? ' active' : ''}`}
                    // TEMPLATE_MRU_WIDGET::OnClick selects without showing the
                    // preview; OnDoubleClick selects and closes with wxID_OK.
                    onClick={() => selectKeepingMru(t)}
                    onDoubleClick={() => confirmWith(t)}
                  >
                    <img src={t.icon ?? kicadIcon} alt="" />
                    <span className="nm">{t.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* m_splitter: m_panelTemplates always, m_panelPreview only once split. */}
          <div className="ze-tplsel-splitter">
            <div className="ze-tplsel-templates">
              {/* wxSearchCtrl with both affordances turned on in the ctor:
                    m_searchCtrl->ShowSearchButton( true );
                    m_searchCtrl->ShowCancelButton( true );
                  so the magnifier sits inside the field and the cancel button
                  appears with the text. OnSearchCtrlCancel clears it. */}
              <div className="ze-tplsel-searchwrap">
                <span className="mag" aria-hidden="true" />
                <input
                  className="ze-tplsel-search ze-bare"
                  type="text"
                  placeholder="Search"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
                {searchText !== '' && (
                  <span
                    className="cancel"
                    title="Clear the search"
                    onClick={() => setSearchText('')}
                  />
                )}
              </div>
              <select
                className="ze-tplsel-filter"
                value={filterChoice}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setFilterChoice(next);
                  try {
                    localStorage.setItem('ziro.templateFilterChoice', String(next));
                  } catch {
                    /* storage blocked; the choice just won't persist */
                  }
                }}
              >
                {FILTERS.map((f, i) => (
                  <option key={f} value={i}>
                    {f}
                  </option>
                ))}
              </select>

              {/* bSizerBrowse - "Browse..." / "Clear" / the browsed-path label -
                  is in KiCad master but not in the 10.0 that ships today:
                  measuring a real 10.0 dialog, the gap between the filter's
                  bottom edge and the template list's top is 10px, which is
                  exactly the two sizers' 5px borders with no row between them.
                  It would also be dead here, since pointing the list at another
                  directory needs wxDirDialog and a filesystem to scan. */}

              <div className="ze-tplsel-list" ref={listRef}>
                {shown.map((t) => (
                  <div
                    key={t.id}
                    className={`ze-tplsel-card${selected?.id === t.id ? ' active' : ''}`}
                    onClick={() => selectWidget(t)}
                    onDoubleClick={() => confirmWith(t)}
                    // onRightClick is bound on the panel and on all three of its
                    // children, so anywhere in the card opens the menu.
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCtxMenu({ x: e.clientX, y: e.clientY, template: t });
                    }}
                  >
                    <img src={t.icon ?? kicadIcon} alt="" />
                    <span className="txt">
                      <span className="name">{t.title}</span>
                      <span className="desc">{truncateDescription(t.description)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {previewVisible && (
              <div className="ze-tplsel-preview">
                {/* LoadTemplatePreview points the WebView at the template's own
                    meta/info.html:
                      wxString url = wxFileName::FileNameToURL( htmlFile );
                      m_webviewPanel->LoadURL( url );
                    That page is the preview - KiCad is not summarising the
                    template, it is showing the author's HTML, images and all.
                    We had been rendering a title, the description and a file
                    list instead, which is why the right-hand pane looked
                    nothing like KiCad's.

                    An iframe is the WEBVIEW_PANEL here. It is sandboxed with no
                    allow-scripts: these pages are vendored KiCad documentation,
                    but they are still third-party HTML being given a frame, and
                    they only need to lay out text and images. */}
                {selected?.html ? (
                  <iframe
                    className="ze-tplsel-html"
                    src={selected.html}
                    title={`${selected.title} template information`}
                    // allow-same-origin, and nothing else. It is what lets us
                    // reach contentDocument to append the stylesheet, the way
                    // OnWebViewLoaded's RunScriptAsync does. Without
                    // allow-scripts the page still cannot execute anything of
                    // its own - no scripts, no forms, no popups, no navigating
                    // the top frame - and these files are our own vendored
                    // copies of KiCad's, served from this origin.
                    sandbox="allow-same-origin"
                    onLoad={(e) => styleTemplatePreview(e.currentTarget)}
                  />
                ) : selected ? (
                  // GetTemplateInfoHtml( title, dark ): the generated stand-in
                  // for a template whose info.html is missing or unreadable.
                  <div className="ze-tplsel-info">
                    <div className="badge">Template</div>
                    <h2>{selected.title}</h2>
                    <p>
                      This template does not include a description. You can still use it to create a
                      new project.
                    </p>
                  </div>
                ) : (
                  <div className="ze-tplsel-info welcome">
                    <h2>Project Templates</h2>
                    <p>Select a template to see what it contains.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* TEMPLATE_WIDGET::onRightClick's menu. Every one of its three actions
            needs a template *directory* on disk that the user can write to:
            onEditTemplate opens the template's own .kicad_pro in place,
            onOpenFolder calls wxLaunchDefaultApplication on the folder, and
            onDuplicateTemplate copies the tree into the user templates path.
            Templates here are read-only assets served over HTTP and there is no
            user templates directory, so the menu is present where KiCad puts it
            with its own labels, and every row is disabled - the same way the
            other host-only actions are carried in their upstream slots.

            The first label follows m_isUserTemplate, which is false for all of
            ours: KiCad shows "Edit Template" only for a user template. */}
        {ctxMenu && (
          <>
            <div className="ze-tplsel-ctxscrim" onMouseDown={() => setCtxMenu(null)} />
            <div
              className="ze-dropdown"
              style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 1000 }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {[
                {
                  // menu.Append( wxID_EDIT, m_isUserTemplate ? _( "Edit Template" )
                  //                                          : _( "Open Template (Read-Only)" ) );
                  label:
                    ctxMenu.template.category === 'user'
                      ? 'Edit Template'
                      : 'Open Template (Read-Only)',
                  run: onOpenTemplate ? () => onOpenTemplate(ctxMenu.template) : undefined,
                  why: undefined as string | undefined,
                },
                // Upstream's second entry, "Open Template Folder", is dropped
                // rather than carried disabled. It is wxLaunchDefaultApplication
                // on the template directory, and there is no version of that a
                // page can ever do - unlike the greyed entries elsewhere in this
                // app, which mark work that is still to come. A row that can
                // never be enabled is just noise in the menu.
                {
                  label: 'Duplicate Template',
                  run: onDuplicate ? () => setDupFor(ctxMenu.template) : undefined,
                  why: undefined,
                },
                ...(ctxMenu.template.source === 'user' && onDelete
                  ? [
                      {
                        // Not an upstream menu entry: there, a template is
                        // removed with the file manager. With no file manager to
                        // send anyone to, deleting has to be reachable from here
                        // or a duplicate is forever.
                        label: 'Delete Template',
                        run: () => void onDelete(ctxMenu.template),
                        why: undefined,
                      },
                    ]
                  : []),
              ].map(({ label, run, why }) => (
                <div
                  key={label}
                  className={`ze-mitem${run ? '' : ' disabled'}`}
                  title={why}
                  onClick={() => {
                    if (!run) return;
                    setCtxMenu(null);
                    run();
                  }}
                >
                  <span className="mico" />
                  <span className="lbl">{label}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* The name row, standing in for the whole "New Project Folder" window.
            A wxFileDialog's job is to choose a directory and a filename; here
            there is no directory, so all that survives is the name - and a
            second window for one field was the wrong shape for it. */}
        <div className="ze-tplsel-name">
          <label htmlFor="ze-tplsel-projname">Project name</label>
          {/* The extension is a label beside the entry, not text inside it, so
              there is nothing to select or backspace over - the same guarantee
              wxFileDialog gets from its wildcard, where SetExt forces
              FILEEXT::ProjectFileExtension whatever was typed. It is here at all
              because a bare name box does not say what is being named; with
              ".kicad_pro" fixed to the end of it, it plainly does. */}
          {/* The box is wider than the filename inside it, so a click on the
              empty part - or on the extension - has to land in the entry, the
              way clicking anywhere in a rename field does. */}
          {/* Naming comes second. There is nothing to name until a template is
              picked - the name defaults from the template and the files created
              are the template's - so the field is dead until then and says why,
              rather than accepting a name that the next click would overwrite. */}
          <div
            className={`ze-tplsel-namewrap${nameTaken ? ' bad' : ''}${selected ? '' : ' disabled'}`}
            onMouseDown={(e) => {
              if (!selected) return;
              if (e.target === e.currentTarget || (e.target as HTMLElement).className === 'ext') {
                e.preventDefault();
                nameRef.current?.focus();
              }
            }}
          >
            <input
              ref={nameRef}
              id="ze-tplsel-projname"
              className="ze-tplsel-nameinput ze-bare"
              value={projectName}
              disabled={!selected}
              placeholder={selected ? selected.id : 'Select a template first'}
              onChange={(e) => {
                nameEdited.current = true;
                setProjectName(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCreate) onOk(selected, cleanName);
              }}
            />
            <span className="ext" aria-hidden="true">
              {PROJECT_FILE_EXT}
            </span>
          </div>
          {nameTaken && <span className="err">A project named “{cleanName}” already exists.</span>}
        </div>

        <div className="ze-modal-footer" style={{ justifyContent: 'space-between' }}>
          <button className="ze-btn" disabled={state === 'initial'} onClick={goBack}>
            Go Back
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ze-btn" onClick={onCancel}>
              Cancel
            </button>
            {/* A plain wxButton, not a highlighted one. m_sdbSizerOK->SetDefault()
                only makes it the *default* button, which GTK does not colour -
                measured on a real dialog, OK and Cancel are the same grey. Ours
                was .primary, so it wore an orange ring the whole time.

                Upstream leaves OK always enabled because the checks it needs -
                a template, a name, a name that is free - all live in the file
                dialog and the message boxes after it. Those checks are on this
                window now, so the button carries them. */}
            <button
              className="ze-btn"
              disabled={!canCreate}
              onClick={() => onOk(selected, cleanName)}
            >
              OK
            </button>
          </div>
        </div>

        {dupFor && (
          <DuplicateTemplateDialog
            source={dupFor}
            taken={new Set(templates.map((t) => t.id.toLowerCase()))}
            onCancel={() => setDupFor(null)}
            onConfirm={async (newId) => {
              setDupFor(null);
              await onDuplicate?.(dupFor, newId);
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * onDuplicateTemplate's name prompt.
 *
 *     wxTextEntryDialog nameDlg( m_dialog, _( "Enter name for the new template:" ),
 *                                _( "Duplicate Template" ), srcTemplateName + _( "_copy" ) );
 *
 * Upstream refuses an empty name with "Template name cannot be empty."; a name
 * already in the list is refused here too, because two templates sharing a
 * directory name is exactly what a filesystem would have prevented.
 */
export function DuplicateTemplateDialog({
  source,
  taken,
  onCancel,
  onConfirm,
}: {
  source: TemplateMeta;
  taken: ReadonlySet<string>;
  onCancel: () => void;
  onConfirm: (newId: string) => void;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [name, setName] = useState(`${source.id}_copy`);
  const clean = sanitizeProjectName(name);
  const clash = clean !== '' && taken.has(clean.toLowerCase());
  const ok = clean !== '' && !clash;
  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-newprjfolder" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Duplicate Template
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body ze-newprjfolder-body">
          <label>
            <span>Enter name for the new template:</span>
            <input
              className="ze-search"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ok) onConfirm(clean);
              }}
            />
          </label>
          {clash && (
            <div className="ze-tplsel-nameerr">A template named “{clean}” already exists.</div>
          )}
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn" disabled={!ok} onClick={() => onConfirm(clean)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
