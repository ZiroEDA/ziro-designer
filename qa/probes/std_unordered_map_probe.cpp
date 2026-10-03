// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// What libstdc++ answers for the three things an emulation of std::unordered_map<std::string, T>
// iteration order needs (common/libc/unordered_map.ts):
//
//   hash <string>          std::hash<std::string>()( s ), i.e. _Hash_bytes( s, len, 0xc70f6907 )
//   nextbkt <n>            _Prime_rehash_policy( 1.0 )._M_next_bkt( n ), and the resize threshold it sets
//   order <k1> <k2> ...    the iteration order after inserting k1, k2, ... in that order,
//                          and the bucket count at the end
//   erase <k...> -- <e...> [-- <i...>]  insert the first list, erase the second, insert the
//                          third, print the order
//   clear <k...> -- <e...> insert the first list, clear(), insert the second, print the order
//   whash <string>         std::hash<std::wstring>() of the string (UTF-8 widened), wxString's hash
//   netorder <name@code>.. NET_MAP order for those keys ("--" clears)
//   primes <limit>         every bucket count _M_next_bkt gives above its fast table, to limit
//   growth <k...>          the bucket count after each insertion
//
// Build: g++ -O1 -std=c++17 -o std_unordered_map_probe std_unordered_map_probe.cpp

#include <cstdio>
#include <cstring>
#include <string>
#include <unordered_map>
#include <vector>
#include <cwchar>
#include <clocale>

// CONNECTION_GRAPH's NET_MAP key and hash, as connection_graph.h writes them, with wxString's
// std::hash (wx/string.h: std::hash<std::wstring> of ToStdWstring()).
struct NET_NAME_CODE_CACHE_KEY
{
    std::wstring Name;
    int          Netcode;

    bool operator==( const NET_NAME_CODE_CACHE_KEY& other ) const
    {
        return Name == other.Name && Netcode == other.Netcode;
    }
};

struct NET_KEY_HASH
{
    std::size_t operator()( const NET_NAME_CODE_CACHE_KEY& k ) const
    {
        const std::size_t prime = 19937;

        return std::hash<std::wstring>()( k.Name ) ^ ( std::hash<int>()( k.Netcode ) * prime );
    }
};

static std::wstring widen( const char* aUtf8 )
{
    std::mbstate_t state{};
    std::wstring   out( std::strlen( aUtf8 ), L'\0' );
    const char*    src = aUtf8;
    size_t         n = std::mbsrtowcs( &out[0], &src, out.size(), &state );
    out.resize( n );
    return out;
}

int main( int argc, char** argv )
{
    if( argc < 2 )
        return 2;

    std::setlocale( LC_ALL, "C.UTF-8" );

    std::string cmd = argv[1];

    if( cmd == "hash" )
    {
        for( int i = 2; i < argc; ++i )
            std::printf( "%zu\n", std::hash<std::string>()( argv[i] ) );
    }
    else if( cmd == "nextbkt" )
    {
        for( int i = 2; i < argc; ++i )
        {
            std::__detail::_Prime_rehash_policy policy( 1.0f );
            size_t n = std::strtoull( argv[i], nullptr, 10 );
            size_t bkt = policy._M_next_bkt( n );
            std::printf( "%zu %zu %zu\n", n, bkt, policy._M_state() );
        }
    }
    else if( cmd == "whash" )
    {
        for( int i = 2; i < argc; ++i )
            std::printf( "%zu\n", std::hash<std::wstring>()( widen( argv[i] ) ) );
    }
    else if( cmd == "netorder" )
    {
        // Keys as name@code, inserted in order; "--" clears the map (keeping its buckets).
        std::unordered_map<NET_NAME_CODE_CACHE_KEY, int, NET_KEY_HASH> map;

        for( int i = 2; i < argc; ++i )
        {
            if( std::strcmp( argv[i], "--" ) == 0 )
            {
                map.clear();
                continue;
            }

            std::string arg = argv[i];
            size_t      at = arg.rfind( '@' );
            NET_NAME_CODE_CACHE_KEY key{ widen( arg.substr( 0, at ).c_str() ),
                                         std::atoi( arg.substr( at + 1 ).c_str() ) };
            map[key] = i;
        }

        for( const auto& [key, value] : map )
            std::printf( "%ls@%d\n", key.Name.c_str(), key.Netcode );

        std::printf( "# buckets %zu\n", map.bucket_count() );
    }
    else if( cmd == "primes" )
    {
        // Every bucket count _M_next_bkt can return above the fast table, up to argv[2].
        size_t limit = std::strtoull( argv[2], nullptr, 10 );
        std::__detail::_Prime_rehash_policy policy( 1.0f );

        for( size_t n = 14;; )
        {
            size_t bkt = policy._M_next_bkt( n );
            std::printf( "%zu\n", bkt );

            if( bkt >= limit || bkt < n )
                break;

            n = bkt + 1;
        }
    }
    else if( cmd == "growth" )
    {
        // The bucket count after each insertion of argv[3..] into an empty map.
        std::unordered_map<std::string, int> map;

        for( int i = 2; i < argc; ++i )
        {
            map.emplace( argv[i], i );
            std::printf( "%zu\n", map.bucket_count() );
        }
    }
    else if( cmd == "order" || cmd == "erase" || cmd == "clear" )
    {
        std::unordered_map<std::string, int> map;
        int i = 2;

        for( ; i < argc && std::strcmp( argv[i], "--" ) != 0; ++i )
            map.emplace( argv[i], i );

        if( cmd == "clear" )
        {
            map.clear();

            for( ++i; i < argc; ++i )
                map.emplace( argv[i], i );
        }
        else
        {
            // erase: the second list; then any keys after a second "--" are inserted.
            for( ++i; i < argc && std::strcmp( argv[i], "--" ) != 0; ++i )
                map.erase( argv[i] );

            for( ++i; i < argc; ++i )
                map.emplace( argv[i], i );
        }

        for( const auto& [key, value] : map )
            std::printf( "%s\n", key.c_str() );

        std::printf( "# buckets %zu\n", map.bucket_count() );
    }

    return 0;
}
