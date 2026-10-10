/* glu_tess_probe: the installed libGLU (Mesa's SGI libtess, what KiCad's VRML_LAYER and
 * OPENGL_GAL call) tessellates the polygons on stdin and prints every callback, so
 * common/kicad_gl/kiglu.ts can be compared against it event for event.
 *
 * stdin:  P <ODD|POS|NEG|NZ> <0|1 boundary-only>   begin polygon
 *         C                                         begin contour
 *         V <x> <y>                                 vertex (numbered from 0 per polygon)
 *         E                                         end polygon
 * stdout: B <GL type> / V <n> | V X<k> <x> <y> (a combined vertex, %.17g) / N (end) / R <err>
 *
 * cc glu_tess_probe.c -o glu_tess_probe -lGLU -lGL
 */
#include <GL/glu.h>
#ifndef CALLBACK
#define CALLBACK
#endif
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { double c[3]; int id; } VTX;
static VTX pool[200000];
static int npool, nextra;

static void CALLBACK cb_begin( GLenum t, void* u ) { printf( "B %d\n", (int) t ); }
static void CALLBACK cb_vertex( void* v, void* u )
{
    VTX* p = v;
    if( p->id >= 0 ) printf( "V %d\n", p->id );
    else printf( "V X%d %.17g %.17g\n", -p->id - 1, p->c[0], p->c[1] );
}
static void CALLBACK cb_end( void* u ) { printf( "N\n" ); }
static void CALLBACK cb_err( GLenum e, void* u ) { printf( "R %d\n", (int) e ); }
static void CALLBACK cb_combine( GLdouble c[3], void* d[4], GLfloat w[4], void** out, void* u )
{
    VTX* p = &pool[npool++];
    p->c[0] = c[0]; p->c[1] = c[1]; p->c[2] = c[2];
    p->id = -( ++nextra );
    *out = p;
}

int main( void )
{
    GLUtesselator* t = gluNewTess();
    gluTessCallback( t, GLU_TESS_BEGIN_DATA, (void (CALLBACK*)()) cb_begin );
    gluTessCallback( t, GLU_TESS_VERTEX_DATA, (void (CALLBACK*)()) cb_vertex );
    gluTessCallback( t, GLU_TESS_END_DATA, (void (CALLBACK*)()) cb_end );
    gluTessCallback( t, GLU_TESS_ERROR_DATA, (void (CALLBACK*)()) cb_err );
    gluTessCallback( t, GLU_TESS_COMBINE_DATA, (void (CALLBACK*)()) cb_combine );
    gluTessNormal( t, 0, 0, 1 );

    char line[256], w[8];
    int b, inContour = 0, nv = 0;
    double x, y;

    while( fgets( line, sizeof line, stdin ) )
    {
        if( line[0] == 'P' )
        {
            sscanf( line, "P %7s %d", w, &b );
            GLenum rule = !strcmp( w, "ODD" ) ? GLU_TESS_WINDING_ODD
                        : !strcmp( w, "POS" ) ? GLU_TESS_WINDING_POSITIVE
                        : !strcmp( w, "NEG" ) ? GLU_TESS_WINDING_NEGATIVE
                                              : GLU_TESS_WINDING_NONZERO;
            gluTessProperty( t, GLU_TESS_WINDING_RULE, rule );
            gluTessProperty( t, GLU_TESS_BOUNDARY_ONLY, b ? GL_TRUE : GL_FALSE );
            npool = 0; nextra = 0; nv = 0;
            printf( "P\n" );
            gluTessBeginPolygon( t, NULL );
        }
        else if( line[0] == 'C' )
        {
            if( inContour ) gluTessEndContour( t );
            gluTessBeginContour( t );
            inContour = 1;
        }
        else if( line[0] == 'V' )
        {
            sscanf( line, "V %lf %lf", &x, &y );
            VTX* p = &pool[npool++];
            p->c[0] = x; p->c[1] = y; p->c[2] = 0; p->id = nv++;
            gluTessVertex( t, p->c, p );
        }
        else if( line[0] == 'E' )
        {
            if( inContour ) gluTessEndContour( t );
            inContour = 0;
            gluTessEndPolygon( t );
        }
    }

    gluDeleteTess( t );
    return 0;
}
