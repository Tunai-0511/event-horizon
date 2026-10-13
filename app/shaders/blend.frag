// out = A * sa * (1 - w) + B * sb * w   (HDR cross-dissolve; each input pre-scaled by its own exposure)
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uSa;
uniform float uSb;
uniform float uW;
in vec2 vUv;
out vec4 o;
void main() {
  o = vec4(texture(uA, vUv).rgb * uSa * (1.0 - uW) + texture(uB, vUv).rgb * uSb * uW, 1.0);
}
