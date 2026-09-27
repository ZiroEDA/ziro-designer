#!/usr/bin/env python3
"""Mutation sweep for the Cairo GAL port (common/gal/cairo/, branch common-gal-cairo).

The driver is calculator_108_mutants.py's: each mutant is (id, file, old, new,
tests); the edit must change the file's bytes, the package must typecheck
BEFORE the tests run (a mutant that does not compile is BUILD-FAILED, not a
kill), a run with no vitest summary is a HARNESS error, and the file is
restored with `git checkout --` - so the baseline must be committed.

Run from anywhere:  python3 qa/probes/cairo_gal_mutants.py [id ...]
"""

import signal
import subprocess
import sys
from pathlib import Path

WT = Path(__file__).resolve().parents[2]
BIN = WT / "node_modules/.bin"

API = "common/gal/cairo/cairo_api.ts"
GAL = "common/gal/cairo/cairo_gal.ts"
CMP = "common/gal/cairo/cairo_compositor.ts"
PRT = "common/gal/cairo/cairo_print.ts"
PNL = "common/draw_panel_gal.ts"
FAKE = "qa/unittests/common/cairo_test_canvas.ts"

T_API = "qa/unittests/common/cairo_api.test.ts"
T_GAL = "qa/unittests/common/cairo_gal.test.ts"
T_PRT = "qa/unittests/common/cairo_print.test.ts"
ALL = [T_API, T_GAL, T_PRT]

MUTANTS = [
    # ---- cairo_api.ts: Cairo's semantics --------------------------------
    ("api-arc-raise", API, "if (angle2 < 0) angle2 += 2 * Math.PI;", "if (angle2 < 0) angle2 += 0;", ALL),
    ("api-arcneg-lower", API, "if (angle2 > 0) angle2 -= 2 * Math.PI;", "if (angle2 > 0) angle2 -= 0;", ALL),
    ("api-sweep-split", API, "if (sweep > 2 * Math.PI) {", "if (false) {", ALL),
    ("api-radius-le0", API, "if (r <= 0.0) {", "if (false) {", ALL),
    ("api-radius-second-line", API, "if (!hadPoint) this.lineTo(xc, yc);", "", ALL),
    ("api-new-sub-path", API, "  newSubPath(): void {\n    this.currentPoint = null;", "  newSubPath(): void {\n", ALL),
    ("api-zero-width-skip", API, "if (g.lineWidth > 0) {", "if (true) {", ALL),
    ("api-negative-width", API, "aWidth < 0 ? 0 : aWidth", "aWidth", ALL),
    ("api-default-width", API, "lineWidth: 2.0,", "lineWidth: 1.0,", ALL),
    ("api-source-add", API, "      ctx.globalCompositeOperation = 'lighter';", "      ctx.globalCompositeOperation = 'source-over';", ALL),
    ("api-clear-opaque", API, "      ctx.globalCompositeOperation = 'destination-out';\n      aPaint(OPAQUE);\n    } else if", "      ctx.globalCompositeOperation = 'destination-out';\n      aPaint(this.sourceStyle());\n    } else if", ALL),
    ("api-channel-byte", API, "Math.trunc(clamped * 65535.0 + 0.5) >> 8", "Math.trunc(clamped * 255 + 0.5)", ALL),
    ("api-fill-clears", API, "      this.ctx.fill(rule);\n    });\n\n    if (!aPreserve) this.newPath();", "      this.ctx.fill(rule);\n    });\n", ALL),
    ("api-copy-path-space", API, "cairo_matrix_multiply(rel, e.m, inverse);", "cairo_matrix_multiply(rel, e.m, cairo_matrix_new());", ALL),
    ("api-append-path-space", API, "cairo_matrix_multiply(m, e.m, this.gstate.matrix);", "cairo_matrix_multiply(m, e.m, cairo_matrix_new());", ALL),
    ("api-multiply-x0", API, "const x0 = a.x0 * b.xx + a.y0 * b.xy + b.x0;", "const x0 = a.x0 * b.xx + a.y0 * b.xy;", ALL),
    ("api-translate-order", API, "cairo_matrix_multiply(aMatrix, { xx: 1, yx: 0, xy: 0, yy: 1, x0: tx, y0: ty }, aMatrix);", "cairo_matrix_multiply(aMatrix, aMatrix, { xx: 1, yx: 0, xy: 0, yy: 1, x0: tx, y0: ty });", ALL),
    ("api-d2u-no-translation", API, "return cairo_matrix_transform_distance(inverse, aDx, aDy);", "return cairo_matrix_transform_point(inverse, aDx, aDy);", ALL),
    ("api-restore", API, "if (g) this.gstate = g;", "", ALL),
    ("api-rectangle", API, "this.lineTo(x + w, y + h);", "this.lineTo(x + w, y);", ALL),
    ("api-close-current-point", API, "  closePath(): void {\n    if (!this.currentPoint) return;\n\n    this.push({ op: 'Z' });\n    this.currentPoint = this.subpathStart;", "  closePath(): void {\n    if (!this.currentPoint) return;\n\n    this.push({ op: 'Z' });\n    this.currentPoint = null;", ALL),
    # ---- cairo_gal.ts: CAIRO_GAL_BASE ------------------------------------
    ("gal-roundp-centre", GAL, "return Math.floor(x + 0.5) + 0.5;", "return Math.floor(x + 0.5);", ALL),
    ("gal-roundp-even", GAL, "else return { x: Math.floor(v.x + 0.5), y: Math.floor(v.y + 0.5) };", "else return { x: v.x, y: v.y };", ALL),
    ("gal-width-threshold", GAL, "if (w <= 1.0) {", "if (w < 1.0) {", ALL),
    ("gal-width-parity", GAL, "this.m_lineWidthIsOdd = Math.trunc(w) % 2 === 1;", "this.m_lineWidthIsOdd = true;", ALL),
    ("gal-width-rounding", GAL, "let w = Math.floor(this.xform(aForceWidth ? aWidth : this.m_lineWidth) + 0.5);", "let w = Math.ceil(this.xform(aForceWidth ? aWidth : this.m_lineWidth));", ALL),
    ("gal-segment-fill-colour", GAL, "      cairo_set_source_rgba(\n        this.cr,\n        this.m_fillColor.r,\n        this.m_fillColor.g,\n        this.m_fillColor.b,\n        this.m_fillColor.a,\n      );\n      cairo_stroke(this.cr);", "      cairo_set_source_rgba(\n        this.cr,\n        this.m_strokeColor.r,\n        this.m_strokeColor.g,\n        this.m_strokeColor.b,\n        this.m_strokeColor.a,\n      );\n      cairo_stroke(this.cr);", ALL),
    ("gal-segment-cap-angle", GAL, "let arcStartAngle = lineAngle - Math.PI / 2.0;", "let arcStartAngle = lineAngle + Math.PI / 2.0;", ALL),
    ("gal-segment-half-width", GAL, "aWidth /= 2.0;", "aWidth /= 1.0;", ALL),
    ("gal-circle-radius-snap", GAL, "const r = roundpScalar(this.xform(aRadius));", "const r = this.xform(aRadius);", ALL),
    ("gal-arc-pie-centre", GAL, "if (this.m_isFillEnabled) cairo_move_to(this.cr, mid.x, mid.y);", "", ALL),
    ("gal-arc-mid-snap", GAL, "    const mid = this.roundp(this.xform(aCenterPoint));\n\n    let startPointS", "    const mid = this.xform(aCenterPoint);\n\n    let startPointS", ALL),
    ("gal-angle-xform-flip", GAL, "if (this.IsFlippedX()) world_rotation = Math.PI - world_rotation;", "", ALL),
    ("gal-arc-angle-flip", GAL, "startAngle = Math.PI - startAngle;", "startAngle = startAngle;", ALL),
    ("gal-arc-full-turn", GAL, "end = start + 2 * Math.PI;", "end = this.angle_xform(endAngle);", ALL),
    ("gal-arcseg-negative-cap", GAL, "    cairo_arc_negative(\n", "    cairo_arc(\n", ALL),
    ("gal-arcseg-half-width", GAL, "const width = this.xform(aWidth / 2.0);", "const width = this.xform(aWidth);", ALL),
    ("gal-arcseg-fill-width", GAL, "this.m_lineWidth = Math.fround(aWidth); // a `float` member", "this.m_lineWidth = Math.fround(aWidth / 2);", ALL),
    ("gal-arcseg-restore-fill", GAL, "      this.m_isFillEnabled = true;\n      this.m_isStrokeEnabled = false;\n      return;", "      this.m_isFillEnabled = false;\n      this.m_isStrokeEnabled = true;\n      return;", ALL),
    ("gal-flush-fill-preserve", GAL, "        cairo_set_line_width(this.cr, this.m_lineWidthInPixels);\n        cairo_fill_preserve(this.cr);", "        cairo_set_line_width(this.cr, this.m_lineWidthInPixels);\n        cairo_fill(this.cr);", ALL),
    ("gal-polyset-outlines", GAL, "i < a.OutlineCount();", "i < 1;", ALL),
    ("gal-drawpoly-one-point", GAL, "if (list.length <= 1) return;", "if (list.length < 1) return;", ALL),
    ("gal-drawpoly-closed", GAL, "    this.syncLineWidth();\n\n    let numPoints = aLineChain.PointCount();\n\n    if (aLineChain.IsClosed()) numPoints += 1;", "    this.syncLineWidth();\n\n    let numPoints = aLineChain.PointCount();\n", ALL),
    ("gal-glyph-evenodd", GAL, "cairo_set_fill_rule(this.cr, cairo_fill_rule_t.CAIRO_FILL_RULE_EVEN_ODD);", "", ALL),
    ("gal-glyph-back-to-stroke", GAL, "        this.flushPath();\n        this.SetIsFill(false);\n        this.SetIsStroke(true);", "        this.flushPath();\n        this.SetIsStroke(true);", ALL),
    ("gal-glyphs-no-hover", GAL, "    for (let i = 0; i < aGlyphs.length; i++) this.DrawGlyph(aGlyphs[i]!, i, aGlyphs.length);\n  }\n\n  /// @copydoc GAL::DrawCurve()", "    super.DrawGlyphs(aGlyphs);\n  }\n\n  /// @copydoc GAL::DrawCurve()", ALL),
    ("gal-curve-line-to-end", GAL, "    cairo_curve_to(this.cr, cpa.x, cpa.y, cpb.x, cpb.y, ep.x, ep.y);\n    cairo_line_to(this.cr, ep.x, ep.y);", "    cairo_curve_to(this.cr, cpa.x, cpa.y, cpb.x, cpb.y, ep.x, ep.y);", ALL),
    ("gal-bitmap-centre", GAL, "cairo_translate(this.cr, -w / 2.0, -h / 2.0);", "cairo_translate(this.cr, 0, 0);", ALL),
    ("gal-bitmap-alpha", GAL, "cairo_paint_with_alpha(this.cr, alphaBlend);", "cairo_paint_with_alpha(this.cr, 1.0);", ALL),
    ("gal-group-fill-alpha", GAL, "            this.m_fillColor.b,\n            this.m_strokeColor.a,", "            this.m_fillColor.b,\n            this.m_fillColor.a,", ALL),
    ("gal-group-min-width", GAL, "Math.max(it.m_Argument.DblArg[0]!, minWidth)", "it.m_Argument.DblArg[0]!", ALL),
    ("gal-group-translate-records", GAL, "  override Translate(aTranslation: Vec2): void {\n    this.storePath();\n\n    if (this.m_isGrouping) {", "  override Translate(aTranslation: Vec2): void {\n    this.storePath();\n\n    if (false) {", ALL),
    ("gal-group-colour-fill", GAL, "        it.m_Command === GRAPHICS_COMMAND.CMD_SET_FILLCOLOR ||\n        it.m_Command === GRAPHICS_COMMAND.CMD_SET_STROKECOLOR\n      ) {\n        it.m_Argument.DblArg[0] = aNewColor.r;", "        it.m_Command === GRAPHICS_COMMAND.CMD_SET_STROKECOLOR\n      ) {\n        it.m_Argument.DblArg[0] = aNewColor.r;", ALL),
    ("gal-group-counter", GAL, "    return this.m_groupCounter++;", "    return this.m_groups.size;", ALL),
    ("gal-group-replay-stroke-colour", GAL, "        case GRAPHICS_COMMAND.CMD_SET_STROKECOLOR:\n          this.m_strokeColor = COLOR4D(", "        case GRAPHICS_COMMAND.CMD_SET_STROKECOLOR:\n          void COLOR4D(", ALL),
    ("gal-group-copy-fill-path", GAL, "GRAPHICS_COMMAND.CMD_FILL_PATH);\n          groupElement.m_CairoPath = cairo_copy_path(this.cr);", "GRAPHICS_COMMAND.CMD_FILL_PATH);\n          groupElement.m_CairoPath = null;", ALL),
    # ---- cairo_gal.ts: CAIRO_GAL ------------------------------------------
    ("win-overlay-composite", GAL, "    this.m_compositor!.DrawBuffer(this.m_overlayBuffer);\n", "", ALL),
    ("win-blit-scale", GAL, "      0,\n      0,\n      native.x,\n      native.y,\n    );", "      0,\n      0,\n      this.m_screenSize.x,\n      this.m_screenSize.y,\n    );", ALL),
    ("win-blit-black", GAL, "    clientDC.fillRect(0, 0, native.x, native.y);\n", "", ALL),
    ("win-diff-op", GAL, "      cairo_operator_t.CAIRO_OPERATOR_DIFFERENCE,", "      cairo_operator_t.CAIRO_OPERATOR_OVER,", ALL),
    ("win-cursor-size", GAL, "const cursorSize = 80;", "const cursorSize = 40;", ALL),
    # ---- cairo_compositor.ts --------------------------------------------
    ("cmp-clear", CMP, "    ctx.clearRect(0, 0, buffer.surface.width, buffer.surface.height);\n", "", ALL),
    ("cmp-op", CMP, "cairo_set_operator(ct, op ?? cairo_operator_t.CAIRO_OPERATOR_OVER);", "cairo_set_operator(ct, cairo_operator_t.CAIRO_OPERATOR_OVER);", ALL),
    ("cmp-aa-fast", CMP, "this.m_currentAntialiasingMode = cairo_antialias_t.CAIRO_ANTIALIAS_FAST;", "this.m_currentAntialiasingMode = cairo_antialias_t.CAIRO_ANTIALIAS_GOOD;", ALL),
    ("cmp-setbuffer-matrix", CMP, "    cairo_set_matrix(this.m_currentContext.get(), this.m_matrix);\n", "", ALL),
    # ---- cairo_print.ts --------------------------------------------------
    ("prt-rotate", PRT, "rotate.SetRotation((90.0 * Math.PI) / 180.0);", "", ALL),
    ("prt-paper-transposed", PRT, "x: this.m_nativePaperSize.y /* inches */", "x: this.m_nativePaperSize.x /* inches */", ALL),
    ("prt-native-branch", PRT, "if (this.m_hasNativeLandscapeRotation) {", "if (false) {", ALL),
    ("prt-sheet-double", PRT, "x: Math.ceil(aSize.x * this.m_screenDPI) * 2,", "x: Math.ceil(aSize.x * this.m_screenDPI) * 1,", ALL),
    ("prt-sheet-ceil", PRT, "y: Math.ceil(aSize.y * this.m_screenDPI) * 2,", "y: Math.round(aSize.y * this.m_screenDPI) * 2,", ALL),
    ("prt-white", PRT, "this.m_clearColor = COLOR4D(1.0, 1.0, 1.0, 1.0);", "this.m_clearColor = COLOR4D(0.0, 0.0, 0.0, 1.0);", ALL),
    ("prt-dpi", PRT, "    this.m_dpi = aDC.GetPPI();\n", "", ALL),
    ("prt-native-rotation", PRT, "  HasNativeLandscapeRotation(): boolean {\n    return true;", "  HasNativeLandscapeRotation(): boolean {\n    return false;", ALL),
    ("prt-image-clear-rgb", PRT, "dstRGB[i * 3] = dstRGB[i * 3 + 1] = dstRGB[i * 3 + 2] = 0;", "", ALL),
    ("prt-zoom-centre", PRT, "const k = 0.5 / this.m_zoomFactor;", "const k = 0.5;", ALL),
    ("prt-flip", PRT, "x: this.m_globalFlipX ? -1.0 : 1.0", "x: this.m_globalFlipX ? 1.0 : 1.0", ALL),
    ("prt-order", PRT, "scale.mul(translation).mul(flip).mul(rotate).mul(lookat)", "scale.mul(translation).mul(rotate).mul(flip).mul(lookat)", ALL),
    # ---- draw_panel_gal.ts ------------------------------------------------
    ("pnl-fallback-type", PNL, "static readonly GAL_FALLBACK: GAL_TYPE = GAL_TYPE.GAL_TYPE_CAIRO;", "static readonly GAL_FALLBACK: GAL_TYPE = GAL_TYPE.GAL_TYPE_OPENGL;", ALL),
    ("pnl-fallback-gal", PNL, "              new_gal = new CAIRO_GAL(this.m_options, this);", "              new_gal = null;", ALL),
    ("pnl-usable-needs-no-gl", PNL, "return EDA_DRAW_PANEL_GAL.GAL_FALLBACK_AVAILABLE && this.m_gl === null;", "return EDA_DRAW_PANEL_GAL.GAL_FALLBACK_AVAILABLE;", ALL),
    # ---- the test's own canvas model: it must see transforms ---------------
    ("fake-ignores-transform", FAKE, "        m = a.slice(0, 6);", "        void a;", ALL),
]


def project_for(rel: str) -> str:
    return rel.split("/", 1)[0]


def run(cmd, cwd, timeout=600):
    return subprocess.run(
        cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout
    )


BUILDINFO = Path.home() / "cairo-gal-mut-{}.tsbuildinfo"


def typecheck(project: str):
    info = str(BUILDINFO).format(project.replace("/", "-"))
    return run(
        f"{BIN}/tsc --noEmit --incremental --tsBuildInfoFile {info} -p tsconfig.json",
        WT / project,
        timeout=900,
    )


def dirty_targets() -> list[str]:
    targets = {rel for _, rel, _, _, _ in MUTANTS}
    out = run("git status --porcelain -- " + " ".join(sorted(targets)), WT).stdout
    return [l[3:] for l in out.splitlines() if l.strip()]


def main() -> int:
    wanted = set(sys.argv[1:])

    dirty = dirty_targets()
    if dirty:
        print("REFUSING: these are already modified, so the baseline is not HEAD:")
        for d in dirty:
            print("  ", d)
        return 2

    killed, survived, build_failed, harness = [], [], [], []

    for mid, rel, old, new, tests in MUTANTS:
        if wanted and mid not in wanted:
            continue
        path = WT / rel
        before = path.read_bytes()
        text = before.decode()
        if old not in text:
            print(f"ANCHOR-MISSED  {mid}  ({rel})", flush=True)
            harness.append(mid)
            continue
        path.write_text(text.replace(old, new, 1))
        if path.read_bytes() == before:
            print(f"NO-CHANGE      {mid}  ({rel})", flush=True)
            harness.append(mid)
            continue

        try:
            tc = typecheck(project_for(rel))
            if tc.returncode != 0:
                print(f"BUILD-FAILED   {mid}", flush=True)
                build_failed.append(mid)
                continue

            spec = " ".join(t[len("qa/"):] if t.startswith("qa/") else t for t in tests)
            r = run(f"{BIN}/vitest run {spec}", WT / "qa", timeout=600)
            out = r.stdout + r.stderr
            if "Test Files" not in out:
                print(f"HARNESS-ERROR  {mid}  (no summary, exit {r.returncode})", flush=True)
                harness.append(mid)
            elif r.returncode != 0:
                fails = [l for l in out.splitlines() if l.strip().startswith("Tests ")]
                print(f"KILLED         {mid}  {fails[0].strip() if fails else ''}", flush=True)
                killed.append(mid)
            else:
                print(f"SURVIVED       {mid}", flush=True)
                survived.append(mid)
        finally:
            run(f"git checkout -- {rel}", WT)
            assert path.read_bytes() == before, f"restore failed for {rel}"

    print()
    print(f"killed={len(killed)} survived={len(survived)} "
          f"build_failed={len(build_failed)} harness={len(harness)}")
    if survived:
        print("SURVIVED:", ", ".join(survived))
    if build_failed:
        print("BUILD-FAILED:", ", ".join(build_failed))
    if harness:
        print("HARNESS:", ", ".join(harness))
    return 0


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit("terminated"))
    sys.exit(main())
