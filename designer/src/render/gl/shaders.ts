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
// The knee for strokes standing in for the OpenGL GAL's texture atlas (pad and
// via net names); see the a_minPx decoding note in SEGMENT_VERT.
const float BITMAP_KNEE_PX = 1.0;

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
/**
 * 1.0 when this segment runs along a device axis, 0.0 otherwise.
 *
 * Set in the same branch that decides whether to snap, so the two can never
 * disagree about what "axis-aligned" means. The fragment stage uses it to pick
 * between the solid hairline and the antialiasing ramp; see SEGMENT_FRAG.
 */
flat out float v_axisAligned;
flat out vec4 v_color;

void main() {
  vec2 s0 = worldToPixel(a_p0);
  vec2 s1 = worldToPixel(a_p1);

  // KiCad rasterises a line and a piece of text by different routes, and they
  // behave differently below one pixel. a_minPx encodes which route this
  // stroke imitates; its magnitude (after decoding) is the pixel floor.
  //
  //   a_minPx < 0    — a *line*. computeLineCoords clamps pixelWidth up to
  //                  u_minLinePixelWidth and the fragment stage draws it solid,
  //                  so a 0.05 mm courtyard is a crisp one-pixel magenta line at
  //                  every zoom KiCad will let you reach. Nothing fades.
  //
  //   0 < a_minPx < 512 — *faded text*, SHADER_FONT: no floor, and the glyph
  //                  thins and greys out as it shrinks. The schematic records
  //                  everything this way.
  //
  //   a_minPx > 512  — *atlas text* (the value carries a +1024 flag). The
  //                  OpenGL GAL draws pad and via net names from a mipmapped
  //                  texture atlas, which loses its ink to minification much
  //                  sooner than a stroke fades: at a board-fit zoom pcbnew's
  //                  pads are clean while a stroke-font rendering of the same
  //                  labels composited to near-solid clutter. So these strokes
  //                  take a one-pixel knee and a cubic falloff — mipmap
  //                  averaging includes the transparent texels around every
  //                  stroke, so ink drops faster than raw coverage.
  //
  // Fading lines as well is what made the courtyard rectangles disappear from a
  // zoomed-out board that KiCad still draws them on.
  bool atlasText = a_minPx > 512.0;
  float signedMinPx = atlasText ? a_minPx - 1024.0 : a_minPx;
  bool bitmapText = signedMinPx > 0.0;
  float minPx = abs(signedMinPx);

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
  float axisAligned = 0.0;
  if (abs(along.y) < 0.001) {          // horizontal: snap y
    snapped0.y = floor(s0.y) + nudge;
    snapped1.y = floor(s1.y) + nudge;
    axisAligned = 1.0;
  } else if (abs(along.x) < 0.001) {   // vertical: snap x
    snapped0.x = floor(s0.x) + nudge;
    snapped1.x = floor(s1.x) + nudge;
    axisAligned = 1.0;
  }
  pos += (snapped0 - s0);

  v_pixel = pos;
  v_s0 = snapped0;
  v_s1 = snapped1;
  v_halfPx = halfPx;
  v_axisAligned = axisAligned;
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
  // Atlas text takes a much higher knee than faded text, because the atlas
  // keys on glyph size, not pen width: a BitmapText glyph is drawn with a pen
  // of roughly an eighth of its height, so a glyph shrunk to the ~6 px where
  // the atlas mipmaps blur it toward nothing has a pen of ~0.8 px.
  float knee = atlasText ? BITMAP_KNEE_PX : GLARE_KNEE_PX;
  float widthRatio = trueHalfPx > 0.0 ? clamp(trueWidthPx / knee, 0.0, 1.0) : 1.0;
  // Only text pays; a line is solid at whatever width the floor gives it. The
  // schematic's faded text keeps its original square; atlas text cubes.
  float sq = widthRatio * widthRatio;
  v_widthFade = atlasText ? sq * widthRatio : (bitmapText ? sq : 1.0);
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
flat in float v_axisAligned;
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

  // An AXIS-ALIGNED hairline is drawn solid, not antialiased.
  //
  // The ramp below is right for anything with width to spare, but a stroke
  // already clamped to a single pixel has none: the ramp spreads it over two
  // columns at partial alpha, so a border line that lands between two pixel
  // centres comes out as two grey columns instead of one solid one.
  //
  // KiCad's line fragment shader is solid too — drawLine() in
  // common/gal/shaders/kicad_frag.glsl is isPixelInSegment ? gl_Color :
  // discard, a coverage BIT with no ramp anywhere in it. What smooths KiCad's
  // diagonals is not the line shader at all: it is the SMAA post-pass that
  // graphics.antialiasing_mode turns on by default (AA_HIGHQUALITY,
  // common_settings.cpp:328-329), which reshapes staircase edges after the
  // whole frame is drawn.
  //
  // SMAA leaves a vertical or horizontal edge alone — there is no staircase to
  // find — and blends an off-axis one across two or three pixels. So the
  // KiCad-shaped rule is not "hairlines are solid", it is "axis-aligned
  // hairlines are solid". Measured on a pl_editor and a ZiroEDA screenshot of
  // the same selected diagonal: KiCad puts rgb(193,127,127) in one pixel with
  // partial neighbours either side and varies per row, ours put exactly
  // rgb(194,128,128) — DS_SELECTED_COLOR at full alpha — in one pixel per row
  // and nothing beside it, which is the staircase the user sees. Dropping the
  // off-axis case through to the ramp reproduces KiCad's gradient and moves no
  // ink: the ramp's triangle over +/-1 px integrates to 1.0, exactly what the
  // 1 px solid band does.
  //
  // Solid, but at the alpha the stroke's real width earns: v_widthFade is 1
  // for anything that genuinely reaches a pixel, so a legible glyph is as crisp
  // as it was, while one widened from a fifth of a pixel is drawn at a fifth
  // the strength instead of at full glare.
  if (v_halfPx <= 0.51 && v_axisAligned > 0.5) {
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

/**
 * Bitmap-font glyphs: one textured quad each, sampled from the MSDF atlas.
 *
 * This is KiCad's `SHADER_FONT` branch (`common/gal/shaders/kicad_frag.glsl`)
 * and nothing else. The atlas is a *multi-channel* signed distance field, so a
 * glyph is one texture fetch and a threshold whatever the zoom: no mipmap
 * chain, no re-rasterising, and corners stay sharp where a plain distance field
 * rounds them off. It is also why pad numbers do not thicken with the pen width
 * the painter sets — there is no pen.
 */
export const GLYPH_VERT = `${COMMON}
layout(location = 0) in vec2 a_pos;   // world
layout(location = 1) in vec2 a_uv;    // atlas, normalised
layout(location = 2) in vec4 a_color;

// The pass's layer depth, in clip space. Every glyph of one pass shares it, so
// the depth test keeps the first fragment to reach a pixel and rejects the
// rest — which is how KiCad stops crossing net names from compounding their
// alpha. See u_depth's use in device.ts.
uniform float u_depth;

out vec2 v_uv;
out vec4 v_color;

void main() {
  v_uv = a_uv;
  v_color = a_color;
  vec4 p = pixelToClip(worldToPixel(a_pos));
  gl_Position = vec4(p.xy, u_depth, p.w);
}
`;

export const GLYPH_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
in vec4 v_color;

uniform sampler2D u_atlas;
uniform vec2 u_atlasSize;   // texels, for the derivative below

out vec4 fragColor;

/** The middle of the three distance channels — msdfgen's decoder. */
float median(vec3 v) {
  return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
}

void main() {
  // Zoom-adaptive filtering: how far the distance field moves per screen pixel
  // sets the width of the threshold ramp, so a glyph is crisp when large and
  // fades honestly when small, with no explicit level of detail anywhere.
  //
  // KiCad writes this as length(dFdx(tex)) * u_fontTextureWidth / 4, taking the
  // *width* as the scale for a derivative that has a v component too. That is
  // near enough on its 1024 x 1107 sheet, where the two axes are within 8% of
  // each other, but ours is repacked to 512 x 135 and it would be off by four.
  // Converting to texels first is the same quantity the C++ is reaching for and
  // is independent of how the atlas happens to be packed.
  float derivative = length(dFdx(v_uv * u_atlasSize)) / 4.0;
  float dist = median(texture(u_atlas, v_uv).rgb);
  float alpha = smoothstep(0.5 - derivative, 0.5 + derivative, dist) * v_color.a;
  if (alpha <= 0.0) discard;
  fragColor = vec4(v_color.rgb, alpha);
}
`;

/**
 * A bitmap on the document — SCH_BITMAP, pcbnew's reference images, the
 * drawing sheet's logo.
 *
 * The vertex stage is GLYPH_VERT's, attribute for attribute, so an image run
 * reuses the glyph VAO layout: position, uv, colour. What differs is entirely
 * in the fragment stage.
 *
 * Not a variant of the glyph program, though it looks like one. That one
 * decodes a multi-channel signed distance field - `median()` of three channels
 * against a zoom-adaptive threshold - which is the right way to draw a glyph at
 * any size and completely wrong for a photograph: it would posterise the image
 * to two levels. A bitmap is sampled, multiplied by the tint, and drawn.
 *
 * The tint exists because KiCad's bitmaps are not always drawn as authored -
 * `drawBitmap` (common/drawing_sheet/ds_painter.cpp) applies the item's colour.
 * A caller that wants the bitmap untouched passes opaque white.
 */
export const IMAGE_VERT = GLYPH_VERT;

export const IMAGE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
in vec4 v_color;

uniform sampler2D u_image;

out vec4 fragColor;

void main() {
  vec4 texel = texture(u_image, v_uv);
  // Straight (non-premultiplied) alpha, matching how the texture is uploaded:
  // UNPACK_PREMULTIPLY_ALPHA_WEBGL is left off, so the blend func the device
  // sets for everything else applies unchanged.
  fragColor = texel * v_color;
  if (fragColor.a <= 0.0) discard;
}
`;

/**
 * The full-screen quad the difference composite draws.
 *
 * KiCad's `xor_diff_vert.glsl` is fixed-function GLSL 120 — it passes
 * `gl_MultiTexCoord0` through and writes `gl_Vertex` straight to
 * `gl_Position`, because `OPENGL_COMPOSITOR` feeds it a quad already in clip
 * space. WebGL2 has neither builtin, so the quad is generated from
 * `gl_VertexID` instead of being uploaded: same two triangles, no buffer, no
 * attribute state to disturb.
 */
export const XOR_DIFF_VERT = /* glsl */ `#version 300 es
out vec2 v_uv;
void main() {
  // (0,0) (2,0) (0,2) in UV, which is the standard oversized triangle pair
  // covering the clip cube exactly once.
  v_uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(v_uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * GerbView's XOR mode, `common/gal/shaders/xor_diff_frag.glsl` verbatim:
 *
 *     vec3 diff = abs( srcColor.rgb - dstColor.rgb );
 *     float alpha = max( srcColor.a, dstColor.a );
 *     gl_FragColor = vec4( diff, alpha );
 *
 * Where only one layer has ink, the difference is that layer's colour; where
 * both have the same ink it cancels to black; where they differ you see by how
 * much. That is the whole point of the mode - it is a visual diff of two
 * gerbers, so "identical cancels" is the signal, not a side effect.
 *
 * It is a composite *pass*, not a blend equation. `abs(a - b)` is
 * `max(a,b) - min(a,b)` and GL can do either of those alone but not both into
 * one buffer, which is why upstream renders the layer into a temp colour target
 * and runs this over both textures rather than setting a blend mode.
 */
export const XOR_DIFF_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform sampler2D u_dst;
out vec4 fragColor;
void main() {
  vec4 srcColor = texture(u_src, v_uv);
  vec4 dstColor = texture(u_dst, v_uv);
  vec3 diff = abs(srcColor.rgb - dstColor.rgb);
  float alpha = max(srcColor.a, dstColor.a);
  fragColor = vec4(diff, alpha);
}
`;

/**
 * Straight copy of one texture onto the bound target, for putting the
 * accumulated result back on the canvas.
 *
 * `OPENGL_COMPOSITOR::DrawBuffer` does this with the same quad and a plain
 * textured draw; the alpha is carried through unchanged so an artefact-free
 * transparent background still composites over whatever is beneath the canvas.
 */
export const BLIT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
out vec4 fragColor;
void main() {
  fragColor = texture(u_src, v_uv);
}
`;
