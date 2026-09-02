// SPDX-License-Identifier: GPL-3.0-or-later
// NETINFO_LIST::RebuildDisplayNetnames (netinfo_list.cpp:190), transcribed
// verbatim and run against real wxSplit, as an oracle for the TS port.
//
// UnescapeString is stubbed to identity: the escaping is covered elsewhere and
// pulling in kicommon just for it would make this a link job. Every case below
// is chosen to have nothing to unescape.
#include <wx/string.h>
#include <wx/arrstr.h>
#include <map>
#include <vector>
#include <optional>
#include <cstdio>

static wxString UnescapeString( const wxString& s ) { return s; }

static std::vector<wxString> rebuild( const std::vector<wxString>& netnames )
{
    std::map<wxString, std::vector<wxString>> shortNameMap;
    std::vector<wxString> shorts, out;

    for( const wxString& n : netnames )
    {
        wxString shortName = n.AfterLast( '/' );
        shorts.push_back( shortName );
        shortNameMap[shortName].push_back( n );
    }

    for( size_t idx = 0; idx < netnames.size(); ++idx )
    {
        const wxString& netname = netnames[idx];

        if( shortNameMap[shorts[idx]].size() == 1 )
        {
            out.push_back( UnescapeString( shorts[idx] ) );
            continue;
        }

        wxArrayString              parts = wxSplit( netname, '/' );
        std::vector<wxArrayString> aggregateParts;
        std::optional<size_t>      firstNonCommon;

        for( const wxString& longName : shortNameMap[shorts[idx]] )
            aggregateParts.push_back( wxSplit( longName, '/' ) );

        for( size_t ii = 0; ii < parts.size() && !firstNonCommon; ++ii )
        {
            for( const wxArrayString& otherParts : aggregateParts )
            {
                if( ii < otherParts.size() && otherParts[ii] == parts[ii] )
                    continue;

                firstNonCommon = ii;
                break;
            }
        }

        if( firstNonCommon.value_or( 0 ) > 0 && firstNonCommon.value() < parts.size() )
        {
            wxString disambiguatedName;

            for( size_t ii = firstNonCommon.value(); ii < parts.size(); ++ii )
            {
                if( !disambiguatedName.IsEmpty() )
                    disambiguatedName += wxS( "/" );

                disambiguatedName += parts[ii];
            }

            out.push_back( UnescapeString( disambiguatedName ) );
        }
        else
        {
            out.push_back( UnescapeString( netname ) );
        }
    }

    return out;
}

static void show( const char* label, std::vector<wxString> nets )
{
    std::vector<wxString> got = rebuild( nets );
    printf( "%-34s", label );
    for( size_t i = 0; i < nets.size(); ++i )
        printf( " %s->\"%s\"", nets[i].ToStdString().c_str(), got[i].ToStdString().c_str() );
    printf( "\n" );
}

int main()
{
    show( "unique shorts",        { "/uart/RXD", "/spi/MOSI" } );
    show( "shared, differ at 1",  { "/Sheet1/SDA", "/Sheet2/SDA" } );
    show( "shared, differ at 3",  { "/a/b/c/SDA", "/a/b/d/SDA" } );
    show( "differ at 0",          { "a/SDA", "b/SDA" } );
    show( "prefix of the other",  { "/SDA", "/x/SDA" } );
    show( "identical names",      { "/uart/SDA", "/uart/SDA" } );
    show( "third unrelated",      { "/Sheet1/SDA", "/Sheet2/SDA", "/Sheet1/SCL" } );
    show( "no leading slash",     { "Sheet1/SDA", "Sheet2/SDA" } );
    show( "bare short names",     { "SDA", "SDA" } );
    return 0;
}
