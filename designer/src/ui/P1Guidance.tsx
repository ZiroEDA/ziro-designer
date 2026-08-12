import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';

export interface GuidanceAction {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  keywords?: string;
  disabled?: boolean;
  run: () => void;
}

const DISCORD_URL = 'https://discord.gg/e97xkc2GV';
const DOCS_URL = 'https://designer.ziroeda.com/docs';
const BUG_URL = 'https://github.com/ZiroEDA/ziro-designer/issues';

export function CommandPalette({
  actions,
  onClose,
}: {
  actions: GuidanceAction[];
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return actions.filter((a) => !q || `${a.label} ${a.description} ${a.keywords ?? ''}`.toLowerCase().includes(q));
  }, [actions, query]);
  return (
    <div className="ze-p1-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ze-command-palette" role="dialog" aria-modal="true" aria-label="Command search">
        <div className="ze-command-search">
          <span aria-hidden="true">⌕</span>
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search commands, tools, and help…" aria-label="Search commands" />
          <kbd>Esc</kbd>
        </div>
        <div className="ze-command-results">
          {matches.length === 0 ? <div className="ze-command-empty">No matching commands. Try “schematic”, “shortcut”, or “Discord”.</div> : matches.map((a) => (
            <button key={a.id} className="ze-command-item" disabled={a.disabled} onClick={() => { a.run(); onClose(); }}>
              <span><strong>{a.label}</strong><small>{a.description}</small></span>
              {a.shortcut && <kbd>{a.shortcut}</kbd>}
            </button>
          ))}
        </div>
        <div className="ze-command-footer">Command search <kbd>Ctrl+K</kbd> · Open Help for shortcuts and support</div>
      </div>
    </div>
  );
}

export function OnboardingPanel({
  hasProject,
  hasSavedProject,
  onNewProject,
  onOpenProject,
  onOpenDemo,
  onOpenDocs,
  onOpenDiscord,
  onReportBug,
}: {
  hasProject: boolean;
  hasSavedProject: boolean;
  onNewProject: () => void;
  onOpenProject: () => void;
  onOpenDemo: () => void;
  onOpenDocs: () => void;
  onOpenDiscord: () => void;
  onReportBug: () => void;
}): JSX.Element | null {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('ziro.p1OnboardingDismissed') === '1');
  if (dismissed) return null;
  const complete = hasProject || hasSavedProject;
  return (
    <section className="ze-onboarding" aria-label="Getting started with ZIRO Designer">
      <div className="ze-onboarding-main">
        <div className="ze-eyebrow">QUICK START</div>
        <h2>{complete ? 'Keep building with ZIRO Designer' : 'Start your first board in minutes'}</h2>
        <p>{complete ? 'Your work is ready. Use the command search or help menu whenever you need a shortcut.' : 'Choose a path below. You can try a demo without importing anything, or open your own KiCad project.'}</p>
        <div className="ze-onboarding-actions">
          <button className="ze-btn primary" onClick={onOpenDemo}>Try a demo</button>
          <button className="ze-btn" onClick={onNewProject}>Create project</button>
          <button className="ze-btn" onClick={onOpenProject}>Import KiCad files</button>
        </div>
      </div>
      <div className="ze-onboarding-checklist">
        <div className="ze-checklist-title">First-run checklist</div>
        <div className={`ze-check ${complete ? 'done' : ''}`}><span>{complete ? '✓' : '1'}</span> Open a demo or project</div>
        <div className="ze-check"><span>2</span> Open the Schematic Editor</div>
        <div className="ze-check"><span>3</span> Save or export your work</div>
        <div className="ze-check"><span>4</span> Ask the community when stuck</div>
      </div>
      <div className="ze-onboarding-links">
        <button onClick={onOpenDocs}>Read docs</button><button onClick={onOpenDiscord}>Join Discord</button><button onClick={onReportBug}>Report a bug</button>
        <button className="ze-onboarding-dismiss" onClick={() => { localStorage.setItem('ziro.p1OnboardingDismissed', '1'); setDismissed(true); }}>Dismiss</button>
      </div>
    </section>
  );
}

export const P1_SUPPORT_URLS = { discord: DISCORD_URL, docs: DOCS_URL, bug: BUG_URL };

export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function ContextHint({ children }: { children: ReactNode }): JSX.Element {
  return <div className="ze-context-hint"><span aria-hidden="true">i</span><span>{children}</span></div>;
}

export const p1SupportUrls = P1_SUPPORT_URLS;
export const openP1External = openExternal;
