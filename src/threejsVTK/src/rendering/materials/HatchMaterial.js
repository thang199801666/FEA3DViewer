// Rendering/HatchMaterial.js
// Hatch material for drafting-style section cuts: solid fill plus evenly spaced
// diagonal lines in screen space so hatch spacing stays stable while zooming.
//
//   const mat = makeHatchMaterial({ angle: 45, spacing: 8, lineColor: 0x222222, fillColor: 0xcfd8dc });

import * as THREE from "three";

const VERT = /* glsl */`
varying vec3 vNormal;
void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
uniform vec3  uFillColor, uLineColor, uLightDir;
uniform float uSpacing, uAngle, uLineWidth, uAmbient, uOpacity;
varying vec3 vNormal;
void main() {
    // Coordinate along the hatch-line normal, measured in screen pixels.
    float c = cos(uAngle), s = sin(uAngle);
    float coord = gl_FragCoord.x * c + gl_FragCoord.y * s;
    float f = mod(coord, uSpacing);
    float line = 1.0 - smoothstep(0.0, uLineWidth, min(f, uSpacing - f));

    vec3 base = mix(uFillColor, uLineColor, line);
    float diff = abs(dot(normalize(vNormal), normalize(uLightDir)));
    base *= uAmbient + (1.0 - uAmbient) * diff;
    gl_FragColor = vec4(base, uOpacity);
}`;

export function makeHatchMaterial(options = {}) {
    const {
        angle = 45, spacing = 8, lineWidth = 1.5,
        fillColor = 0xe0e0e0, lineColor = 0x303030,
        ambient = 0.55, lightDir = [0.5, 0.7, 1.0], opacity = 1.0,
        doubleSide = true,
    } = options;

    return new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
        transparent: opacity < 1.0,
        uniforms: {
            uFillColor: { value: new THREE.Color(fillColor) },
            uLineColor: { value: new THREE.Color(lineColor) },
            uSpacing: { value: spacing },
            uAngle: { value: (angle * Math.PI) / 180 },
            uLineWidth: { value: lineWidth },
            uAmbient: { value: ambient },
            uLightDir: { value: new THREE.Vector3(...lightDir) },
            uOpacity: { value: opacity },
        },
    });
}
