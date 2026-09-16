// The visit order of KiCad's R-tree (thirdparty/rtree/geometry/rtree.h) on a
// fixed set of rectangles, for the double instantiation every spatial index
// uses and the intptr_t one of SHAPE_POLY_SET::splitCollinearOutlines. The
// port has to visit the same ids in the same order: that order decides which
// connectivity candidate is seen first and which collinear waist is split.
//
//   g++ -std=c++17 -I/home/akshay/kicad-reference/thirdparty/rtree/geometry \
//       rtree_order_oracle.cpp -o rtree_order_oracle
//   ./rtree_order_oracle 12345 300 1000000 > ../../fixtures/rtree_order_oracle_nm.json   (a board in nm)
//   ./rtree_order_oracle 1 1000 1 > ../../fixtures/rtree_order_oracle_unit.json      (unit coordinates: the two instantiations disagree)
#include <cstdint>
#include <cstdio>
#include <vector>
#include <algorithm>
#include <cstdlib>
#include "rtree.h"

static uint32_t g_s = 12345;
static int g_n = 300;
static int64_t g_scale = 1000000; // 1 for a unit-sized board, where the truncation bites
static uint32_t next()
{
    g_s = g_s * 1103515245u + 12345u;
    return g_s;
}

struct R { int64_t x0, y0, x1, y1; };

template <class TREE, class E>
static void run( const std::vector<R>& rects, const std::vector<R>& queries, bool first )
{
    TREE tree;
    for( size_t i = 0; i < rects.size(); ++i )
    {
        E mn[2] = { (E) rects[i].x0, (E) rects[i].y0 };
        E mx[2] = { (E) rects[i].x1, (E) rects[i].y1 };
        tree.Insert( mn, mx, (intptr_t) i );
    }
    for( size_t q = 0; q < queries.size(); ++q )
    {
        E mn[2] = { (E) queries[q].x0, (E) queries[q].y0 };
        E mx[2] = { (E) queries[q].x1, (E) queries[q].y1 };
        std::vector<intptr_t> order;
        tree.Search( mn, mx, [&]( const intptr_t& id ) { order.push_back( id ); return true; } );
        printf( "%s[", ( first && q == 0 ) ? "" : "," );
        for( size_t k = 0; k < order.size(); ++k ) printf( "%s%ld", k ? "," : "", (long) order[k] );
        printf( "]" );
    }
}

int main( int argc, char** argv )
{
    // 300 rectangles: 150 small (segment-sized, ~mm) and 150 large (up to
    // 50 mm) on a 300 mm x 300 mm board in nanometres, so that the int64
    // volumes pass 2^53 and the halfExtent truncation bites.
    if( argc > 1 ) g_s = (uint32_t) atoi( argv[1] );
    if( argc > 2 ) g_n = atoi( argv[2] );
    if( argc > 3 ) g_scale = atoll( argv[3] );
    std::vector<R> rects;
    for( int i = 0; i < g_n; ++i )
    {
        int64_t x = next() % ( 300 * g_scale ), y = next() % ( 300 * g_scale );
        int64_t w = ( i < g_n / 2 ) ? next() % ( 2 * g_scale ) : next() % ( 50 * g_scale );
        int64_t h = ( i < g_n / 2 ) ? next() % ( 2 * g_scale ) : next() % ( 50 * g_scale );
        rects.push_back( { x, y, x + w, y + h } );
    }
    std::vector<R> queries;
    for( int i = 0; i < 8; ++i )
    {
        int64_t x = next() % ( 300 * g_scale ), y = next() % ( 300 * g_scale );
        int64_t w = next() % ( 80 * g_scale ), h = next() % ( 80 * g_scale );
        queries.push_back( { x, y, x + w, y + h } );
    }
    printf( "{\"rects\":[" );
    for( size_t i = 0; i < rects.size(); ++i )
        printf( "%s[%ld,%ld,%ld,%ld]", i ? "," : "", (long) rects[i].x0, (long) rects[i].y0, (long) rects[i].x1, (long) rects[i].y1 );
    printf( "],\"queries\":[" );
    for( size_t i = 0; i < queries.size(); ++i )
        printf( "%s[%ld,%ld,%ld,%ld]", i ? "," : "", (long) queries[i].x0, (long) queries[i].y0, (long) queries[i].x1, (long) queries[i].y1 );
    printf( "],\"double\":[" );
    run<RTree<intptr_t, int, 2, double>, int>( rects, queries, true );
    printf( "],\"intptr\":[" );
    run<RTree<intptr_t, intptr_t, 2, intptr_t>, intptr_t>( rects, queries, true );
    printf( "]}\n" );
    return 0;
}
