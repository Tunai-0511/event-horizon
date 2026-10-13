#version 300 es
precision highp float;
in float vI;
in float vD;
in vec3 vCol;
uniform float uWeight;
out vec4 o;
void main() {
  float prof = exp(-vD * vD * 3.0);
  o = vec4(vCol * vI * prof * uWeight, 0.0);
}
