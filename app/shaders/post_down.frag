// 13-tap downsample (Jimenez 2014). On the first level a Karis average tames single bright pixels (fireflies).
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uKaris;
in vec2 vUv;
out vec4 o;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 kw(vec3 a, vec3 b, vec3 c, vec3 d) {
  vec3 s = (a + b + c + d) * 0.25;
  if (uKaris > 0.5) {
    float w = 1.0 / (1.0 + luma(s) * 0.25);
    return s * w;
  }
  return s;
}
vec3 S(vec2 off) { return texture(uSrc, vUv + off * uTexel).rgb; }
void main() {
  vec3 A = S(vec2(-2, 2)), B = S(vec2(0, 2)), C = S(vec2(2, 2));
  vec3 D = S(vec2(-1, 1)), E = S(vec2(1, 1));
  vec3 F = S(vec2(-2, 0)), G = S(vec2(0, 0)), H = S(vec2(2, 0));
  vec3 I = S(vec2(-1, -1)), J = S(vec2(1, -1));
  vec3 K = S(vec2(-2, -2)), L = S(vec2(0, -2)), M = S(vec2(2, -2));
  vec3 r = kw(D, E, I, J) * 0.5 + (kw(A, B, F, G) + kw(B, C, G, H) + kw(F, G, K, L) + kw(G, H, L, M)) * 0.125;
  if (uKaris > 0.5) r *= (1.0 + luma(r) * 0.25); // undo the average darkening of normal-brightness content
  o = vec4(r, 1.0);
}
