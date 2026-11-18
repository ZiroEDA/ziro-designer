// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The project manager's Git commands, over GitHub: `PROJECT_TREE_PANE`'s `onGit*` handlers
 * (kicad/project_tree_pane.cpp) and `KICAD_MANAGER_CONTROL::NewFromRepository`, as one hook the
 * launcher calls, so HomePage only wires them.
 *
 * Each command does what upstream's does and says what upstream says: the feedback on the status
 * bar for eight seconds (`showGitFeedback`), the failures in an error box with GitHub's own words,
 * "Pull Conflict" when a file changed on both sides. The work is in github_project.ts; this is the
 * order things happen in, the dialogs, and the store writes.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { DisplayErrorMessage, DisplayInfoMessage } from '@ziroeda/common/confirm.js';
import { MessageDialogYesNo } from '@ziroeda/common/dialogs/dialog_message.js';
import { SingleChoiceDialog } from '@ziroeda/common/dialogs/dialog_single_choice.js';
import { DIALOG_GIT_COMMIT } from '@ziroeda/common/dialogs/git/dialog_git_commit.js';
import {
  DIALOG_GIT_SWITCH,
  type GitSwitchResult,
} from '@ziroeda/common/dialogs/git/dialog_git_switch.js';
import type { ProgressSnapshot } from '@ziroeda/common/widgets/progress_reporter_snapshot.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';
import type { PickedHomeFile } from '../home/files.js';
import {
  deleteProjectPath,
  loadProject,
  saveProject,
  updateProjectFiles,
} from '../home/projectStore.js';
import type { TreeMenuEntryId, VcsMenuState } from '../home/project_tree_menu.js';
import { type GithubRepo, getAuthenticatedUser, listUserRepos } from './github_api.js';
import {
  GithubAuthError,
  GithubAuthRequired,
  GithubSession,
  type GithubTokens,
  beginGithubConnect,
  clearTokens,
  loadTokens,
  saveTokens,
} from './github_auth.js';
import {
  type CommitPlan,
  GIT_LINK_FILE,
  type GitLink,
  type PullPlan,
  addBranch,
  branchNames,
  cloneRepository,
  fetchPull,
  gitLinkBytes,
  gitLinkOf,
  isValidBranchName,
  planCommit,
  planPull,
  pushNewRepository,
  repoNameFor,
  runCommit,
  upstreamOf,
} from './github_project.js';
import { DialogPushToGithub, type PushToGithubAnswer } from './dialog_push_to_github.js';

type Loading = { title: string; label: string | ProgressSnapshot } | null;

/** `m_gitFeedbackTimer.Start( 8000, wxTIMER_ONE_SHOT )`. */
const FEEDBACK_MS = 8000;

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface GithubProjectHost {
  /** The signed-in account; its tokens are its own on this device. */
  userId: string | undefined;
  /** The open project's store id; null when none (or a demo, which is not the user's). */
  projectId: string | null;
  /** The open project's files, as the tree holds them: where the link is read from. */
  picked: readonly PickedHomeFile[] | null;
  /** The open project's name, which Push to GitHub offers as the repository's. */
  projectName: string;
  /** `COMMON_SETTINGS::m_Git.enableGit`. */
  enableGit: boolean;
  /** Names (lower-cased) of the projects already in the store: a clone must not take one. */
  takenNames: ReadonlySet<string>;
  setLoading: (aLoading: Loading) => void;
  /** Re-read a project from the store into the tree (and open it, for a new clone). */
  openStored: (aId: string) => Promise<void>;
  /** Files of the open project changed in the store without a re-read: patch the tree's copy. */
  patchOpenFiles: (aWrites: readonly { name: string; bytes: Uint8Array }[]) => void;
  /** A project's record was written: refresh the list and push it to the account. */
  onStoreWritten: (aId: string) => void;
}

export interface GithubProject {
  /** The Version Control submenu's state; null with no project of the user's open. */
  versionControl: VcsMenuState | null;
  /** The submenu's rows, by id. */
  onVersionControl: (aId: TreeMenuEntryId, aBranch?: string) => void;
  /** File > Clone Project from Repository... */
  cloneFromRepository: () => void;
  /** `showGitFeedback`'s line for the status bar, while it lasts. */
  feedback: string | null;
  /** The link of the open project, if it has one. */
  link: GitLink | null;
  /** Whatever dialog a command has up. */
  dialogs: JSX.Element | null;
}

export function useGithubProject(host: GithubProjectHost): GithubProject {
  const userKey = host.userId ?? 'guest';
  const hostRef = useRef(host);
  hostRef.current = host;

  const [account, setAccount] = useState<{ connected: boolean; login?: string }>({
    connected: false,
  });
  const [branches, setBranches] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pushOpen, setPushOpen] = useState(false);
  const [commitPlan, setCommitPlan] = useState<CommitPlan | null>(null);
  const [conflict, setConflict] = useState<PullPlan | null>(null);
  const [switchList, setSwitchList] = useState<string[] | null>(null);
  const [cloneRepos, setCloneRepos] = useState<GithubRepo[] | null>(null);
  const [cloneChoice, setCloneChoice] = useState<{
    projects: readonly string[];
    resolve: (aPath: string | null) => void;
  } | null>(null);

  const link = useMemo(() => gitLinkOf(host.picked), [host.picked]);
  const linkRef = useRef(link);
  linkRef.current = link;

  const session = useMemo(
    () =>
      new GithubSession({
        fetch: (...a) => fetch(...a),
        load: () => loadTokens(userKey),
        save: (t) => saveTokens(userKey, t),
        clear: () => {
          clearTokens(userKey);
          setAccount({ connected: false });
        },
      }),
    [userKey],
  );

  // Whether this account has connected GitHub on this device.
  useEffect(() => {
    let live = true;
    void loadTokens(userKey).then((t) => {
      if (live)
        setAccount(
          t ? { connected: true, ...(t.login ? { login: t.login } : {}) } : { connected: false },
        );
    });
    return () => {
      live = false;
    };
  }, [userKey]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFeedback = useCallback((aText: string): void => {
    setFeedback(aText);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // GetBranchNames() for the quick Switch to Branch rows, whenever the link names a new place.
  const linkKey = link ? `${link.owner}/${link.repo}#${link.branch}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: linkKey is the trigger; the link itself is read through its ref
  useEffect(() => {
    const l = linkRef.current;
    setBranches([]);
    if (!l || !account.connected) return;
    let live = true;
    branchNames(session.fetch, l).then(
      (names) => {
        if (live) setBranches(names);
      },
      (e) => console.warn('GitHub branch list failed:', why(e)),
    );
    return () => {
      live = false;
    };
  }, [linkKey, account.connected, session]);

  /** An error box: GitHub's words under upstream's caption-line, or "connect again". */
  const report = useCallback((aTitle: string, e: unknown): void => {
    if (e instanceof GithubAuthRequired) {
      setAccount({ connected: false });
      DisplayErrorMessage(
        _('GitHub needs to be connected again.'),
        `${why(e)}\n\n${_('Choose Version Control > Connect GitHub..., then try again.')}`,
      );
      return;
    }
    DisplayErrorMessage(aTitle, why(e));
  }, []);

  /** "Failed to switch to branch '%s': %s", upstream's one line for it (DisplayError). */
  const reportSwitch = useCallback(
    (aBranch: string, e: unknown): void => {
      if (e instanceof GithubAuthRequired) report('', e);
      else DisplayErrorMessage(wxFormat(_("Failed to switch to branch '%s': %s"), aBranch, why(e)));
    },
    [report],
  );

  /**
   * Connect, then carry on with what was asked. Runs inside the click: GitHub's window has to
   * open from the gesture or the browser blocks it.
   */
  const connect = useCallback(
    (aThen?: () => void): void => {
      beginGithubConnect().then(
        async (t: GithubTokens) => {
          // Who the account is: the Author line, and the owner a new repository goes under.
          const once = new GithubSession({
            fetch: (...a) => fetch(...a),
            load: async () => t,
            save: async () => {},
            clear: () => {},
          });
          let login: string | undefined;
          try {
            login = (await getAuthenticatedUser(once.fetch)).login;
          } catch {
            login = undefined;
          }
          try {
            await saveTokens(userKey, login ? { ...t, login } : t);
          } catch (e) {
            DisplayErrorMessage(_('Could not connect GitHub.'), why(e));
            return;
          }
          setAccount({ connected: true, ...(login ? { login } : {}) });
          if (login) showFeedback(wxFormat(_('Connected to GitHub as %s.'), login));
          aThen?.();
        },
        // GithubAuthError: GitHub's words, or the server's ("not set up on this server yet").
        (e: unknown) =>
          DisplayErrorMessage(
            _('Could not connect GitHub.'),
            e instanceof GithubAuthError ? e.message : why(e),
          ),
      );
    },
    [userKey, showFeedback],
  );

  const withGithub = useCallback(
    (aThen: () => void): void => {
      if (account.connected) aThen();
      else connect(aThen);
    },
    [account.connected, connect],
  );

  /** Write the link into the project and the tree's copy of it. */
  const writeLink = useCallback(async (aId: string, aLink: GitLink): Promise<void> => {
    const bytes = gitLinkBytes(aLink);
    await updateProjectFiles(aId, [{ name: GIT_LINK_FILE, bytes }]);
    hostRef.current.patchOpenFiles([{ name: GIT_LINK_FILE, bytes }]);
    hostRef.current.onStoreWritten(aId);
  }, []);

  const filesOf = async (aId: string) => {
    const loaded = await loadProject(aId);
    if (!loaded) throw new Error(_('The project is no longer in this browser.'));
    return loaded.files;
  };

  // --- Push to GitHub... ---------------------------------------------------------

  const onPushResult = async (aAnswer: PushToGithubAnswer | null): Promise<void> => {
    setPushOpen(false);
    const id = hostRef.current.projectId;
    if (!aAnswer || !id) return;
    const { setLoading } = hostRef.current;
    setLoading({
      title: _('Push to GitHub'),
      label: wxFormat(_('Pushing %s to GitHub...'), aAnswer.name),
    });
    try {
      const { link: made } = await pushNewRepository(
        session.fetch,
        aAnswer.name,
        aAnswer.isPrivate,
        await filesOf(id),
      );
      await writeLink(id, made);
      showFeedback(wxFormat(_('Pushed %s to %s.'), made.branch, upstreamOf(made)));
    } catch (e) {
      report(_('Failed to push project'), e);
    } finally {
      setLoading(null);
    }
  };

  // --- Commit Project... --------------------------------------------------------

  const commitProject = (): void =>
    withGithub(async () => {
      const id = hostRef.current.projectId;
      const l = linkRef.current;
      if (!id || !l) return;
      const { setLoading } = hostRef.current;
      setLoading({ title: _('Commit Changes'), label: _('Comparing the project with GitHub...') });
      try {
        const plan = await planCommit(session.fetch, l, await filesOf(id));
        setLoading(null);
        if (plan.changes.length === 0) {
          await DisplayInfoMessage(_('There are no changes to commit.'));
          return;
        }
        setCommitPlan(plan);
      } catch (e) {
        setLoading(null);
        report(_('Failed to push project'), e);
      }
    });

  const onCommitResult = async (aMessage: string | null): Promise<void> => {
    const plan = commitPlan;
    setCommitPlan(null);
    const id = hostRef.current.projectId;
    if (aMessage === null || !plan || !id) return;
    const { setLoading } = hostRef.current;
    setLoading({ title: _('Commit Changes'), label: _('Pushing to GitHub...') });
    try {
      const next = await runCommit(session.fetch, plan, aMessage);
      await writeLink(id, next);
      showFeedback(wxFormat(_('Pushed %s to %s.'), next.branch, upstreamOf(next)));
    } catch (e) {
      report(_('Failed to push project'), e);
    } finally {
      setLoading(null);
    }
  };

  // --- Pull / Switch to Branch ----------------------------------------------------

  /** Write what a pull brought, re-read the project, and say what happened. */
  const landPull = async (aPlan: PullPlan, aUseRemote: boolean, aSwitching: boolean) => {
    const id = hostRef.current.projectId;
    if (!id) return;
    const { setLoading } = hostRef.current;
    const title = _('Fetch Remote');
    const message = _('Fetching from GitHub...');
    setLoading({ title, label: { message, value: 0 } });
    try {
      const {
        writes,
        deletes,
        link: next,
      } = await fetchPull(session.fetch, aPlan, aUseRemote, (done, total) =>
        setLoading({ title, label: { message, value: total ? done / total : 0 } }),
      );
      if (writes.length > 0) await updateProjectFiles(id, writes);
      for (const path of deletes) await deleteProjectPath(id, path);
      await updateProjectFiles(id, [{ name: GIT_LINK_FILE, bytes: gitLinkBytes(next) }]);
      hostRef.current.onStoreWritten(id);
      // Upstream's editors reload the files the pull changed on disk; re-reading the project is
      // this app's version of that, as Restore from Local History does it.
      await hostRef.current.openStored(id);
      if (aSwitching) showFeedback(wxFormat(_('Switched to branch %s.'), next.branch));
      else if (aPlan.upToDate)
        showFeedback(wxFormat(_('Already up to date with %s.'), upstreamOf(next)));
      else
        showFeedback(
          wxFormat(_('Pulled %s into %s (fast-forward).'), upstreamOf(next), next.branch),
        );
    } catch (e) {
      if (aSwitching) reportSwitch(aPlan.link.branch, e);
      else report(_('Failed to pull project'), e);
    } finally {
      setLoading(null);
    }
  };

  const pull = (aBranch?: string): void =>
    withGithub(async () => {
      const id = hostRef.current.projectId;
      const l = linkRef.current;
      if (!id || !l) return;
      const switching = aBranch !== undefined && aBranch !== l.branch;
      const { setLoading } = hostRef.current;
      setLoading({ title: _('Fetch Remote'), label: _('Fetching from GitHub...') });
      let plan: PullPlan;
      try {
        plan = await planPull(session.fetch, l, await filesOf(id), aBranch ?? l.branch);
      } catch (e) {
        setLoading(null);
        if (switching) reportSwitch(aBranch, e);
        else report(_('Failed to pull project'), e);
        return;
      }
      setLoading(null);
      if (plan.upToDate && !switching) {
        showFeedback(wxFormat(_('Already up to date with %s.'), upstreamOf(l)));
        return;
      }
      if (plan.conflicts.length > 0) {
        // A checkout that would overwrite the project's changes: git's SAFE checkout refuses it.
        if (switching) {
          DisplayErrorMessage(
            wxFormat(
              _("Failed to switch to branch '%s': %s"),
              aBranch,
              _('your changes to these files would be overwritten:'),
            ),
            plan.conflicts.join('\n'),
          );
          return;
        }
        setConflict(plan);
        return;
      }
      await landPull(plan, false, switching);
    });

  const otherBranch = (): void =>
    withGithub(async () => {
      const l = linkRef.current;
      if (!l) return;
      const { setLoading } = hostRef.current;
      setLoading({ title: _('Git Branch Switch'), label: _('Listing the branches on GitHub...') });
      try {
        const names = await branchNames(session.fetch, l);
        setBranches(names);
        setSwitchList(names);
      } catch (e) {
        report(_('Failed to pull project'), e);
      } finally {
        setLoading(null);
      }
    });

  const onSwitchResult = async (aResult: GitSwitchResult | null): Promise<void> => {
    setSwitchList(null);
    const id = hostRef.current.projectId;
    const l = linkRef.current;
    if (!aResult || !id || !l) return;
    if (!aResult.add) {
      pull(aResult.branch);
      return;
    }
    // wxID_ADD: `CreateBranch`, at the commit the project is on, then on it.
    if (!isValidBranchName(aResult.branch)) {
      DisplayErrorMessage(wxFormat(_("'%s' is not a valid branch name."), aResult.branch));
      return;
    }
    const { setLoading } = hostRef.current;
    setLoading({ title: _('Git Branch Switch'), label: _('Creating the branch on GitHub...') });
    try {
      const next = await addBranch(session.fetch, l, aResult.branch);
      await writeLink(id, next);
      showFeedback(wxFormat(_('Switched to branch %s.'), next.branch));
    } catch (e) {
      reportSwitch(aResult.branch, e);
    } finally {
      setLoading(null);
    }
  };

  // --- Clone Project from Repository... --------------------------------------------

  const cloneFromRepository = (): void =>
    withGithub(async () => {
      const { setLoading } = hostRef.current;
      setLoading({ title: _('Clone Repository'), label: _('Listing your GitHub repositories...') });
      try {
        const repos = await listUserRepos(session.fetch);
        if (repos.length === 0) {
          setLoading(null);
          await DisplayInfoMessage(_('This GitHub account has no repositories yet.'));
          return;
        }
        setCloneRepos(repos);
      } catch (e) {
        report(_('Failed to clone repository'), e);
      } finally {
        setLoading(null);
      }
    });

  const onCloneRepo = async (aFullName: string | null): Promise<void> => {
    const repo = cloneRepos?.find((r) => r.full_name === aFullName);
    setCloneRepos(null);
    if (!repo) return;
    const { setLoading } = hostRef.current;
    const title = _('Clone Repository');
    const message = wxFormat(_('Cloning %s...'), repo.full_name);
    setLoading({ title, label: { message, value: 0 } });
    try {
      const got = await cloneRepository(
        session.fetch,
        repo,
        (projects) => {
          // The gauge comes down while the chooser is up, as the GitHub open does it.
          setLoading(null);
          return new Promise((resolve) =>
            setCloneChoice({
              projects,
              resolve: (path) => {
                if (path) setLoading({ title, label: { message, value: 0 } });
                resolve(path);
              },
            }),
          );
        },
        (done, total) => setLoading({ title, label: { message, value: total ? done / total : 0 } }),
      );
      if (!got) return;
      const name = got.project.slice(got.project.lastIndexOf('/') + 1).replace(/\.kicad_pro$/i, '');
      if (hostRef.current.takenNames.has(name.toLowerCase()))
        throw new Error(
          wxFormat(
            _('A project named %s already exists. Rename or delete it first, then clone again.'),
            name,
          ),
        );
      // The chosen .kicad_pro first: the project is named for the first one the manager meets.
      const files = [
        ...got.files.filter((f) => f.name === got.project),
        ...got.files.filter((f) => f.name !== got.project),
        { name: GIT_LINK_FILE, bytes: gitLinkBytes(got.link) },
      ];
      const id = await saveProject(name, files);
      hostRef.current.onStoreWritten(id);
      await hostRef.current.openStored(id);
      showFeedback(wxFormat(_('Cloned %s.'), repo.full_name));
    } catch (e) {
      report(_('Failed to clone repository'), e);
    } finally {
      setLoading(null);
    }
  };

  // --- the submenu --------------------------------------------------------------

  const onVersionControl = (aId: TreeMenuEntryId, aBranch?: string): void => {
    switch (aId) {
      case 'connectGithub':
        connect();
        return;
      case 'pushToGithub':
        withGithub(() => setPushOpen(true));
        return;
      case 'gitCommitProject':
        commitProject();
        return;
      case 'gitPull':
        pull();
        return;
      case 'gitSwitchBranch':
        if (aBranch) pull(aBranch);
        return;
      case 'gitSwitchBranchOther':
        otherBranch();
        return;
      default:
        return;
    }
  };

  const versionControl: VcsMenuState | null = host.projectId
    ? {
        enableGit: host.enableGit,
        connected: account.connected,
        linked: !!link,
        ...(link ? { branch: link.branch, upstream: upstreamOf(link), branches } : {}),
      }
    : null;

  const dialogs = (
    <>
      {pushOpen && (
        <DialogPushToGithub
          defaultName={repoNameFor(host.projectName)}
          owner={account.login ?? _('your GitHub account')}
          onResult={(a) => void onPushResult(a)}
        />
      )}
      {commitPlan && (
        <DIALOG_GIT_COMMIT
          files={commitPlan.changes}
          author={account.login ?? ''}
          onResult={(m) => void onCommitResult(m)}
        />
      )}
      {conflict && (
        <MessageDialogYesNo
          caption={_('Pull Conflict')}
          message={_(
            'Your local changes and the remote changes conflict, so the pull was cancelled and nothing was changed.',
          )}
          extendedMessage={wxFormat(
            _(
              "These files changed both in this project and on GitHub:\n\n%s\n\nUse Remote takes GitHub's version of these files and keeps your other changes.",
            ),
            conflict.conflicts.join('\n'),
          )}
          icon="warning"
          defaultButton="no"
          labels={{ yes: _('Use Remote (discard my changes)'), no: _('Cancel') }}
          onResult={(r) => {
            const plan = conflict;
            setConflict(null);
            if (r === 'yes') void landPull(plan, true, false);
            else showFeedback(_('Pull cancelled.'));
          }}
        />
      )}
      {switchList && link && (
        <DIALOG_GIT_SWITCH
          branches={switchList}
          current={link.branch}
          onResult={(r) => void onSwitchResult(r)}
        />
      )}
      {cloneRepos && (
        <SingleChoiceDialog
          caption={_('Clone Project from Git Repository')}
          message={_('Choose the repository to clone:')}
          choices={cloneRepos.map((r) => ({
            value: r.full_name,
            label: r.private ? `${r.full_name}\t${_('Private')}` : `${r.full_name}\t${_('Public')}`,
          }))}
          onResult={(v) => void onCloneRepo(v)}
        />
      )}
      {cloneChoice && (
        <SingleChoiceDialog
          caption={_('Clone Project from Git Repository')}
          message={_('This repository holds several KiCad projects. Open which one?')}
          choices={cloneChoice.projects.map((p) => ({ value: p, label: p }))}
          onResult={(p) => {
            cloneChoice.resolve(p);
            setCloneChoice(null);
          }}
        />
      )}
    </>
  );

  return {
    versionControl,
    onVersionControl,
    cloneFromRepository,
    feedback,
    link,
    dialogs,
  };
}
