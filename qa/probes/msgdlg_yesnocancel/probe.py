# The button order and default of a wxYES_NO | wxCANCEL wxMessageDialog on wxGTK,
# read off the GtkMessageDialog wx builds (the same call DIALOG_DRC makes).
import wx
app = wx.App(False)
dlg = wx.MessageDialog(None, "Delete exclusions too?", "Delete All Markers",
                       wx.YES_NO | wx.CANCEL | wx.CENTER | wx.ICON_QUESTION)
dlg.SetYesNoLabels("Errors and Warnings Only", "Errors, Warnings and Exclusions")
# wx creates the GTK dialog lazily in ShowModal; force it via the handle after a timer
def probe():
    import gi
    gi.require_version('Gtk', '3.0')
    from gi.repository import Gtk
    for w in Gtk.Window.list_toplevels():
        if isinstance(w, Gtk.MessageDialog):
            area = w.get_action_area()
            labels = [(b.get_label(), w.get_response_for_widget(b)) for b in area.get_children()]
            print("BUTTONS", labels)
            print("DEFAULT", w.get_default_widget().get_label() if w.get_default_widget() else None)
            print("FOCUS", w.get_focus().get_label() if w.get_focus() else None)
            w.response(Gtk.ResponseType.CANCEL)
    return False
wx.CallLater(400, probe)
print("RESULT", dlg.ShowModal())
