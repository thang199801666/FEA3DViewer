import * as THREE from 'three';
import { CameraMath } from './CameraMath.js';

const STATE = {
  NONE: 0,
  ROTATE: 1,
  PAN: 2,
  ZOOM_WINDOW: 3,
  TOUCH_ROTATE: 4,
  TOUCH_PAN_ZOOM: 5,
};

/**
 * MouseController
 * Input layer: chuột / touch / bàn phím -> gọi CameraMath -> cập nhật CameraState.
 * Không tự vẽ UI (zoom-window rectangle) — expose callback để nơi khác vẽ.
 *
 * Binding mặc định (kiểu Abaqus):
 *  - Left drag            : Rotate (quaternion, quanh target)
 *  - Shift + Left / Middle: Pan (screen-space)
 *  - Right drag           : Zoom Window (kéo khung chữ nhật)
 *  - Wheel                : Zoom to cursor
 *  - 1 finger touch       : Rotate
 *  - 2 finger touch       : Pinch zoom + Pan
 *  - Arrow keys           : Pan
 *  - +/-                  : Zoom
 *  - 0-6                  : Standard views (iso/front/back/left/right/top/bottom)
 */
export class MouseController {
  constructor(controller) {
    this.controller = controller;
    this.domElement = controller.domElement;
    this.camera = controller.camera;
    this.state = STATE.NONE;

    this.rotateSpeed = 1.0;
    this.panSpeed = 1.0;
    this.zoomSpeed = 1.0;
    this.enableDamping = true;
    this.inertiaDecay = 0.9;

    this.pointers = new Map();
    this.lastPointer = new THREE.Vector2();
    this.rotateVelocity = new THREE.Vector2();
    this.panVelocity = new THREE.Vector2();

    this.zoomWindowStart = new THREE.Vector2();
    this.zoomWindowEnd = new THREE.Vector2();
    this.onZoomWindowUpdate = null; // (rectDOM) => void, để UI vẽ khung
    this.onZoomWindowEnd = null;    // () => void

    this._pinchStartDist = 0;
    this._touchPanLast = new THREE.Vector2();

    this._bind();
  }

  _bind() {
    const el = this.domElement;
    el.style.touchAction = 'none';

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onWheel = this.onWheel.bind(this);
    this._onContextMenu = (e) => e.preventDefault();
    this._onKeyDown = this.onKeyDown.bind(this);

    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('wheel', this._onWheel, { passive: false });
    el.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('keydown', this._onKeyDown);
  }

  dispose() {
    const el = this.domElement;
    el.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    el.removeEventListener('wheel', this._onWheel);
    el.removeEventListener('contextmenu', this._onContextMenu);
    window.removeEventListener('keydown', this._onKeyDown);
  }

  getNDC(x, y) {
    const rect = this.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1
    );
  }

  // ---------- Pointer events ----------

  onPointerDown(event) {
    this.domElement.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.controller._stopInertia();

    if (this.pointers.size === 1) {
      this.lastPointer.set(event.clientX, event.clientY);
      this.rotateVelocity.set(0, 0);
      this.panVelocity.set(0, 0);

      if (event.pointerType === 'touch') {
        this.state = STATE.TOUCH_ROTATE;
      } else if (event.button === 0) {
        this.state = event.shiftKey ? STATE.PAN : STATE.ROTATE;
      } else if (event.button === 1) {
        this.state = STATE.PAN;
      } else if (event.button === 2) {
        this.state = STATE.ZOOM_WINDOW;
        this.zoomWindowStart.set(event.clientX, event.clientY);
        this.zoomWindowEnd.copy(this.zoomWindowStart);
      }
    } else if (this.pointers.size === 2 && event.pointerType === 'touch') {
      this.state = STATE.TOUCH_PAN_ZOOM;
      const pts = Array.from(this.pointers.values());
      this._pinchStartDist = this._dist(pts[0], pts[1]);
      this._touchPanLast.set((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
    }

    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
  }

  onPointerMove(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.state === STATE.ROTATE || this.state === STATE.TOUCH_ROTATE) {
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this._applyRotate(dx, dy);
      this.rotateVelocity.set(dx, dy);
    } else if (this.state === STATE.PAN) {
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this._applyPan(dx, dy);
      this.panVelocity.set(dx, dy);
    } else if (this.state === STATE.ZOOM_WINDOW) {
      this.zoomWindowEnd.set(event.clientX, event.clientY);
      if (this.onZoomWindowUpdate) this.onZoomWindowUpdate(this._getZoomWindowRect());
    } else if (this.state === STATE.TOUCH_PAN_ZOOM) {
      const pts = Array.from(this.pointers.values());
      if (pts.length < 2) return;

      const dist = this._dist(pts[0], pts[1]);
      const scale = dist / Math.max(this._pinchStartDist, 1e-6);
      if (Number.isFinite(scale) && scale > 0) {
        CameraMath.dolly(this.controller.state, scale, this.camera, null);
      }
      this._pinchStartDist = dist;

      const center = new THREE.Vector2((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      this._applyPan(center.x - this._touchPanLast.x, center.y - this._touchPanLast.y);
      this._touchPanLast.copy(center);
    }

    this.lastPointer.set(event.clientX, event.clientY);
    this.controller._requestRender();
  }

  onPointerUp(event) {
    this.pointers.delete(event.pointerId);

    if (this.state === STATE.ZOOM_WINDOW) {
      const rect = this._getZoomWindowRect();
      if (rect.width > 4 && rect.height > 4) this.controller.zoomToWindow(rect);
      if (this.onZoomWindowEnd) this.onZoomWindowEnd();
    }

    if ((this.state === STATE.ROTATE || this.state === STATE.TOUCH_ROTATE) && this.enableDamping) {
      this.controller._startInertia('rotate', this.rotateVelocity);
    } else if (this.state === STATE.PAN && this.enableDamping) {
      this.controller._startInertia('pan', this.panVelocity);
    }

    if (this.pointers.size === 0) {
      this.state = STATE.NONE;
      window.removeEventListener('pointermove', this._onPointerMove);
      window.removeEventListener('pointerup', this._onPointerUp);
    } else if (this.pointers.size === 1) {
      const [p] = this.pointers.values();
      this.lastPointer.set(p.x, p.y);
      this.state = STATE.ROTATE;
    }
  }

  onWheel(event) {
    event.preventDefault();
    const c = this.controller;
    c._stopInertia(); // tránh inertia cũ cộng dồn vào zoom

    const ndc = this.getNDC(event.clientX, event.clientY);
    // deltaY < 0 (cuộn lên)   => factor > 1 => zoom in
    // deltaY > 0 (cuộn xuống) => factor < 1 => zoom out
    const factor = Math.pow(0.999, event.deltaY * this.zoomSpeed * 0.5);

    CameraMath.dolly(c.state, factor, this.camera, ndc);

    // dolly() có thể đã dịch state.eye/target (zoom-to-cursor) —
    // BẮT BUỘC đồng bộ lại camera thật + clipping, nếu không camera sẽ
    // "giật" về vị trí cũ ở lần rotate/pan tiếp theo.
    c._afterStateChange();
  }

  onKeyDown(event) {
    const c = this.controller;
    const step = 20;
    switch (event.key) {
      case 'ArrowLeft': this._applyPan(-step, 0); break;
      case 'ArrowRight': this._applyPan(step, 0); break;
      case 'ArrowUp': this._applyPan(0, -step); break;
      case 'ArrowDown': this._applyPan(0, step); break;
      case '+': case '=': CameraMath.dolly(c.state, 1.1, this.camera, null); break;
      case '-': case '_': CameraMath.dolly(c.state, 1 / 1.1, this.camera, null); break;
      case '1': c.setStandardView('front'); return;
      case '2': c.setStandardView('back'); return;
      case '3': c.setStandardView('left'); return;
      case '4': c.setStandardView('right'); return;
      case '5': c.setStandardView('top'); return;
      case '6': c.setStandardView('bottom'); return;
      case '0': c.setStandardView('iso'); return;
      default: return;
    }
    c._afterStateChange();
  }

  // ---------- Core transforms (dùng lại bởi inertia) ----------

  _applyRotate(dx, dy) {
    const c = this.controller;
    const rect = this.domElement.getBoundingClientRect();
    
    const sensitivity = 1.0; 
    const angleX = (dx / rect.width) * Math.PI * sensitivity * this.rotateSpeed;
    const angleY = (dy / rect.height) * Math.PI * sensitivity * this.rotateSpeed;

    // 1. Lấy trạng thái quaternion hiện tại của camera
    const currentQ = c.state.quaternion.clone();

    // 2. Tính toán cấu thành Pitch (Xoay lên/xuống quanh trục X cục bộ của camera)
    const localRight = new THREE.Vector3(1, 0, 0);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(localRight, -angleY);

    // 3. Tính toán cấu thành Yaw (Xoay trái/phải quanh trục Y của thế giới)
    const worldUp = new THREE.Vector3(0, 1, 0);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(worldUp, -angleX);

    // 4. Tổ hợp chính xác theo thứ tự ma trận tích: 
    // Áp dụng Pitch lên camera trước (currentQ * qPitch), sau đó áp dụng Yaw toàn cục lên kết quả (qYaw * ...)
    const targetQ = new THREE.Quaternion()
      .copy(qYaw)
      .multiply(currentQ)
      .multiply(qPitch)
      .normalize();

    // 5. Cập nhật trực tiếp vào state thay vì dùng `CameraMath.orbit(c.state, qDelta)` cũ
    c.state.quaternion.copy(targetQ);
    CameraMath.applyQuaternionToEye(c.state); 
    
    c._afterStateChange();
  }

  _applyPan(dx, dy) {
    const c = this.controller;
    const rect = this.domElement.getBoundingClientRect();
    CameraMath.pan(c.state, { x: dx * this.panSpeed, y: dy * this.panSpeed }, rect.height, this.camera);
    c._afterStateChange();
  }

  // ---------- Helpers ----------

  _dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _getZoomWindowRect() {
    const x1 = Math.min(this.zoomWindowStart.x, this.zoomWindowEnd.x);
    const y1 = Math.min(this.zoomWindowStart.y, this.zoomWindowEnd.y);
    const x2 = Math.max(this.zoomWindowStart.x, this.zoomWindowEnd.x);
    const y2 = Math.max(this.zoomWindowStart.y, this.zoomWindowEnd.y);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }
}