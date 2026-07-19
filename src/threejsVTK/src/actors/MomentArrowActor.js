import * as THREE from "three";

/** World-space curved moment arrow centered on an axis. */
export class MomentArrowActor extends THREE.Group {
    constructor({ origin = [0, 0, 0], axis = [1, 0, 0], radius = 0.62, startAngle = 0, direction = 1, color = 0xff0000, loadKey = "" } = {}) {
        super();
        this.name = "MomentArrow";
        this.userData.isLoadSymbol = true;
        this.userData.loadKey = loadKey;

        const sign = direction < 0 ? -1 : 1;
        const start = startAngle;
        const sweep = Math.PI * 0.5 * sign;
        const points = [];
        for (let i = 0; i <= 72; i++) {
            const angle = start + sweep * i / 72;
            points.push(new THREE.Vector3(radius * Math.cos(angle), radius * Math.sin(angle), 0));
        }
        const curve = new THREE.CatmullRomCurve3(points);
        const tubeRadius = radius * 0.035;
        const material = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.42,
            metalness: 0.04,
            emissive: new THREE.Color(color).multiplyScalar(0.08),
        });
        const arc = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, tubeRadius, 10, false), material);

        const end = points.at(-1);
        const tangent = curve.getTangent(1).normalize();
        const headHeight = radius * 0.24;
        const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.105, headHeight, 20), material);
        head.position.copy(end).addScaledVector(tangent, headHeight * 0.3);
        head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
        arc.castShadow = head.castShadow = true;
        this.add(arc, head);

        const normal = new THREE.Vector3(...axis);
        if (normal.lengthSq() === 0) normal.set(1, 0, 0);
        this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.normalize());
        this.position.fromArray(origin);
        this._tip = end.clone().addScaledVector(tangent, headHeight * 0.8);
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
