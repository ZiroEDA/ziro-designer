// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What stands behind the sign-in wall: the project manager's chrome, with no
 * project in it.
 *
 * The wall used to render the REAL app, blurred and inert, so a visitor could
 * see what they were signing up for. The look was right and the substance was
 * wrong: the app mounted, loaded whatever project the browser held, and put
 * its name and every file name into the DOM behind a CSS blur - readable by
 * anyone with devtools, before a password was ever typed. A wall that is only
 * pixels is not a wall.
 *
 * This keeps the look and removes the substance. It is the same frame - menu
 * bar, manager toolbar, project-files pane, launcher tiles, status bar - built
 * from the same tables and classes the manager uses, and it holds nothing
 * but KiCad's own tool names and help lines. No store is read, no project is
 * opened, nothing here can be clicked. The manager itself is not mounted until
 * the wall comes down.
 */
import type { JSX } from 'react';
import { EllipsizedField } from '../ui/EllipsizedField.js';
import { HomeLink } from '../ui/HomeLink.js';
import { KiStatusBar } from '../ui/KiStatusBar.js';
import { MenuBar, type Menu } from '../ui/MenuBar.js';
import { MGR_TOOLS, TILES, tileIcon } from '../home/launcher_tiles.js';
import { managerTitle, projectStatusText } from '../home/manager_frame.js';
import { mgrUrl } from '../home/project_tree_pane.js';

/** The manager's menu headings, empty: they are never opened from here. */
const MENUS: Menu[] = ['File', 'Edit', 'View', 'Tools', 'Preferences', 'Help'].map((label) => ({
  label,
  items: [],
}));

export function GateBackdrop(): JSX.Element {
  return (
    <div className="ze-app">
      <MenuBar menus={MENUS} leftSlot={<HomeLink />} title={managerTitle(null, 'ZiroEDA', false)} />
      <div className="ze-home-body">
        <div className="ze-mgrbar">
          {MGR_TOOLS.map((t, i) =>
            t === 'sep' ? (
              <span key={`s${i}`} className="sep" />
            ) : (
              <button key={t.icon} type="button" aria-label={t.name} disabled>
                <img src={mgrUrl(t.icon)} alt="" />
              </button>
            ),
          )}
        </div>
        <div className="ze-leftdock">
          <div className="ze-panel left ze-projecttree">
            <div className="ze-panel-header">Project Files</div>
            <div className="ze-panel-body" />
          </div>
        </div>
        <div className="ze-splitter" />
        <div className="ze-launchers">
          <div className="ze-tiles">
            {TILES.map((t) => (
              <button key={t.id} type="button" className="ze-launcher" disabled>
                <span className="ico">{tileIcon(t.id)}</span>
                <span className="txt">
                  <span className="name">{t.name}</span>
                  <span className="desc">{t.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <KiStatusBar>
        <EllipsizedField text={projectStatusText(null)} />
      </KiStatusBar>
    </div>
  );
}
