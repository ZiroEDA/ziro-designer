// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_GIT_REPOS` (common/dialogs/git/panel_git_repos_base.cpp), the
 * "Version Control" page.
 *
 *     _("Enable Git tracking")
 *     _("Remote Tracking")     _("Update interval:") … _("minutes")
 *     _("Git Commit Data")     _("Use default values")
 *                              _("Author name:")  _("Author e-mail:")
 *
 * Drawn and disabled. Upstream this drives libgit2 against the working copy of
 * a project on disk: it polls a remote for changes to the project's own files
 * and stamps commits with an author. Our projects live in the cloud store and
 * are versioned by it, so there is no local repository for these to configure —
 * see the cloud sync design, which is content-addressed and commits last.
 */
import type { JSX } from 'react';
import { Check, Group, Num } from '../widgets.js';

const WHY =
  'Upstream this drives libgit2 against a project checked out on disk. Ours live in the cloud ' +
  'store and are versioned there, so there is no local repository to track.';

/** `_("Number of minutes between remote update checks.  Zero disables automatic checks.")` [data] */
const INTERVAL_TIP =
  'Number of minutes between remote update checks.  Zero disables automatic checks.';

export function PanelGitRepos(): JSX.Element {
  return (
    <>
      <div className="ze-pref-hint">{WHY}</div>
      <Check label="Enable Git tracking" checked={false} onChange={() => {}} disabled title={WHY} />
      <Group title="Remote Tracking">
        <Num
          label="Update interval:"
          value={0}
          onChange={() => {}}
          unit="minutes"
          min={0}
          disabled
          title={`${INTERVAL_TIP}\n\n${WHY}`}
        />
      </Group>
      <Group title="Git Commit Data">
        <Check label="Use default values" checked onChange={() => {}} disabled title={WHY} />
        <label className="ze-pref-row" title={WHY}>
          <span className="lbl">Author name:</span>
          <input className="ze-search" type="text" value="" onChange={() => {}} disabled />
        </label>
        <label className="ze-pref-row" title={WHY}>
          <span className="lbl">Author e-mail:</span>
          <input className="ze-search" type="text" value="" onChange={() => {}} disabled />
        </label>
      </Group>
    </>
  );
}
