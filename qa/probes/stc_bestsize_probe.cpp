// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// How tall is the multi-line text control in DIALOG_TEXT_PROPERTIES?
//
// `dialog_text_properties_base.cpp` states no `SetMinSize` for it, unlike the
// text BOX dialog's `SetMinSize( wxSize( -1,150 ) )`. So the height of that
// block is whatever `wxStyledTextCtrl` reports as its best size, with the same
// construction arguments the generated file uses, and this asks it.
//
//   g++ -Wno-deprecated-declarations -o stc_bestsize_probe stc_bestsize_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,stc)
#include <wx/wx.h>
#include <wx/stc/stc.h>
#include <wx/textctrl.h>

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxDialog dlg( nullptr, wxID_ANY, "probe" );

        // Exactly `dialog_text_properties_base.cpp:30`, and the calls that
        // follow it which could change the metrics: the three zeroed margins.
        wxStyledTextCtrl* stc = new wxStyledTextCtrl( &dlg, wxID_ANY, wxDefaultPosition,
                                                      wxDefaultSize, 0, wxEmptyString );
        stc->SetUseTabs( true );
        stc->SetTabWidth( 4 );
        stc->SetIndent( 4 );
        stc->SetMarginWidth( 2, 0 );
        stc->SetMarginWidth( 1, 0 );
        stc->SetMarginWidth( 0, 0 );

        wxTextCtrl* entry = new wxTextCtrl( &dlg, wxID_ANY );

        printf( "wxStyledTextCtrl GetBestSize   = %d x %d\n",
                stc->GetBestSize().x, stc->GetBestSize().y );
        printf( "wxStyledTextCtrl GetMinSize    = %d x %d\n",
                stc->GetMinSize().x, stc->GetMinSize().y );
        printf( "wxStyledTextCtrl TextHeight(0) = %d\n", stc->TextHeight( 0 ) );
        printf( "wxTextCtrl       GetBestSize   = %d x %d\n",
                entry->GetBestSize().x, entry->GetBestSize().y );

        // HTML_MESSAGE_BOX's own size, which PCB_TEXT::ShowSyntaxHelp states in
        // dialog units: `SetMinSize( ConvertDialogToPixels( wxSize( 320, 320 ) ) )`
        // then `SetDialogSizeInDU( 320, 320 )` (`pcb_text.cpp:725-728`).
        wxSize du = dlg.ConvertDialogToPixels( wxSize( 320, 320 ) );
        printf( "ConvertDialogToPixels(320,320) = %d x %d\n", du.x, du.y );
        fflush( stdout );
        return false;
    }
};
IMPLEMENT_APP_NO_MAIN( App )
int main( int argc, char** argv )
{
    wxEntryStart( argc, argv );
    wxTheApp->CallOnInit();
    wxEntryCleanup();
    return 0;
}
