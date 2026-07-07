// Camera/CameraClipping.js
// Tự động điều chỉnh near/far của THREE.OrthographicCamera theo bounding
// sphere của scene, để model không bao giờ bị "cắt" khi zoom/rotate/pan.
// Với ortho camera, near ĐƯỢC PHÉP âm — tận dụng điều này để bao trọn
// cả phần hình học nằm "sau lưng" mặt phẳng camera.
import * as THREE from 'three';

export class CameraClipping {
  /** @param {import('./Camera.js').Camera} camera */
  constructor(camera, { margin = 1.5, minRange = 1e-3 } = {}) {
    this.camera = camera;
    this.margin = margin;     // hệ số nới rộng quanh bounding sphere
    this.minRange = minRange; // khoảng cách tối thiểu giữa near và far
  }

  /**
   * @param {THREE.Sphere|null} boundingSphere world-space; null => dùng fallback
   */
  update(boundingSphere) {
    const three = this.camera.three;
    const state = this.camera.state;
    if (!state.isValid()) return;

    let near, far;

    if (boundingSphere && boundingSphere.radius > 0) {
      // Khoảng cách từ eye tới tâm sphere chiếu lên hướng nhìn
      const viewDir = new THREE.Vector3()
        .subVectors(state.target, state.eye)
        .normalize();
      const toCenter = new THREE.Vector3()
        .subVectors(boundingSphere.center, state.eye);
      const distAlong = toCenter.dot(viewDir);

      const r = boundingSphere.radius * this.margin;
      near = distAlong - r;
      far = distAlong + r;
    } else {
      // Fallback: dựa vào distance hiện tại
      const d = Math.max(state.distance, 1);
      near = -d * 10;
      far = d * 10;
    }

    if (!Number.isFinite(near) || !Number.isFinite(far)) return;
    if (far - near < this.minRange) far = near + this.minRange;

    if (three.near !== near || three.far !== far) {
      three.near = near;
      three.far = far;
      three.updateProjectionMatrix();
    }
  }
}

export default CameraClipping;