import * as THREE from 'three';
import { CameraState } from './CameraController/CameraState.js';
import { CameraMath } from './CameraController/CameraMath.js';
import { MouseController } from './CameraController/MouseController.js';
import { Animation } from './CameraController/Animation.js';
import { Clipping } from './CameraController/Clipping.js';
import { Picking } from './CameraController/Picking.js';

/**
 * CameraController
 * Điều phối chính: CameraState (nguồn sự thật) <-> OrthographicCamera thật.
 * Chỉ hỗ trợ OrthographicCamera (theo yêu cầu: Front/Back/Left/Right/Top/Bottom/Iso
 * kiểu kỹ thuật/CAD, không phối cảnh).
 *
 * Không dùng OrbitControls / ArcballControls — toàn bộ input + toán học tự viết.
 */
export class CameraController {
  /**
   * @param {THREE.OrthographicCamera} camera
   * @param {HTMLElement} domElement  canvas hoặc container nhận sự kiện input
   * @param {Object} [options]
   * @param {function} [options.onChange]              (state) => void, mỗi khi state đổi
   * @param {function} [options.onOrientationChange]   (quaternion) => void, để sync orientation widget (view cube)
   * @param {function} [options.renderCallback]         () => void, gọi renderer.render() ở đây
   * @param {boolean}  [options.autoResize=true]        tự resize theo domElement
   */
  constructor(camera, domElement, options = {}) {
    if (!camera.isOrthographicCamera) {
      throw new Error('CameraController chỉ hỗ trợ THREE.OrthographicCamera.');
    }

    this.camera = camera;
    this.domElement = domElement;

    // ---- Khởi tạo state từ vị trí camera hiện tại ----
    this.state = new CameraState();
    this.state.target.set(0, 0, 0);
    const initDir = new THREE.Vector3().subVectors(camera.position, this.state.target);
    this.state.distance = initDir.length() > 1e-8 ? initDir.length() : 10;
    if (initDir.lengthSq() < 1e-8) initDir.set(1, 1, 1);
    initDir.normalize();

    const m = new THREE.Matrix4().lookAt(initDir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    this.state.quaternion.setFromRotationMatrix(m);
    CameraMath.applyQuaternionToEye(this.state);

    // ---- Sub-modules ----
    this.mouse = new MouseController(this);
    this.animation = new Animation(this);
    this.clipping = new Clipping(this);
    this.picking = new Picking(this);

    // ---- Callbacks ----
    this.onChange = options.onChange || null;
    this.onOrientationChange = options.onOrientationChange || null;
    this.renderCallback = options.renderCallback || null;

    // ---- Inertia ----
    this._inertiaActive = null; // 'rotate' | 'pan' | null
    this._inertiaVelocity = new THREE.Vector2();
    this._inertiaRaf = null;

    this._boundingSphere = null;

    this._listeners = {};

    this._applyStateToCamera();
    this._updateClipping();

    if (options.autoResize !== false) this._setupResizeObserver();
  }

  // ================= PUBLIC API =================

  /** Cập nhật bounding sphere (world-space) của scene để auto-clipping hoạt động. */
  setBoundingSphere(sphere) {
    this._boundingSphere = sphere;
    this._updateClipping();
  }

  /** Zoom Fit: đưa object/box vào giữa khung nhìn vừa khít (camera-space AABB). */
  zoomFit(objectOrBox, { padding = 1.2, animate = true, duration = 400 } = {}) {
    const box = objectOrBox.isBox3 ? objectOrBox : new THREE.Box3().setFromObject(objectOrBox);
    const result = CameraMath.fitBox(this.state, this.camera, box, padding);
    if (!result) return;
    this._finishTransition(result.state, result.zoom, animate, duration);
  }

  /** Zoom Window: rectDOM = {x, y, width, height} theo tọa độ client (px). */
  zoomToWindow(rectDOM, { animate = true, duration = 300 } = {}) {
    const rect = this.domElement.getBoundingClientRect();
    const ndcMin = new THREE.Vector2(
      ((rectDOM.x - rect.left) / rect.width) * 2 - 1,
      -((rectDOM.y + rectDOM.height - rect.top) / rect.height) * 2 + 1
    );
    const ndcMax = new THREE.Vector2(
      ((rectDOM.x + rectDOM.width - rect.left) / rect.width) * 2 - 1,
      -((rectDOM.y - rect.top) / rect.height) * 2 + 1
    );
    const result = CameraMath.fitWindow(this.state, this.camera, ndcMin, ndcMax);
    if (!result) return;
    this._finishTransition(result.state, result.zoom, animate, duration);
  }

  /** name: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso' */
  setStandardView(name, animate = true, duration = 400) {
    const targetState = this.state.clone();
    targetState.quaternion.copy(CameraMath.standardViewQuaternion(name));
    CameraMath.applyQuaternionToEye(targetState);
    this._finishTransition(targetState, this.camera.zoom, animate, duration);
  }

  /** Đặt orientation tuỳ ý (ví dụ khi người dùng click lên orientation widget/view cube). */
  setOrientation(quaternion, animate = true, duration = 300) {
    const targetState = this.state.clone();
    targetState.quaternion.copy(quaternion).normalize();
    CameraMath.applyQuaternionToEye(targetState);
    this._finishTransition(targetState, this.camera.zoom, animate, duration);
  }

  /** Lấy orientation hiện tại để đồng bộ ra orientation widget (view cube). */
  getOrientation() {
    return this.state.quaternion.clone();
  }

  setDamping(enabled) {
  if (this.mouse) {
    this.mouse.enableDamping = enabled;
  }
  // Nếu đang có quán tính chạy ngầm thì dừng ngay lập tức
  if (!enabled) {
    this._stopInertia();
  }
}

addEventListener(type, fn) {
  if (!this._listeners[type]) this._listeners[type] = new Set();
  this._listeners[type].add(fn);
}

removeEventListener(type, fn) {
  this._listeners[type]?.delete(fn);
}

dispatchEvent(type, payload) {
  this._listeners[type]?.forEach((fn) => fn(payload));
}
refreshClipping() {
  this._updateClipping();
}

  dispose() {
    this.mouse.dispose();
    this.animation.stop();
    this._stopInertia();
    if (this._resizeObserver) this._resizeObserver.disconnect();
  }

  // ================= INTERNAL =================

  _finishTransition(targetState, targetZoom, animate, duration) {
    if (!targetState.isValid() || !Number.isFinite(targetZoom) || targetZoom <= 0) return;
    if (animate) {
      this.animation.animateTo(targetState, targetZoom, duration);
    } else {
      this.state.copy(targetState);
      this.camera.zoom = targetZoom;
      this.camera.updateProjectionMatrix();
      this._afterStateChange();
    }
  }

  /** Ghi CameraState -> camera thật. Không bao giờ ghi state không hợp lệ (chặn NaN lan ra render). */
  _applyStateToCamera() {
    const s = this.state;
    if (!s.isValid()) {
      console.warn('[CameraController] state không hợp lệ, bỏ qua apply.');
      return;
    }
    this.camera.position.copy(s.eye);
    this.camera.up.copy(s.up);
    this.camera.quaternion.copy(s.quaternion);
  }

_afterStateChange() {
    if (!this.state.isValid()) {
      console.warn('[CameraController] phát hiện state NaN, đã bỏ qua thao tác.');
      return;
    }
    this._applyStateToCamera();
    this._updateClipping();
    if (this.onChange) this.onChange(this.state);
    if (this.onOrientationChange) this.onOrientationChange(this.state.quaternion);
    this.dispatchEvent('change', this.state);   // <-- thêm dòng này
    this._requestRender();
}

  _updateClipping() {
    this.clipping.update(this._boundingSphere);
  }

  _requestRender() {
    if (this.renderCallback) this.renderCallback();
  }

  // ---------- Resize handling ----------

  _setupResizeObserver() {
    this._resizeObserver = new ResizeObserver(() => this._handleResize());
    this._resizeObserver.observe(this.domElement);
  }

  _handleResize() {
    const w = this.domElement.clientWidth;
    const h = this.domElement.clientHeight;
    if (w === 0 || h === 0) return;

    const aspect = w / h;
    const halfH = (this.camera.top - this.camera.bottom) / 2 || 1;
    const halfW = halfH * aspect;

    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.updateProjectionMatrix();
    this._requestRender();
  }

  // ---------- Inertia ----------

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
    this._inertiaVelocity.multiplyScalar(this.mouse.inertiaDecay);

    if (this._inertiaActive === 'rotate') {
      this.mouse._applyRotate(this._inertiaVelocity.x, this._inertiaVelocity.y);
    } else if (this._inertiaActive === 'pan') {
      this.mouse._applyPan(this._inertiaVelocity.x, this._inertiaVelocity.y);
    }

    if (this._inertiaVelocity.lengthSq() < 0.02) {
      this._inertiaActive = null;
      return;
    }
    this._inertiaRaf = requestAnimationFrame(this._inertiaTick);
  };
}
