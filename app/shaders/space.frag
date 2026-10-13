// Open space: the procedural sky seen through a pinhole camera (no gravity).
#include "common.glsl"
#include "sky.glsl"
uniform float uSkyAmt;
void main() {
  vec3 rd = camRay();
  emit(sky(rd, pixelAngle()) * uSkyAmt);
}
