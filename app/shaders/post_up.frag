// 3x3 tent upsample of the coarser level, added onto this level's downsample.
uniform sampler2D uSrc;   // coarser level (already accumulated)
uniform sampler2D uBase;  // this level (downsampled)
uniform vec2 uTexel;      // texel of uSrc
uniform float uScatter;   // how much of the coarse (wide) glow survives each level
in vec2 vUv;
out vec4 o;
vec3 S(vec2 off) { return texture(uSrc, vUv + off * uTexel).rgb; }
void main() {
  vec3 t = (S(vec2(-1, -1)) + S(vec2(1, -1)) + S(vec2(-1, 1)) + S(vec2(1, 1))) * 1.0
         + (S(vec2(0, -1)) + S(vec2(0, 1)) + S(vec2(-1, 0)) + S(vec2(1, 0))) * 2.0
         + S(vec2(0, 0)) * 4.0;
  t /= 16.0;
  o = vec4(texture(uBase, vUv).rgb + t * uScatter, 1.0);
}
