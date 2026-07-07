// controllers/InteractorStyleCAD.js
// Một InteractorStyle (vtk-style) tùy biến cho ứng dụng CAD/CAE, thay thế
// InteractionController cũ nhưng chạy qua RenderWindowInteractor của threejsVTK.
//
// Giữ nguyên các đặc điểm CAD:
//   - Nav-style (Abaqus / Blender / Inventor / NX) qua InputStyleHandler
//   - Chuột TRÁI chỉ để chọn / kéo-thả Actor (không bao giờ xoay camera)
//   - Zoom-Window (marquee) bằng chuột phải đơn lẻ
//   - Quán tính (damping) cho Rotate / Pan
//   - Zoom-về-con-trỏ bằng cuộn chuột
//   - Phím tắt view chuẩn (1..6, 0) + mũi tên pan + +/- zoom
//
// Nguồn chân lý camera là vtkCamera (Rendering/Camera). Mọi chuyển động
// đều mutate THREE camera rồi gọi vtkCamera.setFromThree() để đồng bộ —
// giống cách CameraNavigationActor lái camera, nên gizmo & drag-rotate khớp nhau.

import * as THREE from "three";
import { InteractorStyle } from "./InteractorStyle.js";
import { InputStyleHandler, NAV_STYLE, INTERACTION_ACTION } from "./InputStyleHandler.js";

export { NAV_STYLE };

const STATE = {
  NONE: 0,
  ROTATE: 1,
  PAN: 2,
  ZOOM_WINDOW: 3,
  DRAG_OBJECT: 4,
};

export class InteractorStyleCAD extends InteractorStyle {
  /**
   * @param {SceneController} sceneController  cần: .scene, .camera (THREE ortho),
   *        .vtkCamera, .domElement, .requestRender(), .setView(name)
   * @param {object} options
   */
  constructor(sceneController, options = {}) {
    super();
    this.sceneController = sceneController;

    this.currentStyle = options.defaultStyle || NAV_STYLE.BLENDER;
    this.inputStyleHandler = new InputStyleHandler(this.currentStyle);

    // Tốc độ & quán tính
    this.rotateSpeed = options.rotateSpeed ?? 1.0;
    this.panSpeed = options.panSpeed ?? 1.0;
    this.zoomSpeed = options.zoomSpeed ?? 1.0;
    this.enableDamping = options.enableDamping ?? false;
    this.inertiaDecay = options.inertiaDecay ?? 0.9;

    this._state = STATE.NONE;
    this._lastClient = new THREE.Vector2();
    this._lastButtons = 0;

    // Vận tốc để tạo quán tính
    this.rotateVelocity = new THREE.Vector2();
    this.panVelocity = new THREE.Vector2();
    this._inertiaActive = null;
    this._inertiaVelocity = new THREE.Vector2();
    this._inertiaRaf = null;

    // Marquee (zoom-window)
    this.marqueeStart = new THREE.Vector2();
    this.marqueeEnd = new THREE.Vector2();
    this.onMarqueeUpdate = options.onMarqueeUpdate || null;
    this.onMarqueeEnd = options.onMarqueeEnd || null;

    // Kéo-thả vật thể
    this.draggedObject = null;
    this.dragPlane = new THREE.Plane();
    this.dragOffset = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();

    this._onKeyDown = this._handleKeyDown.bind(this);
    window.addEventListener("keydown", this._onKeyDown);
  }

  // Được RenderWindowInteractor gọi khi gắn style
  setInteractor(i) {
    super.setInteractor(i);
    return this;
  }

  get domElement() {
    return this.sceneController.domElement;
  }
  get camera() {
    // THREE ortho camera (nguồn hiển thị)
    return this.sceneController.camera;
  }
  get vtkCamera() {
    return this.sceneController.vtkCamera;
  }

  setNavigationStyle(styleName) {
    if (!Object.values(NAV_STYLE).includes(styleName)) return;
    this.currentStyle = styleName;
    this.inputStyleHandler.setStyle(styleName);
    // Nếu đang giữ chuột & đang điều khiển camera, tính lại hành động ngay
    const isCam =
      this._state === STATE.ROTATE ||
      this._state === STATE.PAN ||
      this._state === STATE.ZOOM_WINDOW;
    if (isCam && this._lastRawEvent) this._transition(this._lastRawEvent, true);
  }

  setDamping(enabled) {
    this.enableDamping = enabled;
    if (!enabled) this._stopInertia();
  }

  isNavigating() {
    return this._state === STATE.ROTATE || this._state === STATE.PAN;
  }

  // ================= EVENT HANDLERS (vtk InteractorStyle API) =================

  // Cả 3 nút xuống đều đi qua 1 điểm — luôn quyết định theo NGUYÊN bitmask
  // e.buttons, không phụ thuộc riêng nút nào vừa bấm (an toàn cho chorded).
  onLeftButtonDown(e) { this._onButtonDown(e); }
  onMiddleButtonDown(e) { this._onButtonDown(e); }
  onRightButtonDown(e) { this._onButtonDown(e); }

  // Cả 3 nút lên đều đi qua 1 điểm — tránh lệ thuộc định tuyến theo
  // state.button (vốn sai với tổ hợp nhiều nút) của RenderWindowInteractor.
  onLeftButtonUp(e) { this._onButtonUp(e); }
  onMiddleButtonUp(e) { this._onButtonUp(e); }
  onRightButtonUp(e) { this._onButtonUp(e); }

  _onButtonDown(e) {
    this._stopInertia();
    this._syncBaseline(e);
    this._lastRawEvent = e;
    this._lastButtons = e.buttons;
    this.rotateVelocity.set(0, 0);
    this.panVelocity.set(0, 0);

    // Chuột trái đang giữ: chỉ chọn / kéo Actor (không camera)
    if ((e.buttons & 1) !== 0) {
      this.draggedObject = null;
      if (!e.shiftKey && !e.ctrlKey) {
        const hit = this._raycastObject(e.clientX, e.clientY);
        if (hit) {
          this._setupObjectDrag(hit);
          this._state = STATE.DRAG_OBJECT;
          return;
        }
      }
      this._state = STATE.NONE; // highlight/select do PickingController lo
      return;
    }

    // Còn lại: giải mã camera từ toàn bộ bitmask (kể cả NX giữa+phải = 6)
    this._state = this._resolveAction(e);
  }

  _onButtonUp(e) {
    // Nhả HẾT nút -> kết thúc thao tác
    if (e.buttons === 0) {
      const old = this._state;
      this.draggedObject = null;
      if (old === STATE.ZOOM_WINDOW) {
        this._applyZoomWindow(this._getMarqueeRect());
        if (this.onMarqueeEnd) this.onMarqueeEnd();
      }
      if (this.enableDamping) {
        if (old === STATE.ROTATE) this._startInertia("rotate", this.rotateVelocity);
        else if (old === STATE.PAN) this._startInertia("pan", this.panVelocity);
      }
      this._state = STATE.NONE;
      this._lastButtons = 0;
      return;
    }
    // Nhả bớt 1 nút trong tổ hợp -> tính lại theo (các) nút còn giữ
    this._transition(e, true);
  }

  onMouseMove(e) {
    this._lastRawEvent = e;

    if (e.buttons === 0 && this._state !== STATE.NONE) {
      // Lỡ sự kiện up -> tự dừng cho an toàn
      this._onButtonUp(e);
    } else if (
      e.buttons !== this._lastButtons &&
      (e.buttons & 1) === 0 &&
      this._state !== STATE.DRAG_OBJECT
    ) {
      // Tổ hợp nút đổi giữa chừng (vd NX: giữa -> giữa+phải), không có chuột trái
      this._transition(e);
    }

    const dx = e.clientX - this._lastClient.x;
    const dy = e.clientY - this._lastClient.y;

    switch (this._state) {
      case STATE.ROTATE:
        this._rotate(dx, dy);
        this.rotateVelocity.set(dx, dy);
        break;
      case STATE.PAN:
        this._pan(dx, dy);
        this.panVelocity.set(dx, dy);
        break;
      case STATE.DRAG_OBJECT:
        this._executeObjectDrag(e.clientX, e.clientY);
        break;
      case STATE.ZOOM_WINDOW:
        this.marqueeEnd.set(e.clientX, e.clientY);
        if (this.onMarqueeUpdate) this.onMarqueeUpdate(this._getMarqueeRect());
        break;
      default:
        return;
    }
    this._lastClient.set(e.clientX, e.clientY);
  }

  onWheel(e) {
    this._stopInertia();
    const factor = Math.pow(0.999, -e.deltaY * this.zoomSpeed * 0.5);
    this._zoomToCursor(factor, e.clientX, e.clientY);
  }

  // ================= CAMERA MOTIONS (drive vtkCamera) =================

  _rotate(dx, dy) {
    const rect = this.domElement.getBoundingClientRect();
    const thetaAngle = -(dx / rect.width) * Math.PI * this.rotateSpeed; // yaw
    const phiAngle = -(dy / rect.height) * Math.PI * this.rotateSpeed; // pitch

    const vcam = this.vtkCamera;
    const cam = vcam.getThreeCamera();
    const focal = vcam.getFocalPoint();

    const offset = cam.position.clone().sub(focal);
    const q = new THREE.Quaternion();
    q.multiply(new THREE.Quaternion().setFromAxisAngle(cam.up, thetaAngle));
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).normalize();
    q.multiply(new THREE.Quaternion().setFromAxisAngle(camRight, phiAngle));

    offset.applyQuaternion(q);
    cam.position.copy(focal).add(offset);
    cam.up.applyQuaternion(q).normalize();
    cam.lookAt(focal);
    vcam.setFromThree();

    this._afterCameraChange();
  }

  _pan(dx, dy) {
    const rect = this.domElement.getBoundingClientRect();
    const cam = this.camera; // THREE ortho
    const worldH = (cam.top - cam.bottom) / cam.zoom;
    const worldW = (cam.right - cam.left) / cam.zoom;
    const perPxX = worldW / rect.width;
    const perPxY = worldH / rect.height;

    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();

    const move = new THREE.Vector3()
      .addScaledVector(right, -dx * perPxX * this.panSpeed)
      .addScaledVector(up, dy * perPxY * this.panSpeed);

    this.vtkCamera.translate(move);
    this._afterCameraChange();
  }

  _zoomToCursor(factor, clientX, clientY) {
    const cam = this.camera;
    const before =
      clientX != null ? this._screenToWorld(clientX, clientY) : null;

    this.vtkCamera.scaleView(factor); // ortho -> camera.zoom *= factor
    cam.updateProjectionMatrix();

    if (before) {
      const after = this._screenToWorld(clientX, clientY);
      const delta = before.sub(after); // giữ điểm dưới con trỏ đứng yên
      this.vtkCamera.translate(delta);
    }
    this._afterCameraChange();
  }

  _afterCameraChange() {
    this.sceneController.updateClipping?.();
    this.sceneController.requestRender?.();
    this.interactor?.render?.();
  }

  // ================= ACTION RESOLUTION =================

  _resolveAction(e) {
    if ((e.buttons & 1) !== 0) return STATE.NONE; // trái không điều khiển camera
    const action = this.inputStyleHandler.determineAction(e);
    switch (action) {
      case INTERACTION_ACTION.ROTATE:
        return STATE.ROTATE;
      case INTERACTION_ACTION.PAN:
        return STATE.PAN;
      case INTERACTION_ACTION.ZOOM_WINDOW:
        this.marqueeStart.set(e.clientX, e.clientY);
        this.marqueeEnd.copy(this.marqueeStart);
        return STATE.ZOOM_WINDOW;
      default:
        return STATE.NONE;
    }
  }

  _transition(e, force = false) {
    const oldState = this._state;
    this._lastButtons = e.buttons;
    const newState = this._resolveAction(e);
    if (!force && newState === oldState) return;

    if (oldState === STATE.ZOOM_WINDOW && oldState !== newState) {
      if (this.onMarqueeEnd) this.onMarqueeEnd();
    }
    if (oldState === STATE.DRAG_OBJECT && oldState !== newState) {
      this.draggedObject = null;
    }
    this._syncBaseline(e);
    this.rotateVelocity.set(0, 0);
    this.panVelocity.set(0, 0);
    this._state = newState;
  }

  _syncBaseline(e) {
    this._lastClient.set(e.clientX, e.clientY);
  }

  // ================= OBJECT DRAGGING =================

  _raycastObject(clientX, clientY) {
    const scene = this.sceneController?.scene;
    if (!scene) return null;
    const ndc = this._ndc(clientX, clientY);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = scene.children.filter((o) => o.name !== "system_grid");
    const hits = this.raycaster.intersectObjects(targets, true);
    return hits.length > 0 ? hits[0] : null;
  }

  _setupObjectDrag(hit) {
    let root = hit.object;
    while (root.parent && root.parent !== this.sceneController.scene) root = root.parent;
    this.draggedObject = root;

    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal).negate();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);

    const worldPos = new THREE.Vector3();
    this.draggedObject.getWorldPosition(worldPos);
    this.dragOffset.copy(worldPos).sub(hit.point);
  }

  _executeObjectDrag(clientX, clientY) {
    if (!this.draggedObject) return;
    const ndc = this._ndc(clientX, clientY);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.dragPlane, p)) {
      this.draggedObject.position.copy(p.add(this.dragOffset));
      this.sceneController.requestRender?.();
      this.interactor?.render?.();
    }
  }

  // ================= ZOOM WINDOW =================

  _applyZoomWindow(rect) {
    if (rect.width < 4 || rect.height < 4) return; // coi như click, bỏ qua
    const b = this.domElement.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const worldCenter = this._screenToWorld(cx, cy);

    const factor = Math.min(b.width / rect.width, b.height / rect.height);
    this.vtkCamera.scaleView(factor);
    this.camera.updateProjectionMatrix();

    const viewCenterWorld = this._screenToWorld(b.left + b.width / 2, b.top + b.height / 2);
    this.vtkCamera.translate(worldCenter.sub(viewCenterWorld));
    this._afterCameraChange();
  }

  // ================= INERTIA =================

  _startInertia(type, velocity) {
    if (velocity.lengthSq() < 0.5) return;
    this._inertiaActive = type;
    this._inertiaVelocity.copy(velocity);
    this._inertiaTick();
  }
  _stopInertia() {
    this._inertiaActive = null;
    if (this._inertiaRaf) cancelAnimationFrame(this._inertiaRaf);
    this._inertiaRaf = null;
  }
  _inertiaTick = () => {
    if (!this._inertiaActive) return;
    this._inertiaVelocity.multiplyScalar(this.inertiaDecay);
    if (this._inertiaActive === "rotate")
      this._rotate(this._inertiaVelocity.x, this._inertiaVelocity.y);
    else if (this._inertiaActive === "pan")
      this._pan(this._inertiaVelocity.x, this._inertiaVelocity.y);

    if (this._inertiaVelocity.lengthSq() < 0.02) {
      this._inertiaActive = null;
      return;
    }
    this._inertiaRaf = requestAnimationFrame(this._inertiaTick);
  };

  // ================= KEYBOARD =================

  _handleKeyDown(e) {
    const step = 20;
    switch (e.key) {
      case "ArrowLeft":
        this._pan(-step, 0);
        break;
      case "ArrowRight":
        this._pan(step, 0);
        break;
      case "ArrowUp":
        this._pan(0, -step);
        break;
      case "ArrowDown":
        this._pan(0, step);
        break;
      case "+":
      case "=":
        this._zoomToCursor(1.1, null, null);
        break;
      case "-":
      case "_":
        this._zoomToCursor(1 / 1.1, null, null);
        break;
      case "1":
        this.sceneController.setView?.("front");
        break;
      case "2":
        this.sceneController.setView?.("back");
        break;
      case "3":
        this.sceneController.setView?.("left");
        break;
      case "4":
        this.sceneController.setView?.("right");
        break;
      case "5":
        this.sceneController.setView?.("top");
        break;
      case "6":
        this.sceneController.setView?.("bottom");
        break;
      case "0":
        this.sceneController.setView?.("iso");
        break;
      default:
        return;
    }
  }

  // ================= HELPERS =================

  _ndc(x, y) {
    const rect = this.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1
    );
  }

  // Điểm thế giới trên mặt phẳng tiêu cự (đủ dùng cho ortho pan/zoom)
  _screenToWorld(clientX, clientY) {
    const ndc = this._ndc(clientX, clientY);
    return new THREE.Vector3(ndc.x, ndc.y, 0).unproject(this.camera);
  }

  _getMarqueeRect() {
    return {
      x: Math.min(this.marqueeStart.x, this.marqueeEnd.x),
      y: Math.min(this.marqueeStart.y, this.marqueeEnd.y),
      width: Math.abs(this.marqueeStart.x - this.marqueeEnd.x),
      height: Math.abs(this.marqueeStart.y - this.marqueeEnd.y),
    };
  }

  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    this._stopInertia();
  }
}

export default InteractorStyleCAD;