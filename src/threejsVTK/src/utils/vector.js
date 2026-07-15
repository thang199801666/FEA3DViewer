import * as THREE from "three";

/**
 * Creates a THREE.Vector3 from either an array or coordinate arguments.
 * Keeps direct Three.js vector construction inside the library boundary.
 */
export function createVector3(x = 0, y = 0, z = 0) {
    if (Array.isArray(x)) {
        return new THREE.Vector3(x[0], x[1], x[2]);
    }
    return new THREE.Vector3(x, y, z);
}