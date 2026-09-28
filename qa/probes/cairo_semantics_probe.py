# Oracle for common/gal/cairo/cairo_api.ts: asks the installed libcairo (1.18.0,
# through pycairo) the questions the Canvas 2D adapter has to answer the same way.
# Run: python3 qa/probes/cairo_semantics_probe.py
import math

import cairo

s = cairo.ImageSurface(cairo.FORMAT_ARGB32, 100, 100)
cr = cairo.Context(s)


def path():
    return [(t, tuple(round(v, 6) for v in p)) for t, p in cr.copy_path()]


print("cairo", cairo.cairo_version_string())
# 1. arc with angle2 < angle1: where it ends
cr.arc(50, 50, 10, 1.0, 0.5)
print("arc 1->0.5 last", path()[-1], "expect", (round(50 + 10 * math.cos(0.5), 6), round(50 + 10 * math.sin(0.5), 6)))
cr.new_path()
# 2. sweep > 2pi
cr.arc(50, 50, 10, 0, 3 * math.pi)
print("arc 0->3pi segments", len(list(cr.copy_path())), "last", path()[-1])
cr.new_path()
cr.arc(50, 50, 10, 0, 2 * math.pi)
print("arc 0->2pi segments", len(list(cr.copy_path())))
cr.new_path()
# 3. arc_negative with angle2 > angle1
cr.arc_negative(50, 50, 10, 0.5, 1.0)
print("arcneg 0.5->1 segments", len(list(cr.copy_path())), "last", path()[-1])
cr.new_path()
# 4. negative / zero radius
cr.arc(50, 50, -3, 0, 1)
print("arc r=-3", path())
cr.new_path()
cr.arc(50, 50, 0, 0, 1)
print("arc r=0", path())
cr.new_path()
# 5. arc with a current point: a line to its start
cr.move_to(0, 0)
cr.arc(50, 50, 10, 0, 0.1)
print("arc after move_to", path()[:2])
cr.new_path()
# 6. new_sub_path, then arc: a move to its start
cr.move_to(0, 0)
cr.line_to(5, 5)
cr.new_sub_path()
cr.arc(50, 50, 10, 0, 0.1)
print("arc after new_sub_path", path()[:3])
cr.new_path()
# 7. matrix algebra
a = cairo.Matrix(2, 0, 0, 3, 10, 20)
b = cairo.Matrix(0, 1, -1, 0, 5, 7)
print("a.multiply(b)", tuple(a.multiply(b)))
m = cairo.Matrix()
m.rotate(0.3)
m.translate(4, 5)
print("rotate(0.3) then translate(4,5)", tuple(round(v, 9) for v in m))
m = cairo.Matrix(2, 0, 0, 2, 1, 1)
m.scale(3, 5)
print("(2,0,0,2,1,1).scale(3,5)", tuple(m))
# 8. copy_path is in the user space of the CTM at copy time; append_path re-transforms
cr.identity_matrix()
cr.move_to(10, 10)
cr.line_to(20, 10)
cr.translate(5, 0)
print("copy after translate(5,0)", path())
pth = cr.copy_path()
cr.new_path()
cr.identity_matrix()
cr.scale(2, 2)
cr.append_path(pth)
cr.identity_matrix()
print("appended under scale(2,2), read at identity", path())
cr.new_path()
# 9. device_to_user_distance
cr.identity_matrix()
cr.scale(4, 0.5)
print("device_to_user_distance(1,1) under scale(4,0.5)", cr.device_to_user_distance(1, 1))
cr.identity_matrix()
# 10. defaults
print(
    "defaults lw/cap/join/fill_rule/op/aa/miter",
    cr.get_line_width(),
    cr.get_line_cap(),
    cr.get_line_join(),
    cr.get_fill_rule(),
    cr.get_operator(),
    cr.get_antialias(),
    cr.get_miter_limit(),
)
# 11. save/restore does not touch the path
cr.move_to(1, 1)
cr.save()
cr.line_to(2, 2)
cr.restore()
print("path across save/restore", path())
cr.new_path()
# 12. close_path, then line_to: the current point is the subpath start
cr.move_to(1, 1)
cr.line_to(5, 1)
cr.close_path()
cr.line_to(9, 9)
print("close then line_to", path())
cr.new_path()
# 13. fill clears the path; fill_preserve keeps it
cr.move_to(1, 1)
cr.line_to(5, 1)
cr.line_to(5, 5)
cr.fill_preserve()
print("after fill_preserve", len(list(cr.copy_path())))
cr.fill()
print("after fill", len(list(cr.copy_path())))
# 14. set_line_width(0): accepted
cr.set_line_width(0)
print("line width 0 ->", cr.get_line_width())
# 15. operator CLEAR on a painted surface clears to transparent
cr.set_source_rgba(1, 0, 0, 1)
cr.paint()
cr.set_operator(cairo.OPERATOR_CLEAR)
cr.rectangle(0, 0, 10, 10)
cr.fill()
s.flush()
d = s.get_data()
print("pixel(0,0) after CLEAR", bytes(d[0:4]), "pixel(50,50)", bytes(d[(50 * s.get_stride()) + 200:(50 * s.get_stride()) + 204]))
# 16. stroking at line width 0 paints nothing; a negative width
s2 = cairo.ImageSurface(cairo.FORMAT_ARGB32, 20, 20)
c2 = cairo.Context(s2)
c2.set_source_rgba(1, 1, 1, 1)
c2.set_line_width(0)
c2.move_to(0, 10.5)
c2.line_to(20, 10.5)
c2.stroke()
s2.flush()
print("width-0 stroke painted bytes", sum(bytes(s2.get_data())))
try:
    c2.set_line_width(-1)
    print("negative width ->", c2.get_line_width(), c2.status() if hasattr(c2, "status") else "")
except Exception as e:  # noqa: BLE001
    print("negative width raises", type(e).__name__, e)
# 17. SOURCE is bounded by the shape: outside the rectangle the destination survives
s3 = cairo.ImageSurface(cairo.FORMAT_ARGB32, 20, 20)
c3 = cairo.Context(s3)
c3.set_source_rgba(1, 0, 0, 1)
c3.paint()
c3.set_operator(cairo.OPERATOR_SOURCE)
c3.set_source_rgba(0, 0, 1, 0.5)
c3.rectangle(0, 0, 10, 10)
c3.fill()
s3.flush()
d3 = s3.get_data()
st = s3.get_stride()
print("SOURCE inside BGRA", bytes(d3[0:4]), "outside", bytes(d3[15 * st + 60:15 * st + 64]))
# 18. r <= 0 with a current point: one line_to the centre (a repeat line_to is dropped)
c3.set_operator(cairo.OPERATOR_OVER)
c3.new_path()
c3.move_to(1, 2)
c3.arc(10, 10, -1, 0, 1)
print("r<0 after move_to", [(t, tuple(p)) for t, p in c3.copy_path()])
c3.new_path()
# 19. cairo_rectangle's path
c3.rectangle(1, 2, 3, 4)
print("rectangle", [(t, tuple(p)) for t, p in c3.copy_path()])
c3.new_path()
# 20. arc end point is the current point (device), after translate
c3.translate(5, 0)
c3.arc(0, 0, 2, 0, math.pi / 2)
print("current point after arc under translate", c3.get_current_point())
c3.identity_matrix()
c3.new_path()
# 21. how a double colour channel becomes a byte: (short)(c*65535+0.5) >> 8, or ToColour's c*255+0.5?
s4 = cairo.ImageSurface(cairo.FORMAT_ARGB32, 1, 1)
c4 = cairo.Context(s4)
mism_short = mism_tocolour = 0
for i in range(0, 10001):
    v = i / 10000.0
    c4.set_operator(cairo.OPERATOR_SOURCE)
    c4.set_source_rgba(v, 0, 0, 1)
    c4.paint()
    s4.flush()
    got = s4.get_data()[2]
    if got != (int(v * 65535.0 + 0.5) >> 8):
        mism_short += 1
    if got != int(v * 255 + 0.5):
        mism_tocolour += 1
print("channel byte: mismatches vs short>>8", mism_short, "vs c*255+0.5", mism_tocolour)
