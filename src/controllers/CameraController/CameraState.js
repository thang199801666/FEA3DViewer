import * as THREE from 'three';

/**
 * CameraState
 * Trạng thái "nguồn sự thật" (source of truth) của camera.
 * Camera thật (THREE.OrthographicCamera) chỉ là kết quả áp dụng state này.
 * Không bao giờ tự ý sinh NaN: mọi state phải qua isValid() trước khi apply.
 */
export class CameraState {
  constructor() {
    this.eye = new THREE.Vector3(0, 0, 10);
    this.target = new THREE.Vector3(0, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.quaternion = new THREE.Quaternion(); // hướng nhìn (orientation) quanh target
    this.distance = 10;                       // khoảng cách eye -> target (chỉ để tham chiếu, ortho không phụ thuộc)
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
   * Kiểm tra state có hợp lệ không (không NaN, không Infinity, distance > 0).
   * CameraController luôn gọi hàm này trước khi ghi ra camera thật.
   */
  isValid() {
    const v = (n) => Number.isFinite(n);
    return (
      v(this.eye.x) && v(this.eye.y) && v(this.eye.z) &&
      v(this.target.x) && v(this.target.y) && v(this.target.z) &&
      v(this.up.x) && v(this.up.y) && v(this.up.z) &&
      v(this.quaternion.x) && v(this.quaternion.y) &&
      v(this.quaternion.z) && v(this.quaternion.w) &&
      v(this.distance) && this.distance > 1e-8
    );
  }
}
