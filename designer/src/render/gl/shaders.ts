// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The three GLSL ES 3.00 programs the schematic is drawn with.
 *
 * Modelled on KiCad's OpenGL GAL (`common/gal/shaders/kicad_vert.glsl` and
 * `kicad_frag.glsl`), which solves the same problem for the desktop app. Two
 * ideas are taken directly from it:
 *
 *  - **Minimum width lives in the shader.** KiCad clamps to
 *    `u_minLinePixelWidth` at draw time rather than fattening the geometry, so
 *    a hairline stays visible when zoomed out without the vertex buffer knowing
 *    anything about the zoom. That clamp is what makes our buffer reusable
 *    across every view, and so it is what makes this worth doing at all.
 *  - **Round shapes are a quad plus a distance test.** A segment is drawn as
 *    the rectangle covering it, and the fragment shader keeps only the
 *    fragments within half a width of the centre line. That gives round caps
 *    and round joins with no extra geometry, and, because the test is a
 *    distance rather than a coverage bit, antialiasing falls out of it for
 *    free.
 *
 * Positions are in world units and the view matrix is a uniform, so panning and
 * zooming update three floats and redraw buffers that never moved.
 *
 * Both round primitives are drawn from one shared four-vertex quad using
 * instancing: on a dense sheet the stroke font alone is on the order of a
 * hundred thousand segments, and one instance each rather than four vertices
 * each is the difference between a few megabytes and twenty.
 */

/**
 * Shared preamble: world to clip space.
 *
 * `u_view` is (scaleX, scaleY, offsetX, offsetY) in device pixels, and
 * `u_viewport` is the drawing-buffer size, so world goes to pixels and then to
 * the clip cube. Y is flipped because world y grows downwards, as it does
 * everywhere else in the app.
 */
const COMMON = /* glsl */ `#version 300 es
precision highp float;

uniform vec4 u_view;      // xy: pixels per world unit, zw: pixel offset
uniform vec2 u_viewport;  // drawing buffer size in device pixels

// Below this true width, in device pixels, a stroke starts trading width for
// alpha instead of being drawn solid at the one-pixel floor. Set so that an
// ordinary 6-mil schematic line stays solid at the zooms a sheet is actually
// read at, and only the far-zoomed-out case that piles thousands of glyph
// strokes into one pixel is faded.
const float GLARE_KNEE_PX = 0.35;

vec2 worldToPixel(vec2 w) {
  return w * u_view.xy + u_view.zw;
}

/**
 * Pixels to clip space, flipping Y.
 *
 * Clip space has Y increasing upwards; the pixel space everything above works
 * in has it increasing downwards, as world space does throughout the app. Miss
 * the flip and the whole sheet renders mirrored about its horizontal centre,
 * which reads at a glance as "the text is upside down" and is really the
 * title block sitting at the top of the page.
 */
vec4 pixelToClip(vec2 p) {
  return vec4((p.x / u_viewport.x) * 2.0 - 1.0, 1.0 - (p.y / u_viewport.y) * 2.0, 0.0, 1.0);
}
`;

/**
 * Round-capped segments.
 *
 * One instance per segment. The quad is built in pixel space around the
 * segment, expanded by the half width on every side so the caps have somewhere
 * to live, and the fragment shader does the rest.
 */
export const SEGMENT_VERT = `${COMMON}
layout(location = 0) in vec2 a_corner;   // the shared quad, components in {-1, 1}
layout(location = 1) in vec2 a_p0;       // world
layout(location = 2) in vec2 a_p1;       // world
layout(location = 3) in float a_halfWidth; // world
layout(location = 4) in float a_minPx;     // device pixels; sign picks the rule below
layout(location = 5) in vec4 a_color;

out vec2 v_pixel;
flat out vec2 v_s0;
flat out vec2 v_s1;
flat out float v_halfPx;
flat out float v_widthFade;
flat out vec4 v_color;

void main() {
  vec2 s0 = worldToPixel(a_p0);
  vec2 s1 = worldToPixel(a_p1);

  // KiCad rasterises a line and a piece of text by two different routes, and
  // they behave differently below one pixel. The sign of a_minPx says which one
  // this stroke is; the magnitude is the pixel floor either way.
  //
  //   a_minPx < 0  — a *line*. computeLineCoords clamps pixelWidth up to
  //                  u_minLinePixelWidth and the fragment stage draws it solid,
  //                  so a 0.05 mm courtyard is a crisp one-pixel magenta line at
  //                  every zoom KiCad will let you reach. Nothing fades.
  //
  //   a_minPx > 0  — *bitmap text*. SHADER_FONT samples an atlas and takes no
  //                  floor at all, so a glyph genuinely thins and greys out as
  //                  it shrinks. We have no atlas and stroke these glyphs, so
  //                  the fade below stands in for the texture getting smaller.
  //                  Only the pad and via net names take this route.
  //
  // Fading lines as well is what made the courtyard rectangles disappear from a
  // zoomed-out board that KiCad still draws them on.
  bool bitmapText = a_minPx > 0.0;
  float minPx = abs(a_minPx);

  // The width this stroke really has at this zoom, before any floor.
  //
  // Kept because the floor below is a fiction — it exists to stop a hairline
  // disappearing, not because the stroke is that wide — and the fragment stage
  // has to know how large a fiction it was in order to pay for it in alpha.
  float trueHalfPx = a_halfWidth * abs(u_view.x);

  // The clamp KiCad applies with u_minLinePixelWidth: the larger of the scaled
  // world width and the pixel floor, which keeps a hairline visible when zoomed
  // out without the buffer depending on the zoom.
  float halfPx = max(a_halfWidth * abs(u_view.x), minPx);

  // Then snap it, which is what makes thin strokes *legible* rather than merely
  // present.
  //
  // A one-pixel line whose centre falls on a pixel boundary covers half of each
  // neighbour, so the coverage term below gives two grey columns instead of one
  // solid one. Across a sheet of stroke-font text that reads as washed out and
  // slightly blurred, which is exactly how ours looked beside desktop KiCad at
  // the same zoom.
  //
  // KiCad rounds the width to whole device pixels and snaps the line onto the
  // pixel grid (roundr / roundv in common/gal/shaders/kicad_vert.glsl), then
  // nudges odd widths by half a pixel so their centre lands on a pixel centre
  // rather than a boundary. Same three steps here.
  float widthPx = max(floor(halfPx * 2.0 + 0.5), 1.0);
  halfPx = widthPx * 0.5;
  // Odd widths are centred on a pixel centre, even widths on a boundary.
  float nudge = mod(widthPx, 2.0) > 0.5 ? 0.5 : 0.0;

  // Half a pixel of slack so the antialiasing ramp is inside the quad rather
  // than clipped by its edge.
  float pad = halfPx + 1.0;

  vec2 d = s1 - s0;
  float len = length(d);
  // A zero-length segment is a dot: any direction will do, so pick one rather
  // than dividing by zero and emitting NaNs that take the whole draw with them.
  vec2 along = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-along.y, along.x);
  vec2 mid = (s0 + s1) * 0.5;

  vec2 pos = mid
           + along * a_corner.x * (len * 0.5 + pad)
           + perp  * a_corner.y * pad;

  // Snap only the axis the stroke is thin along, so an axis-aligned run lands
  // on whole pixels while a diagonal keeps its true angle. Snapping both axes
  // would visibly kink diagonals, which is worse than a soft edge.
  vec2 snapped0 = s0;
  vec2 snapped1 = s1;
  if (abs(along.y) < 0.001) {          // horizontal: snap y
    snapped0.y = floor(s0.y) + nudge;
    snapped1.y = floor(s1.y) + nudge;
  } else if (abs(along.x) < 0.001) {   // vertical: snap x
    snapped0.x = floor(s0.x) + nudge;
    snapped1.x = floor(s1.x) + nudge;
  }
  pos += (snapped0 - s0);

  v_pixel = pos;
  v_s0 = snapped0;
  v_s1 = snapped1;
  v_halfPx = halfPx;
  // Pay for the widening in alpha.
  //
  // A stroke 0.2 px wide drawn 1 px wide puts five times the ink on screen that
  // it should. One such stroke does not matter; a board carries thousands, and
  // every pad number and net name on it is one, so zooming out turned a page of
  // fine white text into a solid glare that KiCad does not have. KiCad's own
  // fragment shader also draws lines solid (drawLine), but it then runs an
  // SMAA pass over the whole frame, which is where its hairlines lose the
  // weight ours were keeping.
  //
  // Fading by the ratio is the same trade every sub-pixel line rasteriser
  // makes: below one pixel a stroke stops getting thinner and starts getting
  // fainter, so the ink on screen stays proportional to the ink there should
  // be. Text now recedes as you zoom out and sharpens as you zoom in, and a
  // stroke that genuinely reaches a pixel is untouched — which is the case the
  // solid-hairline path was added for.
  //
  // The ratio is squared rather than used straight, and that is not a taste
  // knob. Alpha compositing does not add, it saturates: n strokes landing in
  // the same pixel at alpha a come out at 1 - (1-a)^n, so three overlapping
  // strokes at 0.2 give 0.49, not 0.2. Glyphs are exactly that case — every
  // character is several strokes crossing within a pixel or two — so a linear
  // fade still lets dense text pile up to near-solid. Squaring holds the
  // accumulated result close to the ink the geometry actually asks for.
  //
  // A zero-width stroke is exempt: it means "thinnest line that draws", not "a
  // line of no width", and fading it to nothing would delete board outlines.
  //
  // The knee is what keeps this from repainting the whole schematic grey.
  // Measured against the *snapped* width — which is what this did — a stroke
  // pays for the pixel-grid snapping as well as for the floor, and the snapping
  // is a legibility feature KiCad also applies (roundr) without charging alpha
  // for it. Worse, the ordinary case is sub-pixel: a 6-mil wire on an A3 sheet
  // viewed whole is under half a device pixel, so an entire schematic came out
  // at about a fifth strength beside desktop KiCad's solid black.
  //
  // So the comparison is against a fixed fraction of a pixel instead. At or
  // above it a stroke is solid, which is what KiCad draws at every zoom
  // (SHADER_LINE_B is unconditionally solid; KiCad sheds the excess weight in
  // its SMAA pass, not in the line shader). Below it the quadratic falloff is
  // unchanged, so the case this was added for — a board zoomed out far enough
  // that thousands of sub-pixel glyph strokes pile up into glare — still fades,
  // and harder than a linear ramp would.
  float trueWidthPx = trueHalfPx * 2.0;
  float widthRatio = trueHalfPx > 0.0 ? clamp(trueWidthPx / GLARE_KNEE_PX, 0.0, 1.0) : 1.0;
  // Only bitmap text pays; a line is solid at whatever width the floor gives it.
  v_widthFade = bitmapText ? widthRatio * widthRatio : 1.0;
  v_color = a_color;
  gl_Position = pixelToClip(pos);
}
`;

export const SEGMENT_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_pixel;
flat in vec2 v_s0;
flat in vec2 v_s1;
flat in float v_halfPx;
flat in float v_widthFade;
flat in vec4 v_color;

out vec4 fragColor;

/** Distance from p to the segment ab. */
float distToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float len2 = dot(ab, ab);
  float t = len2 > 1e-12 ? clamp(dot(p - a, ab) / len2, 0.0, 1.0) : 0.0;
  return distance(p, a + ab * t);
}

void main() {
  float d = distToSegment(v_pixel, v_s0, v_s1);

  // A hairline is drawn solid, not antialiased.
  //
  // The ramp below is right for anything with width to spare, but a stroke
  // already clamped to a single pixel has none: the ramp spreads it over two
  // columns at partial alpha, so it comes out grey. Stroke-font text is
  // thousands of such strokes, which is why our sheet read as washed out beside
  // desktop KiCad's black at the same zoom, and why snapping alone did not fix
  // it: glyphs are mostly diagonals and curves, so an axis-aligned snap never
  // touched them.
  //
  // KiCad splits the same way, with a separate path for lines at or below one
  // pixel (SHADER_LINE_B in common/gal/shaders/kicad_vert.glsl) rather than
  // thinning the antialiased one.
  //
  // Solid, but at the alpha the stroke's real width earns: v_widthFade is 1
  // for anything that genuinely reaches a pixel, so a legible glyph is as crisp
  // as it was, while one widened from a fifth of a pixel is drawn at a fifth
  // the strength instead of at full glare.
  if (v_halfPx <= 0.51) {
    if (d > 0.5) discard;
    fragColor = vec4(v_color.rgb, v_color.a * v_widthFade);
    return;
  }

  // One pixel of ramp: the coverage estimate that gives antialiased edges,
  // round caps and round joins in the same expression.
  float cover = clamp(v_halfPx + 0.5 - d, 0.0, 1.0);
  if (cover <= 0.0) discard;
  fragColor = vec4(v_color.rgb, v_color.a * cover * v_widthFade);
}
`;

/** Filled circles: same quad-plus-distance idea, one instance per disc. */
export const DISC_VERT = `${COMMON}
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_centre;   // world
layout(location = 2) in float a_radius;  // world
layout(location = 3) in float a_minPx;   // device pixels
layout(location = 4) in vec4 a_color;

out vec2 v_pixel;
flat out vec2 v_centre;
flat out float v_radiusPx;
flat out float v_areaFade;
flat out vec4 v_color;

void main() {
  vec2 centre = worldToPixel(a_centre);
  float trueRadiusPx = a_radius * abs(u_view.x);
  float radiusPx = max(a_radius * abs(u_view.x), a_minPx);
  vec2 pos = centre + a_corner * (radiusPx + 1.0);

  v_pixel = pos;
  v_centre = centre;
  v_radiusPx = radiusPx;
  // The same debt the segments pay, but a disc grows by AREA, so the ratio is
  // squared: a via inflated from a third of a pixel to one puts nine times the
  // ink down, not three.
  //
  // Unpaid, this is what makes a row of IC pins read as one solid bar when
  // zoomed out — every via and round pad is held at the same minimum radius,
  // at full strength, until neighbours touch and merge. Fading them keeps a
  // dense row reading as a row.
  float areaRatio = trueRadiusPx > 0.0 ? clamp(trueRadiusPx / radiusPx, 0.0, 1.0) : 1.0;
  v_areaFade = areaRatio * areaRatio;
  v_color = a_color;
  gl_Position = pixelToClip(pos);
}
`;

export const DISC_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_pixel;
flat in vec2 v_centre;
flat in float v_radiusPx;
flat in float v_areaFade;
flat in vec4 v_color;

out vec4 fragColor;

void main() {
  float cover = clamp(v_radiusPx + 0.5 - distance(v_pixel, v_centre), 0.0, 1.0);
  if (cover <= 0.0) discard;
  fragColor = vec4(v_color.rgb, v_color.a * cover * v_areaFade);
}
`;

/**
 * Filled areas, already triangulated on the way in.
 *
 * No distance test and so no antialiased edge: a filled region in a schematic
 * is nearly always bounded by a stroked outline drawn over it, which supplies
 * the smooth edge.
 */
export const TRIANGLE_VERT = `${COMMON}
layout(location = 0) in vec2 a_pos;   // world
layout(location = 1) in vec4 a_color;

out vec4 v_color;

void main() {
  v_color = a_color;
  gl_Position = pixelToClip(worldToPixel(a_pos));
}
`;

export const TRIANGLE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 fragColor;
void main() {
  fragColor = v_color;
}
`;
