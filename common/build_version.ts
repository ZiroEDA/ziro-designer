// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/build_version.cpp`: the KiCad version the port follows. Data, not
 * chrome: the reports and file headers name the KiCad release whose formats
 * they write.
 */

import { version as REACT_VERSION } from 'react';

/** `KICAD_MAJOR_MINOR_PATCH_VERSION` of the reference build. */
export const KICAD_MAJOR_MINOR_PATCH_VERSION = '10.0.5';

export function GetMajorMinorPatchVersion(): string {
  return KICAD_MAJOR_MINOR_PATCH_VERSION;
}

export function GetMajorMinorPatchTuple(): readonly [number, number, number] {
  return [10, 0, 5];
}

/**
 * `__BUILD_STAMP__` is the app build's define (`designer/vite.config.ts`):
 * `"<sha> YYYY-MM-DD HH:MMZ"`, or `"dev"` with no git. A test run has no
 * define at all, hence the `typeof` guard.
 */
declare const __BUILD_STAMP__: string;
const buildStamp = (): string => (typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev');

/** `GetBuildVersion()`: KiCad's is the git describe string; ours is the sha. */
export function GetBuildVersion(): string {
  return buildStamp().split(' ')[0] ?? 'dev';
}

/** `GetBuildDate()`: KiCad's is `__DATE__ __TIME__`; ours is the stamp's time. */
export function GetBuildDate(): string {
  return buildStamp().split(' ').slice(1).join(' ');
}

/**
 * `s_glVendor`, `s_glRenderer`, `s_glVersion`, `s_glBackend`, which KiCad's
 * `SetOpenGLInfo` fills once the GAL has a context. Ours asks a throwaway
 * WebGL2 context on first use instead, since no single canvas owns the answer.
 */
let s_glInfo: string[] | undefined;

function glInfo(): string[] {
  if (s_glInfo) return s_glInfo;
  s_glInfo = [];
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      s_glInfo = [
        String(gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
        String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
        String(gl.getParameter(gl.VERSION)),
      ];
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // No DOM (a test) or no WebGL: the line is left out, as KiCad leaves it
    // out when SetOpenGLInfo was never called.
  }
  return s_glInfo;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * `GetVersionInfoData( aTitle, aHtml, aBrief )` (build_version.cpp:150): the
 * text behind the About dialog's Version page and its Copy Version Info
 * button, which is what a bug report pastes.
 *
 * Same sections in the same order. What KiCad reports about native libraries
 * (wxWidgets, Boost, OCC, Curl, ngspice, FreeType, the compiler and ABI, the
 * build-option switches) has no meaning in a browser and is left out rather
 * than faked. What the browser does answer takes its place: the user agent as
 * the platform, and the WebGL context as the OpenGL line.
 */
export function GetVersionInfoData(aTitle: string, aHtml = false, aBrief = false): string {
  // DO NOT translate information in the msg_version string (upstream's rule).
  const eol = aHtml ? '<br>' : '\n';
  // Tabs instead of spaces for the plaintext version, for shorter strings.
  const indent4 = aHtml ? '&nbsp;&nbsp;&nbsp;&nbsp;' : '\t';
  const text = (s: string): string => (aHtml ? escapeHtml(s) : s);

  let msg = `Application: ${text(aTitle)}${eol}${eol}`;
  msg += `Version: ${text(GetBuildVersion())}, release build${eol}${eol}`;
  msg += `Libraries:${eol}`;
  msg += `${indent4}React ${text(REACT_VERSION)}${eol}`;
  msg += eol;

  const platform = typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent;
  msg += `Platform: ${text(platform)}`;

  const gl = glInfo().filter((s) => s !== '');
  if (gl.length > 0) msg += `${eol}WebGL: ${text(gl.join(', '))}`;

  msg += eol + eol;

  if (!aBrief) {
    msg += `Build Info:${eol}`;
    msg += `${indent4}Date: ${text(GetBuildDate())}${eol}`;
  }
  return msg;
}
