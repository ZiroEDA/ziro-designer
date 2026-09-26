// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gal/opengl/utils.h` + `.cpp`: `checkGlError`, the GL error check the
 * OpenGL GAL makes after each risky call.
 */

/**
 * Check if one of recent OpenGL operations has failed. If so, it displays appropriate
 * information, starting with aInfo string.
 *
 * @param aInfo is the beginning of the error message.
 * @param aThrow decides whether the function should throw an exception or return an error.
 * @return GL_NO_ERROR in case of success or one of GL error codes.
 */
/**
 * Whether `checkGlError` asks the context at all. Native `glGetError` is
 * cheap; a WebGL `getError()` is a synchronous round trip to the GPU process
 * that stalls the command stream, so the per-call checks the C++ makes are
 * skipped unless the application turns them on (a debug switch, as
 * `KICAD_GAL_PROFILE`-style tracing is).
 */
export let g_checkGlErrors = false;

export function SetCheckGlErrors(aEnable: boolean): void {
  g_checkGlErrors = aEnable;
}

export function checkGlError(
  gl: WebGL2RenderingContext,
  aInfo: string,
  aThrow = true,
  aFile = '',
  aLine = 0,
): number {
  if (!g_checkGlErrors) return 0;

  const result = gl.getError();
  let errorMsg = '';

  switch (result) {
    case gl.NO_ERROR:
      // all good
      break;

    case gl.INVALID_ENUM:
      errorMsg = `Error: ${aInfo}: invalid enum`;
      break;

    case gl.INVALID_VALUE:
      errorMsg = `Error: ${aInfo}: invalid value`;
      break;

    case gl.INVALID_OPERATION:
      errorMsg = `Error: ${aInfo}: invalid operation`;
      break;

    case gl.INVALID_FRAMEBUFFER_OPERATION: {
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        switch (status) {
          case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
            errorMsg = 'The framebuffer attachment points are incomplete.';
            break;

          case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
            errorMsg = 'No images attached to the framebuffer.';
            break;

          case gl.FRAMEBUFFER_UNSUPPORTED:
            errorMsg =
              'The combination of internal formats of the attached images violates ' +
              'an implementation dependent set of restrictions.';
            break;

          case gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE:
            errorMsg = 'GL_RENDERBUFFER_SAMPLES is not the same for all attached render buffers.';
            break;

          case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
            errorMsg = 'Framebuffer attachments have different dimensions';
            break;

          default:
            errorMsg = `Unknown incomplete framebuffer error id ${status.toString(16).toUpperCase()}`;
        }
      } else {
        errorMsg = `Error: ${aInfo}: invalid framebuffer operation`;
      }
      break;
    }

    case gl.OUT_OF_MEMORY:
      errorMsg = `Error: ${aInfo}: out of memory`;
      break;

    case gl.CONTEXT_LOST_WEBGL:
      errorMsg = `Error: ${aInfo}: context lost`;
      break;

    default:
      errorMsg = `Error: ${aInfo}: unknown error`;
      break;
  }

  if (result !== gl.NO_ERROR) {
    if (aThrow) {
      throw new Error(errorMsg);
    }

    console.error(`glGetError() '${errorMsg}' in file '${aFile}' on line ${aLine}.`);
  }

  return result;
}
