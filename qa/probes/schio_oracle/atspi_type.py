"""Type argv[1] into whatever has focus, then Return (AT-SPI synthesised keys)."""
import gi, sys, time
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
Atspi.generate_keyboard_event(0, sys.argv[1], Atspi.KeySynthType.STRING)
time.sleep(0.8)
Atspi.generate_keyboard_event(0xff0d, None, Atspi.KeySynthType.SYM)
