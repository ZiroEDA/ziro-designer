// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// What wxGrid's selection API answers after each kind of select, in each
// selection mode - the calls GRID_TRICKS makes (getSelectedArea, the space
// toggle, showEditor, onUpdateUI). The oracle for common/wx/grid.ts.
//
// Build: g++ grid_selection_probe.cpp $(wx-config --cxxflags --libs core,base) -o grid_selection_probe
// Run:   env -i HOME=$HOME DISPLAY=$DISPLAY XAUTHORITY=$XAUTHORITY GDK_BACKEND=x11 ./grid_selection_probe
#include <wx/wx.h>
#include <wx/grid.h>
#include <functional>

static wxGrid* g;

static void dump( const char* aTag )
{
    printf( "%s|", aTag );
    printf( "rows=" );
    for( int r : g->GetSelectedRows() ) printf( "%d,", r );
    printf( " cols=" );
    for( int c : g->GetSelectedCols() ) printf( "%d,", c );
    printf( " cells=" );
    { wxGridCellCoordsArray a = g->GetSelectedCells(); for( size_t i = 0; i < a.Count(); ++i ) printf( "%d:%d,", a[i].GetRow(), a[i].GetCol() ); }
    printf( " tl=" );
    { wxGridCellCoordsArray a = g->GetSelectionBlockTopLeft(); for( size_t i = 0; i < a.Count(); ++i ) printf( "%d:%d,", a[i].GetRow(), a[i].GetCol() ); }
    printf( " br=" );
    { wxGridCellCoordsArray a = g->GetSelectionBlockBottomRight(); for( size_t i = 0; i < a.Count(); ++i ) printf( "%d:%d,", a[i].GetRow(), a[i].GetCol() ); }
    printf( " cursor=%d:%d", g->GetGridCursorRow(), g->GetGridCursorCol() );
    printf( " sel22=%d any=%d\n", g->IsInSelection( 2, 2 ), g->IsSelection() );
}

class APP : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame( nullptr, wxID_ANY, "probe" );
        g = new wxGrid( f, wxID_ANY );
        g->CreateGrid( 5, 4 );

        struct MODE { const char* name; wxGrid::wxGridSelectionModes mode; };

        for( MODE m : { MODE{ "cells", wxGrid::wxGridSelectCells },
                        MODE{ "rows", wxGrid::wxGridSelectRows },
                        MODE{ "cols", wxGrid::wxGridSelectColumns },
                        MODE{ "rowsorcols", wxGrid::wxGridSelectRowsOrColumns } } )
        {
            g->SetSelectionMode( m.mode );
            printf( "== %s mode=%d\n", m.name, (int) g->GetSelectionMode() );

            auto step = [&]( const char* aTag, std::function<void()> aDo )
            {
                g->ClearSelection();
                g->SetGridCursor( 0, 0 );
                aDo();
                dump( aTag );
            };

            step( "none", [] {} );
            step( "cursor13", [] { g->SetGridCursor( 1, 3 ); } );
            step( "row2", [] { g->SelectRow( 2 ); } );
            step( "row2+row4", [] { g->SelectRow( 2 ); g->SelectRow( 4, true ); } );
            step( "row2 then row4", [] { g->SelectRow( 2 ); g->SelectRow( 4 ); } );
            step( "col1", [] { g->SelectCol( 1 ); } );
            step( "col1+col3", [] { g->SelectCol( 1 ); g->SelectCol( 3, true ); } );
            step( "block1122", [] { g->SelectBlock( 1, 1, 2, 2 ); } );
            step( "block2211", [] { g->SelectBlock( 2, 2, 1, 1 ); } );
            step( "block+block", [] { g->SelectBlock( 0, 0, 0, 1 ); g->SelectBlock( 3, 2, 4, 3, true ); } );
            step( "blockfullrow", [] { g->SelectBlock( 1, 0, 1, 3 ); } );
            step( "blockfullcol", [] { g->SelectBlock( 0, 2, 4, 2 ); } );
            step( "all", [] { g->SelectAll(); } );
            step( "row2 deselect", [] { g->SelectRow( 2 ); g->DeselectRow( 2 ); } );
            step( "all deselectcell", [] { g->SelectAll(); g->DeselectCell( 2, 2 ); } );
        }

        f->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP( APP );
