import * as THREE from 'three';
import { Picking } from './CameraController/Picking.js';

export class PickingController {
  constructor(sceneController) {
    this.sceneController = sceneController;
    this.camera = sceneController.camera;
    this.domElement = sceneController.cameraController.domElement;

    // Khởi tạo lớp xử lý Raycaster
    this.picking = new Picking(sceneController.cameraController);

    // Quản lý trạng thái Actor đang tương tác
    this.hoveredActor = null;
    this.selectedActor = null;

    // Map lưu trữ màu sắc gốc của các Mesh con thuộc Actor [Key: mesh.id, Value: THREE.Color]
    this.originalColors = new Map();

    // Định nghĩa bảng màu Highlight CAD chuẩn theo yêu cầu
    this.hoverColor = new THREE.Color(0xffb366);  // Cam nhạt khi hover (surface)
    this.selectColor = new THREE.Color(0xff9999); // Đỏ nhạt khi được chọn (surface)
    this.hoverEdgeColor = new THREE.Color(0xe65c00);  // Cam đậm cho Feature Edges khi hover
    this.selectEdgeColor = new THREE.Color(0xb30000); // Đỏ đậm cho Feature Edges khi select
    this.defaultEdgeColor = new THREE.Color(0x111111); // Màu Feature Edges mặc định

    // Ngưỡng góc mặc định để hiển thị cạnh sắc CAD (20 độ)
    this.defaultEdgeAngle = 20;

    this._bindEvents();
  }

  /**
   * Đăng ký các sự kiện tương tác chuột
   */
  _bindEvents() {
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerDown = this.onPointerDown.bind(this);

    this.domElement.addEventListener('pointermove', this._onPointerMove);
    this.domElement.addEventListener('pointerdown', this._onPointerDown);
  }

  /**
   * Thu thập tất cả các Mesh con có trong Scene (bỏ qua grid hệ thống)
   */
  _getPickableMeshes() {
    const meshes = [];
    this.sceneController.scene.traverse((obj) => {
      // Chỉ lấy các đối tượng hình học dạng Mesh và không thuộc hệ thống lưới
      if (obj.isMesh && obj.name !== 'system_grid') {
        meshes.push(obj);
      }
    });
    return meshes;
  }

  /**
   * Tìm kiếm Actor cha gần nhất của Mesh bị raycast trúng
   */
  _findParentActor(mesh) {
    let current = mesh;
    while (current) {
      if (current.isActor) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  /**
   * Sự kiện di chuột (Hover)
   */
  onPointerMove(event) {
    // Nếu camera đang thực hiện rotate/pan/zoom thì bỏ qua tính toán hover để tối ưu hiệu năng
    const mouseState = this.sceneController.cameraController.mouseController?.state;
    if (mouseState !== undefined && mouseState !== 0) return;

    const intersects = this.picking.pickAtScreen(
      event.clientX,
      event.clientY,
      this._getPickableMeshes()
    );

    if (intersects.length > 0) {
      const targetActor = this._findParentActor(intersects[0].object);

      if (targetActor && this.hoveredActor !== targetActor) {
        this._clearHover();
        this._setHover(targetActor);
      }
    } else {
      this._clearHover();
    }
  }

  /**
   * Sự kiện click chuột trái (Select)
   */
  onPointerDown(event) {
    if (event.button !== 0) return; // Chỉ xử lý khi click chuột trái

    const intersects = this.picking.pickAtScreen(
      event.clientX,
      event.clientY,
      this._getPickableMeshes()
    );

    if (intersects.length > 0) {
      const targetActor = this._findParentActor(intersects[0].object);
      if (targetActor) {
        this._setSelect(targetActor);
      }
    } else {
      this._clearSelect();
    }
  }

  // =========================================================================
  // LOGIC ĐIỀU KHIỂN HIGHLIGHT MÀU SẮC & FEATURE EDGES
  // =========================================================================

  /**
   * Cô lập vật liệu và đổi màu toàn bộ Mesh con nằm trong Actor
   */
  _applyColorToActor(actor, targetColor) {
    if (!actor) return;

    actor.traverse((child) => {
      if (child.isMesh) {
        // Clone vật liệu nếu dùng chung để không làm ảnh hưởng các Actor khác cùng loại
        if (!child.userData.isMaterialCloned) {
          child.material = child.material.clone();
          child.userData.isMaterialCloned = true;
        }

        // Lưu lại màu gốc vào Map bộ nhớ tạm nếu chưa từng lưu
        if (!this.originalColors.has(child.id)) {
          this.originalColors.set(child.id, child.material.color.clone());
        }

        // Đè màu mới lên bề mặt
        child.material.color.copy(targetColor);
      }
    });

    this._requestSceneRender();
  }

  /**
   * Khôi phục lại màu sắc nguyên bản cho Actor dựa trên dữ liệu đã lưu trong Map
   */
  _resetActorColor(actor) {
    if (!actor) return;

    actor.traverse((child) => {
      if (child.isMesh) {
        const origColor = this.originalColors.get(child.id);
        if (origColor) {
          child.material.color.copy(origColor);
        }
      }
    });

    this._requestSceneRender();
  }

  /**
   * Thiết lập trạng thái Hover
   * - Actor thường: Surface -> Cam nhạt, Edge -> Cam đậm
   * - Actor đang được Select: giữ nguyên Surface đỏ nhạt, chỉ đổi Edge -> Cam đậm
   */
  _setHover(actor) {
    this.hoveredActor = actor;

    if (actor !== this.selectedActor) {
      this._applyColorToActor(actor, this.hoverColor);
    }
    this._setActorEdgeColor(actor, this.hoverEdgeColor);
  }

  /**
   * Xóa trạng thái Hover
   * - Nếu Actor đang được Select: giữ nguyên Surface đỏ nhạt, trả Edge về đỏ đậm (màu Select)
   * - Ngược lại: trả cả Surface và Edge về màu gốc/mặc định
   */
  _clearHover() {
    if (!this.hoveredActor) return;
    const actor = this.hoveredActor;

    if (actor === this.selectedActor) {
      this._setActorEdgeColor(actor, this.selectEdgeColor);
    } else {
      this._resetActorColor(actor);
      this._setActorEdgeColor(actor, this.defaultEdgeColor);
    }

    this.hoveredActor = null;
  }

  /**
   * Thiết lập trạng thái Select (Surface -> Đỏ nhạt, Edge -> Đỏ đậm)
   */
  _setSelect(actor) {
    // Xóa trạng thái hover hiện tại và giải phóng Actor cũ đang chọn (nếu có)
    this._clearHover();
    this._clearSelect();

    this.selectedActor = actor;
    this._applyColorToActor(actor, this.selectColor);
    this._setActorEdgeColor(actor, this.selectEdgeColor);
  }

  /**
   * Xóa trạng thái Select
   */
  _clearSelect() {
    if (!this.selectedActor) return;
    const actor = this.selectedActor;

    this._resetActorColor(actor);
    this._setActorEdgeColor(actor, this.defaultEdgeColor);
    this.selectedActor = null;
  }

  /**
   * Đổi màu Feature Edges của Actor (nếu tồn tại) và yêu cầu render lại khung hình
   */
  _setActorEdgeColor(actor, color) {
    if (actor && typeof actor.setEdgeColor === 'function') {
      actor.setEdgeColor(color);
      this._requestSceneRender();
    }
  }

  /**
   * Ép Viewport của hệ thống vẽ lại khung hình mới lập tức khi màu sắc thay đổi
   */
  _requestSceneRender() {
    if (this.sceneController.cameraController?._requestRender) {
      this.sceneController.cameraController._requestRender();
    }
  }

  /**
   * Giải phóng bộ nhớ và gỡ bỏ hoàn toàn sự kiện lắng nghe chuột (Cleanup)
   */
  dispose() {
    this._clearHover();
    this._clearSelect();
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.originalColors.clear();
  }
}