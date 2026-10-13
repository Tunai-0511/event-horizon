// Integer hashing (PCG family). Every random quantity in the film comes from these.
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
uvec4 pcg4d(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
const float INV_U32 = 1.0 / 4294967295.0;
vec3 hash33i(ivec3 c) { return vec3(pcg3d(uvec3(c))) * INV_U32; }
vec4 hash44i(ivec4 c) { return vec4(pcg4d(uvec4(c))) * INV_U32; }
vec3 hash33(vec3 p) { return hash33i(ivec3(floor(p))); }
float hash11(float x) { return float(pcg3d(uvec3(floatBitsToUint(x), 7u, 13u)).x) * INV_U32; }
float hash21(vec2 p) { return float(pcg3d(uvec3(floatBitsToUint(p.x), floatBitsToUint(p.y), 99u)).x) * INV_U32; }
// per-pixel, per-subframe random numbers
vec4 pixelRand(vec2 frag, float seed) {
  return hash44i(ivec4(int(frag.x), int(frag.y), int(seed * 97.0 + 1.0), 4242));
}
