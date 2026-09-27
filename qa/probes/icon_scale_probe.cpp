// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// KiIconScale's input on this machine: a frame's ConvertDialogToPixels(
// wxSize( 0, 8 ) ).y, beside the character height it comes from.
//
// Build: g++ icon_scale_probe.cpp $(wx-config --cxxflags --libs core,base) -o icon_scale_probe
// Run:   env -i HOME=$HOME DISPLAY=$DISPLAY XAUTHORITY=$XAUTHORITY GDK_BACKEND=x11 ./icon_scale_probe
#include <wx/wx.h>

class APP : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame( nullptr, wxID_ANY, "probe" );
        printf( "vert_size %d char_height %d\n", f->ConvertDialogToPixels( wxSize( 0, 8 ) ).y,
                f->GetCharHeight() );
        f->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP( APP );
