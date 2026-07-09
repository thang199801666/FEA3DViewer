import * as THREE from "three";
import { CameraState } from "./CameraState.js";
import { CameraMath } from "./CameraMath.js";
import { CameraAnimation } from "./CameraAnimation.js";
import { CameraClipping } from "./CameraClipping.js";

const _tmp = new THREE.Vector3();

export class Camera {
    /**
     * @param {THREE.Camera} threeCamera 
     * @param {HTMLElement} [domElement] 
     * @param {object} [options]
     */
    constructor(threeCamera, domElement = null, options = {}) {
        if (!threeCamera?.isCamera) {
            throw new TypeError("Camera: The first argument must be a THREE.Camera instance.");
        }
        this.three = threeCamera;
        this.domElement = domElement;
        this.onChange = options.onChange ?? null;
        this.autoClipping = options.autoClipping ?? false;
        this.animationDuration = options.animationDuration ?? 400;

        this.state = new CameraState();
        const t = options.target;
        if (t) this.state.target.copy(t.isVector3 ? t : new THREE.Vector3(...t));
        else this.state.target.set(0, 0, 0);
        this._pullFromThree();

        this.animation = new CameraAnimation(this);
        this.clipping = new CameraClipping(this);
        this._boundingSphere = null;
        this._listeners = new Map();

        if (options.autoResize && domElement && typeof ResizeObserver !== "undefined") {
            this._resizeObserver = new ResizeObserver(() => {
                const w = domElement.clientWidth, h = domElement.clientHeight;
                if (w && h) this.setAspect(w / h);
            });
            this._resizeObserver.observe(domElement);
        }
    }

    // ── Event Emitter ────────────────────────────────────────────────────────
    addEventListener(name, cb) {
        if (!this._listeners.has(name)) this._listeners.set(name, new Set());
        this._listeners.get(name).add(cb);
        return this;
    }

    removeEventListener(name, cb) { 
        this._listeners.get(name)?.delete(cb); 
        return this; 
    }

    dispatchEvent(name, ...args) { 
        this._listeners.get(name)?.forEach((cb) => cb(...args)); 
    }

    // ── Bidirectional Synchronization ────────────────────────────────────────

    /** Sync State -> Three (Triggered after state modifications) */
    _afterStateChange() {
        const s = this.state;
        if (!s.isValid()) return;

        this.three.position.copy(s.eye);
        this.three.quaternion.copy(s.quaternion);
        this.three.up.copy(s.up);
        this.three.updateMatrixWorld(true);

        if (this.autoClipping) this.clipping.update(this._boundingSphere);

        this.onChange?.();
        this.dispatchEvent("change", s);
    }

    /** Sync Three -> State (Triggered when external source modifies the raw three camera) */
    _pullFromThree() {
        const s = this.state;
        const t = this.three;
        t.updateMatrixWorld(true);
        s.eye.copy(t.position);
        s.quaternion.copy(t.quaternion).normalize();
        s.up.set(0, 1, 0).applyQuaternion(s.quaternion);
        const d = s.eye.distanceTo(s.target);
        s.distance = d > 1e-6 ? d : 10;
        return this;
    }

    syncFromThree() {
        this._pullFromThree();
        if (this.autoClipping) this.clipping.update(this._boundingSphere);
        this.dispatchEvent("change", this.state);
        return this;
    }

    setFromThree() { 
        return this.syncFromThree(); 
    }

    // ── Navigation Methods ───────────────────────────────────────────────────

    rotateLocal(yaw, pitch) {
        CameraMath.orbitLocal(this.state, yaw, pitch);
        this._afterStateChange();
        return this;
    }

    orbit(deltaQuat) {
        CameraMath.orbit(this.state, deltaQuat);
        this._afterStateChange();
        return this;
    }

    pan(dxPx, dyPx) {
        const h = this.domElement?.clientHeight || 1;
        CameraMath.pan(this.state, { x: dxPx, y: dyPx }, h, this.three);
        this._afterStateChange();
        return this;
    }

    dolly(factor, cursorNDC = null) {
        CameraMath.dolly(this.state, factor, this.three, cursorNDC);
        this._afterStateChange();
        return this;
    }

    getNDC(clientX, clientY, out = new THREE.Vector2()) {
        const r = this.domElement?.getBoundingClientRect?.();
        if (!r || !r.width || !r.height) return out.set(0, 0);
        return out.set(
            ((clientX - r.left) / r.width) * 2 - 1,
            -((clientY - r.top) / r.height) * 2 + 1
        );
    }

    zoomToWindow(rectPx, duration = this.animationDuration) {
        const min = this.getNDC(rectPx.x, rectPx.y + rectPx.height, new THREE.Vector2());
        const max = this.getNDC(rectPx.x + rectPx.width, rectPx.y, new THREE.Vector2());
        const res = CameraMath.fitWindow(this.state, this.three, min, max);
        if (!res) return this;
        this.animation.animateTo(res.state, res.zoom, duration);
        return this;
    }

    zoomFit(box, padding = 1.2, duration = this.animationDuration) {
        const res = CameraMath.fitBox(this.state, this.three, box, padding);
        if (!res) return this;
        this.animation.animateTo(res.state, res.zoom, duration);
        return this;
    }

    setStandardView(name, duration = this.animationDuration) {
        const target = this.state.clone();
        target.quaternion.copy(CameraMath.standardViewQuaternion(name));
        CameraMath.applyQuaternionToEye(target);
        this.animation.animateTo(target, this.three.zoom, duration);
        return this;
    }

    // ── Bounding Sphere & Clipping ───────────────────────────────────────────

    setBoundingSphere(sphere) { 
        this._boundingSphere = sphere ?? null; 
        return this; 
    }

    updateClipping(sphere = this._boundingSphere) {
        this._boundingSphere = sphere ?? this._boundingSphere;
        this.clipping.update(this._boundingSphere);
        return this;
    }

    // ── VTK Architecture Layer compatibility ─────────────────────────────────

    getThreeCamera() { 
        return this.three; 
    }

    getFocalPoint() { 
        return this.state.target.clone(); 
    }
    
    setFocalPoint(x, y, z) {
        if (x?.isVector3) this.state.target.copy(x); else this.state.target.set(x, y, z);
        this.state.distance = this.state.eye.distanceTo(this.state.target);
        this._afterStateChange();
        return this;
    }

    getDistance() { 
        return this.three.position.distanceTo(this.state.target); 
    }

    setAspect(aspect) {
        const c = this.three;
        if (c.isOrthographicCamera) {
            const halfH = (c.top - c.bottom) / 2;
            c.left = -halfH * aspect;
            c.right = halfH * aspect;
            c.updateProjectionMatrix();
        } else if (c.isPerspectiveCamera) {
            c.aspect = aspect;
            c.updateProjectionMatrix();
        }
        return this;
    }

    setClippingRange(near, far) {
        this.three.near = near;
        this.three.far = far;
        this.three.updateProjectionMatrix();
        return this;
    }
    
    getClippingRange() { 
        return [this.three.near, this.three.far]; 
    }

    reset(center, distance) {
        const c = this.three;
        this.state.target.copy(center);
        const dir = _tmp.subVectors(c.position, center);
        if (dir.lengthSq() < 1e-8) dir.set(1, 1, 1);
        dir.normalize().multiplyScalar(distance || 1);
        c.position.copy(center).add(dir);
        c.lookAt(center);
        c.updateMatrixWorld(true);
        this._pullFromThree();
        this.dispatchEvent("change", this.state);
        return this;
    }

    dispose() {
        this.animation.stop();
        this._resizeObserver?.disconnect();
        this._listeners.clear();
        this.onChange = null;
    }
}

export default Camera;