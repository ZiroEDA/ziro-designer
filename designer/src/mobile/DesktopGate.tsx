import { useState, type JSX, type ReactNode } from 'react';
import { useDesktopGate } from './useDesktopGate.js';
import './desktopGate.css';

/** Copy to clipboard, falling back to a hidden textarea on non-secure origins. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* clipboard API unavailable (http:// origin, or permission denied) */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function GateCard({ onContinue }: { onContinue: () => void }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const url = window.location.href;
  const mailto =
    `mailto:?subject=${encodeURIComponent('Ziro Designer')}` +
    `&body=${encodeURIComponent(`Open this on your computer:\n\n${url}\n`)}`;

  return (
    <div className="ze-gate">
      <div className="ze-gate-card">
        <svg className="ze-gate-icon" viewBox="0 0 48 34" aria-hidden="true">
          <rect x="1" y="1" width="46" height="30" rx="2.5" />
          <path d="M17 33h14M24 31v2" />
        </svg>

        <h1 className="ze-gate-title">Ziro Designer needs a bigger screen</h1>

        <p className="ze-gate-body">
          Ziro Designer is a full EDA suite, schematic capture, PCB layout and 3D preview. It's
          built for a mouse, a keyboard and room to work, so there's no phone version yet.
        </p>
        <p className="ze-gate-body">Open this link on a laptop or desktop to get started.</p>

        <div className="ze-gate-actions">
          <button
            type="button"
            className="ze-gate-btn primary"
            onClick={() => {
              void copyText(url).then((ok) => {
                if (!ok) return;
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <a className="ze-gate-btn" href={mailto}>
            Email me the link
          </a>
        </div>

        <p className="ze-gate-hint">On a tablet? Rotate to landscape, or connect a mouse.</p>

        <button type="button" className="ze-gate-anyway" onClick={onContinue}>
          Continue anyway
        </button>
      </div>
    </div>
  );
}

/**
 * Desktop-only wall. On a small touch-only device the app is replaced by a card
 * explaining why, with a way to carry the link over to a real machine, a phone
 * visitor gets a deliberate product, not a collapsed desktop layout that reads
 * as broken. See {@link useDesktopGate} for what counts as "small touch-only";
 * tablets in landscape and anything with a mouse attached are let straight
 * through.
 *
 * This wraps the *whole* app rather than just the editors: our home screen is
 * KiCad's project manager (tree pane, drag splitter, status bar), which is no
 * more usable on a phone than the editors are.
 *
 * "Continue anyway" is always offered, the layout will be unusable, but a
 * determined visitor is never hard-blocked, and the choice sticks across
 * reloads.
 */
export function DesktopGate({ children }: { children: ReactNode }): JSX.Element {
  const { gated, dismiss } = useDesktopGate();
  if (gated) return <GateCard onContinue={dismiss} />;
  return <>{children}</>;
}
