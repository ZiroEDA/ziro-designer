"""Select the row of the file named argv[1] in the 'Import Schematic' chooser (AT-SPI).

Synthesised keystrokes do not reach this dialog on a Wayland session, so a typed path
never lands; the chooser opens in eeschema's working folder with its first row selected,
and Open takes that. Selecting the input's own row through the table interface is
deterministic in a folder holding several files.
"""
import gi, sys, time
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
desk = Atspi.get_desktop(0)
cells, tables = [], []
def walk(o):
    try:
        r = o.get_role_name()
        if r == 'table cell' and o.get_name() == sys.argv[1]: cells.append(o)
        if r in ('table', 'tree table'): tables.append(o)
        for i in range(o.get_child_count()): walk(o.get_child_at_index(i))
    except Exception: pass
for i in range(desk.get_child_count()):
    a = desk.get_child_at_index(i)
    if a.get_name() == 'eeschema':
        for j in range(a.get_child_count()):
            w = a.get_child_at_index(j)
            if w.get_name() == 'Import Schematic': walk(w)
if not cells or not tables:
    print('not found', len(cells), len(tables)); sys.exit(1)
t = tables[0].get_table_iface()
# GTK nests the name in a container cell (icon + label): the row is the container's.
cell = cells[0]
if cell.get_parent().get_role_name() == 'table cell': cell = cell.get_parent()
row = t.get_row_at_index(cell.get_index_in_parent())
for r in range(t.get_n_rows()):
    if t.is_row_selected(r) and r != row: t.remove_row_selection(r)
ok = t.add_row_selection(row)
time.sleep(0.5)
print('row', row, 'selected', ok, t.is_row_selected(row), flush=True)
