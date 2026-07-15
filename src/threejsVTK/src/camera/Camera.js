import * as THREE from "three";
import { CameraState } from "./CameraState.js";
import { CameraMath } from "./CameraMath.js";
import { CameraAnimation } from "./CameraAnimation.js";
import { CameraClipping } from "./CameraClipping.js";

const _tmp = new THREE.Vector3();

export class Camera {
    /**
     * @param {HTMLElement} [domElement=null]
     * @param {object} [options={}]
     * @param {'orthographic' | 'perspective'} [options.type='orthographic']
     */
    constructor(domElement = null, options = {}) {
        this.domElement = domElement;
        this.type = options.type || 'orthographic';
        this.onChange = options.onChange ?? null;
        this.autoClipping = options.autoClipping ?? false;
        this.animationDuration = options.animationDuration ?? 400;

        // 1. Create the core Three.js camera from the configured type.
        this.three = this._createThreeCamera(this.type, options.cameraArgs);

        // 2. Initialize independent camera state.
        this.state = new CameraState();
        const t = options.target;
        if (t) this.state.target.copy(t.isVector3 ? t : new THREE.Vector3(...t));
        else this.state.target.set(0, 0, 0);

        this._pullFromThree();

        // 3. Initialize helper modules.
        this.animation = new CameraAnimation(this);
        this.clipping = new CameraClipping(this);
        this._boundingSphere = null;
        this._listeners = new Map();

        if (options.autoResize && domElement && typeof ResizeObserver !== "undefined") {
            this._setupAutoResize();
        }
    }

    /**
     * Creates the matching internal Three.js camera.
     */
    _createThreeCamera(type, args = {}) {
        if (type === 'perspective') {
            return new THREE.PerspectiveCamera(
                args.fov || 45,
                args.aspect || 1,
                args.near || 0.1,
                args.far || 1000
            );
        } else {
            return new THREE.OrthographicCamera(
                args.left || -10,
                args.right || 10,
                args.top || 10,
                args.bottom || -10,
                args.near || -1000,
                args.far || 1000
            );
        }
    }

    /**
     * Switches dynamically between orthographic and perspective modes.
     * Preserves eye position, target, and orientation.
     */
    switchType(newType) {
        if (this.type === newType) return this;

        const oldThree = this.three;
        let aspect = 1;
        
        if (oldThree.isPerspectiveCamera) {
            aspect = oldThree.aspect;
        } else if (oldThree.isOrthographicCamera) {
            aspect = (oldThree.right - oldThree.left) / (oldThree.top - oldThree.bottom);
        }

        // Create the new camera instance.
        this.type = newType;
        this.three = this._createThreeCamera(newType, { aspect });

        // Copy spatial state from the previous camera.
        this.three.position.copy(oldThree.position);
        this.three.quaternion.copy(oldThree.quaternion);
        this.three.updateMatrixWorld(true);

        // Refresh clipping from the current bounding sphere when available.
        if (this.autoClipping && this._boundingSphere) {
            this.clipping.update(this._boundingSphere);
        } else {
            this.three.near = oldThree.near;
            this.three.far = oldThree.far;
            this.three.updateProjectionMatrix();
        }

        this._pullFromThree();
        this._afterStateChange();
        return this;
    }

    _setupAutoResize() {
        this._resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    this.setAspect(width / height);
                }
            }
        });
        this._resizeObserver.observe(this.domElement);
    }

    setBoundingSphere(sphere) {
        this._boundingSphere = sphere;
        if (this.autoClipping) {
            this.clipping.update(sphere);
        }
    }

    _pullFromThree() {
        const c = this.three;
        this.state.eye.copy(c.position);
        this.state.up.set(0, 1, 0).applyQuaternion(c.quaternion);
        this.state.quaternion.copy(c.quaternion);
        this.state.distance = c.position.distanceTo(this.state.target);
    }

    _afterStateChange() {
        const c = this.three;
        c.quaternion.copy(this.state.quaternion);
        c.position.copy(this.state.eye);
        c.up.copy(this.state.up);
        c.updateMatrixWorld(true);

        if (this.autoClipping && this._boundingSphere) {
            this.clipping.update(this._boundingSphere);
        }

        if (this.onChange) this.onChange(this);
    }

    syncFromThree() {
        this._pullFromThree();
        return this;
    }

    addEventListener(type, callback) {
        if (typeof callback !== "function") return this;
        if (!this._listeners.has(type)) this._listeners.set(type, new Set());
        this._listeners.get(type).add(callback);
        return this;
    }

    removeEventListener(type, callback) {
        this._listeners.get(type)?.delete(callback);
        return this;
    }

    dispatchEvent(typeOrEvent, payload = undefined) {
        const event = typeof typeOrEvent === "string"
            ? { type: typeOrEvent, payload }
            : typeOrEvent;
        if (!event?.type) return this;
        const listeners = this._listeners.get(event.type);
        if (!listeners) return this;
        for (const callback of [...listeners]) {
            callback(payload ?? event);
        }
        return this;
    }

    setFromThree() {
        return this.syncFromThree();
    }

    getThreeCamera() {
        return this.three;
    }

    setPosition(x, y, z) {
        this.three.position.set(x, y, z);
        this._pullFromThree();
        return this;
    }

    getPosition(out = [0, 0, 0]) {
        out[0] = this.three.position.x;
        out[1] = this.three.position.y;
        out[2] = this.three.position.z;
        return out;
    }

    setUp(x, y, z) {
        this.three.up.set(x, y, z);
        this._pullFromThree();
        return this;
    }

    lookAt(x, y, z) {
        if (Array.isArray(x)) this.three.lookAt(x[0], x[1], x[2]);
        else this.three.lookAt(x, y, z);
        this.three.updateMatrixWorld(true);
        this._pullFromThree();
        return this;
    }

    setLayerEnabled(layer, enabled = true) {
        if (enabled) this.three.layers.enable(layer);
        else this.three.layers.disable(layer);
        return this;
    }

    updateMatrixWorld(force = true) {
        this.three.updateMatrixWorld(force);
        return this;
    }

    getDistance() { 
        return this.three.position.distanceTo(this.state.target); 
    }

    getFocalPoint() {
        return this.state.target.clone();
    }

    setFocalPoint(x, y, z) {
        if (x?.isVector3) this.state.target.copy(x);
        else this.state.target.set(x, y, z);
        this.state.distance = this.three.position.distanceTo(this.state.target);
        this._afterStateChange();
        return this;
    }

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
        this._afterStateChange();
        return this;
    }

    // Navigation helpers used by interactor styles.

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

    dispose() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }
        this.animation.stop();
        this._listeners.clear();
    }
}

export default Camera;
