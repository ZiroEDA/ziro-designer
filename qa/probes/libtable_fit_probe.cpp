// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// How big DIALOG_EDIT_LIBRARY_TABLES comes out when a table has many rows.
//
// LIB_TABLE_NOTEBOOK_PANEL::AddTable (common/lib_table_notebook_panel.cpp) makes each page's grid
// with CreateGrid( 1, 7 ), lays the page out and Fit()s it, and only then does the panel's
// AddTable SetTable() the real rows and autosize Nickname, Type, URI and Description.
// InstallPanel gives m_contentPanel a 1000 x 600 minimum and finishDialogSettings calls
// SetSizeHints. Whether the rows then reach the dialog's size is wx's to say, so this asks it,
// for a table of 1 row and one of 155 with the hosted URLs.
//
//   g++ -Wno-deprecated-declarations -o libtable_fit_probe libtable_fit_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,aui,adv)
// Run (redirect to a file; a pipe swallows the output):
//   env -i HOME=$HOME DISPLAY=$DISPLAY XAUTHORITY=$XAUTHORITY \
//       XDG_RUNTIME_DIR=/run/user/$(id -u) PATH=/usr/bin:/bin ./libtable_fit_probe > out.txt
#include <wx/wx.h>
#include <wx/aui/auibook.h>
#include <wx/display.h>
#include <wx/grid.h>
#include <cstdio>

static void measure( int aRows )
{
    wxDialog* dlg = new wxDialog( nullptr, wxID_ANY, "Footprint Libraries", wxDefaultPosition,
                                  wxDefaultSize, wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER );

    // PANEL_FP_LIB_TABLE_BASE, the parts that size it.
    wxPanel*    content = new wxPanel( dlg );
    wxBoxSizer* bMainSizer = new wxBoxSizer( wxVERTICAL );
    wxAuiNotebook* nb = new wxAuiNotebook( content, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                                           wxAUI_NB_CLOSE_ON_ALL_TABS | wxAUI_NB_DEFAULT_STYLE );
    bMainSizer->Add( nb, 1, wxEXPAND | wxTOP | wxRIGHT | wxLEFT, 5 );
    wxBoxSizer* buttons = new wxBoxSizer( wxHORIZONTAL );
    buttons->Add( new wxButton( content, wxID_ANY, "Add Existing" ), 0, wxTOP | wxBOTTOM | wxRIGHT, 5 );
    bMainSizer->Add( buttons, 0, wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT, 8 );
    bMainSizer->Add( new wxStaticText( content, wxID_ANY, "Available path substitutions:" ), 0,
                     wxTOP | wxRIGHT | wxLEFT, 8 );
    wxGrid* subs = new wxGrid( content, wxID_ANY );
    subs->CreateGrid( 1, 2 );
    subs->SetColLabelSize( 0 );
    subs->SetRowLabelSize( 0 );
    bMainSizer->Add( subs, 0, wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT, 5 );
    content->SetSizer( bMainSizer );

    // LIB_TABLE_NOTEBOOK_PANEL::AddTable.
    wxPanel*    page = new wxPanel( nb );
    wxBoxSizer* sizer = new wxBoxSizer( wxVERTICAL );
    wxGrid*     grid = new wxGrid( page, wxID_ANY );
    grid->CreateGrid( 1, 7 );
    grid->EnableGridLines( true );
    grid->SetMargins( 0, 0 );
    const int widths[] = { 30, 48, 48, 240, 100, 80, 240 };
    for( int c = 0; c < 7; ++c )
        grid->SetColSize( c, widths[c] );
    grid->SetColLabelSize( 22 );
    grid->SetRowLabelSize( 0 );
    sizer->Add( grid, 1, wxALL | wxEXPAND, 5 );
    page->SetSizer( sizer );
    page->Layout();
    sizer->Fit( page );
    nb->AddPage( page, "Global Libraries", false );

    // PANEL_FP_LIB_TABLE::AddTable: the rows, then autoSizeCol on Nickname, Type, URI, Descr.
    if( aRows > 1 )
        grid->AppendRows( aRows - 1 );
    for( int r = 0; r < aRows; ++r )
    {
        wxString nick = wxString::Format( "Connector_Phoenix_MC_HighVoltage_%d", r );
        grid->SetCellValue( r, 3, nick );
        grid->SetCellValue( r, 4, "https://pub-ac941e05e1284f409be2ed74ddb151b3.r2.dev/footprints/"
                                  + nick + ".pretty" );
        grid->SetCellValue( r, 5, "KiCad" );
    }
    for( int c : { 3, 4, 5, 6 } )
    {
        int prev = grid->GetColSize( c );
        grid->AutoSizeColumn( c, false );
        grid->SetColSize( c, std::max( prev, grid->GetColSize( c ) ) );
    }

    // DIALOG_EDIT_LIBRARY_TABLES::InstallPanel.
    wxBoxSizer* mainSizer = new wxBoxSizer( wxVERTICAL );
    dlg->SetSizer( mainSizer );
    mainSizer->Add( content, 1, wxEXPAND | wxLEFT | wxTOP | wxRIGHT, 5 );
    content->SetMinSize( dlg->FromDIP( wxSize( 1000, 600 ) ) );
    wxStdDialogButtonSizer* sdb = new wxStdDialogButtonSizer();
    sdb->AddButton( new wxButton( dlg, wxID_OK ) );
    sdb->AddButton( new wxButton( dlg, wxID_CANCEL ) );
    sdb->Realize();
    mainSizer->Add( sdb, 0, wxALL | wxEXPAND, 5 );
    mainSizer->SetSizeHints( dlg ); // finishDialogSettings
    dlg->Layout();

    wxSize gridBest = grid->GetBestSize();
    wxSize nbBest = nb->GetBestSize();
    printf( "rows=%d dialog=%dx%d content=%dx%d notebook=%dx%d nbBest=%dx%d grid=%dx%d gridBest=%dx%d "
            "contentMin=%dx%d\n",
            aRows, dlg->GetSize().x, dlg->GetSize().y, content->GetSize().x, content->GetSize().y,
            nb->GetSize().x, nb->GetSize().y, nbBest.x, nbBest.y, grid->GetSize().x,
            grid->GetSize().y, gridBest.x, gridBest.y, content->GetMinSize().x,
            content->GetMinSize().y );
    dlg->Destroy();
}

class APP : public wxApp
{
public:
    bool OnInit() override
    {
        wxRect area = wxDisplay( 0u ).GetClientArea();
        printf( "display client area %dx%d\n", area.width, area.height );
        measure( 1 );
        measure( 155 );
        fflush( stdout );
        return false;
    }
};

wxIMPLEMENT_APP( APP );
