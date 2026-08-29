// SPDX-License-Identifier: GPL-3.0-or-later
// What sets DIALOG_FIELD_PROPERTIES' width.
//
// Reading `dialog_field_properties_base.cpp` does not answer it. Row 0 of
// `gbSizer1` is
//
//     m_fontLabel   (0,0)
//     m_fontCtrl    (0,1) span 1x2, wxEXPAND
//     formattingSizer (0,3) span 1x2
//
// and `m_fontCtrl` is a `FONT_CHOICE`, which is a `wxOwnerDrawnComboBox`
// constructed with **zero** items (`font_choice.cpp:179-191`) and then filled by
// `RefreshFonts()` with the fonts installed on the machine. Its best width is
// therefore whatever the longest of those names measures, which is a property of
// this desktop and not of KiCad's source. That is the number this probe exists
// to report.
//
//   g++ -Wno-deprecated-declarations -o field_props_width_probe \
//       field_props_width_probe.cpp $(wx-config --cxxflags --libs core,base,adv)
#include <wx/wx.h>
#include <wx/odcombo.h>
#include <wx/fontenum.h>
#include <wx/statline.h>
#include <wx/gbsizer.h>
#include <wx/bmpbuttn.h>

/** `BITMAP_BUTTON`s in the formatting row are built at this size upstream. */
static const int BMP = 16;

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxDialog* dlg = new wxDialog( nullptr, wxID_ANY, "Edit Value Field" );

        // ---- the font choice, as FONT_CHOICE builds it ---------------------
        // Constructed empty, then RefreshFonts() appends the system faces.
        wxOwnerDrawnComboBox* font =
                new wxOwnerDrawnComboBox( dlg, wxID_ANY, wxEmptyString, wxDefaultPosition,
                                          wxDefaultSize, 0, nullptr, 0 );
        font->Append( "Default Font" );
        font->Append( "KiCad Font" );

        wxArrayString faces = wxFontEnumerator::GetFacenames();
        faces.Sort();
        for( const wxString& f : faces )
            font->Append( f );

        wxPrintf( "%-38s %d\n", "installed faces", (int) faces.GetCount() );

        wxString longest;
        for( const wxString& f : faces )
            if( f.length() > longest.length() )
                longest = f;

        wxPrintf( "%-38s %s\n", "longest face name", (const char*) longest.utf8_str() );
        wxPrintf( "%-38s %d\n", "FONT_CHOICE GetBestSize().x", font->GetBestSize().x );

        // The same control with only the two static strings, which is what our
        // <select> currently holds.
        wxOwnerDrawnComboBox* twoOnly =
                new wxOwnerDrawnComboBox( dlg, wxID_ANY, wxEmptyString, wxDefaultPosition,
                                          wxDefaultSize, 0, nullptr, 0 );
        twoOnly->Append( "Default Font" );
        twoOnly->Append( "KiCad Font" );
        wxPrintf( "%-38s %d\n", "  ...with only the 2 static items", twoOnly->GetBestSize().x );

        // ---- formattingSizer: 5 separators + 10 bitmap buttons -------------
        wxBoxSizer* fmt = new wxBoxSizer( wxHORIZONTAL );
        auto sep = [&]()
        {
            wxStaticLine* s = new wxStaticLine( dlg, wxID_ANY, wxDefaultPosition,
                                                wxDefaultSize, wxLI_VERTICAL );
            fmt->Add( s, 0, wxALIGN_CENTER_VERTICAL, 5 );
        };
        auto btn = [&]()
        {
            wxBitmapButton* b = new wxBitmapButton( dlg, wxID_ANY,
                                                    wxBitmap( BMP, BMP ), wxDefaultPosition,
                                                    wxDefaultSize, wxBU_AUTODRAW | 0 );
            fmt->Add( b, 0, wxALIGN_CENTER_VERTICAL, 5 );
        };
        // separator1, bold, italic, separator2, hAlign x3, separator3,
        // vAlign x3, separator4, horizontal, vertical, separator5
        sep(); btn(); btn();
        sep(); btn(); btn(); btn();
        sep(); btn(); btn(); btn();
        sep(); btn(); btn();
        sep();
        wxPrintf( "%-38s %d\n", "formattingSizer CalcMin().x", fmt->CalcMin().x );

        // The two parts of that total, so a CSS button size can carry a number.
        wxBitmapButton* one = new wxBitmapButton( dlg, wxID_ANY, wxBitmap( BMP, BMP ),
                                                  wxDefaultPosition, wxDefaultSize,
                                                  wxBU_AUTODRAW | 0 );
        wxStaticLine* oneSep = new wxStaticLine( dlg, wxID_ANY, wxDefaultPosition,
                                                 wxDefaultSize, wxLI_VERTICAL );
        wxPrintf( "%-38s %d x %d\n", "  one BITMAP_BUTTON best size",
                  one->GetBestSize().x, one->GetBestSize().y );
        wxPrintf( "%-38s %d\n", "  one wxLI_VERTICAL best width",
                  oneSep->GetBestSize().x );

        // ---- row 0 as a whole ---------------------------------------------
        wxStaticText* fontLabel = new wxStaticText( dlg, wxID_ANY, "Font:" );
        wxGridBagSizer* gb = new wxGridBagSizer( 3, 0 );
        gb->SetEmptyCellSize( wxSize( -1, 10 ) );
        gb->Add( fontLabel, wxGBPosition( 0, 0 ), wxGBSpan( 1, 1 ),
                 wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL, 5 );
        gb->Add( font, wxGBPosition( 0, 1 ), wxGBSpan( 1, 2 ), wxEXPAND, 5 );
        gb->Add( fmt, wxGBPosition( 0, 3 ), wxGBSpan( 1, 2 ), wxEXPAND, 5 );

        wxPrintf( "%-38s %d\n", "gbSizer1 row 0 CalcMin().x", gb->CalcMin().x );

        // ---- the entry controls -------------------------------------------
        // `m_textSizeCtrl` and the position ctrls are plain wxTextCtrls at
        // wxSize( -1, -1 ), so they take GTK's own best size.
        wxTextCtrl* small = new wxTextCtrl( dlg, wxID_ANY, wxEmptyString, wxDefaultPosition,
                                            wxSize( -1, -1 ), 0 );
        wxPrintf( "%-38s %d x %d\n", "wxTextCtrl best size (size/pos)",
                  small->GetBestSize().x, small->GetBestSize().y );

        // ---- rows 1..4 and the checkbox row, so the whole thing fits -------
        wxStaticText* sizeLabel = new wxStaticText( dlg, wxID_ANY, "Text size:" );
        gb->Add( sizeLabel, wxGBPosition( 1, 0 ), wxGBSpan( 1, 1 ),
                 wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT, 5 );
        wxBoxSizer* b71 = new wxBoxSizer( wxHORIZONTAL );
        b71->Add( small, 0, wxALIGN_CENTER_VERTICAL, 5 );
        b71->Add( new wxStaticText( dlg, wxID_ANY, "mils" ), 0,
                  wxALIGN_CENTER_VERTICAL | wxLEFT, 3 );
        b71->Add( new wxStaticText( dlg, wxID_ANY, "Color:" ), 0,
                  wxALIGN_CENTER_VERTICAL | wxLEFT, 15 );
        b71->Add( 5, 0, 0, 0, 5 );
        gb->Add( b71, wxGBPosition( 1, 1 ), wxGBSpan( 1, 2 ), wxEXPAND, 5 );

        for( int r = 3; r <= 4; ++r )
        {
            gb->Add( new wxStaticText( dlg, wxID_ANY, r == 3 ? "Position X:" : "Position Y:" ),
                     wxGBPosition( r, 0 ), wxGBSpan( 1, 1 ),
                     wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL, 5 );
            gb->Add( new wxTextCtrl( dlg, wxID_ANY, wxEmptyString, wxDefaultPosition,
                                     wxSize( -1, -1 ), 0 ),
                     wxGBPosition( r, 1 ), wxGBSpan( 1, 1 ),
                     wxALIGN_CENTER_VERTICAL | wxEXPAND, 5 );
            gb->Add( new wxStaticText( dlg, wxID_ANY, "mils" ), wxGBPosition( r, 2 ),
                     wxGBSpan( 1, 1 ), wxALIGN_CENTER_VERTICAL | wxLEFT, 3 );
        }

        // bSizer9: the three checkboxes with stretch spacers between them.
        wxBoxSizer* b9 = new wxBoxSizer( wxHORIZONTAL );
        b9->Add( new wxCheckBox( dlg, wxID_ANY, "Visible" ), 0, wxALIGN_LEFT | wxBOTTOM, 5 );
        b9->Add( 0, 0, 1, wxEXPAND, 5 );
        b9->Add( new wxCheckBox( dlg, wxID_ANY, "Show field name" ), 0, wxRIGHT | wxLEFT, 20 );
        b9->Add( 0, 0, 1, wxEXPAND, 5 );
        b9->Add( new wxCheckBox( dlg, wxID_ANY, "Allow automatic placement" ), 0,
                 wxFIXED_MINSIZE | wxRIGHT, 37 );
        wxPrintf( "%-38s %d\n", "bSizer9 (checkbox row) CalcMin().x", b9->CalcMin().x );

        // bTextValueBoxSizer: the Value label and its entry, which takes
        // proportion 1 so its MIN is the text ctrl's best width.
        wxBoxSizer* bVal = new wxBoxSizer( wxHORIZONTAL );
        bVal->Add( new wxStaticText( dlg, wxID_ANY, "Value:" ), 0,
                   wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT, 5 );
        bVal->Add( new wxTextCtrl( dlg, wxID_ANY, wxEmptyString ), 1,
                   wxALIGN_CENTER_VERTICAL | wxLEFT, 5 );
        wxPrintf( "%-38s %d\n", "bTextValueBoxSizer CalcMin().x", bVal->CalcMin().x );

        // ---- and what the dialog fits to -----------------------------------
        wxBoxSizer* props = new wxBoxSizer( wxVERTICAL );
        props->Add( bVal, 0, wxBOTTOM | wxRIGHT | wxLEFT | wxEXPAND, 5 );
        props->Add( b9, 0, wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT, 10 );
        props->Add( gb, 1, wxEXPAND | wxRIGHT | wxLEFT, 5 );

        wxBoxSizer* main = new wxBoxSizer( wxVERTICAL );
        main->Add( props, 1, wxEXPAND | wxTOP | wxRIGHT | wxLEFT, 5 );
        wxStdDialogButtonSizer* sdb = new wxStdDialogButtonSizer();
        sdb->AddButton( new wxButton( dlg, wxID_OK ) );
        sdb->AddButton( new wxButton( dlg, wxID_CANCEL ) );
        sdb->Realize();
        main->Add( sdb, 0, wxEXPAND | wxALL, 5 );

        dlg->SetSizer( main );
        dlg->Layout();
        main->Fit( dlg );
        wxPrintf( "%-38s %d x %d\n", "WHOLE DIALOG after Fit",
                  dlg->GetSize().x, dlg->GetSize().y );

        dlg->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_NO_MAIN( App );

int main( int argc, char** argv )
{
    wxEntryStart( argc, argv );
    wxTheApp->CallOnInit();
    wxEntryCleanup();
    return 0;
}
