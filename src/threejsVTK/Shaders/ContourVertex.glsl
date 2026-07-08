// Shaders/ContourVertex.glsl
// Đưa scalar per-vertex xuống fragment shader để banding + chiếu sáng Lambert đơn giản.
// three.js tự cung cấp: position, normal, projectionMatrix, modelViewMatrix, normalMatrix.

attribute float aScalar;   // giá trị scalar thô tại đỉnh

varying float vScalar;
varying vec3  vNormal;

void main() {
    vScalar = aScalar;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
