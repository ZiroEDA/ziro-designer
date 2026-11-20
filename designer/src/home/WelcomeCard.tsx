// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The welcome card in the project manager while no project is open. ZiroEDA only: KiCad's
 * manager opens on the launcher tiles alone, which suits someone with KiCad projects on disk
 * and is a dead end for someone arriving from a link with nothing (the usage counts: 72% of
 * visitors left without one active minute). The card offers the three ways in - a demo
 * board, your own project, a new one - each through what the File menu already does. The
 * launcher tiles below it stay exactly as upstream draws them, and the card goes away as
 * soon as a project is open.
 */
import { useEffect, type JSX } from 'react';
import { _ } from '@ziroeda/wx/translation.js';
import { NoteUsage } from '@ziroeda/common/usage_hooks.js';
import './welcome_card.css';

export interface WelcomeDemo {
  id: string;
  title: string;
  blurb: () => string;
  /** Under the app's public folder. */
  image: string;
}

/**
 * The boards the card offers: things people build, small enough to open quickly (0.3 to
 * 7 MB). Pictures are their 3D views, made from the boards themselves.
 */
export const WELCOME_DEMOS: readonly WelcomeDemo[] = [
  {
    id: 'openair-max',
    title: 'OpenAir Max',
    blurb: () => _('ESP32-C6 air quality monitor'),
    image: 'welcome/openair-max.webp',
  },
  {
    id: 'stickhub',
    title: 'StickHub',
    blurb: () => _('USB hub on a stick'),
    image: 'welcome/stickhub.webp',
  },
  {
    id: 'cm5_minima',
    title: 'CM5 Minima',
    blurb: () => _('Raspberry Pi CM5 carrier board'),
    image: 'welcome/cm5_minima.webp',
  },
];

export interface WelcomeCardProps {
  /** The demo ids the demo list has; a board missing from it is not offered. */
  available: ReadonlySet<string>;
  onDemo: (aId: string) => void;
  onOpenProject: () => void;
  onOpenZip: () => void;
  onOpenGithub: () => void;
  onNewProject: () => void;
}

const BASE: string =
  (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

export function WelcomeCard(p: WelcomeCardProps): JSX.Element {
  // The usage counts learn that the card was seen, and which way in each visitor took.
  useEffect(() => NoteUsage('welcome', { action: 'shown' }), []);
  const act = (aAction: string, aRun: () => void) => (): void => {
    NoteUsage('welcome', { action: aAction });
    aRun();
  };
  const demos = WELCOME_DEMOS.filter((d) => p.available.has(d.id));

  return (
    <section className="ze-welcome" aria-labelledby="ze-welcome-title">
      <h2 id="ze-welcome-title" className="ze-welcome-title">
        {_('Welcome to ZiroEDA')}
      </h2>
      <p className="ze-welcome-lead">
        {_('KiCad 10 in your browser: schematics, PCB layout and 3D, with nothing to install.')}
      </p>

      <div className="ze-welcome-cols">
        {demos.length > 0 && (
          <div className="ze-welcome-col ze-welcome-col-demos">
            <h3 className="ze-welcome-head">{_('Try a demo board')}</h3>
            <div className="ze-welcome-demos">
              {demos.map((d) => (
                <button
                  type="button"
                  key={d.id}
                  className="ze-welcome-demo"
                  onClick={act(`demo:${d.id}`, () => p.onDemo(d.id))}
                >
                  <img src={`${BASE}${d.image}`} alt="" width={240} height={150} loading="lazy" />
                  <span className="name">{d.title}</span>
                  <span className="desc">{d.blurb()}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ze-welcome-col">
          <h3 className="ze-welcome-head">{_('Open your KiCad project')}</h3>
          <div className="ze-welcome-buttons">
            <button type="button" className="ze-btn primary" onClick={act('open', p.onOpenProject)}>
              {_('Open Project...')}
            </button>
            <button type="button" className="ze-btn" onClick={act('zip', p.onOpenZip)}>
              {_('Open a .zip...')}
            </button>
            <button type="button" className="ze-btn" onClick={act('github', p.onOpenGithub)}>
              {_('Open from GitHub...')}
            </button>
          </div>
          <p className="ze-welcome-hint">
            {_('Or drop a project folder or .zip anywhere on this window.')}
          </p>

          <h3 className="ze-welcome-head">{_('Start from scratch')}</h3>
          <div className="ze-welcome-buttons">
            <button type="button" className="ze-btn" onClick={act('new', p.onNewProject)}>
              {_('New Project...')}
            </button>
          </div>
          <p className="ze-welcome-hint">
            {_('Projects are kept in this browser. Sign in to sync them across your devices.')}
          </p>
        </div>
      </div>
    </section>
  );
}
