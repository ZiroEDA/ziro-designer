// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// Where GTK puts wxRichMessageDialog's "Do not show again" checkbox.
//
// KIDIALOG derives from wxRichMessageDialog on this platform
// (include/kidialog.h:30-34), and KIDIALOG::DoNotShowCheckbox calls
// ShowCheckBox( _( "Do not show again" ), false ). So the row's position, the
// gap above it and the gap under it are GTK's answers, not KiCad's - the same
// reason .ze-msgdlg's 614x199 was measured rather than chosen.
//
//   g++ -Wno-deprecated-declarations -o kidialog_probe kidialog_probe.cpp \
//       $(wx-config --cxxflags --libs core,base)
#include <wx/wx.h>
#include <wx/richmsgdlg.h>
#include <unistd.h>
#include <functional>

static void walk( wxWindow* w, int depth )
{
    wxRect r = w->GetRect();
    // The foreground too: whether the extended message is DIMMED is the one
    // thing a rect cannot say, and copying the native message box's grey into
    // the generic dialog would be an invention if wx does not set one.
    wxColour fg = w->GetForegroundColour();
    wxFont f = w->GetFont();
    wxPrintf( "%*s%-22s rect=(%d,%d %dx%d) fg=#%02x%02x%02x font=%dpt%s label='%s'\n",
              depth * 2, "", (const char*) w->GetClassInfo()->GetClassName(),
              r.x, r.y, r.width, r.height, fg.Red(), fg.Green(), fg.Blue(),
              f.GetPointSize(), f.GetWeight() == wxFONTWEIGHT_BOLD ? " bold" : "",
              (const char*) w->GetLabel().utf8_str() );

    for( wxWindow* c : w->GetChildren() )
        walk( c, depth + 1 );
}

/**
 * One variant of the dialog, measured from inside its own modal loop.
 *
 * wxGenericMessageDialog builds its controls in ShowModal, not in the
 * constructor -- Fit() before that asserts "invalid frame", because there is no
 * widget tree yet. CallAfter runs once the loop is pumping, by which time the
 * layout exists.
 */
static void measure( wxWindow* parent, const char* what, bool checkbox, bool extended,
                     const char* message = "This position is already occupied by another pin, in unit 2." )
{
    wxRichMessageDialog dlg( parent, message, "Confirmation",
                             wxOK | wxCANCEL | wxICON_WARNING );

    if( extended )
        dlg.SetExtendedMessage( "Disable the 'Synchronized Pins Mode' option to avoid this message." );

    dlg.SetOKLabel( "Place Pin Anyway" );

    if( checkbox )
        dlg.ShowCheckBox( "Do not show again", false );

    dlg.CallAfter( [&dlg, what]()
                   {
                       wxSize win = dlg.GetSize();
                       wxSize cli = dlg.GetClientSize();
                       wxPrintf( "\n== %s ==\nwindow %d x %d, client %d x %d\n",
                                 what, win.x, win.y, cli.x, cli.y );
                       walk( &dlg, 0 );
                       dlg.EndModal( wxID_CANCEL );
                   } );
    dlg.ShowModal();
}

class App : public wxApp
{
public:
    bool OnInit() override
    {
        // A real parent: wxGenericRichMessageDialog is a wxDialog, and sizing
        // one with no top-level window trips an assert in gtk/toplevel.cpp.
        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, "probe" );

        measure( frame, "checkbox + extended message", true,  true );
        measure( frame, "extended message, NO checkbox", false, true );
        measure( frame, "checkbox, no extended message", true,  false );
        measure( frame, "neither", false, false );
        // How wide does a long message get before wx wraps it? The answer is a
        // cap the CSS needs, because shrink-to-fit alone never wraps.
        measure( frame, "a very long message", true, false,
                 "The board file was written by a newer version of KiCad and contains "
                 "features this version does not understand, so opening it here may "
                 "silently drop them; keep a copy before saving over the original." );

        fflush( stdout );
        // A probe, not an app: leave rather than unwind a parent frame that was
        // never shown.
        _exit( 0 );
        return false;
    }
};
wxIMPLEMENT_APP( App );
