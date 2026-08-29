// SPDX-License-Identifier: GPL-3.0-or-later
// DIALOG_CHANGE_SYMBOLS, rebuilt with real wxWidgets on this desktop, so the
// numbers our CSS states can be read off the toolkit instead of a screenshot.
//
// The sizer tree is transcribed line for line from
// `eeschema/dialogs/dialog_change_symbols_base.cpp` (KiCad 10.0.5) plus
// `common/widgets/wx_html_report_panel_base.cpp` for the message panel, with
// two substitutions that carry no layout of their own:
//   STD_BITMAP_BUTTON -> wxBitmapButton with a 16x16 bitmap (KiBitmapBundle)
//   HTML_WINDOW       -> wxHtmlWindow (its own base class)
//   NUMBER_BADGE      -> a wxPanel with the same SetMinSize( 10, 10 )
//
//   g++ -Wno-deprecated-declarations -o change_symbols_probe change_symbols_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,adv,html)
#include <wx/wx.h>
#include <wx/checklst.h>
#include <wx/gbsizer.h>
#include <wx/html/htmlwin.h>
#include <wx/statline.h>

static void size( const char* what, const wxSize& s )
{
    wxPrintf( "%-46s %4d x %4d\n", what, s.x, s.y );
}

static void say( const char* what, const wxColour& c )
{
    wxPrintf( "%-46s rgb(%3d,%3d,%3d)  %s\n", what, c.Red(), c.Green(), c.Blue(),
              c.GetAsString( wxC2S_HTML_SYNTAX ) );
}

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxDialog* dlg = new wxDialog( nullptr, wxID_ANY, "Update Symbols from Library",
                                      wxDefaultPosition, wxDefaultSize,
                                      wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER );

        wxBitmap browseBmp( 16, 16 );

        wxBoxSizer* m_mainSizer = new wxBoxSizer( wxVERTICAL );

        wxBoxSizer*    matchSizerMargins = new wxBoxSizer( wxVERTICAL );
        wxGridBagSizer* m_matchSizer = new wxGridBagSizer( 3, 0 );
        m_matchSizer->SetFlexibleDirection( wxBOTH );
        m_matchSizer->SetNonFlexibleGrowMode( wxFLEX_GROWMODE_SPECIFIED );

        wxRadioButton* m_matchAll = new wxRadioButton( dlg, wxID_ANY, "Update all symbols in schematic" );
        m_matchSizer->Add( m_matchAll, wxGBPosition( 0, 0 ), wxGBSpan( 1, 2 ),
                           wxALIGN_CENTER_VERTICAL | wxBOTTOM, 5 );

        wxRadioButton* m_matchBySelection = new wxRadioButton( dlg, wxID_ANY, "Update selected symbol(s)" );
        m_matchSizer->Add( m_matchBySelection, wxGBPosition( 1, 0 ), wxGBSpan( 1, 1 ),
                           wxALIGN_CENTER_VERTICAL | wxBOTTOM, 5 );

        wxRadioButton* m_matchByReference =
                new wxRadioButton( dlg, wxID_ANY, "Update symbols matching reference designator:" );
        m_matchSizer->Add( m_matchByReference, wxGBPosition( 2, 0 ), wxGBSpan( 1, 1 ),
                           wxALIGN_CENTER_VERTICAL, 2 );

        wxTextCtrl* m_specifiedReference = new wxTextCtrl( dlg, wxID_ANY, wxEmptyString, wxDefaultPosition,
                                                          wxSize( 200, -1 ), wxTE_PROCESS_ENTER );
        m_matchSizer->Add( m_specifiedReference, wxGBPosition( 2, 1 ), wxGBSpan( 1, 1 ),
                           wxALIGN_CENTER_VERTICAL | wxRIGHT | wxEXPAND, 5 );

        wxRadioButton* m_matchByValue = new wxRadioButton( dlg, wxID_ANY, "Update symbols matching value:" );
        m_matchSizer->Add( m_matchByValue, wxGBPosition( 3, 0 ), wxGBSpan( 1, 1 ),
                           wxALIGN_CENTER_VERTICAL, 5 );

        wxTextCtrl* m_specifiedValue = new wxTextCtrl( dlg, wxID_ANY, wxEmptyString, wxDefaultPosition,
                                                      wxDefaultSize, wxTE_PROCESS_ENTER );
        m_matchSizer->Add( m_specifiedValue, wxGBPosition( 3, 1 ), wxGBSpan( 1, 1 ),
                           wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT, 5 );

        wxRadioButton* m_matchById =
                new wxRadioButton( dlg, wxID_ANY, "Update symbols matching library identifier:" );
        m_matchSizer->Add( m_matchById, wxGBPosition( 4, 0 ), wxGBSpan( 1, 1 ),
                           wxALIGN_CENTER_VERTICAL, 6 );

        wxBoxSizer* bSizer10 = new wxBoxSizer( wxHORIZONTAL );
        wxTextCtrl* m_specifiedId = new wxTextCtrl( dlg, wxID_ANY, wxEmptyString, wxDefaultPosition,
                                                   wxDefaultSize, wxTE_PROCESS_ENTER );
        bSizer10->Add( m_specifiedId, 1, wxALIGN_CENTER_VERTICAL, 5 );
        wxBitmapButton* m_matchIdBrowserButton =
                new wxBitmapButton( dlg, wxID_ANY, browseBmp, wxDefaultPosition, wxDefaultSize, wxBU_AUTODRAW );
        bSizer10->Add( m_matchIdBrowserButton, 0, wxALIGN_CENTER_VERTICAL, 5 );
        m_matchSizer->Add( bSizer10, wxGBPosition( 4, 1 ), wxGBSpan( 1, 1 ), wxEXPAND | wxRIGHT, 5 );

        m_matchSizer->AddGrowableCol( 1 );
        m_matchSizer->AddGrowableRow( 1 );

        matchSizerMargins->Add( m_matchSizer, 0, wxEXPAND | wxTOP | wxRIGHT | wxLEFT, 5 );
        m_mainSizer->Add( matchSizerMargins, 0, wxEXPAND | wxTOP | wxLEFT, 5 );

        m_mainSizer->Add( 0, 8, 0, wxEXPAND, 5 );

        wxStaticLine* m_staticline1 = new wxStaticLine( dlg, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                                                        wxLI_HORIZONTAL );
        m_mainSizer->Add( m_staticline1, 0, wxEXPAND | wxALL, 4 );

        wxBoxSizer*   m_newIdSizer = new wxBoxSizer( wxHORIZONTAL );
        wxStaticText* m_newIdLabel = new wxStaticText( dlg, wxID_ANY, "New library identifier:" );
        m_newIdSizer->Add( m_newIdLabel, 0, wxLEFT | wxALIGN_CENTER_VERTICAL, 5 );
        wxTextCtrl* m_newId = new wxTextCtrl( dlg, wxID_ANY, wxEmptyString, wxDefaultPosition, wxDefaultSize,
                                              wxTE_PROCESS_ENTER );
        m_newIdSizer->Add( m_newId, 1, wxALIGN_CENTER_VERTICAL | wxLEFT, 5 );
        wxBitmapButton* m_newIdBrowserButton =
                new wxBitmapButton( dlg, wxID_ANY, browseBmp, wxDefaultPosition, wxDefaultSize, wxBU_AUTODRAW );
        m_newIdSizer->Add( m_newIdBrowserButton, 0, wxALIGN_CENTER_VERTICAL | wxRIGHT, 5 );
        m_mainSizer->Add( m_newIdSizer, 0, wxEXPAND | wxTOP | wxRIGHT | wxLEFT, 5 );

        wxBoxSizer* bSizerUpdate = new wxBoxSizer( wxHORIZONTAL );

        wxStaticBoxSizer* m_updateFieldsSizer =
                new wxStaticBoxSizer( new wxStaticBox( dlg, wxID_ANY, "Update/Reset Fields" ), wxVERTICAL );
        wxArrayString  fieldChoices;
        wxCheckListBox* m_fieldsBox = new wxCheckListBox( m_updateFieldsSizer->GetStaticBox(), wxID_ANY,
                                                          wxDefaultPosition, wxDefaultSize, fieldChoices,
                                                          wxLB_NEEDED_SB );
        m_fieldsBox->SetMinSize( wxSize( -1, 120 ) );
        m_updateFieldsSizer->Add( m_fieldsBox, 1, wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT, 5 );

        wxBoxSizer* m_selBtnSizer = new wxBoxSizer( wxHORIZONTAL );
        wxButton*   m_selAllBtn = new wxButton( m_updateFieldsSizer->GetStaticBox(), wxID_ANY, "Select All" );
        m_selBtnSizer->Add( m_selAllBtn, 1, wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT, 5 );
        wxButton* m_selNoneBtn = new wxButton( m_updateFieldsSizer->GetStaticBox(), wxID_ANY, "Select None" );
        m_selBtnSizer->Add( m_selNoneBtn, 1, wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT, 5 );
        m_updateFieldsSizer->Add( m_selBtnSizer, 0, wxEXPAND, 5 );

        bSizerUpdate->Add( m_updateFieldsSizer, 2, wxEXPAND | wxTOP | wxRIGHT | wxLEFT, 10 );
        bSizerUpdate->Add( 5, 0, 0, wxEXPAND, 5 );

        wxStaticBoxSizer* m_updateOptionsSizer =
                new wxStaticBoxSizer( new wxStaticBox( dlg, wxID_ANY, "Update Options" ), wxHORIZONTAL );
        wxWindow*   optBox = m_updateOptionsSizer->GetStaticBox();
        wxBoxSizer* bSizer8 = new wxBoxSizer( wxVERTICAL );
        wxCheckBox* c1 = new wxCheckBox( optBox, wxID_ANY, "Remove fields if not in library symbol" );
        bSizer8->Add( c1, 0, wxBOTTOM | wxRIGHT, 5 );
        wxCheckBox* c2 = new wxCheckBox( optBox, wxID_ANY, "Reset fields if empty in library symbol" );
        bSizer8->Add( c2, 0, wxBOTTOM | wxRIGHT, 5 );
        bSizer8->Add( 0, 10, 1, wxEXPAND, 5 );
        wxCheckBox* c3 = new wxCheckBox( optBox, wxID_ANY, "Update/reset field text" );
        bSizer8->Add( c3, 0, wxBOTTOM | wxRIGHT, 5 );
        wxCheckBox* c4 = new wxCheckBox( optBox, wxID_ANY, "Update/reset field visibilities" );
        bSizer8->Add( c4, 0, wxBOTTOM | wxRIGHT, 5 );
        wxCheckBox* c5 = new wxCheckBox( optBox, wxID_ANY, "Update/reset field text sizes and styles" );
        bSizer8->Add( c5, 0, wxBOTTOM | wxRIGHT, 5 );
        wxCheckBox* c6 = new wxCheckBox( optBox, wxID_ANY, "Update/reset field positions" );
        bSizer8->Add( c6, 0, wxBOTTOM | wxRIGHT, 10 );
        wxButton* m_checkAll = new wxButton( optBox, wxID_ANY, "Check All Update Options" );
        bSizer8->Add( m_checkAll, 0, wxEXPAND | wxTOP | wxBOTTOM, 5 );
        m_updateOptionsSizer->Add( bSizer8, 1, wxEXPAND | wxRIGHT, 10 );

        wxBoxSizer* bSizer9 = new wxBoxSizer( wxVERTICAL );
        wxCheckBox* d1 = new wxCheckBox( optBox, wxID_ANY, "Update symbol shape and pins" );
        d1->SetValue( true );
        d1->Enable( false );
        bSizer9->Add( d1, 0, wxBOTTOM | wxRIGHT, 5 );
        wxCheckBox* d2 = new wxCheckBox( optBox, wxID_ANY, "Update keywords and footprint filters" );
        d2->SetValue( true );
        d2->Enable( false );
        bSizer9->Add( d2, 0, wxBOTTOM | wxRIGHT, 5 );
        bSizer9->Add( 0, 10, 1, wxEXPAND, 5 );
        wxCheckBox* d3 = new wxCheckBox( optBox, wxID_ANY, "Update/reset pin name/number visibilities" );
        bSizer9->Add( d3, 0, wxBOTTOM | wxRIGHT, 5 );
        wxCheckBox* d4 = new wxCheckBox( optBox, wxID_ANY, "Reset alternate pin functions" );
        bSizer9->Add( d4, 0, wxBOTTOM | wxRIGHT, 5 );
        bSizer9->Add( 0, 10, 1, wxEXPAND, 5 );
        wxCheckBox* d5 = new wxCheckBox( optBox, wxID_ANY, "Update/reset symbol attributes" );
        bSizer9->Add( d5, 0, wxBOTTOM | wxRIGHT, 5 );
        wxCheckBox* d6 = new wxCheckBox( optBox, wxID_ANY, "Reset custom power symbols" );
        bSizer9->Add( d6, 0, wxBOTTOM | wxRIGHT, 10 );
        wxButton* m_uncheckAll = new wxButton( optBox, wxID_ANY, "Uncheck All Update Options" );
        bSizer9->Add( m_uncheckAll, 0, wxEXPAND | wxTOP | wxBOTTOM, 5 );
        m_updateOptionsSizer->Add( bSizer9, 1, wxEXPAND, 5 );

        bSizerUpdate->Add( m_updateOptionsSizer, 4, wxEXPAND | wxTOP | wxRIGHT, 10 );
        m_mainSizer->Add( bSizerUpdate, 0, wxEXPAND, 5 );

        // ---- WX_HTML_REPORT_PANEL_BASE, verbatim -------------------------------
        wxPanel* m_messagePanel = new wxPanel( dlg, wxID_ANY );
        m_messagePanel->SetMinSize( wxSize( -1, 225 ) );
        wxStaticBoxSizer* m_box =
                new wxStaticBoxSizer( new wxStaticBox( m_messagePanel, wxID_ANY, "Output Messages" ), wxVERTICAL );
        wxWindow*       rBox = m_box->GetStaticBox();
        wxFlexGridSizer* m_fgSizer = new wxFlexGridSizer( 2, 1, 0, 0 );
        m_fgSizer->AddGrowableCol( 0 );
        m_fgSizer->AddGrowableRow( 0 );
        m_fgSizer->SetFlexibleDirection( wxBOTH );
        m_fgSizer->SetNonFlexibleGrowMode( wxFLEX_GROWMODE_SPECIFIED );
        wxHtmlWindow* m_htmlView = new wxHtmlWindow( rBox, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                                                     wxHW_SCROLLBAR_AUTO );
        m_fgSizer->Add( m_htmlView, 1, wxEXPAND | wxLEFT | wxRIGHT | wxTOP, 5 );

        wxBoxSizer*   bSizerBottom = new wxBoxSizer( wxHORIZONTAL );
        wxStaticText* m_staticTextShow = new wxStaticText( rBox, wxID_ANY, "Show:" );
        bSizerBottom->Add( m_staticTextShow, 0, wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxLEFT, 2 );
        wxCheckBox* showAll = new wxCheckBox( rBox, wxID_ANY, "All" );
        showAll->SetValue( true );
        bSizerBottom->Add( showAll, 0, wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT, 5 );
        bSizerBottom->Add( 30, 0, 0, wxEXPAND, 5 );
        wxCheckBox* showErrors = new wxCheckBox( rBox, wxID_ANY, "Errors" );
        showErrors->SetValue( true );
        bSizerBottom->Add( showErrors, 0, wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT, 5 );
        wxPanel* errBadge = new wxPanel( rBox, wxID_ANY );
        errBadge->SetMinSize( wxSize( 10, 10 ) );
        bSizerBottom->Add( errBadge, 0, wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxTOP, 4 );
        bSizerBottom->Add( 25, 0, 0, wxEXPAND, 5 );
        wxCheckBox* showWarnings = new wxCheckBox( rBox, wxID_ANY, "Warnings" );
        showWarnings->SetValue( true );
        bSizerBottom->Add( showWarnings, 0, wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT, 5 );
        wxPanel* warnBadge = new wxPanel( rBox, wxID_ANY );
        warnBadge->SetMinSize( wxSize( 10, 10 ) );
        bSizerBottom->Add( warnBadge, 0, wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxTOP, 4 );
        bSizerBottom->Add( 25, 0, 0, wxEXPAND, 5 );
        wxCheckBox* showActions = new wxCheckBox( rBox, wxID_ANY, "Actions" );
        showActions->SetValue( true );
        bSizerBottom->Add( showActions, 0, wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT, 5 );
        bSizerBottom->Add( 30, 0, 0, wxEXPAND, 5 );
        wxCheckBox* showInfos = new wxCheckBox( rBox, wxID_ANY, "Infos" );
        showInfos->SetValue( true );
        bSizerBottom->Add( showInfos, 0, wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT, 5 );
        bSizerBottom->Add( 30, 0, 1, wxEXPAND, 5 );
        wxButton* m_btnSaveReportToFile = new wxButton( rBox, wxID_ANY, "Save..." );
        bSizerBottom->Add( m_btnSaveReportToFile, 0, wxALIGN_CENTER_VERTICAL | wxALL, 5 );
        m_fgSizer->Add( bSizerBottom, 0, wxEXPAND, 5 );
        m_box->Add( m_fgSizer, 1, wxEXPAND, 5 );
        m_messagePanel->SetSizer( m_box );
        m_messagePanel->Layout();
        m_box->Fit( m_messagePanel );
        // ------------------------------------------------------------------------

        m_messagePanel->SetMinSize( wxSize( -1, 200 ) );
        wxBoxSizer* bSizer2 = new wxBoxSizer( wxVERTICAL );
        bSizer2->Add( m_messagePanel, 1, wxEXPAND | wxALL, 5 );
        m_mainSizer->Add( bSizer2, 1, wxEXPAND | wxTOP | wxRIGHT | wxLEFT, 5 );

        wxStdDialogButtonSizer* m_sdbSizer = new wxStdDialogButtonSizer();
        wxButton* ok = new wxButton( dlg, wxID_OK );
        m_sdbSizer->AddButton( ok );
        wxButton* cancel = new wxButton( dlg, wxID_CANCEL );
        m_sdbSizer->AddButton( cancel );
        m_sdbSizer->Realize();
        m_mainSizer->Add( m_sdbSizer, 0, wxEXPAND | wxALL, 5 );

        dlg->SetSizer( m_mainSizer );
        dlg->Layout();
        m_mainSizer->Fit( dlg );
        dlg->Show();
        for( int i = 0; i < 3; ++i )
        {
            while( Pending() )
                Dispatch();
            dlg->Layout();
        }

        wxFont f = dlg->GetFont();
        wxPrintf( "gtk-font-name sanity (must NOT be Cantarell): %s %gpt\n",
                  f.GetFaceName().mb_str().data(), f.GetFractionalPointSize() );
        wxPrintf( "\n=== the dialog ===\n" );
        size( "dialog GetSize (after Fit)", dlg->GetSize() );
        size( "dialog GetClientSize", dlg->GetClientSize() );
        size( "m_mainSizer CalcMin", m_mainSizer->CalcMin() );

        wxPrintf( "\n=== the five match rows (m_matchSizer) ===\n" );
        const char* names[] = { "m_matchAll", "m_matchBySelection", "m_matchByReference",
                                "m_matchByValue", "m_matchById" };
        wxWindow* rows[] = { m_matchAll, m_matchBySelection, m_matchByReference, m_matchByValue,
                             m_matchById };
        wxWindow* entries[] = { nullptr, nullptr, m_specifiedReference, m_specifiedValue, m_specifiedId };
        int prevCentre = -1;
        for( int i = 0; i < 5; ++i )
        {
            wxRect r = rows[i]->GetRect();
            int    centre = r.y + r.height / 2;
            wxPrintf( "%-22s radio y=%4d h=%3d centre=%4d", names[i], r.y, r.height, centre );
            if( entries[i] )
            {
                wxRect e = entries[i]->GetRect();
                wxPrintf( "   entry y=%4d h=%3d centre=%4d", e.y, e.height, e.y + e.height / 2 );
                centre = e.y + e.height / 2;
            }
            if( prevCentre >= 0 )
                wxPrintf( "   d=%d", centre - prevCentre );
            prevCentre = centre;
            wxPrintf( "\n" );
        }
        size( "wxRadioButton GetBestSize", m_matchAll->GetBestSize() );
        size( "wxTextCtrl GetBestSize", m_specifiedValue->GetBestSize() );
        size( "wxCheckBox GetBestSize", c3->GetBestSize() );
        size( "m_matchSizer CalcMin", m_matchSizer->CalcMin() );

        wxPrintf( "\n=== the two boxes (bSizerUpdate, proportions 2 and 4) ===\n" );
        size( "m_updateFieldsSizer CalcMin", m_updateFieldsSizer->CalcMin() );
        size( "m_updateOptionsSizer CalcMin", m_updateOptionsSizer->CalcMin() );
        size( "bSizer8 CalcMin (left option column)", bSizer8->CalcMin() );
        size( "bSizer9 CalcMin (right option column)", bSizer9->CalcMin() );
        size( "bSizerUpdate CalcMin", bSizerUpdate->CalcMin() );
        wxRect fb = m_updateFieldsSizer->GetStaticBox()->GetRect();
        wxRect ob = m_updateOptionsSizer->GetStaticBox()->GetRect();
        wxPrintf( "%-46s x=%4d w=%4d\n", "Update/Reset Fields staticbox", fb.x, fb.width );
        wxPrintf( "%-46s x=%4d w=%4d\n", "Update Options staticbox", ob.x, ob.width );
        wxPrintf( "%-46s x=%4d w=%4d\n", "m_fieldsBox (checklist)", m_fieldsBox->GetRect().x,
                  m_fieldsBox->GetRect().width );

        wxPrintf( "\n=== the report panel ===\n" );
        size( "bSizerBottom CalcMin (the Show: strip)", bSizerBottom->CalcMin() );
        size( "m_messagePanel CalcMin", m_box->CalcMin() );
        size( "Save... button best", m_btnSaveReportToFile->GetBestSize() );
        size( "'Show:' static text best", m_staticTextShow->GetBestSize() );

        wxPrintf( "\n=== the fills ===\n" );
        say( "dialog GetBackgroundColour", dlg->GetBackgroundColour() );
        say( "m_fieldsBox GetBackgroundColour", m_fieldsBox->GetBackgroundColour() );
        say( "wxTextCtrl GetBackgroundColour", m_specifiedValue->GetBackgroundColour() );
        say( "m_htmlView GetBackgroundColour", m_htmlView->GetBackgroundColour() );
        say( "wxSYS_COLOUR_LISTBOX", wxSystemSettings::GetColour( wxSYS_COLOUR_LISTBOX ) );
        say( "wxSYS_COLOUR_WINDOW", wxSystemSettings::GetColour( wxSYS_COLOUR_WINDOW ) );
        say( "wxSYS_COLOUR_3DFACE", wxSystemSettings::GetColour( wxSYS_COLOUR_3DFACE ) );

        dlg->Destroy();
        return false;
    }
};

IMPLEMENT_APP_CONSOLE( App )
