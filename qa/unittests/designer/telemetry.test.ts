/**
 * Crash-report scrubbing and the opt-out boundary
 * (designer/src/telemetry/{scrub,reporter}.ts).
 *
 * A board is intellectual property, so these tests pin down both halves of the
 * bargain: that identifying data is stripped before anything is sent, and that
 * a user who switches reporting off has nothing sent at all.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  scrubEvent,
  scrubText,
  scrubUrl,
  type ScrubbableEvent,
} from '@ziroeda/designer/src/telemetry/scrub.js';
import {
  prepareEvent,
  reportingEnabled,
  setReportingEnabled,
} from '@ziroeda/designer/src/telemetry/reporter.js';

afterEach(() => setReportingEnabled(true));

describe('scrubText', () => {
  it('redacts project file names but keeps the extension', () => {
    expect(scrubText('Failed to parse power-supply-rev-c.kicad_sch at line 42')).toBe(
      'Failed to parse <redacted>.kicad_sch at line 42',
    );
  });

  it('redacts every KiCad file type, plus 3D and fabrication outputs', () => {
    for (const ext of ['kicad_pcb', 'kicad_pro', 'kicad_mod', 'kicad_sym', 'step', 'gbr', 'drl']) {
      expect(scrubText(`secret-board.${ext} failed`)).toBe(`<redacted>.${ext} failed`);
    }
  });

  it('fully redacts a quoted name, spaces and all', () => {
    const out = scrubText(`Failed to open 'My Board (rev 2).kicad_pcb'`);
    expect(out).toBe(`Failed to open '<redacted>.kicad_pcb'`);
    expect(out).not.toContain('My Board');
  });

  it('redacts the directories of a path, not just the file', () => {
    const out = scrubText('reading /home/ada/clients/acme/board.kicad_pcb now');
    expect(out).toBe('reading <redacted>.kicad_pcb now');
    expect(out).not.toContain('acme');
  });

  it('does not eat surrounding prose to reach a filename', () => {
    // Regression: a space-tolerant pattern matched backwards over the sentence,
    // collapsing "cannot serialize board.kicad_sch" to just the redaction.
    expect(scrubText('cannot serialize board.kicad_sch')).toBe(
      'cannot serialize <redacted>.kicad_sch',
    );
  });

  it('leaves ordinary diagnostic text alone', () => {
    const msg = "Cannot read properties of undefined (reading 'uuid')";
    expect(scrubText(msg)).toBe(msg);
  });

  it('caps runaway strings, which are usually serialized state', () => {
    const out = scrubText('x'.repeat(5000));
    expect(out.length).toBeLessThan(2100);
    expect(out.endsWith('…[truncated]')).toBe(true);
  });
});

describe('scrubUrl', () => {
  it('keeps origin and path but drops query and fragment', () => {
    expect(scrubUrl('https://app.ziro.dev/editor?project=acme-secret&sheet=3#net-VCC')).toBe(
      'https://app.ziro.dev/editor',
    );
  });

  it('handles a bare path', () => {
    expect(scrubUrl('/assets/index-abc123.js')).toBe('/assets/index-abc123.js');
  });

  it('degrades safely on an unparseable value', () => {
    expect(scrubUrl('not a url?secret=1')).toBe('not a url');
  });
});

describe('scrubEvent', () => {
  const event = (): ScrubbableEvent => ({
    message: 'crash while saving my-secret-board.kicad_pcb',
    exception: {
      values: [
        {
          type: 'TypeError',
          value: 'cannot serialize my-secret-board.kicad_sch',
          stacktrace: {
            frames: [{ filename: 'https://app.ziro.dev/a.js?token=abc', abs_path: '/src/a.ts' }],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: 'console', message: 'dumping netlist: VCC, GND, SPI_CLK' },
      { category: 'navigation', message: 'to /editor', data: { url: '/editor?project=acme' } },
    ],
    request: { url: 'https://app.ziro.dev/editor?project=acme', query_string: 'project=acme' },
    extra: { boardJson: '{...}' },
    user: { email: 'someone@example.com' },
  });

  it('scrubs the message and the exception value', () => {
    const out = scrubEvent(event());
    expect(out.message).not.toContain('my-secret-board');
    expect(out.exception?.values?.[0]?.value).toBe('cannot serialize <redacted>.kicad_sch');
  });

  it('keeps the exception type, which is what identifies the bug', () => {
    expect(scrubEvent(event()).exception?.values?.[0]?.type).toBe('TypeError');
  });

  it('strips query strings from stack frame paths', () => {
    const frame = scrubEvent(event()).exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame?.filename).toBe('https://app.ziro.dev/a.js');
  });

  it('drops console breadcrumbs entirely', () => {
    const out = scrubEvent(event());
    expect(out.breadcrumbs).toHaveLength(1);
    expect(out.breadcrumbs?.[0]?.category).toBe('navigation');
    expect(JSON.stringify(out.breadcrumbs)).not.toContain('SPI_CLK');
  });

  it('scrubs urls inside breadcrumb data', () => {
    expect(scrubEvent(event()).breadcrumbs?.[0]?.data?.url).toBe('/editor');
  });

  it('drops the request query string', () => {
    const out = scrubEvent(event());
    expect(out.request?.url).toBe('https://app.ziro.dev/editor');
    expect(out.request?.query_string).toBeUndefined();
  });

  it('never forwards extras or user identity', () => {
    const out = scrubEvent(event());
    expect(out.extra).toBeUndefined();
    expect(out.user).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('someone@example.com');
  });

  it('leaves no trace of the project name anywhere in the payload', () => {
    expect(JSON.stringify(scrubEvent(event()))).not.toContain('my-secret-board');
  });
});

describe('opt-out enforcement', () => {
  it('is on by default', () => {
    expect(reportingEnabled()).toBe(true);
  });

  it('scrubs and forwards while enabled', () => {
    const out = prepareEvent({ message: 'boom' });
    expect(out?.message).toBe('boom');
  });

  it('drops every event once switched off, including already-queued ones', () => {
    setReportingEnabled(false);
    expect(reportingEnabled()).toBe(false);
    expect(prepareEvent({ message: 'boom' })).toBeNull();
  });

  it('resumes when switched back on', () => {
    setReportingEnabled(false);
    setReportingEnabled(true);
    expect(prepareEvent({ message: 'boom' })).not.toBeNull();
  });

  it('sends nothing rather than something unscrubbed if scrubbing fails', () => {
    // A payload whose getter throws stands in for any scrubber fault.
    const hostile = {
      get message(): string {
        throw new Error('nope');
      },
    } as ScrubbableEvent;
    expect(prepareEvent(hostile)).toBeNull();
  });
});
