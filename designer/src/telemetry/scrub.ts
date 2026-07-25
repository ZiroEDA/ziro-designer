/**
 * Payload scrubbing for crash reports.
 *
 * A board is intellectual property. Error text from an EDA tool routinely
 * carries the user's own design in it, file names, and sometimes net or
 * component identifiers quoted into a message, and none of that should leave
 * their machine because something threw.
 *
 * The scrubber is deliberately *not* maximal. Redacting every quoted string
 * would strip the diagnostic value that justifies collecting reports at all,
 * leaving noise nobody acts on. The line drawn here:
 *
 *   - **File names are always redacted.** They are user data, they are the most
 *     reliably identifying thing in a stack, and the extension alone carries
 *     essentially all the diagnostic value ("it was a .kicad_pcb").
 *   - **URLs keep their path, lose their query and hash**, which is where
 *     project and session identifiers live.
 *   - **Console breadcrumbs are dropped wholesale.** That is where bulk project
 *     data would leak, our own crash log includes a React component stack,
 *     which can embed props.
 *   - **Message text is otherwise preserved** and length-capped. A net name may
 *     survive inside a message; that is the accepted cost of reports being
 *     useful. Anyone who objects can switch reporting off.
 *
 * Structural types rather than Sentry's own keep this pure and testable, and
 * mean swapping transports never touches the privacy rules.
 */

/** The subset of a crash-report payload we inspect. Mirrors Sentry's shape. */
export interface ScrubbableEvent {
  message?: string;
  exception?: {
    values?: {
      type?: string;
      value?: string;
      stacktrace?: { frames?: { filename?: string; abs_path?: string }[] };
    }[];
  };
  breadcrumbs?: { category?: string; message?: string; data?: Record<string, unknown> }[];
  request?: { url?: string; query_string?: string; headers?: Record<string, string> };
  extra?: Record<string, unknown>;
  user?: Record<string, unknown>;
}

/** Longest message we forward; runaway strings are usually serialized state. */
const MAX_TEXT = 2000;

/**
 * User-file extensions to redact: KiCad's own project/library/fabrication types,
 * plus the 3D and archive formats that ride along in a project.
 */
const EXT =
  'kicad_sch|kicad_pcb|kicad_pro|kicad_prl|kicad_mod|kicad_sym|kicad_wks|kicad_dru|kicad_jobset|net|cir|step|stp|stl|wrl|glb|gbr|gko|pho|drl|zip|csv|bom';

/**
 * A filename inside quotes, how error text usually carries one. Matched first
 * and allowed to contain spaces, since the quotes bound it unambiguously.
 */
const QUOTED_FILE_RE = new RegExp(String.raw`(['"\`])[^'"\`]*?\.(${EXT})\1`, 'gi');

/**
 * A bare filename in free text. Deliberately excludes spaces: allowing them
 * made the match run backwards over ordinary prose ("cannot serialize
 * board.kicad_sch" collapsed to just the redaction), destroying the diagnostic
 * text that justifies collecting reports at all.
 *
 * Residual, accepted: an *unquoted* filename containing spaces keeps its
 * leading words ("My Board <redacted>.kicad_pcb"). KiCad discourages spaces in
 * project names, and the quoted and path forms above and below cover how these
 * actually appear in practice.
 */
const BARE_FILE_RE = new RegExp(String.raw`[\w\-.()[\]]+\.(${EXT})\b`, 'gi');

/** A path segment leading to a file: redact the directories with it. */
const PATH_FILE_RE = new RegExp(String.raw`[^\s'"\`]*/[^\s'"\`]*\.(${EXT})\b`, 'gi');

/** Redact file names and cap length, keeping the extension for diagnosis. */
export function scrubText(text: string): string {
  const redacted = text
    .replace(QUOTED_FILE_RE, (_m, q: string, ext: string) => `${q}<redacted>.${lower(ext)}${q}`)
    .replace(PATH_FILE_RE, (_m, ext: string) => `<redacted>.${lower(ext)}`)
    .replace(BARE_FILE_RE, (_m, ext: string) => `<redacted>.${lower(ext)}`);
  return redacted.length > MAX_TEXT ? `${redacted.slice(0, MAX_TEXT)}…[truncated]` : redacted;
}

const lower = (s: string): string => s.toLowerCase();

/**
 * Drop query string and fragment; keep origin + path for grouping by route.
 *
 * Deliberately a string split rather than `new URL()`: with a base, the URL
 * constructor accepts essentially any string, so the parse never fails, and it
 * percent-encodes the result into something harder to read than the input.
 */
export function scrubUrl(url: string): string {
  return scrubText(url.split(/[?#]/)[0] ?? '');
}

/**
 * Scrub a whole event in place-safe fashion (returns a new object graph for the
 * parts it touches). Applied as the last step before any transport sends.
 */
export function scrubEvent(event: ScrubbableEvent): ScrubbableEvent {
  const out: ScrubbableEvent = { ...event };

  if (out.message) out.message = scrubText(out.message);

  if (out.exception?.values) {
    out.exception = {
      values: out.exception.values.map((v) => ({
        ...v,
        value: v.value ? scrubText(v.value) : v.value,
        stacktrace: v.stacktrace && {
          frames: v.stacktrace.frames?.map((f) => ({
            ...f,
            // Bundle paths are ours and safe, but a frame can name a user file
            // (a worker blob, an imported model), scrub both path fields.
            filename: f.filename ? scrubUrl(f.filename) : f.filename,
            abs_path: f.abs_path ? scrubUrl(f.abs_path) : f.abs_path,
          })),
        },
      })),
    };
  }

  if (out.breadcrumbs) {
    out.breadcrumbs = out.breadcrumbs
      // Console output is the highest-risk carrier of project data.
      .filter((b) => b.category !== 'console')
      .map((b) => ({
        ...b,
        message: b.message ? scrubText(b.message) : b.message,
        data: b.data && scrubBreadcrumbData(b.data),
      }));
  }

  if (out.request) {
    const { url } = out.request;
    // headers can carry cookies/auth; query_string is dropped outright.
    out.request = url ? { url: scrubUrl(url) } : {};
  }

  // Never forward ad-hoc extras or identity: both are unbounded, and the
  // anonymous install id is attached by the transport as a tag instead.
  delete out.extra;
  delete out.user;

  return out;
}

function scrubBreadcrumbData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') out[k] = k === 'url' ? scrubUrl(v) : scrubText(v);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    // Objects/arrays are dropped: unbounded, and rarely diagnostic on their own.
  }
  return out;
}
