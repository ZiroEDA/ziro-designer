"""Click the push button named argv[1] in $ATSPI_APP (AT-SPI)."""
import gi, os, sys
APP = os.environ.get('ATSPI_APP', 'pcbnew')
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
desk = Atspi.get_desktop(0)
app = next(desk.get_child_at_index(i) for i in range(desk.get_child_count()) if desk.get_child_at_index(i) and desk.get_child_at_index(i).get_name() == APP)
def find(o, depth=0):
    if depth > 14: return None
    try:
        if o.get_role_name() in ('push button', 'button') and o.get_name() == sys.argv[1]: return o
        n = o.get_child_count()
    except Exception: return None
    for i in range(n):
        c = o.get_child_at_index(i)
        if c:
            r = find(c, depth + 1)
            if r: return r
b = find(app)
print('button', bool(b), flush=True)
if b: b.get_action_iface().do_action(0)
