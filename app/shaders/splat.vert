#version 300 es
// One instance = one SPH particle, drawn as a quad covering its kernel's footprint in the current volume slice.
precision highp float;
precision highp sampler2D;
uniform sampler2D uParts;   // x y z h
uniform sampler2D uAux;     // vx vy vz u
uniform int uTexW;
uniform vec4 uBox;          // centre, half size
uniform float uRes;         // voxels per side
uniform float uVox;         // voxel size
uniform float uSlice;       // current slice index
uniform float uMass;
uniform float uRhoRef;
uniform float uUA;          // reference specific internal energy (the unperturbed star) ...
uniform float uTA;          // ... shown at this colour temperature (the Sun: 5800 K)
uniform float uTGamma;      // colour temperature T = uTA * (u / uUA)^uTGamma: monotonic in u, compressed so the range from the
                            // adiabatically cooled stream (red) to virially shocked gas (blue-white) stays in the visible
uniform float uTMin;
flat out vec4 vP;           // particle position in voxel units (xyz), effective h in voxels (w)
flat out vec4 vQ;           // mass/rhoRef/(pi h^3) normalisation, visual temperature/1e4, unused
flat out vec3 vVel;
void main() {
  int i = gl_InstanceID;
  ivec2 tc = ivec2(i % uTexW, i / uTexW);
  vec4 P = texelFetch(uParts, tc, 0);
  vec4 A = texelFetch(uAux, tc, 0);
  float h = P.w;
  vec3 pv = (P.xyz - (uBox.xyz - uBox.w)) / uVox;              // voxel coordinates
  float hv = max(h / uVox, 0.45);                               // never thinner than the grid can hold
  float dz = pv.z - (uSlice + 0.5);
  float R = 2.0 * hv;
  if (h <= 0.0 || abs(dz) >= R || pv.x < -R || pv.y < -R || pv.x > uRes + R || pv.y > uRes + R) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vP = vec4(0.0); vQ = vec4(0.0); vVel = vec3(0.0); return;
  }
  float r2d = sqrt(R * R - dz * dz) + 0.71;
  int v = gl_VertexID;
  vec2 c = vec2((v == 1 || v == 2 || v == 4) ? 1.0 : -1.0, (v == 2 || v == 4 || v == 5) ? 1.0 : -1.0);
  vec2 xy = pv.xy + c * r2d;
  gl_Position = vec4(xy / uRes * 2.0 - 1.0, 0.0, 1.0);
  float hw = hv * uVox;                                        // effective h in world units
  float Tv = max(uTA * pow(max(A.w, 1e-30) / uUA, uTGamma), uTMin);
  vP = vec4(pv, hv);
  vQ = vec4(uMass / uRhoRef / (3.14159265 * hw * hw * hw), Tv * 1e-4, 0.0, 0.0);
  vVel = A.xyz;
}
