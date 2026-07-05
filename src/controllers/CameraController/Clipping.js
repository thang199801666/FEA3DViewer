import * as THREE from 'three'; // Đảm bảo đã import THREE nếu cần dùng Vector3 bóc tách độc lập

export class Clipping {
  constructor(controller) {
    this.controller = controller;
    this.margin = 1.05;   
    this.minNear = 0.01;
  }

  /** boundingSphere: THREE.Sphere (world-space) của toàn bộ scene / model. */
  update(boundingSphere) {
    const c = this.controller;
    const camera = c.camera;
    const state = c.state;

    if (!boundingSphere || !(boundingSphere.radius > 0) || !Number.isFinite(boundingSphere.radius)) {
      camera.near = this.minNear;
      camera.far = 10000;
      camera.updateProjectionMatrix();
      return;
    }

    // 1. Lấy hướng nhìn (Forward Vector) của camera từ quaternion
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(state.quaternion).normalize();

    // 2. Tạo vector từ mắt camera đến tâm của bounding sphere
    const cameraToCenter = new THREE.Vector3().subVectors(boundingSphere.center, state.eye);

    // 3. Tính khoảng cách hình chiếu lên trục nhìn (dùng Dot Product)
    const distToCenter = cameraToCenter.dot(forward);

    const r = boundingSphere.radius * this.margin;

    // 4. Tính toán near/far dựa trên khoảng cách hình chiếu này
    let near = distToCenter - r;
    let far = distToCenter + r;

    near = Math.max(near, this.minNear);
    far = Math.max(far, near + this.minNear);

    if (!Number.isFinite(near) || !Number.isFinite(far) || near <= 0) {
      near = this.minNear;
      // Dùng distToCenter nếu nó hợp lệ, ngược lại fallback về giá trị an toàn
      const safeDist = distToCenter > 0 ? distToCenter : 100;
      far = Math.max(safeDist * 2, 10);
    }

    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}