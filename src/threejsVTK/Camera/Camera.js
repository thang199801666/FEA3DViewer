// Camera/Camera.js
// Facade chính của folder Camera — quản lý trạng thái hình học của OrthographicCamera.
// KHÔNG chứa các actor UI phụ thuộc vào Scene (như Thước hay Lưới).

import * as THREE from 'three';
import { CameraState } from './CameraState.js';
import { CameraMath } from './CameraMath.js';
import { CameraAnimation } from './CameraAnimation.js';
import { CameraClipping } from './CameraClipping.js';

export class Camera {
  /**
   * @param {THREE.OrthographicCamera} threeCamera
   * @param {HTMLElement} domElement  canvas/container (dùng cho resize + đổi px->world)
   * @param {Object} [options]
   * @param {function} [options.onChange]            (state) => void — Phát sự kiện khi camera thay đổi vị trí/zoom
   * @param {function} [options.onOrientationChange] (quaternion) => void — sync view cube
   * @param {function} [options.renderCallback]      () => void — gọi renderer.render()
   * @param {boolean}  [options.autoResize=true]
   * @param {boolean}  [options.autoClipping=true]
   */
  constructor(threeCamera, domElement, options = {}) {
    if (!threeCamera.isOrthographicCamera) {
      throw new Error('Camera chỉ hỗ trợ THREE.OrthographicCamera.');
    }

    this.three = threeCamera;
    this.domElement = domElement;

    this.state = new CameraState();
    this.state.target.set(0, 0, 0);

    const initDir = new THREE.Vector3().subVectors(threeCamera.position, this.state.target);
    this.state.distance = initDir.length() > 1e-8 ? initDir.length() : 10;
    if (initDir.lengthSq() < 1e-8) initDir.set(1, 1, 1);
    initDir.normalize();

    const m = new THREE.Matrix4().lookAt(initDir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    this.state.quaternion.setFromRotationMatrix(m);
    CameraMath.applyQuaternionToEye(this.state);

    this.animation = new CameraAnimation(this);
    this.clipping = new CameraClipping(this);
    this.autoClipping = options.autoClipping !== false;

    this.onChange = options.onChange || null;
    this.onOrientationChange = options.onOrientationChange || null;
    this.renderCallback = options.renderCallback || null;
    this._listeners = {};
    this._boundingSphere = null;

    this._applyStateToCamera();
    this._updateClipping();

    if (options.autoResize !== false && domElement) {
      this._setupResizeObserver();
    }
  }

  // ---------- Các hàm dịch chuyển hình học (Ủy quyền cho CameraMath) ----------

  rotateLocal(angleYaw, anglePitch) {
    CameraMath.orbitLocal(this.state, angleYaw, anglePitch);
    this._afterStateChange();
  }

  pan(dxPx, dyPx) {
    const h = this.domElement?.clientHeight || 1;
    CameraMath.pan(this.state, { x: dxPx, y: dyPx }, h, this.three);
    this._afterStateChange();
  }

  dolly(factor, cursorNDC = null) {
    CameraMath.dolly(this.state, factor, this.three, cursorNDC);
    this._afterStateChange();
  }

  translate(offsetWorld) {
    this.state.eye.add(offsetWorld);
    this.state.target.add(offsetWorld);
    this._afterStateChange();
  }

  /**
   * SỬA LỖI: CameraMath KHÔNG có hàm zoomToWindow — hàm đúng là
   * fitWindow(state, camera, ndcMin, ndcMax) và nhận NDC chứ không phải px.
   * Chuyển rect client-px -> NDC rồi ủy quyền, sau đó animate tới kết quả.
   * @param {{x:number, y:number, width:number, height:number}} rectPx client px
   */
  zoomToWindow(rectPx) {
    if (!this.domElement) return;
    const dom = this.domElement.getBoundingClientRect();
    if (dom.width === 0 || dom.height === 0) return;

    // client px -> NDC (lưu ý trục Y đảo: đáy rect = ndc.y nhỏ hơn)
    const toNDC = (px, py) => new THREE.Vector2(
      ((px - dom.left) / dom.width) * 2 - 1,
      -((py - dom.top) / dom.height) * 2 + 1
    );
    const ndcA = toNDC(rectPx.x, rectPx.y + rectPx.height);              // góc dưới-trái
    const ndcB = toNDC(rectPx.x + rectPx.width, rectPx.y);               // góc trên-phải
    const ndcMin = new THREE.Vector2(Math.min(ndcA.x, ndcB.x), Math.min(ndcA.y, ndcB.y));
    const ndcMax = new THREE.Vector2(Math.max(ndcA.x, ndcB.x), Math.max(ndcA.y, ndcB.y));

    const result = CameraMath.fitWindow(this.state, this.three, ndcMin, ndcMax);
    if (!result) return;

    this.animation.stop();
    this.animation.animateTo(result.state, result.zoom, 300);
  }

  /**
   * SỬA LỖI: CameraMath không có getStandardView — hàm đúng là
   * standardViewQuaternion(name). animateTo cũng cần (state, zoom, duration).
   */
  setStandardView(viewName) {
    this.animation.stop();
    const targetState = this.state.clone();
    targetState.quaternion.copy(CameraMath.standardViewQuaternion(viewName));
    CameraMath.applyQuaternionToEye(targetState);
    this.animation.animateTo(targetState, this.three.zoom, 400);
  }

  /**
   * SỬA LỖI: THREE.BoundingSphere không tồn tại (đúng là THREE.Sphere), và
   * animateTo(targetState, 500, cb) sai chữ ký — 500 bị hiểu nhầm là zoom.
   * Giờ tính zoom đích từ bán kính sphere và animate đúng (state, zoom, ms).
   */
  fitBounds(boxWorld) {
    this.animation.stop();
    if (!boxWorld || boxWorld.isEmpty()) return;

    const sphere = new THREE.Sphere();
    boxWorld.getBoundingSphere(sphere);
    if (!(sphere.radius > 0)) sphere.radius = 1;

    const targetState = this.state.clone();
    targetState.target.copy(sphere.center);
    targetState.distance = Math.max(sphere.radius * 3, 1);
    CameraMath.applyQuaternionToEye(targetState);

    const camHalfH = (this.three.top - this.three.bottom) / 2 || 1;
    const camHalfW = (this.three.right - this.three.left) / 2 || 1;
    const r = sphere.radius * 1.1;
    let zoom = Math.min(camHalfH / r, camHalfW / r);
    if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;

    this.animation.animateTo(targetState, zoom, 500);
  }

  setBoundingSphere(sphere) {
    this._boundingSphere = sphere;
    this._updateClipping();
  }

  /**
   * SỬA LỖI SNAP: bản cũ giữ target CŨ rồi tính lại eye = target + dir·distance,
   * nên khi THREE camera thật bị bên ngoài dời đi (fitView, gizmo...) thì eye
   * tính ra ≠ vị trí thật => camera "giật" về vị trí sai.
   * Bản mới ADOPT theo chiều ngược lại: eye/quaternion lấy NGUYÊN từ THREE
   * camera (không đổi 1 pixel nào), target khôi phục bằng cách chiếu pivot
   * có ý nghĩa (bounding sphere nếu có, không thì target cũ) lên trục nhìn mới.
   */
  syncFromThree() {
    const c = this.three;
    c.updateMatrixWorld();
    const s = this.state;

    s.quaternion.copy(c.quaternion).normalize();
    s.eye.copy(c.position);
    s.up.set(0, 1, 0).applyQuaternion(s.quaternion);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quaternion);
    const bs = this._boundingSphere;
    const pivot = (bs && bs.radius > 0) ? bs.center : s.target;

    let depth = new THREE.Vector3().subVectors(pivot, c.position).dot(forward);
    if (!Number.isFinite(depth) || depth < 1e-6) {
      depth = (Number.isFinite(s.distance) && s.distance > 0) ? s.distance : 10;
    }

    s.distance = depth;
    s.target.copy(c.position).addScaledVector(forward, depth);

    this._afterStateChange(); // vô hại: eye == vị trí thật, không có snap
  }

  // ---------- Internal Sync & Events ----------

  _applyStateToCamera() {
    const s = this.state;
    if (!s.isValid()) return;
    this.three.position.copy(s.eye);
    this.three.up.copy(s.up);
    this.three.quaternion.copy(s.quaternion);
    this.three.updateMatrixWorld();
  }

  _afterStateChange() {
    if (!this.state.isValid()) {
      console.warn('[Camera] phát hiện state không hợp lệ, đã bỏ qua thao tác.');
      return;
    }
    this._applyStateToCamera();
    this._updateClipping();

    // Đứng từ ngoài Scene, hàm callback này sẽ hứng tọa độ camera để cập nhật Ruler/Grid
    if (this.onChange) this.onChange(this.state);
    if (this.onOrientationChange) this.onOrientationChange(this.state.quaternion);
    this.dispatchEvent('change', this.state);
    this._requestRender();
  }

  _updateClipping() {
    if (!this.autoClipping) return;
    this.clipping.update(this._boundingSphere);
  }

  _requestRender() {
    if (this.renderCallback) this.renderCallback();
  }

  // ---------- Resize Handling ----------

  _setupResizeObserver() {
    this._resizeObserver = new ResizeObserver(() => this._handleResize());
    this._resizeObserver.observe(this.domElement);
  }

  _handleResize() {
    const w = this.domElement.clientWidth;
    const h = this.domElement.clientHeight;
    if (w === 0 || h === 0) return;

    const aspect = w / h;
    const halfH = (this.three.top - this.three.bottom) / 2 || 1;
    const halfW = halfH * aspect;

    this.three.left = -halfW;
    this.three.right = halfW;
    this.three.updateProjectionMatrix();

    if (this.onChange) this.onChange(this.state);
    this._requestRender();
  }

  getNDC(clientX, clientY) {
    const rect = this.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    return new THREE.Vector2(x, y);
  }

  // ---------- Event Dispatcher Pattern ----------

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

  dispose() {
    this.animation.stop();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
    this._listeners = {};
  }
}

export default Camera;