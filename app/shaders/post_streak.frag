// Horizontal anamorphic streak from a low-res bright-pass: wide 1D blur, only the very bright survives.
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThresh;
uniform float uLen;
in vec2 vUv;
out vec4 o;
void main() {
  vec3 s = vec3(0.0); float wsum = 0.0;
  for (int i = -24; i <= 24; i++) {
    float x = float(i);
    float w = exp(-abs(x) / (6.0 * uLen));
    vec3 c = texture(uSrc, vUv + vec2(x * uLen * 2.0, 0.0) * uTexel).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c *= max(l - uThresh, 0.0) / max(l, 1e-4);
    s += c * w; wsum += w;
  }
  o = vec4(s / wsum, 1.0);
}
