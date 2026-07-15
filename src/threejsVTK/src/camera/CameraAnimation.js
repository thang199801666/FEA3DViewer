import * as THREE from 'three';
import { CameraMath } from "./CameraMath.js";

const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export class CameraAnimation {
  constructor(camera) {
    this.camera = camera;
    this._raf = null;
    this._active = false;
  }

  get isAnimating() {
    return this._active;
  }

  animateTo(targetState, targetZoom, duration = 400) {
    this.stop();

    const cam = this.camera;
    const from = cam.state.clone();
    const fromZoom = cam.three.zoom;

    if (!targetState.isValid() || !Number.isFinite(targetZoom) || targetZoom <= 0) {
      return;
    }
    if (duration <= 0) {
      cam.state.copy(targetState);
      cam.three.zoom = targetZoom;
      cam.three.updateProjectionMatrix();
      cam._afterStateChange();
      return;
    }

    const startTime = performance.now();
    this._active = true;

    const tick = (now) => {
      if (!this._active) return;

      const t = Math.min((now - startTime) / duration, 1);
      const k = easeInOutCubic(t);
      const s = cam.state;

      s.quaternion.slerpQuaternions(from.quaternion, targetState.quaternion, k);
      s.target.lerpVectors(from.target, targetState.target, k);
      s.distance = THREE.MathUtils.lerp(from.distance, targetState.distance, k);
      CameraMath.applyQuaternionToEye(s);

      cam.three.zoom = THREE.MathUtils.lerp(fromZoom, targetZoom, k);
      cam.three.updateProjectionMatrix();

      cam._afterStateChange();

      if (t < 1) {
        this._raf = requestAnimationFrame(tick);
      } else {
        this._active = false;
        this._raf = null;
      }
    };

    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this._active && this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
      this._active = false;
    }
  }
}
