// Camera/CameraMath.js
// Toàn bộ hàm ở đây là PURE (không side-effect ra camera thật, trừ dolly có
// ghi camera.zoom vì zoom là thuộc tính projection của THREE ortho camera).
// Chỉ thao tác trên CameraState để Camera.js quyết định apply ngay hay animate.
import * as THREE from 'three';

export const CameraMath = {
  /**
   * Xoay quanh target bằng quaternion delta biểu diễn trong WORLD-space.
   */
  orbit(state, deltaQuat) {
    state.quaternion.premultiply(deltaQuat).normalize();
    this.applyQuaternionToEye(state);
  },

  /**
   * Xoay theo hệ trục CỤC BỘ của camera (trackball-feel nhưng tự viết,
   * không phụ thuộc TrackballControls/ArcballControls):
   *   - yaw  : quay quanh trục Up cục bộ (0,1,0)
   *   - pitch: quay quanh trục Right cục bộ (1,0,0)
   * Nhân bên PHẢI => mọi thao tác xoay mới đều dựa trên góc nhìn hiện tại.
   */
  orbitLocal(state, angleYaw, anglePitch) {
    const qYaw = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), -angleYaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0), -anglePitch);
    state.quaternion.multiply(qYaw).multiply(qPitch).normalize();
    this.applyQuaternionToEye(state);
  },

  /** Tính lại eye/up từ quaternion + distance, giữ target cố định. */
  applyQuaternionToEye(state) {
    const offset = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(state.quaternion)
      .multiplyScalar(state.distance);
    state.eye.copy(state.target).add(offset);
    state.up.set(0, 1, 0).applyQuaternion(state.quaternion);
  },

  /**
   * Pan theo screen-space: dịch target + eye theo trục right/up của camera,
   * độ lớn = world-unit/pixel dựa trên frustum ortho hiện tại
   * (không phụ thuộc distance).
   */
  pan(state, deltaScreenPx, viewportHeightPx, camera) {
    if (viewportHeightPx <= 0) return;
    const worldPerPixel =
      (camera.top - camera.bottom) / camera.zoom / viewportHeightPx;
    if (!Number.isFinite(worldPerPixel)) return;

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(state.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(state.quaternion);

    const offset = new THREE.Vector3()
      .addScaledVector(right, -deltaScreenPx.x * worldPerPixel)
      .addScaledVector(up, deltaScreenPx.y * worldPerPixel);

    state.eye.add(offset);
    state.target.add(offset);
  },

  /**
   * Chuyển 1 điểm NDC (-1..1) thành điểm world trên mặt phẳng đi qua target,
   * vuông góc hướng nhìn (đúng cho ortho).
   */
  ndcToWorld(ndc, camera, state) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(state.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(state.quaternion);
    const halfW = (camera.right - camera.left) / (2 * camera.zoom);
    const halfH = (camera.top - camera.bottom) / (2 * camera.zoom);

    return new THREE.Vector3()
      .copy(state.target)
      .addScaledVector(right, ndc.x * halfW)
      .addScaledVector(up, ndc.y * halfH);
  },

  /**
   * Dolly (zoom): mutate camera.zoom, neo theo con trỏ nếu có cursorNDC
   * (zoom-to-cursor). factor > 1 = zoom in. Clamp để không bao giờ NaN / <= 0.
   */
  dolly(state, factor, camera, cursorNDC) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    let newZoom = camera.zoom * factor;
    newZoom = THREE.MathUtils.clamp(newZoom, 1e-4, 1e6);
    if (!Number.isFinite(newZoom) || newZoom <= 0) return;

    if (cursorNDC) {
      const worldBefore = this.ndcToWorld(cursorNDC, camera, state);
      camera.zoom = newZoom;
      camera.updateProjectionMatrix();
      const worldAfter = this.ndcToWorld(cursorNDC, camera, state);
      const shift = new THREE.Vector3().subVectors(worldBefore, worldAfter);
      state.eye.add(shift);
      state.target.add(shift);
    } else {
      camera.zoom = newZoom;
      camera.updateProjectionMatrix();
    }
  },

  /**
   * Zoom Fit 1 Box3 theo hướng nhìn hiện tại (camera-space AABB), có padding.
   * KHÔNG mutate camera — trả kết quả để Camera tự apply (instant / animate).
   */
  fitBox(state, camera, box, padding = 1.2) {
    if (!box || box.isEmpty()) return null;

    const center = new THREE.Vector3();
    box.getCenter(center);

    const corners = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];

    const invQuat = state.quaternion.clone().invert();
    let maxRight = 1e-6, maxUp = 1e-6, maxForward = 1e-6;

    for (const c of corners) {
      const local = c.clone().sub(center).applyQuaternion(invQuat);
      maxRight = Math.max(maxRight, Math.abs(local.x));
      maxUp = Math.max(maxUp, Math.abs(local.y));
      maxForward = Math.max(maxForward, Math.abs(local.z));
    }

    const halfW = maxRight * padding;
    const halfH = maxUp * padding;
    const camHalfW = (camera.right - camera.left) / 2;
    const camHalfH = (camera.top - camera.bottom) / 2;

    let zoom = Math.min(camHalfW / halfW, camHalfH / halfH);
    if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;

    const resultState = state.clone();
    resultState.target.copy(center);
    resultState.distance = Math.max(maxForward * 3, 1);
    this.applyQuaternionToEye(resultState);

    return { state: resultState, zoom };
  },

  /**
   * Zoom Window: khung chữ nhật (NDC min/max) sẽ lấp đầy viewport sau khi zoom.
   */
  fitWindow(state, camera, ndcMin, ndcMax) {
    const sizeNDC = new THREE.Vector2(
      Math.abs(ndcMax.x - ndcMin.x),
      Math.abs(ndcMax.y - ndcMin.y)
    );
    if (sizeNDC.x < 1e-4 || sizeNDC.y < 1e-4) return null;

    const centerNDC = new THREE.Vector2(
      (ndcMin.x + ndcMax.x) / 2,
      (ndcMin.y + ndcMax.y) / 2
    );
    const worldCenter = this.ndcToWorld(centerNDC, camera, state);

    const scale = Math.min(2 / sizeNDC.x, 2 / sizeNDC.y);
    let zoom = camera.zoom * scale;
    zoom = THREE.MathUtils.clamp(zoom, 1e-4, 1e6);
    if (!Number.isFinite(zoom) || zoom <= 0) zoom = camera.zoom;

    const shift = new THREE.Vector3().subVectors(worldCenter, state.target);
    const resultState = state.clone();
    resultState.target.add(shift);
    resultState.eye.add(shift);

    return { state: resultState, zoom };
  },

  /** Quaternion cho các view chuẩn kiểu CAD (camera mặc định nhìn theo -Z). */
  standardViewQuaternion(name) {
    const dirs = {
      front:  [0, 0, 1],
      back:   [0, 0, -1],
      left:   [-1, 0, 0],
      right:  [1, 0, 0],
      top:    [0, 1, 0],
      bottom: [0, -1, 0],
      iso:    [1, 1, 1],
    };
    const ups = {
      top:    [0, 0, -1],
      bottom: [0, 0, 1],
    };

    const eyeDir = new THREE.Vector3(...(dirs[name] || dirs.iso)).normalize();
    const up = new THREE.Vector3(...(ups[name] || [0, 1, 0]));

    const m = new THREE.Matrix4().lookAt(eyeDir, new THREE.Vector3(0, 0, 0), up);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  },
};

export default CameraMath;