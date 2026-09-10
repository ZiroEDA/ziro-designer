"""Build WX_PROGRESS_REPORTER's dialog the way KiCad does and print its geometry.

`WX_PROGRESS_REPORTER( parent, _( "Load Schematic" ), 1, PR_CAN_ABORT )`
(eeschema/files-io.cpp:179) is a wxProgressDialog — on GTK the generic one —
constructed with an 80-space message so the width is reserved up front, and
the style wxPD_AUTO_HIDE | wxPD_CAN_ABORT | wxPD_ELAPSED_TIME
(common/widgets/wx_progress_reporters.cpp:37-48). This asks that dialog, on
this machine's theme, for every child's class, label, position, size and font.

    DISPLAY=:0 python3 qa/probes/progress_dialog_probe.py
"""
import sys
import wx

# `--no-abort`: the reporter built without PR_CAN_ABORT, for the dialogs that
# cannot stop a synchronous load — what is under the clock when there is no
# button row.
CAN_ABORT = 0 if "--no-abort" in sys.argv else wx.PD_CAN_ABORT

app = wx.App(False)
frame = wx.Frame(None, title="parent", size=(1200, 800))
frame.Show()
dlg = wx.ProgressDialog("Load Schematic", " " * 80, 1000, frame,
                        wx.PD_AUTO_HIDE | CAN_ABORT | wx.PD_ELAPSED_TIME)
dlg.Update(371, "Loading schematic: amp.kicad_sch")
wx.Yield()

def walk(w, depth=0):
    f = w.GetFont()
    print("  " * depth + f"{w.GetClassName()} label={w.GetLabel()!r} pos={tuple(w.GetPosition())} "
          f"size={tuple(w.GetSize())} font={f.GetFaceName()} {f.GetPointSize()}pt "
          f"fg={w.GetForegroundColour().GetAsString(wx.C2S_HTML_SYNTAX)} bg={w.GetBackgroundColour().GetAsString(wx.C2S_HTML_SYNTAX)}")
    for c in w.GetChildren():
        walk(c, depth + 1)

print("dialog client size", tuple(dlg.GetClientSize()), "size", tuple(dlg.GetSize()), "pos", tuple(dlg.GetPosition()))
print("frame pos", tuple(frame.GetPosition()), "size", tuple(frame.GetSize()))
walk(dlg)
# The sizer tree: what each item was Add()ed with.
def sizers(s, depth=0):
    for it in s.GetChildren():
        w = it.GetWindow(); sub = it.GetSizer()
        what = w.GetClassName() + (f" {w.GetLabel()!r}" if w else "") if w else (sub.GetClassName() if sub else "spacer")
        print("  " * depth + f"{what} border={it.GetBorder()} flag={it.GetFlag():#x} prop={it.GetProportion()} rect={tuple(it.GetRect())}")
        if sub: sizers(sub, depth + 1)
sizers(dlg.GetSizer())

# `--hold`: keep the dialog up for a moment so a screen capture can sample the
# gauge's fill and trough, which wx cannot report (they are GTK's CSS, not the
# widget's colours).
import time
if "--hold" in sys.argv:
    dlg.Raise()
    for _ in range(25):
        wx.Yield(); time.sleep(0.1)
    print("dialog screen pos", tuple(dlg.GetScreenPosition()), "client", tuple(dlg.ClientToScreen((0, 0))))
