// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The page tree a `PAGED_DIALOG` puts down its left side — one component, for
 * every dialog that has one.
 *
 * Upstream it is literally one widget: `PAGED_DIALOG` owns a `wxTreebook`
 * (`common/widgets/paged_dialog.cpp:60-73`), and Preferences, Board Setup and
 * Schematic Setup are all PAGED_DIALOGs. Nobody re-implements the tree, so
 * nobody can have a different one. Ours had two: `PagedDialog`'s, with
 * expanders and collapsible parents, and a second flat one written inside
 * `PreferencesDialog` whose parents were dead headings you could not collapse.
 *
 * A parent row IS a page upstream — `book->AddPage( new wxPanel( book ), _(
 * "Symbol Editor" ) )` (`common/eda_base_frame.cpp`) adds an EMPTY panel — and
 * `PAGED_DIALOG` handles the consequence: selecting an empty page while its
 * node is expanded moves on to the first child (`paged_dialog.cpp:415-420`):
 *
 *     if( currentPage && currentPage->GetChildren().IsEmpty()
 *             && page + 1 < m_treebook->GetPageCount()
 *             && m_treebook->IsNodeExpanded( page ) )
 *         m_treebook->ChangeSelection( ++page );
 *
 * so clicking "Symbol Editor" lands you on "Display Options" rather than on a
 * blank right-hand side. `onSelectParent` is that call; a caller that does not
 * pass one simply toggles.
 *
 * Sections are ordered as the caller gives them. A section with an EMPTY label
 * is the run of top-level pages a treebook starts with — Common, Mouse and
 * Touchpad, Hotkeys — which have no parent to sit under and so draw with no
 * expander and no indent.
 */
import type { JSX } from 'react';

export interface PagedTreePage {
  readonly id: string;
  readonly label: string;
  /** Greyed and unselectable: the engine data is not modelled yet. */
  readonly disabled?: boolean;
}

export interface PagedTreeSection {
  /** The parent row's label; empty means "these have no parent". */
  readonly label: string;
  readonly pages: readonly PagedTreePage[];
}

/** [px] the indent a child row carries under its parent. */
const CHILD_INDENT = 26;

export function PagedDialogTree({
  sections,
  page,
  collapsed,
  onToggleSection,
  onSelect,
  treeRef,
}: {
  readonly sections: readonly PagedTreeSection[];
  readonly page: string;
  /** Section labels currently collapsed. All expanded is `ExpandNode` on every node. */
  readonly collapsed: ReadonlySet<string>;
  readonly onToggleSection: (label: string) => void;
  readonly onSelect: (id: string) => void;
  readonly treeRef?: React.Ref<HTMLDivElement>;
}): JSX.Element {
  return (
    <div className="ze-paged-tree" ref={treeRef} tabIndex={0}>
      {sections.map((section) => {
        // A parentless run: no expander, no indent, and nothing to collapse.
        if (section.label === '') {
          return section.pages.map((p) => (
            <div
              key={p.id}
              className={`ze-tree-item${p.id === page ? ' active' : ''}`}
              style={{ opacity: p.disabled ? 0.45 : 1, cursor: 'default' }}
              onClick={() => !p.disabled && onSelect(p.id)}
              title={p.disabled ? 'Not implemented yet' : p.label}
            >
              {/* The expander GUTTER, with no expander in it. A wxTreeCtrl
                  reserves one button column per level and draws a button only
                  where there are children, so every level-0 row - parentless
                  page and section parent alike - has its LABEL at the same x.
                  Measured on the installed 10.0.5: Common, Mouse and Touchpad,
                  SpaceMouse, Hotkeys, Version Control, Packages and Updates,
                  Plugins and Maintenance all start their text at x=494/495,
                  exactly where Symbol Editor's and PCB Editor's do, with the
                  twisty out at x=474 in the gutter. Ours drew these rows with
                  no gutter, so they hung left of every section name.

                  A bare `.twisty` is that gutter: the chevron lives on
                  `.twisty.expandable::before`, so without the modifier this is
                  an empty box of exactly the right width. Which is the point -
                  the alignment comes from the same box the arrow uses, not
                  from a padding restating its size, so it cannot drift. */}
              <span className="twisty" />
              {p.label}
            </div>
          ));
        }

        const open = !collapsed.has(section.label);
        return (
          <div key={section.label}>
            <div
              className="ze-tree-item root"
              onClick={() => onToggleSection(section.label)}
              title={section.label}
            >
              <span className={`twisty expandable${open ? ' open' : ''}`} />
              {section.label}
            </div>
            {open &&
              section.pages.map((p) => (
                <div
                  key={p.id}
                  className={`ze-tree-item${p.id === page ? ' active' : ''}`}
                  style={{
                    paddingLeft: CHILD_INDENT,
                    opacity: p.disabled ? 0.45 : 1,
                    cursor: 'default',
                  }}
                  onClick={() => !p.disabled && onSelect(p.id)}
                  title={p.disabled ? 'Not implemented yet' : p.label}
                >
                  {p.label}
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
