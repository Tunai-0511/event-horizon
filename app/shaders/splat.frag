#version 300 es
precision highp float;
flat in vec4 vP;
flat in vec4 vQ;
flat in vec3 vVel;
uniform float uSlice;
layout(location = 0) out vec4 oA;   // rho, rho*T4, rho*vx, rho*vy
layout(location = 1) out vec4 oB;   // rho*vz
void main() {
  vec3 c = vec3(gl_FragCoord.xy, uSlice + 0.5);
  float q = length(c - vP.xyz) / vP.w;
  if (q >= 2.0) discard;
  float w = q < 1.0 ? 1.0 - 1.5 * q * q + 0.75 * q * q * q : 0.25 * (2.0 - q) * (2.0 - q) * (2.0 - q);
  float rho = vQ.x * w;
  oA = vec4(rho, rho * vQ.y, rho * vVel.x, rho * vVel.y);
  oB = vec4(rho * vVel.z, 0.0, 0.0, 0.0);
}
