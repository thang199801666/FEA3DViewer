import * as THREE from "three";

// Public interoperability boundary for application code that needs access to
// the underlying scene graph without depending on Three.js directly.
export const RenderingBackend = Object.freeze({
    createScene(background = null) {
        const scene = new THREE.Scene();
        scene.background = background == null ? null : new THREE.Color(background);
        return scene;
    },
    createWebGLRenderer: (options = {}) => new THREE.WebGLRenderer(options),
    createEventDispatcher: () => new THREE.EventDispatcher(),
    createAmbientLight: (color, intensity) => new THREE.AmbientLight(color, intensity),
    createDirectionalLight: (color, intensity) => new THREE.DirectionalLight(color, intensity),
    box3: () => new THREE.Box3(),
    vector3: (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z),
    sphere: () => new THREE.Sphere(),
    clamp: (value, min, max) => THREE.MathUtils.clamp(value, min, max),
    degToRad: (value) => THREE.MathUtils.degToRad(value),
    projectWorldToScreen(camera, point, width, height) {
        if (!camera || !width || !height) return null;
        camera.updateMatrixWorld?.(true);
        const projected = new THREE.Vector3(point[0], point[1], point[2]).project(camera);
        return {
            x: (projected.x + 1) * width / 2,
            y: (1 - projected.y) * height / 2,
            depth: projected.z,
            visible: projected.z >= -1 && projected.z <= 1,
        };
    },
    getObjectBounds(object) {
        const box = new THREE.Box3().setFromObject(object);
        const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
        return { empty: box.isEmpty(), size: [size.x, size.y, size.z] };
    },
});
