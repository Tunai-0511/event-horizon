// THE ENDLESS (Act I) — a giant molecular cloud, its pillars, its dark interior, one dense core that collapses into a
// spinning disk, and the ignition of a massive star whose light front carves the cloud.
//
// Rendering model
//  * One ray march through a density field built from the noise volume (domain-warped fBm, billows, Worley walls) and
//    analytic shapes (cloud ellipsoid, cavity bowl, pillars, globules, cocoons, the collapsing core with disk + jets).
//  * Shadows are analytic. For each light source the distance to its ionisation front is a function on the sphere of
//    directions ("first hit": noise + explicit pillar geometry), and the column density from the source to any point
//    is integrated in closed form along that direction. No secondary marches.
//  * Ionising photons die in a thin skin -> H-alpha / [S II] rims; the [O III] share follows the ionisation parameter
//    (flux / density): teal near hot stars and in rarefied gas, pink-red at the dense fronts.
//  * Dust: reddening extinction (uExt), two-lobe Henyey-Greenstein scattering of whatever starlight reaches it.
//  * Stars are queued before the march and composited at their depth, so dust extinguishes and reddens them.
#include "common.glsl"
#include "sky.glsl"
#include "nebula_lib.glsl"

#ifndef MAXSTEPS
#define MAXSTEPS 100
#endif

uniform float uFootStep;
void main() {
  vec3 ro = uCamPos, rd = camRay();
  float pa = pixelAngle();
  vec4 rnd = pixelRand(gl_FragCoord.xy, uSeed);
  heroSetup();
  rayMasks(ro, rd);

  // ---- point sources, queued by depth ----------------------------------------------------------------------------
  float tSolid = 1e9;            // a resolved stellar surface terminates the ray
  vec3 solidCol = vec3(0.0);
  queueStars(ro, rd, pa, tSolid, solidCol);
  queueJets(ro, rd, pa);
  queueField(ro, rd, pa);

  vec3 col = vec3(0.0);
  vec3 T = vec3(1.0);
  float nSteps = 0.0;

  vec2 tb = sphHit(ro, rd, uCloudC, WORLD_R);
  if (tb.y > 0.0) {
    float t = max(tb.x, 0.0);
    float tEnd = min(tb.y, tSolid);
    float busy = 1.0;
    // Stratified jittered sampling: each segment's length comes from the previous sample's busyness, and the
    // segment is sampled at a per-pixel random fraction of its length (the jitter scales with the step, so a
    // geometric step sequence cannot line up across pixels into rings).
    for (int i = 0; i < MAXSTEPS; i++) {
      if (t >= tEnd) break;
      float seg = min(stepFor(t, pa, busy, ro + rd * t), tEnd - t);
      float ts = t + rnd.x * seg;
      vec3 p = ro + rd * ts;
      // footprint for texture filtering: the pixel cone, but never finer than the step can resolve
      // (detail finer than ~half a step cannot be resolved by the march: filter it away instead of turning it into grain)
      float foot = max(max(ts * pa, uFootStep * seg), 1e-4);
      Med m = medium(p, rd, foot);
      busy = m.busy;
      nSteps += 1.0;
      // sources lying inside this segment are seen through the extinction accumulated so far
      queueFlush(t + 0.5 * seg, T, col);
      // analytic integration of a homogeneous segment (energy conserving for thick samples)
      vec3 sig = max(m.sig, vec3(1e-6));
      vec3 tr = exp(-sig * seg);
      col += T * m.emi * (1.0 - tr) / sig;
      T *= tr;
      t += seg;
      if (max(T.r, max(T.g, T.b)) < 0.003) { T = vec3(0.0); break; }
    }
  }
  queueFlush(1e10, T, col);
  if (tSolid < 1e8) col += T * solidCol, T = vec3(0.0);
  if (max(T.r, max(T.g, T.b)) > 0.003 && uSkyAmt > 0.0) col += T * sky(rd, pa) * uSkyAmt;
#ifdef DBG_STEPS
  col = vec3(nSteps / float(MAXSTEPS));   // debug: march samples per pixel (grey = fraction of MAXSTEPS)
#endif
  emit(col);
}
