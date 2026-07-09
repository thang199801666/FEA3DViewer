import * as THREE from 'three';
import { InteractorStyle } from "./InteractorStyle.js";
import { InputStyleHandler } from "./InputStyleHandler.js";
import { INTERACTION_ACTION, NAV_STATE as STATE, RUBBER_BAND_MODE } from "./constants.js";

export { RUBBER_BAND_MODE };

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const ROTATE_RAD_PER_PX = 0.006;
const MAX_DELTA_PX = 120;
const INERTIA_IDLE_MS = 80;
const CLICK_GUARD_MS = 150;
const POLAR_EPS = 0.02;

export class InteractorStyleOrbit extends InteractorStyle {
  constructor(camera, options = {}) {
    super();
    this.cadCamera = camera;

    this.rotateSpeed = options.rotateSpeed ?? 1.0;
    this.panSpeed = options.panSpeed ?? 1.0;
    this.zoomSpeed = options.zoomSpeed ?? 1.0;

    this.enableDamping = options.enableDamping ?? false;
    this.inertiaDecay = options.inertiaDecay ?? 0.9;

    // 'trackball': free rotation, 'turntable': locked around world Y-axis
    this.rotateMode = options.rotateMode ?? 'trackball';
    this.enableZoomWindow = options.enableZoomWindow ?? true;

    this.inputHandler = new InputStyleHandler(options.navStyle);

    this._state = STATE.NONE;
    this._lastClient = new THREE.Vector2();
    this._lastMoveTime = 0;
    this._gestureMoved = false;
    this._gestureEndTime = 0;

    this._pointers = new Map();
    this._pinchStartDist = 0;
    this._touchPanLast = new THREE.Vector2();

    this.rotateVelocity = new THREE.Vector2();
    this.panVelocity = new THREE.Vector2();
    this._inertiaActive = null;
    this._inertiaVelocity = new THREE.Vector2();
    this._inertiaRaf = null;

    this.marqueeStart = new THREE.Vector2();
    this.marqueeEnd = new THREE.Vector2();
    this.onMarqueeUpdate = options.onMarqueeUpdate || null;
    this.onMarqueeEnd = options.onMarqueeEnd || null;

    // Rubber band selection options
    this.enableRubberBand = options.enableRubberBand ?? true;
    this.rubberBandThreshold = options.rubberBandThreshold ?? 5;
    this.getSelectableObjects = options.getSelectableObjects || null;
    this.rubberBandFilter = options.rubberBandFilter || ((o) => o.visible && o.name !== 'system_grid');
    this.onRubberBandUpdate = options.onRubberBandUpdate || null;
    this.onRubberBandEnd = options.onRubberBandEnd || null;
    this.onRubberBandSelect = options.onRubberBandSelect || null;

    this._rubberArmed = false;
    this._rubberStart = new THREE.Vector2();
    this._rubberEnd = new THREE.Vector2();

    // Global event listeners to prevent stuck interaction states
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onWindowPointerUp = (e) => {
      if (this._pointers.has(e.pointerId)) this._pointerUp(e);
    };
    this._onWindowPointerCancel = () => this._forceRelease();
    this._onWindowBlur = () => this._forceRelease();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('pointerup', this._onWindowPointerUp, true);
    window.addEventListener('pointercancel', this._onWindowPointerCancel, true);
    window.addEventListener('blur', this._onWindowBlur);
  }

  get domElement() {
    return this.cadCamera.domElement;
  }

  setNavStyle(style) {
    this.inputHandler.setStyle(style);
  }

  setDamping(enabled) {
    this.enableDamping = enabled;
    if (!enabled) this._stopInertia();
  }

  isNavigating() {
    if (this._state !== STATE.NONE || this._inertiaActive !== null) return true;
    return performance.now() - this._gestureEndTime < CLICK_GUARD_MS;
  }

  onLeftButtonDown(e) { this._pointerDown(e); }
  onMiddleButtonDown(e) { this._pointerDown(e); }
  onRightButtonDown(e) { this._pointerDown(e); }

  onLeftButtonUp(e) { this._pointerUp(e); }
  onMiddleButtonUp(e) { this._pointerUp(e); }
  onRightButtonUp(e) { this._pointerUp(e); }

  _pointerDown(e) {
    this._stopInertia();
    this.cadCamera.animation.stop();

    // Synchronize to prevent first-frame interaction jumps
    this._syncFacadeWithThree();

    this._pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      type: e.pointerType,
    });

    if (this._pointers.size === 1) {
      this._lastClient.set(e.clientX, e.clientY);
      this._lastMoveTime = 0;
      this._gestureMoved = false;
      this.rotateVelocity.set(0, 0);
      this.panVelocity.set(0, 0);

      if (e.pointerType === 'touch') {
        this._state = STATE.TOUCH_ROTATE;
      } else {
        this._state = this._actionToState(this.inputHandler.determineAction(e));
        if (this._state === STATE.ZOOM_WINDOW) {
          this.marqueeStart.set(e.clientX, e.clientY);
          this.marqueeEnd.copy(this.marqueeStart);
        }

        if (this._state === STATE.NONE && this.enableRubberBand && e.buttons === 1) {
          this._rubberArmed = true;
          this._rubberStart.set(e.clientX, e.clientY);
          this._rubberEnd.copy(this._rubberStart);
        }
      }
    } else if (this._pointers.size === 2 && e.pointerType === 'touch') {
      this._state = STATE.TOUCH_PAN_ZOOM;
      const pts = Array.from(this._pointers.values());
      this._pinchStartDist = this._dist(pts[0], pts[1]);
      this._touchPanLast.set((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
    }

    if (this._state !== STATE.NONE) {
      this._capturePointer(e.pointerId);
    }
  }

  _pointerUp(e) {
    if (!this._pointers.has(e.pointerId)) return;

    this._releasePointer(e.pointerId);
    const endedState = this._state;

    if (endedState === STATE.ZOOM_WINDOW) {
      const rect = this._getMarqueeRect();
      if (rect.width > 4 && rect.height > 4 && typeof this.cadCamera.zoomToWindow === 'function') {
        this.cadCamera.zoomToWindow(rect);
      }
      if (this.onMarqueeEnd) this.onMarqueeEnd();
    }

    if (endedState === STATE.RUBBER_BAND) {
      this._rubberEnd.set(e.clientX, e.clientY);
      if (this.onRubberBandEnd) this.onRubberBandEnd();

      const rect = this._getRubberRect();
      const mode = this._getRubberMode();
      if (rect.width > 2 && rect.height > 2) {
        const additive = e.shiftKey || e.ctrlKey;
        let selected = [];
        if (this.getSelectableObjects) {
          selected = this.computeRectSelection(this.getSelectableObjects(), rect, mode);
        }
        if (this.onRubberBandSelect) {
          this.onRubberBandSelect(selected, { rect, mode, additive });
        }
      }
    }
    this._rubberArmed = false;
    this._pointers.delete(e.pointerId);

    if (this._pointers.size === 0) {
      this._state = STATE.NONE;
    } else if (this._pointers.size === 1) {
      const [p] = this._pointers.values();
      this._lastClient.set(p.x, p.y);
      this._pinchStartDist = 0;
      this._state = p.type === 'touch' ? STATE.TOUCH_ROTATE : STATE.NONE;
    }

    if (endedState !== STATE.NONE && this._gestureMoved) {
      this._gestureEndTime = performance.now();
    }

    if (this.enableDamping && performance.now() - this._lastMoveTime < INERTIA_IDLE_MS) {
      if (endedState === STATE.ROTATE || endedState === STATE.TOUCH_ROTATE) {
        this._startInertia('rotate', this.rotateVelocity);
      } else if (endedState === STATE.PAN) {
        this._startInertia('pan', this.panVelocity);
      }
    }

    this.interactor?.render?.();
  }

  onMouseMove(e) {
    if (e.pointerType !== 'touch' && e.buttons === 0) {
      if (this._state !== STATE.NONE || this._pointers.size > 0) {
        this._forceRelease();
      }
      return;
    }

    if (!this._pointers.has(e.pointerId)) return;

    this._pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      type: e.pointerType,
    });

    // Dynamic mapping adjustments for multi-button navigation styles (e.g., NX)
    if (e.pointerType !== 'touch' && this._pointers.size === 1 && (e.buttons & 1) === 0) {
      const next = this._actionToState(this.inputHandler.determineAction(e));
      if (next !== this._state) {
        if (this._state === STATE.ZOOM_WINDOW && this.onMarqueeEnd) this.onMarqueeEnd();
        if (next === STATE.ZOOM_WINDOW) {
          this.marqueeStart.set(e.clientX, e.clientY);
          this.marqueeEnd.copy(this.marqueeStart);
        }
        this.rotateVelocity.set(0, 0);
        this.panVelocity.set(0, 0);
        this._state = next;
      }
    }

    if (this._state === STATE.NONE && this._rubberArmed && (e.buttons & 1) !== 0) {
      const moved = Math.hypot(e.clientX - this._rubberStart.x, e.clientY - this._rubberStart.y);
      if (moved > this.rubberBandThreshold) {
        this._state = STATE.RUBBER_BAND;
        this._capturePointer(e.pointerId);
      }
    }

    if (this._state === STATE.NONE) {
      this._lastClient.set(e.clientX, e.clientY);
      return;
    }

    const dx = e.clientX - this._lastClient.x;
    const dy = e.clientY - this._lastClient.y;
    if (dx !== 0 || dy !== 0) this._gestureMoved = true;

    if (
      this._state !== STATE.ZOOM_WINDOW &&
      this._state !== STATE.RUBBER_BAND &&
      (Math.abs(dx) > MAX_DELTA_PX || Math.abs(dy) > MAX_DELTA_PX)
    ) {
      this._lastClient.set(e.clientX, e.clientY);
      return;
    }

    switch (this._state) {
      case STATE.ROTATE:
      case STATE.TOUCH_ROTATE:
        this._rotate(dx, dy);
        this.rotateVelocity.set(dx, dy);
        this._lastMoveTime = performance.now();
        break;

      case STATE.PAN:
        this._pan(dx, dy);
        this.panVelocity.set(dx, dy);
        this._lastMoveTime = performance.now();
        break;

      case STATE.ZOOM_WINDOW:
        this.marqueeEnd.set(e.clientX, e.clientY);
        if (this.onMarqueeUpdate) this.onMarqueeUpdate(this._getMarqueeRect());
        break;

      case STATE.RUBBER_BAND:
        this._rubberEnd.set(e.clientX, e.clientY);
        if (this.onRubberBandUpdate) {
          this.onRubberBandUpdate(this._getRubberRect(), this._getRubberMode());
        }
        break;

      case STATE.TOUCH_PAN_ZOOM: {
        const pts = Array.from(this._pointers.values());
        if (pts.length < 2) break;

        const dist = this._dist(pts[0], pts[1]);
        const scale = dist / Math.max(this._pinchStartDist, 1e-6);
        if (Number.isFinite(scale) && scale > 0) {
          this.cadCamera.dolly(scale, null);
        }
        this._pinchStartDist = dist;

        const center = new THREE.Vector2((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
        this._pan(center.x - this._touchPanLast.x, center.y - this._touchPanLast.y);
        this._touchPanLast.copy(center);
        break;
      }
    }

    this._lastClient.set(e.clientX, e.clientY);
    this.interactor?.render?.();
  }

  onWheel(e) {
    this._stopInertia();
    this.cadCamera.animation.stop();
    this._syncFacadeWithThree();
    const ndc = this.cadCamera.getNDC(e.clientX, e.clientY);
    const factor = Math.pow(0.999, -e.deltaY * this.zoomSpeed * 0.5);
    this.cadCamera.dolly(factor, ndc);
    this.interactor?.render?.();
  }

  _rotate(dx, dy) {
    const yaw = dx * ROTATE_RAD_PER_PX * this.rotateSpeed;
    const pitch = dy * ROTATE_RAD_PER_PX * this.rotateSpeed;

    if (this.rotateMode !== 'turntable') {
      this.cadCamera.rotateLocal(yaw, pitch);
      return;
    }

    const s = this.cadCamera.state;
    let pitchWorld = -pitch;

    const offsetDir = new THREE.Vector3(0, 0, 1).applyQuaternion(s.quaternion);
    const phi = offsetDir.angleTo(WORLD_UP);
    pitchWorld = THREE.MathUtils.clamp(pitchWorld, POLAR_EPS - phi, Math.PI - POLAR_EPS - phi);

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(s.quaternion);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(right, pitchWorld);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, -yaw);

    s.quaternion.premultiply(qPitch).premultiply(qYaw).normalize();
    this.cadCamera.rotateLocal(0, 0);
  }

  _pan(dx, dy) {
    this.cadCamera.pan(dx * this.panSpeed, dy * this.panSpeed);
  }

  _getRubberRect() {
    const x1 = Math.min(this._rubberStart.x, this._rubberEnd.x);
    const y1 = Math.min(this._rubberStart.y, this._rubberEnd.y);
    const x2 = Math.max(this._rubberStart.x, this._rubberEnd.x);
    const y2 = Math.max(this._rubberStart.y, this._rubberEnd.y);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  _getRubberMode() {
    return this._rubberEnd.x >= this._rubberStart.x ? RUBBER_BAND_MODE.CROSSING : RUBBER_BAND_MODE.WINDOW;
  }

  computeRectSelection(objects, rectPx, mode) {
    if (!Array.isArray(objects) || objects.length === 0) return [];

    const cam = this.cadCamera.three;
    const dom = this.domElement;
    if (!cam || !dom) return [];

    cam.updateMatrixWorld(true);
    const domRect = dom.getBoundingClientRect();
    const rL = rectPx.x;
    const rT = rectPx.y;
    const rR = rectPx.x + rectPx.width;
    const rB = rectPx.y + rectPx.height;

    const box = new THREE.Box3();
    const corner = new THREE.Vector3();
    const selected = [];

    for (const obj of objects) {
      if (!obj || !this.rubberBandFilter(obj)) continue;

      box.setFromObject(obj);
      if (box.isEmpty()) continue;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z
        );
        corner.project(cam);
        const px = domRect.left + ((corner.x + 1) / 2) * domRect.width;
        const py = domRect.top + ((1 - corner.y) / 2) * domRect.height;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }

      const hit = mode === RUBBER_BAND_MODE.WINDOW
          ? minX >= rL && maxX <= rR && minY >= rT && maxY <= rB
          : minX <= rR && maxX >= rL && minY <= rB && maxY >= rT;

      if (hit) selected.push(obj);
    }

    return selected;
  }

  _handleKeyDown(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    const c = this.cadCamera;
    const step = 20;
    let handled = true;

    switch (e.key) {
      case 'ArrowLeft':  this._pan(-step, 0); break;
      case 'ArrowRight': this._pan(step, 0); break;
      case 'ArrowUp':    this._pan(0, -step); break;
      case 'ArrowDown':  this._pan(0, step); break;
      case '+': case '=': c.dolly(1.1, null); break;
      case '-': case '_': c.dolly(1 / 1.1, null); break;
      case '1': c.setStandardView('front'); break;
      case '2': c.setStandardView('back'); break;
      case '3': c.setStandardView('left'); break;
      case '4': c.setStandardView('right'); break;
      case '5': c.setStandardView('top'); break;
      case '6': c.setStandardView('bottom'); break;
      case '0': c.setStandardView('iso'); break;
      default:
        handled = false;
        return;
    }

    if (handled) {
      this.interactor?.render?.();
    }
  }

  _startInertia(type, velocity) {
    if (velocity.lengthSq() < 0.5) return;
    this._inertiaActive = type;
    this._inertiaVelocity.copy(velocity);
    this._inertiaTick();
  }

  _stopInertia() {
    this._inertiaActive = null;
    if (this._inertiaRaf) cancelAnimationFrame(this._inertiaRaf);
    this._inertiaRaf = null;
  }

  _inertiaTick = () => {
    if (!this._inertiaActive) return;
    this._inertiaVelocity.multiplyScalar(this.inertiaDecay);
    if (this._inertiaActive === 'rotate') {
      this._rotate(this._inertiaVelocity.x, this._inertiaVelocity.y);
    } else if (this._inertiaActive === 'pan') {
      this._pan(this._inertiaVelocity.x, this._inertiaVelocity.y);
    }
    this.interactor?.render?.();
    if (this._inertiaVelocity.lengthSq() < 0.02) {
      this._inertiaActive = null;
      this._inertiaRaf = null;
      return;
    }
    this._inertiaRaf = requestAnimationFrame(this._inertiaTick);
  };

  _syncFacadeWithThree() {
    const s = this.cadCamera.state;
    const t = this.cadCamera.three;
    if (!t) return;
    t.updateMatrixWorld();

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(t.quaternion);
    const offset  = new THREE.Vector3().subVectors(s.eye, s.target);

    const ok =
      t.position.distanceToSquared(s.eye) <= 1e-10 &&
      Math.abs(t.quaternion.dot(s.quaternion)) >= 1 - 1e-7 &&
      Math.abs(offset.length() - s.distance) < 1e-4 &&
      offset.normalize().dot(forward) < -1 + 1e-4;
    if (ok) return;

    s.quaternion.copy(t.quaternion).normalize();
    s.eye.copy(t.position);
    s.up.set(0, 1, 0).applyQuaternion(s.quaternion);

    // Prioritize keeping the current pivot: project it onto the new viewing ray
    let depth = new THREE.Vector3().subVectors(s.target, t.position).dot(forward);

    if (!Number.isFinite(depth) || depth < 1e-3) {
      const bs = this.cadCamera._boundingSphere;
      const center = (bs && bs.radius > 0) ? bs.center : new THREE.Vector3();
      depth = new THREE.Vector3().subVectors(center, t.position).dot(forward);
    }
    if (!Number.isFinite(depth) || depth < 1e-3) {
      const bs = this.cadCamera._boundingSphere;
      depth = (bs && bs.radius > 0) ? bs.radius : 10;
    }

    s.distance = depth;
    s.target.copy(t.position).addScaledVector(forward, depth); // Force target back onto the exact view ray
  }

  _actionToState(action) {
    switch (action) {
      case INTERACTION_ACTION.ROTATE:      return STATE.ROTATE;
      case INTERACTION_ACTION.PAN:         return STATE.PAN;
      case INTERACTION_ACTION.ZOOM_WINDOW: return this.enableZoomWindow ? STATE.ZOOM_WINDOW : STATE.NONE;
      default:                             return STATE.NONE;
    }
  }

  _capturePointer(pointerId) {
    try { this.domElement?.setPointerCapture?.(pointerId); } catch {}
  }

  _releasePointer(pointerId) {
    try { this.domElement?.releasePointerCapture?.(pointerId); } catch {}
  }

  _forceRelease() {
    if (this._state === STATE.ZOOM_WINDOW && this.onMarqueeEnd) this.onMarqueeEnd();
    if (this._state === STATE.RUBBER_BAND && this.onRubberBandEnd) this.onRubberBandEnd();
    this._rubberArmed = false;

    for (const id of this._pointers.keys()) {
      this._releasePointer(id);
    }
    this._pointers.clear();
    this._state = STATE.NONE;
    this._pinchStartDist = 0;
    this.rotateVelocity.set(0, 0);
    this.panVelocity.set(0, 0);
    this._stopInertia();
  }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  _getMarqueeRect() {
    const x1 = Math.min(this.marqueeStart.x, this.marqueeEnd.x);
    const y1 = Math.min(this.marqueeStart.y, this.marqueeEnd.y);
    const x2 = Math.max(this.marqueeStart.x, this.marqueeEnd.x);
    const y2 = Math.max(this.marqueeStart.y, this.marqueeEnd.y);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('pointerup', this._onWindowPointerUp, true);
    window.removeEventListener('pointercancel', this._onWindowPointerCancel, true);
    window.removeEventListener('blur', this._onWindowBlur);
    this._forceRelease();
  }
}

export default InteractorStyleOrbit;