import * as THREE from "three";

const _tmp = new THREE.Vector3();

export const VTK_CAMERA_API = {
    getThreeCamera() { 
        return this.three; 
    },

    getFocalPoint() {
        return (this.state?.target ?? new THREE.Vector3()).clone();
    },

    setFocalPoint(x, y, z) {
        const t = this.state?.target;
        if (!t) throw new Error("Camera.setFocalPoint: state.target is undefined");
        if (x?.isVector3) t.copy(x); else t.set(x, y, z);
        this._afterStateChange?.();
        return this;
    },

    getDistance() {
        return this.three.position.distanceTo(this.getFocalPoint());
    },

    setFromThree() {
        if (typeof this.syncFromThree === "function") return this.syncFromThree();
        this.three.updateMatrixWorld(true);
        return this;
    },

    setAspect(aspect) {
        const c = this.three;
        if (this.type === 'orthographic' || c.isOrthographicCamera) {
            const halfH = (c.top - c.bottom) / 2;
            c.left = -halfH * aspect;
            c.right = halfH * aspect;
            c.updateProjectionMatrix();
        } else if (this.type === 'perspective' || c.isPerspectiveCamera) {
            c.aspect = aspect;
            c.updateProjectionMatrix();
        }
        return this;
    },

    setClippingRange(near, far) {
        const c = this.three;
        c.near = near;
        c.far = far;
        c.updateProjectionMatrix();
        return this;
    },

    getClippingRange() { 
        return [this.three.near, this.three.far]; 
    },

    reset(center, distance) {
        const c = this.three;
        if (this.state?.target) this.state.target.copy(center);
        const dir = _tmp.subVectors(c.position, center);
        if (dir.lengthSq() < 1e-8) dir.set(1, 1, 1);
        dir.normalize().multiplyScalar(distance || 1);
        c.position.copy(center).add(dir);
        c.lookAt(center);
        c.updateMatrixWorld(true);
        this.setFromThree();
        return this;
    },
};

export const REQUIRED_BY_RENDERER = ["getThreeCamera", "setAspect", "reset"];
export const REQUIRED_BY_GIZMO = ["getThreeCamera", "getFocalPoint", "getDistance", "setFromThree"];
export const REQUIRED_CAMERA_API = [...new Set([...REQUIRED_BY_RENDERER, ...REQUIRED_BY_GIZMO])];

export function missingCameraApi(camera) {
    return REQUIRED_CAMERA_API.filter((name) => typeof camera?.[name] !== "function");
}

export function applyVTKCameraApi(CameraClass) {
    const proto = CameraClass.prototype;
    for (const [name, fn] of Object.entries(VTK_CAMERA_API)) {
        if (!Object.prototype.hasOwnProperty.call(proto, name)) {
            Object.defineProperty(proto, name, {
                value: fn,
                writable: true,
                configurable: true
            });
        }
    }
}
