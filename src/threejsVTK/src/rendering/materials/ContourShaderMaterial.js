// Rendering/ContourShaderMaterial.js
// Builds a high-performance banded contour THREE.ShaderMaterial.
// Compared with vertex colors, changing bands, range, or isolines updates uniforms
// without rebuilding geometry, which keeps large meshes interactive.
//
//   const { material, attachScalar } = makeContourMaterial(lookupTable, { numBands: 12 });
//   attachScalar(geometry, dataArray, [min,max]);   // attach aScalar attribute
//   const mesh = new THREE.Mesh(geometry, material);
//
// GLSL is embedded inline so no bundler-specific .glsl loader is required.

import * as THREE from "three";

const VERT = /* glsl */`
attribute float aScalar;
varying float vScalar;
varying vec3  vNormal;
void main() {
    vScalar = aScalar;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uLut;
uniform float uMin, uMax, uNumBands, uShowIsolines, uAmbient;
uniform vec3  uIsolineColor, uLightDir;
varying float vScalar;
varying vec3  vNormal;
void main() {
    float t = clamp((vScalar - uMin) / max(uMax - uMin, 1e-8), 0.0, 1.0);
    float band = min(floor(t * uNumBands), uNumBands - 1.0);
    vec3 col = texture2D(uLut, vec2((band + 0.5) / uNumBands, 0.5)).rgb;
    float diff = abs(dot(normalize(vNormal), normalize(uLightDir)));
    col *= uAmbient + (1.0 - uAmbient) * diff;
    if (uShowIsolines > 0.5) {
        float s = t * uNumBands; float f = fract(s); float d = fwidth(s);
        float w = smoothstep(0.0, d * 1.5, f) * smoothstep(0.0, d * 1.5, 1.0 - f);
        col = mix(uIsolineColor, col, w);
    }
    gl_FragColor = vec4(col, 1.0);
}`;

/** Builds a 1D DataTexture from a LookupTable or ColorTransferFunction. */
function lutToTexture(lut) {
    const data = lut.getUint8Table();
    const n = lut.numberOfColors;
    const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    if (THREE.NoColorSpace !== undefined) tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
}

export function makeContourMaterial(lookupTable, options = {}) {
    const {
        numBands = 12, range = [0, 1], showIsolines = true,
        isolineColor = 0x000000, ambient = 0.35, lightDir = [0.5, 0.7, 1.0],
    } = options;

    const material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.DoubleSide,
        uniforms: {
            uLut: { value: lutToTexture(lookupTable) },
            uMin: { value: range[0] },
            uMax: { value: range[1] },
            uNumBands: { value: numBands },
            uShowIsolines: { value: showIsolines ? 1 : 0 },
            uIsolineColor: { value: new THREE.Color(isolineColor) },
            uLightDir: { value: new THREE.Vector3(...lightDir) },
            uAmbient: { value: ambient },
        },
    });

    // Attach raw scalars to geometry as the aScalar attribute.
    function attachScalar(geometry, dataArray, r = range, component = 0) {
        const n = dataArray.getNumberOfTuples();
        const arr = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            arr[i] = component === -1 ? dataArray.getMagnitude(i) : dataArray.getComponent(i, component);
        }
        geometry.setAttribute("aScalar", new THREE.BufferAttribute(arr, 1));
        material.uniforms.uMin.value = r[0];
        material.uniforms.uMax.value = r[1];
        if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    }

    // Realtime update path: only uniforms change.
    function setNumBands(n) { material.uniforms.uNumBands.value = n; }
    function setRange(min, max) { material.uniforms.uMin.value = min; material.uniforms.uMax.value = max; }
    function setIsolines(on) { material.uniforms.uShowIsolines.value = on ? 1 : 0; }
    function setLookupTable(lut) {
        material.uniforms.uLut.value.dispose();
        material.uniforms.uLut.value = lutToTexture(lut);
    }

    return { material, attachScalar, setNumBands, setRange, setIsolines, setLookupTable };
}
