// SPDX-License-Identifier: GPL-3.0-or-later
// What a wxDialog is actually made of on this desktop: the colours GTK paints
// it with, the font it uses, and the natural size of the controls KiCad puts in
// one. Every number our `.ze-modal` chrome states should come from here.
//
//   g++ -Wno-deprecated-declarations -o dialog_chrome_probe dialog_chrome_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,adv)
#include <wx/wx.h>
#include <wx/statline.h>

static void say( const char* what, const wxColour& c )
{
    wxPrintf( "%-34s rgb(%3d,%3d,%3d)  %s\n", what, c.Red(), c.Green(), c.Blue(),
              c.GetAsString( wxC2S_HTML_SYNTAX ) );
}

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxDialog* dlg = new wxDialog( nullptr, wxID_ANY, "probe", wxDefaultPosition,
                                      wxDefaultSize,
                                      wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER );
        wxBoxSizer* top = new wxBoxSizer( wxVERTICAL );
        wxStaticText* label = new wxStaticText( dlg, wxID_ANY, "Text size:" );
        wxTextCtrl*   entry = new wxTextCtrl( dlg, wxID_ANY, "1.27" );
        wxButton*     ok     = new wxButton( dlg, wxID_OK, "OK" );
        wxStaticBox*  group  = new wxStaticBox( dlg, wxID_ANY, "Formatting" );
        top->Add( label, 0, wxALL, 5 );
        top->Add( entry, 0, wxALL, 5 );
        top->Add( ok, 0, wxALL, 5 );
        dlg->SetSizer( top );
        top->Fit( dlg );
        dlg->Show();
        while( Pending() ) Dispatch();

        wxPrintf( "gtk-font-name (sanity: must NOT be Cantarell)\n" );
        wxFont f = dlg->GetFont();
        wxPrintf( "%-34s %s %gpt  px=%d\n", "dialog GetFont", f.GetFaceName().mb_str().data(),
                  f.GetFractionalPointSize(), f.GetPixelSize().y );
        say( "dialog GetBackgroundColour", dlg->GetBackgroundColour() );
        say( "dialog GetForegroundColour", dlg->GetForegroundColour() );
        say( "staticText GetForegroundColour", label->GetForegroundColour() );
        say( "wxSYS_COLOUR_WINDOWTEXT", wxSystemSettings::GetColour( wxSYS_COLOUR_WINDOWTEXT ) );
        say( "wxSYS_COLOUR_BTNTEXT", wxSystemSettings::GetColour( wxSYS_COLOUR_BTNTEXT ) );
        say( "wxSYS_COLOUR_3DFACE", wxSystemSettings::GetColour( wxSYS_COLOUR_3DFACE ) );
        say( "entry GetBackgroundColour", entry->GetBackgroundColour() );

        wxSize es = entry->GetSize(), bs = ok->GetSize(), ls = label->GetSize();
        wxPrintf( "%-34s %d x %d\n", "wxTextCtrl size", es.x, es.y );
        wxPrintf( "%-34s %d x %d\n", "wxButton  size", bs.x, bs.y );
        wxPrintf( "%-34s %d x %d\n", "wxStaticText size", ls.x, ls.y );
        wxPrintf( "%-34s %d\n", "dialog char height", dlg->GetCharHeight() );
        wxPrintf( "%-34s %d\n", "5 DU border in px",
                  dlg->ConvertDialogToPixels( wxSize( 5, 0 ) ).x );
        (void) group;
        dlg->Destroy();
        return false;
    }
};
wxIMPLEMENT_APP_NO_MAIN( App );
int main( int argc, char** argv ) { wxEntryStart( argc, argv ); wxTheApp->CallOnInit(); return 0; }
