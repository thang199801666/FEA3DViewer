import * as THREE from "three";

export function computeSceneBounds(scene, predicate = () => true) {
    const box = new THREE.Box3();
    if (!scene) return _boxInfo(box);

    scene.updateMatrixWorld?.(true);
    scene.traverse?.((object) => {
        if (predicate(object)) box.expandByObject(object);
    });

    return _boxInfo(box);
}

function _boxInfo(box) {
    const empty = box.isEmpty();
    const center = empty ? [0, 0, 0] : box.getCenter(new THREE.Vector3()).toArray();
    return {
        empty,
        min: empty ? [0, 0, 0] : box.min.toArray(),
        max: empty ? [0, 0, 0] : box.max.toArray(),
        center,
        isEmpty: () => empty,
    };
}

export class SectionPlaneHelperActor extends THREE.Group {
    constructor({ axis = "x", width = 1, height = 1, color = 0xffffff, opacity = 0.12 } = {}) {
        super();
        this.name = "clip_plane_helper";
        this.isSectionPlaneHelperActor = true;

        const planeGeo = new THREE.PlaneGeometry(width, height);
        const planeMat = new THREE.MeshBasicMaterial({
            color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity,
            depthWrite: false,
        });
        this.add(new THREE.Mesh(planeGeo, planeMat));

        const hw = width / 2;
        const hh = height / 2;
        const edgesGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-hw, -hh, 0),
            new THREE.Vector3(hw, -hh, 0),
            new THREE.Vector3(hw, hh, 0),
            new THREE.Vector3(-hw, hh, 0),
        ]);
        const lineMat = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.6,
        });
        this.add(new THREE.LineLoop(edgesGeo, lineMat));

        this.setAxis(axis);
    }

    setAxis(axis) {
        if (axis === "x") this.lookAt(1, 0, 0);
        if (axis === "y") this.lookAt(0, 1, 0);
        if (axis === "z") this.lookAt(0, 0, 1);
        return this;
    }

    setPositionArray(position) {
        this.position.set(position[0], position[1], position[2]);
        return this;
    }

    dispose() {
        this.traverse((child) => {
            child.geometry?.dispose?.();
            const material = child.material;
            if (Array.isArray(material)) material.forEach((m) => m.dispose?.());
            else material?.dispose?.();
        });
    }
}
