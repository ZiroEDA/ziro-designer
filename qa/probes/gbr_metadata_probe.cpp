// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// KiCad's own common/gbr_metadata.cpp, linked in and asked: the oracle for
// common/gbr_metadata.ts. time() is defined here, so wxDateTime::GetTimeNow()
// reads a fixed instant (the executable's symbol interposes libc's).
//
// Build:
//   K=/home/akshay/kicad-reference
//   g++ gbr_metadata_probe.cpp $K/common/gbr_metadata.cpp -I$K/include \
//       -I$K/libs/core/include $(wx-config --cxxflags --libs base) -o gbr_metadata_probe
// Run:   TZ=Asia/Kolkata ./gbr_metadata_probe   (and TZ=UTC, TZ=America/St_Johns)
#include <wx/string.h>
#include <gbr_metadata.h>
#include <cstdio>
#include <ctime>
#include <wx/init.h>

// 2026-09-27T06:05:04Z
extern "C" time_t time( time_t* t )
{
    time_t v = 1790575504;

    if( t )
        *t = v;

    return v;
}

static void show( const char* aTag, const std::string& aText )
{
    printf( "%s|", aTag );

    for( char c : aText )
    {
        if( c == '\n' )
            printf( "\\n" );
        else
            putchar( c );
    }

    printf( "|\n" );
}

static void show( const char* aTag, const wxString& aText )
{
    show( aTag, std::string( aText.utf8_str() ) );
}

int main( int argc, char** argv )
{
    wxInitializer init( argc, argv );

    show( "date.x1", GbrMakeCreationDateAttributeString( GBR_NC_STRING_FORMAT_X1 ) );
    show( "date.x2", GbrMakeCreationDateAttributeString( GBR_NC_STRING_FORMAT_X2 ) );
    show( "date.job", GbrMakeCreationDateAttributeString( GBR_NC_STRING_FORMAT_GBRJOB ) );
    show( "date.drill", GbrMakeCreationDateAttributeString( GBR_NC_STRING_FORMAT_NCDRILL ) );

    for( const wchar_t* name : { L"pic_programmer.kicad_pcb", L"a.kicad_pcb", L"",
                                 L"ÿé.kicad_pcb", L"0123456789abcdefghij" } )
        show( "guid", GbrMakeProjectGUIDfromString( wxString( name ) ) );

    for( int a = GBR_APERTURE_METADATA::GBR_APERTURE_ATTRIB_NONE;
         a <= GBR_APERTURE_METADATA::GBR_APERTURE_ATTRIB_END; ++a )
    {
        auto attr = (GBR_APERTURE_METADATA::GBR_APERTURE_ATTRIB) a;
        show( "ap.x2", GBR_APERTURE_METADATA::FormatAttribute( attr, false, "Custom,1" ) );
        show( "ap.x1", GBR_APERTURE_METADATA::FormatAttribute( attr, true, "Custom,1" ) );
    }

    for( const wchar_t* s : { L"R1", L"a,b*c%d\\e", L"q\"x", L"µΩ€", L"\"quoted,*\"", L"",
                              L"\U0001F600" } )
    {
        show( "conv.ff", ConvertNotAllowedCharsInGerber( wxString( s ), false, false ) );
        show( "conv.tf", ConvertNotAllowedCharsInGerber( wxString( s ), true, false ) );
        show( "conv.ft", ConvertNotAllowedCharsInGerber( wxString( s ), false, true ) );
        show( "conv.tt", ConvertNotAllowedCharsInGerber( wxString( s ), true, true ) );
        show( "to", FormatStringToGerber( wxString( s ) ) );
    }

    GBR_DATA_FIELD field;
    field.SetField( wxString( L"Ωa,\"b" ), true, true );
    show( "field.tt", field.GetGerberString() );
    field.SetField( wxString( L"Ωa,\"b" ), false, false );
    show( "field.ff", field.GetGerberString() );

    // A sequence of objects, the way GERBER_PLOTTER feeds FormatNetAttribute.
    std::string last;

    auto net = [&]( const char* aTag, int aType, const wchar_t* aCmp, const wchar_t* aPad,
                    const wchar_t* aFunc, const wchar_t* aNet, bool aNotInNet, bool aKeep,
                    bool aX1 )
    {
        GBR_NETLIST_METADATA d;
        d.m_NetAttribType = aType;
        d.m_Cmpref = aCmp;
        d.m_Padname.SetField( aPad, false, false );
        d.m_PadPinFunction.SetField( aFunc, true, true );
        d.m_Netname = aNet;
        d.m_NotInNet = aNotInNet;
        d.m_TryKeepPreviousAttributes = aKeep;
        std::string printed = "<untouched>";
        bool clear = true;
        bool ok = FormatNetAttribute( printed, last, &d, clear, aX1 );
        printf( "%s ok=%d clear=%d ", aTag, ok, clear );
        show( "printed", printed );
        show( "last", last );
    };

    using N = GBR_NETLIST_METADATA;
    net( "n1", N::GBR_NETINFO_PAD | N::GBR_NETINFO_NET, L"R5", L"3", L"reset", L"Clk3", false, false, false );
    net( "n2", N::GBR_NETINFO_PAD | N::GBR_NETINFO_NET, L"R5", L"3", L"reset", L"Clk3", false, false, false );
    net( "n3", N::GBR_NETINFO_PAD | N::GBR_NETINFO_NET, L"R5", L"4", L"", L"Clk3", false, false, false );
    net( "n4", N::GBR_NETINFO_NET, L"", L"", L"", L"GND", false, false, false );
    net( "n5", N::GBR_NETINFO_NET | N::GBR_NETINFO_CMP, L"U1", L"", L"", L"", false, false, false );
    net( "n6", N::GBR_NETINFO_NET | N::GBR_NETINFO_CMP, L"U1", L"", L"", L"", true, false, false );
    net( "n7", N::GBR_NETINFO_NET, L"", L"", L"", L"V,*%", false, true, false );
    net( "n8", N::GBR_NETINFO_PAD | N::GBR_NETINFO_NET, L"J1", L"", L"", L"A", false, true, false );
    net( "n9", N::GBR_NETINFO_CMP, L"J1", L"", L"", L"", false, true, false );
    net( "n10", N::GBR_NETINFO_NET, L"", L"", L"", L"B", false, true, false );
    net( "n11", N::GBR_NETINFO_PAD, L"J2", L"1", L"", L"", false, true, true );
    net( "n12", N::GBR_NETINFO_UNSPECIFIED, L"", L"", L"", L"", false, false, false );

    GBR_CMP_PNP_METADATA pnp;
    show( "pnp.empty", pnp.FormatCmpPnPMetadata() );
    pnp.m_Manufacturer = "TI";
    pnp.m_MPN = "LM358";
    pnp.m_Package = "SOIC-8";
    pnp.m_Footprint = "SOIC-8_3.9x4.9mm";
    pnp.m_Value = "LM358";
    pnp.m_LibraryName = "Package_SO";
    pnp.m_LibraryDescr = "SOIC, 8 Pin";
    pnp.m_MountType = GBR_CMP_PNP_METADATA::MOUNT_TYPE_SMD;
    pnp.m_Orientation = 90.0;
    show( "pnp.full", pnp.FormatCmpPnPMetadata() );
    pnp.m_Orientation = -45.123456789;
    pnp.m_MountType = GBR_CMP_PNP_METADATA::MOUNT_TYPE_TH;
    pnp.ClearData();
    show( "pnp.cleared", pnp.FormatCmpPnPMetadata() );
    pnp.m_Orientation = 0.0000123;
    show( "pnp.small", pnp.FormatCmpPnPMetadata() );
    pnp.m_Orientation = 179.99999999;
    show( "pnp.round", pnp.FormatCmpPnPMetadata() );
}
