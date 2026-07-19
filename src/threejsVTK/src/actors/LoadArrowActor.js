import * as THREE from "three";

/** World-space load arrow using the same cylinder + cone construction as the axes triad. */
export class LoadArrowActor extends THREE.Group {
    constructor({ origin = [0, 0, 0], direction = [0, 1, 0], length = 0.82, startOffset = 0.34, color = 0x54ef00, loadKey = "" } = {}) {
        super();
        this.name = "LoadArrow";
        this.userData.isLoadSymbol = true;
        this.userData.loadKey = loadKey;

        const vector = new THREE.Vector3(...direction);
        if (vector.lengthSq() === 0) vector.set(0, 1, 0);
        vector.normalize();

        const headHeight = length * 0.28;
        const bodyLength = length - headHeight;
        const shaftRadius = length * 0.027;
        const headRadius = length * 0.09;
        const material = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.42,
            metalness: 0.04,
            emissive: new THREE.Color(color).multiplyScalar(0.08),
        });

        const body = new THREE.Mesh(new THREE.CylinderGeometry(shaftRadius, shaftRadius, bodyLength, 24), material);
        body.position.y = startOffset + bodyLength / 2;
        const head = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headHeight, 24), material);
        head.position.y = startOffset + bodyLength + headHeight / 2;
        body.castShadow = body.receiveShadow = true;
        head.castShadow = head.receiveShadow = true;
        this.add(body, head);

        this.position.fromArray(origin);
        this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector);
        this._tip = new THREE.Vector3(0, startOffset + length, 0);
    }

    getTipPosition() {
        const tip = this.localToWorld(this._tip.clone());
        return [tip.x, tip.y, tip.z];
    }

    getOriginPosition() {
        const origin = this.localToWorld(new THREE.Vector3(0, 0, 0));
        return [origin.x, origin.y, origin.z];
    }

    dispose() {
        const materials = new Set();
        this.traverse((object) => {
            object.geometry?.dispose?.();
            if (object.material) materials.add(object.material);
        });
        materials.forEach((material) => material.dispose?.());
    }
}
