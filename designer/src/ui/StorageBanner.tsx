import { useEffect, useState, type JSX } from 'react';
import {
  storageStatus,
  subscribeStorageHealth,
  type StorageFailure,
  type StorageStatus,
} from '../home/storageHealth.js';
import { downloadRecoveryZip } from '../home/recovery.js';
import './errorBoundary.css';

const fmtMB = (n?: number): string => (n === undefined ? '?' : `${Math.round(n / 1e6)} MB`);

/** What to tell the user, in terms of what they can actually do about it. */
function explain(status: StorageStatus): { title: string; detail: string } {
  const failure: StorageFailure = status.failure ?? 'unknown';
  switch (failure) {
    case 'quota':
      return {
        title: "Your browser's storage is full, edits are no longer being saved.",
        detail: `Using ${fmtMB(status.usage)} of ${fmtMB(status.quota)}. Download your project, then delete old projects from the home screen to free space.`,
      };
    case 'blocked':
      return {
        title: 'This browser is blocking site storage, edits are not being saved.',
        detail:
          'Allow site data for this page, or download your project before closing the tab. Private-browsing windows often discard storage.',
      };
    case 'unsupported':
      return {
        title: 'This browser has no local storage, edits are not being saved.',
        detail: 'Download your project before closing the tab, or switch to a current browser.',
      };
    default:
      return {
        title: 'Saving failed, recent edits are not being stored.',
        detail: 'Download your project before closing the tab so nothing is lost.',
      };
  }
}

/**
 * Persistent warning shown when the project store cannot save.
 *
 * Silent failure is the dangerous case: without this, a user edits happily for
 * an hour and only discovers on reload that none of it persisted. So this is
 * loud, sits above every view, and cannot be dismissed while storage is broken
 * - each further edit is more work at risk. Its one action is the one that
 * actually helps: get the project onto the user's disk.
 */
export function StorageBanner(): JSX.Element | null {
  const [status, setStatus] = useState<StorageStatus>(storageStatus);
  const [saved, setSaved] = useState(false);

  useEffect(() => subscribeStorageHealth(setStatus), []);
  // Storage recovering (space freed, permission granted) makes a prior download
  // offer stale, reset so a later failure shows a live button again.
  useEffect(() => {
    if (status.ok) setSaved(false);
  }, [status.ok]);

  if (status.ok) return null;
  const { title, detail } = explain(status);

  return (
    <div className="ze-storage-banner" role="alert">
      <div className="ze-storage-banner-text">
        <b>{title}</b>
        {detail}
      </div>
      <button type="button" onClick={() => setSaved(downloadRecoveryZip())}>
        {saved ? 'Downloaded' : 'Download project'}
      </button>
    </div>
  );
}
