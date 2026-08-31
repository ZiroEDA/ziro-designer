// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_GIT_REPOS` (common/dialogs/git/panel_git_repos_base.cpp), the
 * "Version Control" page (`common/eda_base_frame.cpp:1605`).
 *
 * `bLeftSizer` holds three things, and the first is NOT in a group:
 *
 *     m_enableGit                          Add( …, wxEXPAND|wxALL, 10 )
 *     "Remote Tracking"   gbUpdate( 4, 5 ): label / wxSpinCtrl / "minutes"
 *     "Git Commit Data"   fgSizer1( 0, 2 ): the checkbox, then two label/entry
 *                                           rows
 *
 * and `bPanelSizer->Add( bLeftSizer, 0, wxRIGHT, 20 )` — proportion 0, so the
 * page is its own width and the entries are their own width too, not the
 * page's. Ours stretched them across the whole panel.
 *
 * Everything is drawn and disabled. Upstream this drives libgit2 against a
 * project checked out on disk: it polls a remote for changes to the project's
 * files and stamps commits with an author. Ours live in the cloud store and are
 * versioned by it, so there is no local repository for any of this to
 * configure. That reason belongs HERE — it was on the page as a banner and
 * repeated in every control's tooltip, and KiCad has neither.
 *
 * The controls bind to `common.git.*` rather than to literals: the panel is a
 * `RESETTABLE_PANEL` upstream (`panel_git_repos.cpp:48`), so its footer button
 * reads "Reset Version Control to Defaults" and has to have something to reset.
 */
import type { JSX } from 'react';
import { Check, Group } from '../widgets.js';
import { SpinCtrl } from '../../../ui/SpinCtrl.js';
import type { PrefsContext } from '../types.js';

export function PanelGitRepos({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { common, upC } = ctx;
  const git = common.git;

  return (
    <div className="ze-pref-page-natural">
      {/* `Add( m_enableGit, 0, wxEXPAND|wxALL, 10 )` — above the first heading,
          in no group at all. */}
      <div className="ze-git-enable">
        <Check
          label="Enable Git tracking"
          checked={git.enableGit}
          disabled
          onChange={(v) =>
            upC((s) => {
              s.git.enableGit = v;
            })
          }
        />
      </div>
      <Group title="Remote Tracking">
        {/* `gbUpdate = new wxGridBagSizer( 4, 5 )`: the label, the spin control
            and the units, in three cells. */}
        <div className="ze-git-update">
          <span className="lbl">Update interval:</span>
          <SpinCtrl
            value={git.updatInterval}
            /* [data] `wxSpinCtrl( …, wxSP_ARROW_KEYS, 0, 60, 5 )`. */
            min={0}
            max={60}
            disabled
            ariaLabel="Update interval"
            onChange={(v) =>
              upC((s) => {
                s.git.updatInterval = v;
              })
            }
          />
          <span className="unit">minutes</span>
        </div>
      </Group>
      <Group title="Git Commit Data">
        {/* `fgSizer1 = new wxFlexGridSizer( 0, 2, 0, 0 )`: the checkbox takes
            the first cell of row 0 and an empty spacer the second, so the label
            column is as wide as the checkbox — which is why KiCad's two entries
            start well right of "Author name:". */}
        <div className="ze-git-commit">
          <Check
            label="Use default values"
            checked={git.useDefaultAuthor}
            disabled
            onChange={(v) =>
              upC((s) => {
                s.git.useDefaultAuthor = v;
              })
            }
          />
          <span />
          <span className="lbl">Author name:</span>
          <input
            className="ze-search"
            type="text"
            value={git.authorName}
            disabled
            onChange={(e) =>
              upC((s) => {
                s.git.authorName = e.target.value;
              })
            }
          />
          <span className="lbl">Author e-mail:</span>
          <input
            className="ze-search"
            type="text"
            value={git.authorEmail}
            disabled
            onChange={(e) =>
              upC((s) => {
                s.git.authorEmail = e.target.value;
              })
            }
          />
        </div>
      </Group>
    </div>
  );
}
