/* Reads targeted_inputs.txt ("fn mutant hexarg [hexarg]") and appends the
 * installed glibc's answer in hex:  gcc -O0 -fno-builtin targeted.c -lm && ./a.out < targeted_inputs.txt > targeted.txt */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>
#include <math.h>
static double fromhex(const char* s){ uint64_t u = strtoull(s, 0, 16); double d; memcpy(&d, &u, 8); return d; }
static void tohex(double d, char* out){ uint64_t u; memcpy(&u, &d, 8); sprintf(out, "%016llx", (unsigned long long)u); }
int main(void){ char fn[16], mut[16], a[32], b[32]; char r[32];
  while (scanf("%15s %15s %31s", fn, mut, a) == 3) {
    double res;
    if (!strcmp(fn, "atan2")) { if (scanf("%31s", b) != 1) return 1; res = atan2(fromhex(a), fromhex(b)); tohex(res, r); printf("%s %s %s %s %s\n", fn, mut, a, b, r); }
    else { res = !strcmp(fn, "sin") ? sin(fromhex(a)) : !strcmp(fn, "cos") ? cos(fromhex(a)) : !strcmp(fn, "acos") ? acos(fromhex(a)) : asin(fromhex(a)); tohex(res, r); printf("%s %s %s %s\n", fn, mut, a, r); }
  }
  return 0; }
