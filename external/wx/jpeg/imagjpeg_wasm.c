/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 ZiroEDA and contributors.
 * Portions derived from wxWidgets 3.2.4 src/common/imagjpeg.cpp, copyright Vaclav Slavik and the
 * wxWidgets team (wxWindows Library Licence).
 *
 * wxJPEGHandler::LoadFile and ::SaveFile, as the calls they make into libjpeg, compiled with the
 * libjpeg-turbo KiCad links (build.sh pins the version) into the WebAssembly module wx_image.ts
 * loads. Only the wx side is transcribed; libjpeg itself is the unmodified library.
 *
 * The calls are wx's; the plumbing around them is not: the input stream is a memory buffer read
 * in wx's 2048-byte chunks, the decoded image goes to a buffer the module owns, and the
 * wxImage options are plain arguments and getters.
 */

#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <emscripten/emscripten.h>

#include "jpeglib.h"

/* ---- the result of the last call, read back by the getters ---------------------------------- */

static unsigned char* s_data = NULL; /* RGB from Load, the JPEG stream from Save */
static size_t         s_size = 0;
static int            s_width = 0;
static int            s_height = 0;
static int            s_sawJFIF = 0;
static int            s_xDensity = 0;
static int            s_yDensity = 0;
static int            s_densityUnit = 0;

static void reset_result( void )
{
    free( s_data );
    s_data = NULL;
    s_size = 0;
    s_width = s_height = 0;
    s_sawJFIF = s_xDensity = s_yDensity = s_densityUnit = 0;
}

/* ---- JPEG Data Source Manager (imagjpeg.cpp:72-138), on a memory buffer --------------------- */

#define JPEG_IO_BUFFER_SIZE 2048

typedef struct
{
    struct jpeg_source_mgr pub; /* public fields */
    JOCTET*                buffer; /* start of buffer */
    const unsigned char*   stream; /* the memory "stream" and its read position */
    size_t                 streamLen;
    size_t                 streamPos;
} wx_source_mgr;

typedef wx_source_mgr* wx_src_ptr;

static void wx_init_source( j_decompress_ptr cinfo )
{
    (void) cinfo;
}

static boolean wx_fill_input_buffer( j_decompress_ptr cinfo )
{
    wx_src_ptr src = (wx_src_ptr) cinfo->src;
    size_t     n = src->streamLen - src->streamPos;

    if( n > JPEG_IO_BUFFER_SIZE )
        n = JPEG_IO_BUFFER_SIZE;

    memcpy( src->buffer, src->stream + src->streamPos, n );
    src->streamPos += n;

    src->pub.next_input_byte = src->buffer;
    src->pub.bytes_in_buffer = n;

    if( src->pub.bytes_in_buffer == 0 ) // check for end-of-stream
    {
        // Insert a fake EOI marker
        src->buffer[0] = 0xFF;
        src->buffer[1] = JPEG_EOI;
        src->pub.bytes_in_buffer = 2;
    }

    return TRUE;
}

static void wx_skip_input_data( j_decompress_ptr cinfo, long num_bytes )
{
    if( num_bytes > 0 )
    {
        wx_src_ptr src = (wx_src_ptr) cinfo->src;

        while( num_bytes > (long) src->pub.bytes_in_buffer )
        {
            num_bytes -= (long) src->pub.bytes_in_buffer;
            src->pub.fill_input_buffer( cinfo );
        }

        src->pub.next_input_byte += (size_t) num_bytes;
        src->pub.bytes_in_buffer -= (size_t) num_bytes;
    }
}

static void wx_term_source( j_decompress_ptr cinfo )
{
    wx_src_ptr src = (wx_src_ptr) cinfo->src;

    // wx seeks the stream back over the unread bytes; a memory buffer has no one to give them to.
    free( src->buffer );
    src->buffer = NULL;
}

static void wx_jpeg_io_src( j_decompress_ptr cinfo, const unsigned char* aData, size_t aLen )
{
    wx_src_ptr src;

    if( cinfo->src == NULL ) /* first time for this JPEG object? */
    {
        cinfo->src = (struct jpeg_source_mgr*) ( *cinfo->mem->alloc_small )(
                (j_common_ptr) cinfo, JPOOL_PERMANENT, sizeof( wx_source_mgr ) );
    }

    src = (wx_src_ptr) cinfo->src;
    src->pub.bytes_in_buffer = 0; /* forces fill_input_buffer on first read */
    src->buffer = (JOCTET*) malloc( JPEG_IO_BUFFER_SIZE );
    src->pub.next_input_byte = NULL; /* until buffer loaded */
    src->stream = aData;
    src->streamLen = aLen;
    src->streamPos = 0;

    src->pub.init_source = wx_init_source;
    src->pub.fill_input_buffer = wx_fill_input_buffer;
    src->pub.skip_input_data = wx_skip_input_data;
    src->pub.resync_to_restart = jpeg_resync_to_restart; /* use default method */
    src->pub.term_source = wx_term_source;
}

/* ---- JPEG error manager (imagjpeg.cpp:148-183) ---------------------------------------------- */

struct wx_error_mgr
{
    struct jpeg_error_mgr pub;
    jmp_buf               setjmp_buffer; /* for return to caller */
};

static void wx_error_exit( j_common_ptr cinfo )
{
    /* cinfo->err really points to a wx_error_mgr struct, so coerce pointer */
    struct wx_error_mgr* const jerr = (struct wx_error_mgr*) cinfo->err;

    /* Always display the message. */
    ( *cinfo->err->output_message )( cinfo );

    /* Return control to the setjmp point */
    longjmp( jerr->setjmp_buffer, 1 );
}

/* LoadFile( image, stream, verbose = false ): wxImage::LoadFile passes verbose only for a log. */
static void wx_ignore_message( j_common_ptr cinfo )
{
    (void) cinfo;
}

/* imagjpeg.cpp:210 */
static void wx_cmyk_to_rgb( unsigned char* rgb, const unsigned char* cmyk )
{
    int k = 255 - cmyk[3];
    int k2 = cmyk[3];
    int c;

    c = k + k2 * ( 255 - cmyk[0] ) / 255;
    rgb[0] = (unsigned char) ( ( c > 255 ) ? 0 : ( 255 - c ) );

    c = k + k2 * ( 255 - cmyk[1] ) / 255;
    rgb[1] = (unsigned char) ( ( c > 255 ) ? 0 : ( 255 - c ) );

    c = k + k2 * ( 255 - cmyk[2] ) / 255;
    rgb[2] = (unsigned char) ( ( c > 255 ) ? 0 : ( 255 - c ) );
}

/* ---- wxJPEGHandler::LoadFile (imagjpeg.cpp:226-345) ----------------------------------------- */

/*
 * Decode aData; 1 on success, with the RGB plane, the size and the JFIF density readable through
 * the getters. wxIMAGE_OPTION_MAX_WIDTH/HEIGHT are never set by BITMAP_BASE, so scale_denom stays 1.
 */
EMSCRIPTEN_KEEPALIVE int wxjpeg_load( const unsigned char* aData, size_t aLen )
{
    /* static, not automatic: an automatic object modified between setjmp and longjmp is
     * indeterminate after the jump (C11 7.13.2.1), and clang -O2 does read a stale cinfo.src
     * there - a corrupt file then never left libjpeg. The module is single-threaded. */
    static struct jpeg_decompress_struct cinfo;
    static struct wx_error_mgr           jerr;
    unsigned char*                       ptr;
    static unsigned char*                image;

    image = NULL;
    memset( &cinfo, 0, sizeof( cinfo ) );

    reset_result();

    cinfo.err = jpeg_std_error( &jerr.pub );
    jerr.pub.error_exit = wx_error_exit;
    cinfo.err->output_message = wx_ignore_message;

    /* Establish the setjmp return context for wx_error_exit to use. */
    if( setjmp( jerr.setjmp_buffer ) )
    {
        /* If we get here, the JPEG code has signaled an error.
         * We need to clean up the JPEG object, close the input file, and return.
         */
        ( cinfo.src->term_source )( &cinfo );
        jpeg_destroy_decompress( &cinfo );
        free( image );
        return 0;
    }

    jpeg_create_decompress( &cinfo );
    wx_jpeg_io_src( &cinfo, aData, aLen );
    jpeg_read_header( &cinfo, TRUE );

    int bytesPerPixel;

    if( ( cinfo.out_color_space == JCS_CMYK ) || ( cinfo.out_color_space == JCS_YCCK ) )
    {
        cinfo.out_color_space = JCS_CMYK;
        bytesPerPixel = 4;
    }
    else // all the rest is treated as RGB
    {
        cinfo.out_color_space = JCS_RGB;
        bytesPerPixel = 3;
    }

    jpeg_start_decompress( &cinfo );

    image = (unsigned char*) malloc( (size_t) cinfo.output_width * cinfo.output_height * 3 );

    if( !image )
    {
        jpeg_finish_decompress( &cinfo );
        jpeg_destroy_decompress( &cinfo );
        return 0;
    }

    ptr = image;

    unsigned   stride = cinfo.output_width * bytesPerPixel;
    JSAMPARRAY tempbuf =
            ( *cinfo.mem->alloc_sarray )( (j_common_ptr) &cinfo, JPOOL_IMAGE, stride, 1 );

    while( cinfo.output_scanline < cinfo.output_height )
    {
        jpeg_read_scanlines( &cinfo, tempbuf, 1 );

        if( cinfo.out_color_space == JCS_RGB )
        {
            memcpy( ptr, tempbuf[0], stride );
            ptr += stride;
        }
        else // CMYK
        {
            const unsigned char* inptr = (const unsigned char*) tempbuf[0];

            for( size_t i = 0; i < cinfo.output_width; i++ )
            {
                wx_cmyk_to_rgb( ptr, inptr );
                ptr += 3;
                inptr += 4;
            }
        }
    }

    // set up resolution if available: it's part of optional JFIF APP0 chunk
    if( cinfo.saw_JFIF_marker )
    {
        s_sawJFIF = 1;
        s_xDensity = cinfo.X_density;
        s_yDensity = cinfo.Y_density;

        // we use the same values for this option as libjpeg so we don't need
        // any conversion here
        s_densityUnit = cinfo.density_unit;
    }

    s_width = (int) cinfo.output_width;
    s_height = (int) cinfo.output_height;

    jpeg_finish_decompress( &cinfo );
    jpeg_destroy_decompress( &cinfo );

    s_data = image;
    s_size = (size_t) s_width * s_height * 3;
    return 1;
}

/* ---- JPEG Data Destination Manager (imagjpeg.cpp:352-398), into a growing memory buffer ----- */

typedef struct
{
    struct jpeg_destination_mgr pub;
    JOCTET*                     buffer;
    unsigned char*              out; /* the memory "stream" */
    size_t                      outLen;
    size_t                      outCap;
} wx_destination_mgr;

typedef wx_destination_mgr* wx_dest_ptr;

#define OUTPUT_BUF_SIZE 4096 /* choose an efficiently fwrite'able size */

static void wx_stream_write( wx_dest_ptr dest, const JOCTET* aBytes, size_t aLen )
{
    if( dest->outLen + aLen > dest->outCap )
    {
        size_t cap = dest->outCap ? dest->outCap * 2 : 65536;

        while( cap < dest->outLen + aLen )
            cap *= 2;

        dest->out = (unsigned char*) realloc( dest->out, cap );
        dest->outCap = cap;
    }

    memcpy( dest->out + dest->outLen, aBytes, aLen );
    dest->outLen += aLen;
}

static void wx_init_destination( j_compress_ptr cinfo )
{
    wx_dest_ptr dest = (wx_dest_ptr) cinfo->dest;

    /* Allocate the output buffer --- it will be released when done with image */
    dest->buffer = (JOCTET*) ( *cinfo->mem->alloc_small )(
            (j_common_ptr) cinfo, JPOOL_IMAGE, OUTPUT_BUF_SIZE * sizeof( JOCTET ) );
    dest->pub.next_output_byte = dest->buffer;
    dest->pub.free_in_buffer = OUTPUT_BUF_SIZE;
}

static boolean wx_empty_output_buffer( j_compress_ptr cinfo )
{
    wx_dest_ptr dest = (wx_dest_ptr) cinfo->dest;

    wx_stream_write( dest, dest->buffer, OUTPUT_BUF_SIZE );
    dest->pub.next_output_byte = dest->buffer;
    dest->pub.free_in_buffer = OUTPUT_BUF_SIZE;
    return TRUE;
}

static void wx_term_destination( j_compress_ptr cinfo )
{
    wx_dest_ptr dest = (wx_dest_ptr) cinfo->dest;
    size_t      datacount = OUTPUT_BUF_SIZE - dest->pub.free_in_buffer;

    /* Write any data remaining in the buffer */
    if( datacount > 0 )
        wx_stream_write( dest, dest->buffer, datacount );
}

static void wx_jpeg_io_dest( j_compress_ptr cinfo, wx_dest_ptr* aDest )
{
    wx_dest_ptr dest;

    if( cinfo->dest == NULL ) /* first time for this JPEG object? */
    {
        cinfo->dest = (struct jpeg_destination_mgr*) ( *cinfo->mem->alloc_small )(
                (j_common_ptr) cinfo, JPOOL_PERMANENT, sizeof( wx_destination_mgr ) );
    }

    dest = (wx_dest_ptr) cinfo->dest;
    dest->pub.init_destination = wx_init_destination;
    dest->pub.empty_output_buffer = wx_empty_output_buffer;
    dest->pub.term_destination = wx_term_destination;
    dest->out = NULL;
    dest->outLen = 0;
    dest->outCap = 0;
    *aDest = dest;
}

/* ---- wxJPEGHandler::SaveFile (imagjpeg.cpp:400-480) ----------------------------------------- */

/*
 * Encode aRgb (aWidth x aHeight, 3 bytes a pixel); 1 on success, with the stream readable through
 * the getters. aQuality < 0 is "no wxIMAGE_OPTION_QUALITY"; aResUnit is GetResolutionFromOptions'
 * wxImageResolution (0 = none), with aResX/aResY its values.
 */
EMSCRIPTEN_KEEPALIVE int wxjpeg_save( const unsigned char* aRgb, int aWidth, int aHeight,
                                      int aQuality, int aResUnit, int aResX, int aResY )
{
    /* static, not automatic: see wxjpeg_load */
    static struct jpeg_compress_struct cinfo;
    static struct wx_error_mgr         jerr;
    JSAMPROW                           row_pointer[1]; /* pointer to JSAMPLE row[s] */
    int                                stride;         /* physical row width in image buffer */
    static wx_dest_ptr                 dest;

    dest = NULL;
    memset( &cinfo, 0, sizeof( cinfo ) );

    reset_result();

    cinfo.err = jpeg_std_error( &jerr.pub );
    jerr.pub.error_exit = wx_error_exit;
    cinfo.err->output_message = wx_ignore_message;

    /* Establish the setjmp return context for wx_error_exit to use. */
    if( setjmp( jerr.setjmp_buffer ) )
    {
        /* If we get here, the JPEG code has signaled an error.
         * We need to clean up the JPEG object, close the input file, and return.
         */
        if( dest )
            free( dest->out );

        jpeg_destroy_compress( &cinfo );
        return 0;
    }

    jpeg_create_compress( &cinfo );

    wx_dest_ptr d;
    wx_jpeg_io_dest( &cinfo, &d );
    dest = d;

    cinfo.image_width = aWidth;
    cinfo.image_height = aHeight;
    cinfo.input_components = 3;
    cinfo.in_color_space = JCS_RGB;
    jpeg_set_defaults( &cinfo );

    if( aQuality >= 0 )
        jpeg_set_quality( &cinfo, aQuality, TRUE );

    if( aResUnit != 0 )
    {
        cinfo.X_density = aResX;
        cinfo.Y_density = aResY;

        cinfo.density_unit = aResUnit;
    }

    jpeg_start_compress( &cinfo, TRUE );

    stride = cinfo.image_width * 3; /* JSAMPLEs per row in image_buffer */

    while( cinfo.next_scanline < cinfo.image_height )
    {
        row_pointer[0] = (JSAMPROW) &aRgb[cinfo.next_scanline * stride];
        jpeg_write_scanlines( &cinfo, row_pointer, 1 );
    }

    jpeg_finish_compress( &cinfo );
    jpeg_destroy_compress( &cinfo );

    s_data = dest->out;
    s_size = dest->outLen;
    return 1;
}

/* ---- getters, and the buffers JavaScript fills ---------------------------------------------- */

EMSCRIPTEN_KEEPALIVE unsigned char* wxjpeg_data( void ) { return s_data; }
EMSCRIPTEN_KEEPALIVE int wxjpeg_size( void ) { return (int) s_size; }
EMSCRIPTEN_KEEPALIVE int wxjpeg_width( void ) { return s_width; }
EMSCRIPTEN_KEEPALIVE int wxjpeg_height( void ) { return s_height; }
EMSCRIPTEN_KEEPALIVE int wxjpeg_saw_jfif( void ) { return s_sawJFIF; }
EMSCRIPTEN_KEEPALIVE int wxjpeg_x_density( void ) { return s_xDensity; }
EMSCRIPTEN_KEEPALIVE int wxjpeg_y_density( void ) { return s_yDensity; }
EMSCRIPTEN_KEEPALIVE int wxjpeg_density_unit( void ) { return s_densityUnit; }
EMSCRIPTEN_KEEPALIVE void wxjpeg_release( void ) { reset_result(); }
EMSCRIPTEN_KEEPALIVE unsigned char* wxjpeg_alloc( int aSize ) { return (unsigned char*) malloc( aSize ); }
EMSCRIPTEN_KEEPALIVE void wxjpeg_free( unsigned char* aPtr ) { free( aPtr ); }
