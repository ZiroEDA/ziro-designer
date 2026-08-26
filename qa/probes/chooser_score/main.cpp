// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
//
// Oracle for the Choose Symbol result ORDER.
//
// It compiles KiCad 10.0.5's own common/eda_pattern_match.cpp (the pinned
// reference tree, unmodified) and drives it with the search terms built exactly
// the way LIB_SYMBOL::cacheSearchTerms + LIB_SYMBOL::cacheChooserFields +
// LIB_TREE_NODE::RebuildSearchTerms build them, over a real .kicad_sym.  The
// scores and the resulting order are therefore KiCad's, not a re-derivation.
//
// Build:
//   g++ -std=c++17 -O1 -o chooser_score main.cpp \
//       /home/akshay/kicad-reference/common/eda_pattern_match.cpp \
//       -I. -I/home/akshay/kicad-reference/include $(wx-config --cxxflags --libs)
//
// Run:
//   ./chooser_score /usr/share/kicad/symbols/Connector.kicad_sym ter
//   ./chooser_score /usr/share/kicad/symbols/Device.kicad_sym res --cols=Item,Description
//
// --cols= is LIB_TREE_MODEL_ADAPTER::m_shownColumns.  Its default here is
// { Item, Description, Value }, which is loadColumnConfig's fallback for the
// symbol chooser (eeschema/symbol_tree_model_adapter.cpp:74); passing a shorter
// list is how the effect of a shown column on the RANKING is measured.

#include <eda_pattern_match.h>
#include <wx/wx.h>
#include <wx/filename.h>
#include <wx/regex.h>
#include <wx/textfile.h>
#include <wx/tokenzr.h>
#include <algorithm>
#include <cstdio>
#include <map>
#include <vector>

// common/string_utils.cpp:825, verbatim.
#include "strnumcmp.inc"

struct SYM
{
    wxString                     name;
    std::map<wxString, wxString> props;

    wxString Prop( const wxString& aKey ) const
    {
        auto it = props.find( aKey );
        return it == props.end() ? wxString() : it->second;
    }
};

/// Minimal .kicad_sym scan: top-level `(symbol "NAME"` blocks and their
/// one-line `(property "Key" "Value"` children.
static std::vector<SYM> LoadLib( const wxString& aPath )
{
    wxTextFile f;

    if( !f.Open( aPath ) )
    {
        fprintf( stderr, "cannot open %s\n", (const char*) aPath.utf8_str() );
        exit( 2 );
    }

    std::vector<SYM> out;
    wxRegEx          symRe( "^\t\\(symbol \"([^\"]*)\"", wxRE_ADVANCED );
    wxRegEx          propRe( "^\t\t\\(property \"([^\"]*)\" \"(.*)\"$", wxRE_ADVANCED );
    SYM              cur;
    bool             have = false;

    for( size_t i = 0; i < f.GetLineCount(); ++i )
    {
        const wxString& line = f[i];

        if( symRe.Matches( line ) )
        {
            if( have )
                out.push_back( cur );

            cur = SYM();
            cur.name = symRe.GetMatch( line, 1 );
            have = true;
        }
        else if( have && propRe.Matches( line ) )
        {
            wxString val = propRe.GetMatch( line, 2 );
            val.Replace( "\\\"", "\"" );
            val.Replace( "\\n", "\n" );
            cur.props[propRe.GetMatch( line, 1 )] = val;
        }
    }

    if( have )
        out.push_back( cur );

    f.Close();
    return out;
}

/// The four property names SCH_IO_KICAD_SEXPR_PARSER consumes into LIB_SYMBOL
/// members instead of creating a SCH_FIELD for
/// (eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.cpp:1170-1200).  They
/// are therefore NOT chooser fields.
static bool IsParsedIntoMember( const wxString& aKey )
{
    return aKey == "ki_keywords" || aKey == "ki_description" || aKey == "ki_fp_filters"
           || aKey == "ki_locked";
}

/// LIB_SYMBOL::cacheChooserFields, eeschema/lib_symbol.cpp:191-209.  Every
/// SCH_FIELD is a chooser field: SCH_FIELD::m_showInChooser defaults true
/// (eeschema/sch_field.cpp:130) and nothing in 10.0.5 ever clears it -
/// `show_in_chooser` is not a token this format has.
static std::map<wxString, wxString> ChooserFields( const SYM& s )
{
    std::map<wxString, wxString> fields;

    for( const auto& [key, value] : s.props )
    {
        if( !IsParsedIntoMember( key ) )
            fields[key] = value;
    }

    if( !fields.count( "Keywords" ) )
        fields["Keywords"] = s.Prop( "ki_keywords" );

    return fields;
}

/// LIB_SYMBOL::cacheSearchTerms (eeschema/lib_symbol.cpp:159-183) followed by
/// LIB_TREE_NODE::RebuildSearchTerms (common/lib_tree_model.cpp:34-43).
static std::vector<SEARCH_TERM> BuildTerms( const wxString& aNick, const SYM& s,
                                            const std::vector<wxString>& aShownColumns )
{
    const wxString keywords = s.Prop( "ki_keywords" );
    const wxString desc = s.Prop( "Description" );
    const wxString footprint = s.Prop( "Footprint" );

    std::vector<SEARCH_TERM> terms;
    terms.emplace_back( SEARCH_TERM( aNick, 4 ) );
    terms.emplace_back( SEARCH_TERM( s.name, 8, true ) );
    terms.emplace_back( SEARCH_TERM( aNick + ":" + s.name, 16, true ) );

    wxStringTokenizer kw( keywords, " \t\r\n", wxTOKEN_STRTOK );

    while( kw.HasMoreTokens() )
        terms.emplace_back( SEARCH_TERM( kw.GetNextToken(), 4 ) );

    terms.emplace_back( SEARCH_TERM( keywords, 1 ) );
    terms.emplace_back( SEARCH_TERM( desc, 1 ) );

    if( !footprint.IsEmpty() )
        terms.emplace_back( SEARCH_TERM( footprint, 1 ) );

    for( const auto& [name, value] : ChooserFields( s ) )
    {
        if( std::find( aShownColumns.begin(), aShownColumns.end(), name ) != aShownColumns.end() )
            terms.emplace_back( SEARCH_TERM( value, 4 ) );
    }

    return terms;
}

int main( int argc, char** argv )
{
    wxInitializer init;

    if( argc < 3 )
    {
        printf( "usage: chooser_score <lib.kicad_sym> <query> [--cols=A,B,C] [--terms]\n" );
        return 1;
    }

    wxString              path( argv[1] );
    wxString              query( argv[2] );
    bool                  showTerms = false;
    std::vector<wxString> shownColumns = { "Item", "Description", "Value" };

    for( int i = 3; i < argc; ++i )
    {
        wxString arg( argv[i] );

        if( arg == "--terms" )
        {
            showTerms = true;
        }
        else if( arg.StartsWith( "--cols=" ) )
        {
            shownColumns.clear();
            wxStringTokenizer cols( arg.Mid( 7 ), ",", wxTOKEN_STRTOK );

            while( cols.HasMoreTokens() )
                shownColumns.push_back( cols.GetNextToken() );
        }
    }

    const wxString   nick = wxFileName( path ).GetName();
    std::vector<SYM> syms = LoadLib( path );

    // LIB_TREE_MODEL_ADAPTER::UpdateSearchString, common/lib_tree_model_adapter.cpp:343-349.
    std::vector<std::unique_ptr<EDA_COMBINED_MATCHER>> matchers;
    wxStringTokenizer                                  tok( query, " \t\r\n", wxTOKEN_STRTOK );

    while( tok.HasMoreTokens() )
    {
        matchers.emplace_back(
                std::make_unique<EDA_COMBINED_MATCHER>( tok.GetNextToken().Lower(), CTX_LIBITEM ) );
    }

    // LIB_TREE_NODE::AssignIntrinsicRanks with presorted == false: sort the names
    // with StrNumCmp( a, b, true ) > 0 and hand out ranks 0..n in that order.
    std::vector<wxString> names;

    for( const SYM& s : syms )
        names.push_back( s.name );

    std::sort( names.begin(), names.end(),
               []( const wxString& a, const wxString& b ) { return StrNumCmp( a, b, true ) > 0; } );

    std::map<wxString, int> rank;

    for( size_t i = 0; i < names.size(); ++i )
        rank[names[i]] = (int) i;

    struct ROW
    {
        wxString name;
        int      score;
        bool     exact;
        int      rank;
    };

    std::vector<ROW> rows;

    for( const SYM& s : syms )
    {
        std::vector<SEARCH_TERM> terms = BuildTerms( nick, s, shownColumns );

        // LIB_TREE_NODE_ITEM::UpdateScore, common/lib_tree_model.cpp:248-274.
        int  score = 1;
        bool exact = false;

        for( const std::unique_ptr<EDA_COMBINED_MATCHER>& m : matchers )
        {
            bool ex = false;
            int  sc = m->ScoreTerms( terms, &ex );

            if( sc == 0 )
            {
                score = 0;
                exact = false;
                break;
            }

            score += sc;
            exact |= ex;
        }

        // LIB_TREE_MODEL_ADAPTER::GetChildren shows only m_Score > 0.
        if( score <= 0 )
            continue;

        rows.push_back( { s.name, score, exact, rank[s.name] } );

        if( showTerms )
        {
            printf( "TERMS %s:", (const char*) s.name.utf8_str() );

            for( const SEARCH_TERM& t : terms )
                printf( " [%s|%d]", (const char*) t.Text.utf8_str(), t.Score );

            printf( "\n" );
        }
    }

    // LIB_TREE_NODE::Compare's scoring tail: exact tier, score DESC, rank DESC.
    std::stable_sort( rows.begin(), rows.end(),
                      []( const ROW& a, const ROW& b )
                      {
                          if( a.exact != b.exact )
                              return a.exact;

                          if( a.score != b.score )
                              return a.score > b.score;

                          return a.rank > b.rank;
                      } );

    for( const ROW& r : rows )
        printf( "%5d %s %s\n", r.score, r.exact ? "E" : ".", (const char*) r.name.utf8_str() );

    return 0;
}
