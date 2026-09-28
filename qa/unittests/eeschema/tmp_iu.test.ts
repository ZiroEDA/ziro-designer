import { it } from 'vitest';
import { schIUScale } from '@ziroeda/common';
import { IU_PER_MILS } from '@ziroeda/eeschema/schematic_settings.js';
it('scale', () => {
  console.log('schIUScale.IU_PER_MILS =', schIUScale.IU_PER_MILS);
  console.log('local IU_PER_MILS      =', IU_PER_MILS);
  console.log('50 mil grid, correct   =', 50 * schIUScale.IU_PER_MILS);
  console.log('50 mil grid, ours      =', 50 * IU_PER_MILS);
});
