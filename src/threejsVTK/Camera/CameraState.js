// Camera/CameraState.js
// Nguồn sự thật (single source of truth) của camera.
// Mọi module khác (Math / Animation / Clipping / InteractorStyle) chỉ đọc-ghi
// qua state này, sau đó Camera.js mới "apply" xuống THREE.OrthographicCamera thật.
import * as THREE from 'three';

export class CameraState {
  constructor() {
    this.eye = new THREE.Vector3(10, 10, 10);   // vị trí camera (world)
    this.target = new THREE.Vector3(0, 0, 0);   // điểm nhìn / tâm quay
    this.up = new THREE.Vector3(0, 1, 0);       // vector up hiện tại
    this.quaternion = new THREE.Quaternion();   // orientation (không dùng Euler -> không gimbal lock)
    this.distance = 10;                         // |eye - target|
  }

  clone() {
    return new CameraState().copy(this);
  }

  copy(other) {
    this.eye.copy(other.eye);
    this.target.copy(other.target);
    this.up.copy(other.up);
    this.quaternion.copy(other.quaternion);
    this.distance = other.distance;
    return this;
  }

  /**
   * Kiểm tra state hợp lệ (chặn NaN / Infinity / quaternion suy biến
   * lan xuống render pipeline).
   */
  isValid() {
    const v3ok = (v) =>
      Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    const q = this.quaternion;
    const qFinite =
      Number.isFinite(q.x) && Number.isFinite(q.y) &&
      Number.isFinite(q.z) && Number.isFinite(q.w);
    const qUnit = qFinite && Math.abs(q.length() - 1) < 1e-2;

    return (
      v3ok(this.eye) &&
      v3ok(this.target) &&
      v3ok(this.up) &&
      qUnit &&
      Number.isFinite(this.distance) &&
      this.distance > 0
    );
  }
}

export default CameraState;