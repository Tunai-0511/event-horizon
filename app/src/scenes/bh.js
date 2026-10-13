// Black-hole scene: uniform defaults for bh.frag (units r_s = 1, c = 1).
import { BH } from '../u.js';

export const DEFAULTS = {
  ...BH,
  uDiskTemp: 6200, uDiskBright: 2.2, uDiskTau: 2.5, uDoppler: 1.0, uBeam: 0.25, uDiskOut: 18, uDiskTime: 30, uDiskSat: 2.0,
};
