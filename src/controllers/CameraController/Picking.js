import * as THREE from 'three';

/**
 * Picking
 * - pickAtScreen: raycast thông thường từ 1 điểm màn hình.
 * - pickInWindow: chọn object theo khung chữ nhật (marquee), dùng khi
 *   người dùng vẽ khung tương tự Zoom Window nhưng để select thay vì zoom.
 */
export class Picking {
  constructor(controller) {
    this.controller = controller;
    this.raycaster = new THREE.Raycaster();
  }

  pickAtScreen(x, y, objects, recursive = true) {
    const c = this.controller;
    const rect = c.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, c.camera);
    return this.raycaster.intersectObjects(objects, recursive);
  }

  /**
   * rectDOM: {x, y, width, height} theo tọa độ client (px), ví dụ lấy từ
   * MouseController.onZoomWindowUpdate khi dùng cho mục đích chọn thay vì zoom.
   */
  pickInWindow(rectDOM, objects) {
    const c = this.controller;
    const camera = c.camera;
    const canvasRect = c.domElement.getBoundingClientRect();

    const ndcMin = new THREE.Vector2(
      ((rectDOM.x - canvasRect.left) / canvasRect.width) * 2 - 1,
      -((rectDOM.y + rectDOM.height - canvasRect.top) / canvasRect.height) * 2 + 1
    );
    const ndcMax = new THREE.Vector2(
      ((rectDOM.x + rectDOM.width - canvasRect.left) / canvasRect.width) * 2 - 1,
      -((rectDOM.y - canvasRect.top) / canvasRect.height) * 2 + 1
    );

    const selected = [];
    const box = new THREE.Box3();
    const center = new THREE.Vector3();

    for (const obj of objects) {
      obj.updateWorldMatrix(true, false);
      box.setFromObject(obj);
      if (box.isEmpty()) continue;

      box.getCenter(center);
      const ndc = center.clone().project(camera);

      if (
        ndc.x >= ndcMin.x && ndc.x <= ndcMax.x &&
        ndc.y >= ndcMin.y && ndc.y <= ndcMax.y &&
        ndc.z >= -1 && ndc.z <= 1
      ) {
        selected.push(obj);
      }
    }

    return selected;
  }
}
