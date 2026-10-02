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
//   erase <k...> -- <e...> insert the first list, erase the second, print the order
//   clear <k...> -- <e...> insert the first list, clear(), insert the second, print the order
//   primes <limit>         every bucket count _M_next_bkt gives above its fast table, to limit
//   growth <k...>          the bucket count after each insertion
//
// Build: g++ -O1 -std=c++17 -o std_unordered_map_probe std_unordered_map_probe.cpp

#include <cstdio>
#include <cstring>
#include <string>
#include <unordered_map>
#include <vector>

int main( int argc, char** argv )
{
    if( argc < 2 )
        return 2;

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
            for( ++i; i < argc; ++i )
                map.erase( argv[i] );
        }

        for( const auto& [key, value] : map )
            std::printf( "%s\n", key.c_str() );

        std::printf( "# buckets %zu\n", map.bucket_count() );
    }

    return 0;
}
