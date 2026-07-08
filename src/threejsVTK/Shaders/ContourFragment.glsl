// Shaders/ContourFragment.glsl
// Banding scalar -> màu qua LUT 1D + isoline sắc nét (fwidth) + Lambert 2 phía.
// Tính hoàn toàn trên GPU: đổi số band/range không cần dựng lại geometry => rất nhanh.

precision highp float;

uniform sampler2D uLut;        // texture LUT 1D (N x 1)
uniform float uMin;
uniform float uMax;
uniform float uNumBands;       // số dải màu
uniform float uShowIsolines;   // 0/1
uniform vec3  uIsolineColor;
uniform vec3  uLightDir;       // hướng sáng (view space)
uniform float uAmbient;        // 0..1

varying float vScalar;
varying vec3  vNormal;

void main() {
    float t = clamp((vScalar - uMin) / max(uMax - uMin, 1e-8), 0.0, 1.0);

    // Lượng tử hóa thành band (0.5 để lấy màu tâm mỗi dải)
    float band = floor(t * uNumBands);
    band = min(band, uNumBands - 1.0);
    float lutU = (band + 0.5) / uNumBands;
    vec3 col = texture2D(uLut, vec2(lutU, 0.5)).rgb;

    // Chiếu sáng Lambert 2 phía (mặt cắt vẫn sáng)
    vec3 N = normalize(vNormal);
    float diff = abs(dot(N, normalize(uLightDir)));
    float light = uAmbient + (1.0 - uAmbient) * diff;
    col *= light;

    // Isolines: kẻ đường tại ranh giới band bằng đạo hàm màn hình (anti-aliased)
    if (uShowIsolines > 0.5) {
        float scaled = t * uNumBands;
        float f = fract(scaled);
        float d = fwidth(scaled);
        float lineW = smoothstep(0.0, d * 1.5, f) * smoothstep(0.0, d * 1.5, 1.0 - f);
        col = mix(uIsolineColor, col, lineW);
    }

    gl_FragColor = vec4(col, 1.0);
}
