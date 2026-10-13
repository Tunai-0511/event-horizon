// Uniform defaults per scene shader + small matrix helpers.
import { norm, cross } from './cam.js';

// rotation matrix (column-major, for GLSL mat3) from yaw (y), pitch (x), roll (z) in degrees: R = Ry * Rx * Rz
export function rotYXZ(yaw = 0, pitch = 0, roll = 0) {
  const d = Math.PI / 180;
  const [cy, sy, cx, sx, cz, sz] = [Math.cos(yaw * d), Math.sin(yaw * d), Math.cos(pitch * d), Math.sin(pitch * d), Math.cos(roll * d), Math.sin(roll * d)];
  // rows
  const m = [
    [cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx],
    [cx * sz, cx * cz, -sx],
    [-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx],
  ];
  return [m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]];
}
export const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const SKY = {
  uSkyRot: I3, uStars: 1, uStarReveal: 1, uMilky: 1, uGalN: norm([0.15, 0.95, 0.2]), uGalC: norm([1, -0.1, 0.3]), uGal: 1,
  uNebSky: 0, uNebSkyA: [1.0, 0.25, 0.35], uNebSkyB: [0.2, 0.7, 0.9], uSkyShift: 1, uGalDeep: 0, uHeroDir: [0, 0, -1], uHeroFlux: 0, uHeroTemp: 9000,
};

export const BH = {
  ...SKY,
  uLens: 1, uObsStatic: 0, uObsFall: 0, uRfar: 1200,
  uDisk: 1, uDiskIn: 3, uDiskOut: 16, uDiskTemp: 7200, uDiskBright: 1.2, uDiskTau: 2.2, uDoppler: 0.6, uBeam: 0.0,
  uDiskSpeed: 0.05, uDiskTurb: 0.8, uDiskSeed: 0.0, uDiskTime: 0, uDiskSat: 2.0, uForm: 1, uIgnFront: 0, uIgnWidth: 1.6, uEmber: 0.1, uIgnFlash: 0, uIgnDir: 1,
  uHaze: 0.0, uHazeH: 0.05, uJet: 0, uJetLen: 200,
  uSkyAmt: 1, uFlash: 0, uReveal: 1,
};

export { norm, cross };
