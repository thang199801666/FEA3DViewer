import * as THREE from 'three';

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
* Animation
* Tween CameraState (target, quaternion, distance) + camera.zoom bằng easing,
* dùng cho chuyển view mượt (Standard Views, Zoom Fit, Zoom Window).
* Quaternion dùng slerp -> luôn đi theo đường ngắn nhất, không lật camera.
*/
export class Animation {
    constructor(controller) {
        this.controller = controller;
        this.active = false;
        this.duration = 400;
        this.startTime = 0;
        this.from = null;
        this.to = null;
        this.fromZoom = 1;
        this.toZoom = 1;
        this.onComplete = null;
        this._raf = null;
    }
    
    animateTo(targetState, targetZoom, duration = 400, onComplete = null) {
        this.stop();
        const c = this.controller;
        this.from = c.state.clone();
        this.to = targetState.clone();
        this.fromZoom = c.camera.zoom;
        this.toZoom = targetZoom;
        this.duration = duration;
        this.onComplete = onComplete;
        this.startTime = performance.now();
        this.active = true;
        this._tick();
    }
    
    stop() {
        this.active = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
    }
    
    _tick = () => {
        if (!this.active) return;
        const c = this.controller;
        const elapsed = performance.now() - this.startTime;
        const t = Math.min(1, elapsed / this.duration);
        const k = easeInOutCubic(t);
        
        c.state.target.lerpVectors(this.from.target, this.to.target, k);
        c.state.quaternion.copy(this.from.quaternion).slerp(this.to.quaternion, k);
        c.state.distance = THREE.MathUtils.lerp(this.from.distance, this.to.distance, k);
        c.state.up.set(0, 1, 0).applyQuaternion(c.state.quaternion);
        c.state.eye.copy(c.state.target).add(
            new THREE.Vector3(0, 0, 1).applyQuaternion(c.state.quaternion).multiplyScalar(c.state.distance)
        );
        
        const zoom = THREE.MathUtils.lerp(this.fromZoom, this.toZoom, k);
        if (Number.isFinite(zoom) && zoom > 0) {
            c.camera.zoom = zoom;
            c.camera.updateProjectionMatrix();
        }
        
        c._afterStateChange();     // thay cho 3 dòng gọi tay ở trên — giờ sẽ bắn 'change' mỗi tick
        
        if (t >= 1) {
            this.active = false;
            if (this.onComplete) this.onComplete();
            return;
        }
        this._raf = requestAnimationFrame(this._tick);
    };
}
