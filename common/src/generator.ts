/**
 * How this application identifies itself inside the files it writes.
 *
 * KiCad's formats carry a `(generator ...)` token naming the program that wrote
 * the file, and Gerber X2 carries a `.GenerationSoftware` attribute naming the
 * vendor and application. Those fields exist so that a file can be traced back
 * to whatever produced it.
 *
 * We are not KiCad, so we must not write KiCad's program names into them. Doing
 * so is a misuse of the KiCad name, and it is practically harmful in a way that
 * is easy to overlook: a file we wrote would be indistinguishable from one
 * KiCad wrote, so any bug in our writers would be reported against KiCad by a
 * user who had no way of knowing otherwise.
 *
 * Nothing depends on the value. KiCad treats `generator` as informational and
 * does not check it against a list of known programs, so writing our own name
 * costs no compatibility.
 */

/** The company. Used where a format separates vendor from application. */
export const GENERATOR_VENDOR = 'ZiroEDA';

/** The application, in prose. */
export const GENERATOR_APPLICATION = 'Ziro Designer';

/**
 * The application as a `(generator ...)` token. Lowercase and underscored to
 * match the style of the values KiCad writes ("pcbnew", "kicad_symbol_editor").
 *
 * One name for every editor, unlike KiCad, whose editors are separate programs
 * and so identify separately. Ziro Designer is a single application, and
 * claiming otherwise in the file would be its own small fiction.
 */
export const GENERATOR = 'ziro_designer';

/**
 * Our version, not KiCad's. The format revision is carried separately by each
 * format's own `(version ...)` token, so this field is free to describe the
 * generator, which is what its name says it does.
 */
export const GENERATOR_VERSION = '1.0';
