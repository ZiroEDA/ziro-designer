import { readFileSync } from 'node:fs';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema';
const DIR = '/home/akshay/ziro-perf-fixtures/symbols';
for (const name of ['Relay', 'Device', 'MCU_ST_STM32H7']) {
  const text = readFileSync(`${DIR}/${name}.kicad_sym`, 'utf8');
  let s = performance.now();
  const sx = parse(text);
  const tParse = performance.now() - s;
  s = performance.now();
  const syms = readSymbolLib(sx);
  const tRead = performance.now() - s;
  const extendsCount = syms.filter((x) => x.extends).length;
  console.log(`${name.padEnd(18)} ${(text.length/1e6).toFixed(2)} MB  parse ${tParse.toFixed(1)} ms  readSymbolLib ${tRead.toFixed(1)} ms  symbols ${syms.length}  derived ${extendsCount}`);
}
