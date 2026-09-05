/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ask KiCad's own vendored Zint what a barcode's modules are.
 *
 * `PCB_BARCODE::ComputeBarcode` (`pcbnew/pcb_barcode.cpp:412`) does not
 * implement any encoder — it creates a `zint_symbol`, sets `symbology` and
 * `option_1` exactly as below, and calls `ZBarcode_Encode`. So the module
 * pattern our TypeScript port has to produce is whatever THIS prints, and a
 * disagreement is our bug by definition.
 *
 * Usage: zint_probe <code39|code128|datamatrix|qr|microqr> <ecc 1-4> <text>
 * Prints "<rows> <width>" then one line of '0'/'1' per row.
 */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "zint.h"

/* `common.h`'s macro form (:216); the header itself is internal to Zint. */
#define module_is_set(s, y, x) (((s)->encoded_data[y][(x) >> 3] >> ((x) & 0x07)) & 1)

int main(int argc, char **argv)
{
    if (argc < 4) { fprintf(stderr, "usage: zint_probe <kind> <ecc> <text>\n"); return 2; }

    struct zint_symbol *symbol = ZBarcode_Create();
    if (!symbol) return 3;

    /* The four lines ComputeBarcode sets before encoding. */
    symbol->input_mode = UNICODE_MODE;
    symbol->show_hrt = 0;

    const char *kind = argv[1];
    int ecc = atoi(argv[2]);

    if (!strcmp(kind, "code39"))          symbol->symbology = BARCODE_CODE39;
    else if (!strcmp(kind, "code128"))    symbol->symbology = BARCODE_CODE128;
    else if (!strcmp(kind, "datamatrix")) symbol->symbology = BARCODE_DATAMATRIX;
    else if (!strcmp(kind, "qr"))       { symbol->symbology = BARCODE_QRCODE; symbol->option_1 = ecc; }
    else if (!strcmp(kind, "microqr"))  { symbol->symbology = BARCODE_MICROQR; symbol->option_1 = ecc; }
    else { fprintf(stderr, "unknown kind %s\n", kind); return 2; }

    const char *text = argv[3];
    int length = (int) strlen(text);

    /* ComputeBarcode's ECI branch, `pcb_barcode.cpp:602-605`. */
    int is_ascii = 1;
    for (int i = 0; i < length; i++) if ((unsigned char) text[i] > 127) is_ascii = 0;
    if ((symbol->symbology == BARCODE_QRCODE || symbol->symbology == BARCODE_DATAMATRIX) && !is_ascii)
        symbol->eci = 26; /* ECI_UTF8 */

    int rc = ZBarcode_Encode(symbol, (unsigned char *) text, length);
    if (rc >= ZINT_ERROR) { printf("ERROR %s\n", symbol->errtxt); return 1; }

    printf("%d %d\n", symbol->rows, symbol->width);
    for (int r = 0; r < symbol->rows; r++) {
        for (int i = 0; i < symbol->width; i++)
            putchar(module_is_set(symbol, r, i) ? '1' : '0');
        putchar('\n');
    }
    /* Row heights, which decide a linear symbol's bar proportions. */
    printf("height %g\n", symbol->height);
    printf("heights");
    for (int r = 0; r < symbol->rows; r++) printf(" %g", symbol->row_height[r]);
    putchar('\n');

    ZBarcode_Delete(symbol);
    return 0;
}
