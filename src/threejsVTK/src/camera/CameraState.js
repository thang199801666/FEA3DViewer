import * as THREE from 'three';

export class CameraState {
  constructor() {
    this.eye = new THREE.Vector3(10, 10, 10);
    this.target = new THREE.Vector3(0, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.quaternion = new THREE.Quaternion();
    this.distance = 10;
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

  isValid() {
    const isVector3Valid = (v) =>
      Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    
    const q = this.quaternion;
    const isQuatFinite =
      Number.isFinite(q.x) && Number.isFinite(q.y) &&
      Number.isFinite(q.z) && Number.isFinite(q.w);
    const isQuatUnit = isQuatFinite && Math.abs(q.length() - 1) < 1e-2;

    return (
      isVector3Valid(this.eye) &&
      isVector3Valid(this.target) &&
      isVector3Valid(this.up) &&
      isQuatUnit &&
      Number.isFinite(this.distance) &&
      this.distance > 0
    );
  }
}

export default CameraState;