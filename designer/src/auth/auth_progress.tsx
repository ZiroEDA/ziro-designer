// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * What a sign-in or sign-up is doing while it takes seconds, said as it happens.
 *
 * The seconds are the encryption: Argon2id hardens the password on this device before anything
 * is sent, and again to unlock the account's key (cloud/crypto.ts). A button that only said
 * "Generating encryption keys..." over a page that froze read as a hang, and people left. Each
 * stage now names itself, says why it is there, and fills a bar over the time it usually takes -
 * measured: 0.5-1 s to harden the password (often done already, primed while typing), 1-3 s to
 * unlock or make the key.
 */
import { type JSX, useEffect, useState } from 'react';
import { Gauge } from '@ziroeda/wx/controls.js';

export interface AuthStage {
  label: string;
  /** Why it is there: the protection it buys. */
  why: string;
  /** How long it usually takes; the bar fills over it and waits near the end. */
  expectMs: number;
}

export const AUTH_STAGE = {
  secure: {
    label: 'Securing your password on this device',
    why: 'Your password never leaves your computer. It is turned into a key here first.',
    expectMs: 1000,
  },
  check: {
    label: 'Checking your account',
    why: "Confirming it's you with ZiroEDA's server.",
    expectMs: 1500,
  },
  unlock: {
    label: 'Unlocking your encrypted projects',
    why: 'Your projects are end-to-end encrypted: only your password opens them, not even ZiroEDA can.',
    expectMs: 3000,
  },
  create: {
    label: 'Creating your account',
    why: 'Registering your email with ZiroEDA.',
    expectMs: 1500,
  },
  confirm: {
    label: 'Confirming your email',
    why: 'Checking the code we sent you.',
    expectMs: 1500,
  },
  keys: {
    label: 'Generating your encryption keys',
    why: 'Keys only you hold, made on this device. Your designs are encrypted with them before they ever leave it.',
    expectMs: 3000,
  },
} as const satisfies Record<string, AuthStage>;

export interface AuthProgress {
  stage: AuthStage;
  /** 1-based. */
  step: number;
  steps: number;
  /** `performance.now()` when the stage began. */
  startedAt: number;
}

/** How far along the whole run is, 0-100: done stages, and this one by its usual time. */
export function progressPercent(aProgress: AuthProgress, aNow: number): number {
  const within = Math.min(
    0.95,
    Math.max(0, (aNow - aProgress.startedAt) / aProgress.stage.expectMs),
  );
  return Math.round(((aProgress.step - 1 + within) / aProgress.steps) * 100);
}

/** The stage whose words take the most room: the one the panel's space is kept for. */
export const LONGEST_STAGE: AuthStage = Object.values(AUTH_STAGE).reduce((a, b) =>
  b.why.length + b.label.length > a.why.length + a.label.length ? b : a,
);

/** One stage, drawn: its name and step, the bar, and why it is there. */
function StageView({
  stage,
  step,
  steps,
  percent,
}: {
  stage: AuthStage;
  step: number;
  steps: number;
  percent: number;
}): JSX.Element {
  return (
    <div className="ze-auth-field">
      <span>
        {stage.label}... (step {step} of {steps})
      </span>
      <Gauge value={percent} range={100} />
      <p className="ze-auth-note">{stage.why}</p>
    </div>
  );
}

/**
 * The stage being run, its step, a bar that fills, and why it is worth the wait - in a space
 * kept for it whether or not one runs: the form is centred, so a panel that came and went, or
 * grew and shrank between stages, moved the email and password with it. An invisible copy of the
 * longest stage holds the space (the status bar's `.ze-size-template`), the live one over it.
 */
export function AuthProgressPanel({ progress }: { progress: AuthProgress | null }): JSX.Element {
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!progress) return;

    let frame = requestAnimationFrame(function tick() {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [progress]);

  return (
    <div className="ze-auth-progress" role="status" aria-live="polite">
      <div className="ze-size-template" aria-hidden="true">
        <StageView stage={LONGEST_STAGE} step={3} steps={3} percent={0} />
      </div>
      {progress && (
        <StageView
          stage={progress.stage}
          step={progress.step}
          steps={progress.steps}
          percent={progressPercent(progress, now)}
        />
      )}
    </div>
  );
}
