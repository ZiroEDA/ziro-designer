#!/usr/bin/env python3
"""Dump an AT-SPI accessible tree for a running application.

Usage: atspi_dump.py <app-name-substring> [max-depth]

Reads the tree the toolkit itself publishes, which is how the PCB Calculator
audit read ~180 strings off a real pcb_calculator. Read-only.
"""
import sys
import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402


def describe(node):
    try:
        name = node.get_name()
    except Exception:
        name = "<?>"
    try:
        role = node.get_role_name()
    except Exception:
        role = "<?>"
    ext = ""
    try:
        comp = node.get_component_iface()
        if comp is not None:
            r = comp.get_extents(Atspi.CoordType.WINDOW)
            ext = f" [{r.x},{r.y} {r.width}x{r.height}]"
    except Exception:
        pass
    txt = ""
    try:
        ti = node.get_text_iface()
        if ti is not None:
            s = ti.get_text(0, -1)
            if s:
                txt = f" text={s!r}"
    except Exception:
        pass
    return f"{role} {name!r}{ext}{txt}"


def walk(node, depth, maxdepth, out):
    out.append("  " * depth + describe(node))
    if depth >= maxdepth:
        return
    for i in range(node.get_child_count()):
        try:
            c = node.get_child_at_index(i)
        except Exception:
            continue
        if c is None:
            continue
        walk(c, depth + 1, maxdepth, out)


def main():
    want = sys.argv[1] if len(sys.argv) > 1 else ""
    maxdepth = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    Atspi.init()
    desktop = Atspi.get_desktop(0)
    out = []
    for i in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(i)
        if app is None:
            continue
        nm = app.get_name() or ""
        if want and want.lower() not in nm.lower():
            continue
        out.append(f"=== APP {nm!r} ===")
        walk(app, 0, maxdepth, out)
    print("\n".join(out))


main()
