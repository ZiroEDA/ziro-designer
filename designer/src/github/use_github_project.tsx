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
import {
  type GithubInstallation,
  type GithubRepo,
  connectionInfo,
  listAppRepos,
  listInstallations,
} from './github_api.js';
import {
  GITHUB_INSTALLATIONS_SETTINGS,
  GithubAuthError,
  GithubAuthRequired,
  GithubSession,
  type GithubTokens,
  accessSettingsUrl,
  afterSignIn,
  beginGithubConnect,
  clearTokens,
  disconnectGithub,
  loadTokens,
  onGithubAccessUpdated,
  saveTokens,
} from './github_auth.js';
import {
  type CommitPlan,
  GIT_LINK_FILE,
  type GitLink,
  GithubAccessError,
  type PullPlan,
  type RepoProjects,
  addBranch,
  branchNames,
  cloneRepository,
  fetchPull,
  findKicadProjects,
  gitLinkBytes,
  gitLinkOf,
  localView,
  remoteFilesOf,
  syncedFilesOf,
  isValidBranchName,
  planCommit,
  planPull,
  pushNewRepository,
  pushToExistingRepository,
  repoNameFor,
  runCommit,
  upstreamOf,
} from './github_project.js';
import { DialogPushToGithub, type PushToGithubAnswer } from './dialog_push_to_github.js';
import {
  DialogOpenFromGithub,
  type GithubRepoList,
  type OpenFromGithubAnswer,
} from './dialog_open_from_github.js';
import { DialogGithubNotice, openGithubPage } from './dialog_github_notice.js';
import { type GitFileStatus, gitFileStatuses, startRemoteChecks } from './git_status.js';

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
  /** `COMMON_SETTINGS::m_Git.updatInterval`: minutes between remote checks; 0, only the first. */
  remoteIntervalMinutes: number;
  /** Names (lower-cased) of the projects already in the store: an opened one must not take one. */
  takenNames: ReadonlySet<string>;
  setLoading: (aLoading: Loading) => void;
  /** Re-read a project from the store into the tree (and open it, for one just brought in). */
  openStored: (aId: string) => Promise<void>;
  /**
   * Every open editor's unsaved work into the store, settled once written. A pull, commit or
   * branch switch reads the project from the store; without this an edit still held by an editor
   * was neither committed nor protected from the pull, and was written back over it later.
   */
  flushEditors: () => Promise<void>;
  /** After a pull rewrote the files: re-read the tree AND reload the editors that hold them. */
  reloadOpenProject: (aId: string) => Promise<void>;
  /** Files of the open project changed in the store without a re-read: patch the tree's copy. */
  patchOpenFiles: (aWrites: readonly { name: string; bytes: Uint8Array }[]) => void;
  /** A project's record was written: refresh the list and push it to the account. */
  onStoreWritten: (aId: string) => void;
  /**
   * The link pasted into Open Project from GitHub...: that project, read-only, as its
   * `/gh/<owner>/<repo>` address opens it - or, for an address that is no GitHub link, the error
   * the dialog has always given.
   */
  openGithubLink: (aText: string) => void;
}

/** A notice with a link to GitHub, or a question whose button takes the step (DialogGithubNotice). */
interface Notice {
  caption: string;
  message: string;
  detail?: string;
  link?: { label: string; url: string };
  action?: { label: string; run: () => void };
}

export interface GithubProject {
  /** The Version Control submenu's state; null with no project of the user's open. */
  versionControl: VcsMenuState | null;
  /** The submenu's rows, by id. */
  onVersionControl: (aId: TreeMenuEntryId, aBranch?: string) => void;
  /** File > Open Project from GitHub... */
  openFromGithub: () => void;
  /** `showGitFeedback`'s line for the status bar, while it lasts. */
  feedback: string | null;
  /** The link of the open project, if it has one. */
  link: GitLink | null;
  /** Each file's Git status, for the tree's state images; null when there are none to draw. */
  gitStatus: ReadonlyMap<string, GitFileStatus> | null;
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
  /** Where the App is installed for this person: what "Change repository access" opens. */
  const [installations, setInstallations] = useState<GithubInstallation[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  /** Push to GitHub... is up, with the repositories it offers as existing ones. */
  const [pushRepos, setPushRepos] = useState<GithubRepo[] | null>(null);
  const [commitPlan, setCommitPlan] = useState<CommitPlan | null>(null);
  const [conflict, setConflict] = useState<PullPlan | null>(null);
  const [switchList, setSwitchList] = useState<string[] | null>(null);
  /** Open Project from GitHub... is up, and its list of the person's projects. */
  const [openOpen, setOpenOpen] = useState(false);
  const [repoList, setRepoList] = useState<GithubRepoList | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** Moves when GitHub says the App's repository access changed: everything listed is stale. */
  const [accessNonce, setAccessNonce] = useState(0);
  /** The repositories the App may use, once asked, until the access changes. */
  const appReposRef = useRef<{ installations: GithubInstallation[]; repos: GithubRepo[] } | null>(
    null,
  );
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

  // An install, or the person changing ZiroEDA's repositories on GitHub (in its window, or in a
  // tab of their own): what was listed is stale.
  useEffect(
    () =>
      onGithubAccessUpdated(() => {
        appReposRef.current = null;
        setAccessNonce((n) => n + 1);
      }),
    [],
  );

  // Where the App is installed, for the links to change it: asked again after every change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: accessNonce is the trigger
  useEffect(() => {
    if (!account.connected) {
      setInstallations([]);
      return;
    }
    let live = true;
    listInstallations(session.fetch).then(
      (list) => {
        if (live) setInstallations(list);
      },
      (e) => console.warn('GitHub installations failed:', why(e)),
    );
    return () => {
      live = false;
    };
  }, [account.connected, session, accessNonce]);

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

  // --- the tree's Git status (updateGitStatusIconMap) --------------------------------

  /** The synced commit's files: the link's record, or fetched for a link older than it. */
  const [synced, setSynced] = useState<ReadonlyMap<string, string> | null>(null);
  /** The project's files by blob id, as the tree holds them. */
  const [working, setWorking] = useState<ReadonlyMap<string, string> | null>(null);
  /** The remote branch at the last check: its head and files. */
  const [remote, setRemote] = useState<{ head: string; files: ReadonlyMap<string, string> } | null>(
    null,
  );
  const syncKey = link ? `${link.owner}/${link.repo}#${link.branch}@${link.commit}` : '';

  // biome-ignore lint/correctness/useExhaustiveDependencies: syncKey is the trigger; the link is read through its ref
  useEffect(() => {
    const l = linkRef.current;
    setSynced(null);
    setRemote(null);
    if (!l) return;
    if (l.files) {
      setSynced(new Map(Object.entries(l.files)));
      return;
    }
    if (!account.connected) return;
    let live = true;
    syncedFilesOf(session.fetch, l).then(
      (m) => {
        if (live) setSynced(m);
      },
      (e) => console.warn('GitHub tree failed:', why(e)),
    );
    return () => {
      live = false;
    };
  }, [syncKey, account.connected, session]);

  // The files' blob ids, again whenever the tree's copy changes.
  useEffect(() => {
    const files = host.picked;
    if (!link || !files) {
      setWorking(null);
      return;
    }
    let live = true;
    const enc = new TextEncoder();
    const timer = setTimeout(() => {
      void localView(
        files.map((f) => ({ name: f.name, bytes: f.bytes ?? enc.encode(f.text) })),
      ).then((view) => {
        if (live) setWorking(new Map([...view].map(([p, e]) => [p, e.sha])));
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [host.picked, link]);

  // `onGitSyncTimer`: the remote check, once soon and then every `updatInterval` minutes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: syncKey is the trigger; the link is read through its ref
  useEffect(() => {
    if (!linkRef.current || !account.connected || !host.enableGit) return;
    return startRemoteChecks({
      intervalMinutes: host.remoteIntervalMinutes,
      check: async () => {
        const l = linkRef.current;
        if (!l) return;
        try {
          const r = await remoteFilesOf(session.fetch, l);
          if (linkRef.current?.commit === l.commit) setRemote(r);
        } catch (e) {
          console.warn('GitHub remote check failed:', why(e));
        }
      },
      isVisible: () => document.visibilityState === 'visible',
      onVisible: (listener) => {
        const on = (): void => {
          if (document.visibilityState === 'visible') listener();
        };
        document.addEventListener('visibilitychange', on);
        return () => document.removeEventListener('visibilitychange', on);
      },
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
  }, [syncKey, account.connected, session, host.enableGit, host.remoteIntervalMinutes]);

  const gitStatus = useMemo(
    () =>
      host.enableGit && link && synced && working
        ? gitFileStatuses(working, synced, link.pending, remote ? remote.files : null)
        : null,
    [host.enableGit, link, synced, working, remote],
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
   *
   * First the sign-in (`authorize`): a person who installed the App before - on another device -
   * is done there. One with no installation is then asked to install it, which picks the
   * repositories it may use; that button's click opens the install page (`install`), and the
   * install finishes the sign-in again at the same callback.
   */
  const connect = useCallback(
    (aThen?: () => void, aHow: 'authorize' | 'install' = 'authorize'): void => {
      beginGithubConnect(window, aHow).then(
        async (t: GithubTokens) => {
          const once = new GithubSession({
            fetch: (...a) => fetch(...a),
            load: async () => t,
            save: async () => {},
            clear: () => {},
          });
          let info: { login: string; installations: GithubInstallation[] } | null = null;
          try {
            info = await connectionInfo(once.fetch);
          } catch {
            info = null;
          }
          try {
            await saveTokens(userKey, info ? { ...t, login: info.login } : t);
          } catch (e) {
            DisplayErrorMessage(_('Could not connect GitHub.'), why(e));
            return;
          }
          appReposRef.current = null;
          setAccount({ connected: true, ...(info ? { login: info.login } : {}) });
          if (info) setInstallations(info.installations);
          setAccessNonce((n) => n + 1);
          const next = afterSignIn(info ? info.installations : null, aHow);
          if (info && next !== 'connected' && next !== 'unknown') {
            if (next === 'pending') {
              // Back from the install page and still nothing installed: an organisation's owners
              // were asked to approve it, or the page was left without installing.
              setNotice({
                caption: _('Connect GitHub'),
                message: _(
                  'GitHub did not report ZiroEDA installed on any of your accounts. If you asked an organization to install it, connect again once its owners have approved it.',
                ),
              });
              return;
            }
            setNotice({
              caption: _('Connect GitHub'),
              message: wxFormat(
                _(
                  'You are signed in to GitHub as %s, but ZiroEDA is not installed on your account yet.',
                ),
                info.login,
              ),
              detail: _(
                'Installing it is where you choose which repositories ZiroEDA may use: all of them, or only the ones you select.',
              ),
              action: { label: _('Install on GitHub...'), run: () => connect(aThen, 'install') },
            });
            return;
          }
          if (info) showFeedback(wxFormat(_('Connected to GitHub as %s.'), info.login));
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

  /**
   * Version Control > Disconnect GitHub: GitHub revokes this device's token (api/github/revoke.js)
   * and the app forgets it. The installation stays - it is the person's, on GitHub - and the note
   * says where it is.
   */
  const disconnect = async (): Promise<void> => {
    const problem = await disconnectGithub(userKey, (...a) => fetch(...a));
    appReposRef.current = null;
    setAccount({ connected: false });
    setInstallations([]);
    setBranches([]);
    setNotice({
      caption: _('Disconnect GitHub'),
      message: _('ZiroEDA is disconnected from GitHub on this device.'),
      detail:
        (problem
          ? `${wxFormat(_('GitHub could not be told to revoke the connection (%s), but this device no longer holds it.'), problem)}\n\n`
          : '') +
        _(
          'ZiroEDA is still installed on GitHub. To uninstall it, or to change which repositories it may use, open your installed GitHub Apps.',
        ),
      link: { label: _('Installed GitHub Apps'), url: GITHUB_INSTALLATIONS_SETTINGS },
    });
  };

  /** The repositories the App may use: asked once, and again after the access changes. */
  const appRepos = async (): Promise<{
    installations: GithubInstallation[];
    repos: GithubRepo[];
  }> => {
    if (appReposRef.current) return appReposRef.current;
    const got = await listAppRepos(session.fetch);
    appReposRef.current = got;
    setInstallations(got.installations);
    return got;
  };

  /** "Change repository access on GitHub". */
  const changeAccess = (): void => openGithubPage(accessSettingsUrl(installations));

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
    await hostRef.current.flushEditors();
    const loaded = await loadProject(aId);
    if (!loaded) throw new Error(_('The project is no longer in this browser.'));
    return loaded.files;
  };

  // --- Push to GitHub... ---------------------------------------------------------

  const pushToGithub = (): void =>
    withGithub(async () => {
      const { setLoading } = hostRef.current;
      setLoading({
        title: _('Push to GitHub'),
        label: _('Listing the repositories ZiroEDA can use...'),
      });
      try {
        setPushRepos((await appRepos()).repos);
      } catch (e) {
        report(_('Failed to push project'), e);
      } finally {
        setLoading(null);
      }
    });

  const onPushResult = async (aAnswer: PushToGithubAnswer | null): Promise<void> => {
    setPushRepos(null);
    const id = hostRef.current.projectId;
    if (!aAnswer || !id) return;
    const { setLoading } = hostRef.current;
    const target = aAnswer.kind === 'new' ? aAnswer.name : aAnswer.repo.full_name;
    setLoading({
      title: _('Push to GitHub'),
      label: wxFormat(_('Pushing %s to GitHub...'), target),
    });
    try {
      const files = await filesOf(id);
      const { link: made } =
        aAnswer.kind === 'new'
          ? await pushNewRepository(session.fetch, aAnswer.name, aAnswer.isPrivate, files)
          : await pushToExistingRepository(session.fetch, aAnswer.repo, files);
      appReposRef.current = null;
      await writeLink(id, made);
      showFeedback(wxFormat(_('Pushed %s to %s.'), made.branch, upstreamOf(made)));
    } catch (e) {
      if (e instanceof GithubAccessError)
        setNotice({
          caption: _('Failed to push project'),
          message: e.message,
          link: {
            label: _('Change repository access on GitHub'),
            url: accessSettingsUrl(installations),
          },
        });
      else report(_('Failed to push project'), e);
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
      // Upstream's editors reload the files the pull changed on disk. Re-reading the manager's
      // tree alone left the open editors on their pre-pull files, and they wrote them back over
      // the pull at the next save (end-to-end test 11-19): they reload too.
      await hostRef.current.reloadOpenProject(id);
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

  // --- Open Project from GitHub... ------------------------------------------------

  /** File > Open Project from GitHub...: the dialog is up at once, connected or not. */
  const openFromGithub = (): void => setOpenOpen(true);

  // The dialog's list: the repositories the App may use, then the KiCad projects in each, growing
  // as each is answered. Again whenever the access changes, or GitHub is connected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: accessNonce is the trigger; appRepos reads refs and the session
  useEffect(() => {
    if (!openOpen || !account.connected) {
      setRepoList(null);
      return;
    }
    let live = true;
    setRepoList({ all: [], found: [], status: 'listing' });
    (async () => {
      try {
        const { repos } = await appRepos();
        if (!live) return;
        const found: RepoProjects[] = [];
        setRepoList({ all: repos, found, status: 'scanning', done: 0, total: repos.length });
        const all = await findKicadProjects(session.fetch, repos, (done, total, hit) => {
          if (!live) return;
          if (hit) found.push(hit);
          setRepoList({ all: repos, found: [...found], status: 'scanning', done, total });
        });
        if (live) setRepoList({ all: repos, found: all, status: 'ready' });
      } catch (e) {
        if (!live) return;
        if (e instanceof GithubAuthRequired) setAccount({ connected: false });
        setRepoList({ all: [], found: [], status: 'error', error: why(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [openOpen, account.connected, session, accessNonce]);

  const onOpenResult = (aAnswer: OpenFromGithubAnswer | null): void => {
    setOpenOpen(false);
    if (!aAnswer) return;
    if (aAnswer.kind === 'link') hostRef.current.openGithubLink(aAnswer.text);
    else void onOpenRepo(aAnswer.repo, aAnswer.project);
  };

  /**
   * One of the person's repositories, opened as their own project linked to it: what Clone does
   * in KiCad. `project`, chosen in the list already, skips "Open which one?".
   */
  const onOpenRepo = async (repo: GithubRepo, project?: string): Promise<void> => {
    const { setLoading } = hostRef.current;
    const title = _('Open Project from GitHub');
    const message = wxFormat(_('Downloading %s from GitHub...'), repo.full_name);
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
        (name) =>
          hostRef.current.takenNames.has(name.toLowerCase())
            ? wxFormat(
                _(
                  'A project named %s already exists. Rename or delete it first, then open it again.',
                ),
                name,
              )
            : null,
        project,
      );
      if (!got) return;
      const name = got.project.slice(got.project.lastIndexOf('/') + 1).replace(/\.kicad_pro$/i, '');
      if (hostRef.current.takenNames.has(name.toLowerCase()))
        throw new Error(
          wxFormat(
            _('A project named %s already exists. Rename or delete it first, then open it again.'),
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
      showFeedback(wxFormat(_('Opened %s.'), repo.full_name));
    } catch (e) {
      report(wxFormat(_('Could not open %s.'), repo.full_name), e);
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
      case 'disconnectGithub':
        void disconnect();
        return;
      case 'pushToGithub':
        pushToGithub();
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
      {pushRepos && (
        <DialogPushToGithub
          defaultName={repoNameFor(host.projectName)}
          owner={account.login ?? _('your GitHub account')}
          repos={pushRepos}
          onChangeAccess={changeAccess}
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
      {openOpen && (
        <DialogOpenFromGithub
          connected={account.connected}
          list={repoList}
          onConnect={() => connect()}
          onChangeAccess={changeAccess}
          onResult={onOpenResult}
        />
      )}
      {notice && (
        <DialogGithubNotice
          caption={notice.caption}
          message={notice.message}
          {...(notice.detail ? { detail: notice.detail } : {})}
          {...(notice.link ? { link: notice.link } : {})}
          {...(notice.action ? { action: notice.action } : {})}
          onClose={() => setNotice(null)}
        />
      )}
      {cloneChoice && (
        <SingleChoiceDialog
          caption={_('Open Project from GitHub')}
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
    openFromGithub,
    feedback,
    link,
    gitStatus,
    dialogs,
  };
}
