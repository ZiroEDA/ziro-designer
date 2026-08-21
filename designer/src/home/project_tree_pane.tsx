// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The launcher's project-files pane (upstream counterpart:
 * kicad/project_tree_pane.cpp). Renders the .kicad_pro root row and the
 * KiCad-sorted directory tree; with no project it renders nothing at all,
 * as `ReCreateTreePrj` leaves the real tree.
 * Single click selects, double click routes each document type to its editor
 * (PROJECT_TREE_ITEM::Activate). State stays in the launcher, this pane is
 * fully controlled. Ctrl/Cmd-click multi-selects; right-click opens the
 * context menu (the web-applicable subset of upstream's popup: text viewer,
 * rename, delete).
 */

import { useEffect, useMemo, useState, type JSX } from 'react';
import type { PickedHomeFile } from './files.js';
import {
  basename,
  inTreeAllowList,
  isHiddenFile,
  treeIconFor,
  type DirNode,
} from './project_tree.js';
import { treeFileType } from './file_activation.js';
import { type TreeMenuSelectionItem, projectTreeMenu } from './project_tree_menu.js';

// KiCad's own dark-theme manager icons (GPL), vendored under assets/.
const MGR_ICONS = import.meta.glob('../assets/manager/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
export const mgrUrl = (name: string): string | undefined =>
  MGR_ICONS[`../assets/manager/${name}.svg`];

export const TreeIcon = ({ name }: { name: string }): JSX.Element => {
  const url = mgrUrl(name);
  return url ? <img src={url} alt="" /> : <span style={{ width: 18, height: 18 }} />;
};

/** Sentinel used as the selection id of the project root row. */
export const ROOT_SELECTION = '\0root';

export function ProjectTreePane({
  picked,
  dirRoot,
  rootLabel,
  projectNames,
  width,
  expanded,
  onToggleDir,
  selected,
  onSelect,
  rootOpen,
  onToggleRoot,
  onRenamePath,
  onDeletePaths,
  onViewTextPath,
  onDownloadPath,
  onActivate,
}: {
  picked: PickedHomeFile[] | null;
  dirRoot: DirNode | null;
  /** The tree root shows the full .kicad_pro filename (m_root = fn.GetFullName()). */
  rootLabel: string;
  /** Basenames (lowercased, no extension) of every .kicad_pro in the folder,
   *  KiCad's getProjects(dir). A .kicad_sch shows only when its basename is one
   *  of these (the root sheet of some project); subsheets stay hidden. */
  projectNames: ReadonlySet<string>;
  width: number;
  expanded: Set<string>;
  onToggleDir: (path: string) => void;
  /** Selected tree paths (multi-select via Ctrl/Cmd-click, like upstream). */
  selected: ReadonlySet<string>;
  onSelect: (path: string, additive: boolean) => void;
  rootOpen: boolean;
  onToggleRoot: () => void;
  onRenamePath?: (path: string) => void;
  onDeletePaths?: (paths: Set<string>) => void;
  onViewTextPath?: (path: string) => void;
  /** Download a single file from the project to the browser's local storage. */
  onDownloadPath?: (path: string) => void;
  /**
   * `item->Activate( this )`.
   *
   * PROJECT_TREE_PANE hands a double-clicked row to the item and is told
   * nothing more: `OnSelect` is four lines, and not one of them knows an editor
   * exists (`kicad/project_tree_pane.cpp`). This pane does the same, so the
   * mapping from file type to editor lives in one place and the file manager
   * reaches the same one. It used to live here as six regexes, which is six of
   * the fourteen branches - the rest did nothing.
   */
  onActivate?: (node: { name: string; path: string; file?: PickedHomeFile }) => void;
}): JSX.Element {
  // KiCad's addItemToProjectTree: a .kicad_sch is listed only when its basename
  // is one of the folder's project names (getProjects), i.e. the root sheet of
  // *some* project. Sub-sheets hide (they live in the editor's hierarchy
  // navigator). A folder may hold several projects: the active project's
  // .kicad_pro is the bold root row (hidden as a child, like KiCad's
  // `filename != fn.GetFullName()`); every other file, including the other
  // projects' .kicad_pro, .kicad_sch and .kicad_pcb, stays visible, and their
  // .kicad_pro can be double-clicked to switch project.
  const isHiddenNode = (name: string): boolean => {
    const base = name.split(/[\\/]/).pop() ?? name;
    if (/\.kicad_pro$/i.test(base)) return base === rootLabel;
    if (/\.kicad_sch$/i.test(base)) {
      const stem = base.replace(/\.kicad_sch$/i, '').toLowerCase();
      return !projectNames.has(stem);
    }
    if (isHiddenFile(name)) return true;
    // The tree is an allow list; anything not in s_allowedExtensionsToList is
    // not shown at all (3D bodies among them - see inTreeAllowList).
    return !inTreeAllowList(name);
  };

  // Right-click context menu (upstream popup, web-applicable subset).
  const [menu, setMenu] = useState<{ x: number; y: number; paths: Set<string> } | null>(null);

  /**
   * Every row of the tree by its path, so the popup can ask what a selected
   * path *is*.
   *
   * `onRight` works from `GetSelectedData()` - a vector of PROJECT_TREE_ITEM,
   * each already carrying its TREE_FILE_TYPE - so the type is free upstream.
   * Ours holds paths, and this is the lookup that turns one back into a type.
   */
  const nodeByPath = useMemo(() => {
    const out = new Map<string, DirNode>();
    const walk = (n: DirNode): void => {
      if (n.path) out.set(n.path, n);
      n.children.forEach(walk);
    };
    if (dirRoot) walk(dirRoot);
    return out;
  }, [dirRoot]);

  /** One selected path as the popup's conditions see it. */
  const selectionItem = (path: string): TreeMenuSelectionItem => {
    // The root row is the project's own .kicad_pro, and the only row for which
    // `item->GetId() == GetRootItem()` is true.
    if (path === ROOT_SELECTION) return { type: 'JSON_PROJECT', isTreeRoot: true };
    const node = nodeByPath.get(path);
    if (node?.isDir) return { type: 'DIRECTORY' };
    return { type: treeFileType(path) };
  };
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const openContextMenu = (e: React.MouseEvent, path: string): void => {
    e.preventDefault();
    e.stopPropagation();
    // Right-clicking an unselected row selects it (like upstream's tree).
    const paths = selected.has(path) ? new Set(selected) : new Set([path]);
    if (!selected.has(path)) onSelect(path, false);
    if (paths.size > 0) setMenu({ x: e.clientX, y: e.clientY, paths });
  };

  const renderDir = (node: DirNode, depth: number): JSX.Element | null => {
    if (node.isDir) {
      const kids = node.children.filter((c) => c.isDir || !isHiddenNode(c.name));
      // Upstream lists every directory it finds and only filters the contents,
      // so a folder whose files are all filtered out (a .3dshapes full of STEP
      // bodies) is still a row - it just has nothing to expand and therefore no
      // twisty. We used to drop such folders from the tree entirely.
      const hasKids = kids.length > 0;
      const open = hasKids && expanded.has(node.path);
      return (
        <div key={node.path}>
          <div
            className={`ze-tree-item${selected.has(node.path) ? ' active' : ''}`}
            style={{ paddingLeft: 8 + depth * 16 }}
            // A single click selects, like every other row; expanding is the
            // twisty or a double click (wxTreeCtrl's own behaviour). It used to
            // toggle on single click, so a folder could never be selected and
            // never showed the highlight.
            onClick={(e) => onSelect(node.path, e.ctrlKey || e.metaKey)}
            onDoubleClick={() => hasKids && onToggleDir(node.path)}
            onContextMenu={(e) => openContextMenu(e, node.path)}
          >
            {hasKids ? (
              <span
                className={`twisty expandable${open ? ' open' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleDir(node.path);
                }}
              />
            ) : (
              <span className="ze-tree-spacer" />
            )}
            <TreeIcon name={open ? 'directory_open' : 'directory'} />
            <span className="ze-tree-name">{node.name}</span>
          </div>
          {open && kids.map((c) => renderDir(c, depth + 1))}
        </div>
      );
    }
    if (isHiddenNode(node.name)) return null;
    // PROJECT_TREE_ITEM::Activate, which the pane does not get to second-guess.
    const openFn = onActivate
      ? (): void => onActivate({ name: node.name, path: node.path, file: node.file })
      : undefined;
    // KiCad's project tree: single click selects, double click opens the file.
    // No tooltip on either kind of row - there is no SetToolTip anywhere in
    // project_tree_pane.cpp, project_tree.cpp or project_tree_item.cpp, so a
    // KiCad tree never explains itself on hover. Ours had been captioning every
    // file with "Double-click to open in the ... Editor", which is a web habit.
    return (
      <div
        key={node.path}
        className={`ze-tree-item${selected.has(node.path) ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 + 15 }}
        onClick={(e) => onSelect(node.path, e.ctrlKey || e.metaKey)}
        onContextMenu={(e) => openContextMenu(e, node.path)}
        onDoubleClick={openFn}
      >
        <TreeIcon name={treeIconFor(node.name)} />
        <span className="ze-tree-name">{node.name}</span>
      </div>
    );
  };

  return (
    <div className="ze-panel left ze-projecttree" style={{ width }}>
      <div className="ze-panel-header">Project Files</div>
      <div className="ze-panel-body">
        {picked ? (
          <>
            {/* project root (.kicad_pro): bold, selectable, and its twisty
                collapses the whole tree, like KiCad's tree root. */}
            <div
              className={`ze-tree-item root${selected.has(ROOT_SELECTION) ? ' active' : ''}`}
              onClick={() => onSelect(ROOT_SELECTION, false)}
            >
              <span
                className={`twisty expandable${rootOpen ? ' open' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleRoot();
                }}
              />
              <TreeIcon name="project" />
              <span className="ze-tree-name">{rootLabel}</span>
            </div>
            {/* project directory contents, flat and KiCad-sorted */}
            {rootOpen && dirRoot?.children.map((c) => renderDir(c, 1))}
          </>
        ) : /* No project: the tree is empty, exactly as upstream leaves it.
             `PROJECT_TREE_PANE::ReCreateTreePrj` (project_tree_pane.cpp:664)
             calls `m_TreeProject->DeleteAllItems()` and then returns early on
             `if( !pro_dir )`, so KiCad draws no root, no placeholder and no
             hint text. The ways in are the same as upstream's: File ▸ Open
             Project… (Ctrl+O), the launcher's own Open Project tile, and
             dropping a folder on the window. */
        null}
      </div>
      {menu && (
        <div
          className="ze-dropdown"
          style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(() => {
            const paths = [...menu.paths];
            const single = paths.length === 1 ? paths[0]! : null;
            /**
             * What each row does here, by the id the shared builder gave it.
             *
             * A row with no handler is not drawn - the same rule
             * `runActivation` follows for a branch a call site cannot honour,
             * and the reason `New Directory...` is absent rather than greyed:
             * upstream's creates a folder on disk and there is nothing here to
             * create one in yet. Every row that IS drawn works.
             */
            const handlers: Partial<Record<string, () => void>> = {
              newDirectory: undefined,
              editInTextEditor:
                single !== null && onViewTextPath
                  ? () => onViewTextPath(single === ROOT_SELECTION ? rootLabel : single)
                  : undefined,
              download:
                single !== null && single !== ROOT_SELECTION && onDownloadPath
                  ? () => onDownloadPath(single)
                  : undefined,
              renameFile:
                single !== null && single !== ROOT_SELECTION && onRenamePath
                  ? () => onRenamePath(single)
                  : undefined,
              moveToTrash: onDeletePaths ? () => onDeletePaths(new Set(paths)) : undefined,
              // The same thing double-clicking that row does, so it goes
              // through the same Activate switch rather than round a second
              // path to the same LoadProject.
              switchToProject:
                single !== null && single !== ROOT_SELECTION && onActivate
                  ? () => {
                      const node = nodeByPath.get(single);
                      if (node) onActivate({ name: node.name, path: node.path, file: node.file });
                    }
                  : undefined,
            };

            const entries = projectTreeMenu(paths.map(selectionItem));
            const rows: JSX.Element[] = [];

            entries.forEach((e, i) => {
              if (e === 'separator') {
                // A rule is only worth drawing between two rows that exist.
                if (rows.length > 0) rows.push(<div key={`sep${i}`} className="ze-msep" />);
                return;
              }
              const run = handlers[e.id];
              if (!run) return;
              rows.push(
                <div
                  key={e.id}
                  className="ze-mitem"
                  title={e.help}
                  onClick={() => {
                    setMenu(null);
                    run();
                  }}
                >
                  {/* KIUI::AddMenuItem takes a KiBitmap for every one of these
                      rows, so the icon column is never empty upstream. */}
                  <span className="mico">
                    <TreeIcon name={e.icon} />
                  </span>
                  <span className="lbl">{e.label}</span>
                </div>,
              );
            });

            // Trailing rule, if the rows under it all dropped out.
            while (rows.length > 0 && rows[rows.length - 1]?.key?.startsWith('sep')) rows.pop();
            return rows;
          })()}
        </div>
      )}
    </div>
  );
}
