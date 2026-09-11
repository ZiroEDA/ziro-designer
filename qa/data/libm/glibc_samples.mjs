// Picks the committed libm fixture out of the million-sample oracle files
// written by ~/kicad-oracle/libm/build/samples.c (glibc 2.39, x86-64, the
// FMA ifunc variants): for each function, inputs where V8's Math.* is NOT
// glibc's answer (so a port that falls back to Math.* fails), plus random
// ones, plus a hand-picked set of edge cases evaluated by C `fma`.
// Values are IEEE bit patterns in hex so nothing is lost in printing.
//   node glibc_samples.mjs > glibc_2_39_samples.json
import { readFileSync } from 'node:fs';

const DIR = `${process.env.HOME}/kicad-oracle/libm/samples`;
const dv = new DataView(new ArrayBuffer(8));
const hex = (x) => { dv.setFloat64(0, x); return dv.getBigUint64(0).toString(16).padStart(16, '0'); };
const same = (a, b) => Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b));
const out = {};
for (const [name, fn, argc] of [['sin', Math.sin, 1], ['cos', Math.cos, 1], ['atan2', Math.atan2, 2], ['acos', Math.acos, 1], ['asin', Math.asin, 1], ['fma', (a, b, c) => a * b + c, 3]]) {
  const buf = readFileSync(`${DIR}/${name}.bin`);
  const f = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  const stride = argc + 1;
  const n = f.length / stride;
  const differ = [];
  const random = [];
  for (let i = 0; i < n && (differ.length < 250 || random.length < 250); i++) {
    const o = i * stride;
    const args = Array.from(f.subarray(o, o + argc));
    const row = [...args.map(hex), hex(f[o + argc])];
    if (!same(fn(...args), f[o + argc])) { if (differ.length < 250) differ.push(row); }
    else if (random.length < 250 && i % 97 === 0) random.push(row);
  }
  out[name] = { differ, random };
}
// Inputs found by mutating libm.ts (qa/unittests/kimath/libm_glibc.test.ts
// names the mutants): the answers come from targeted.c, the installed glibc.
for (const line of readFileSync(new URL('./targeted.txt', import.meta.url), 'utf8').trim().split('\n')) {
  const [fn, mutant, ...rest] = line.split(' ');
  (out[fn].targeted ??= []).push([mutant, ...rest]);
}
console.log(JSON.stringify(out));
