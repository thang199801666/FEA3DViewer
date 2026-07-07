import * as THREE from 'three';
import { InteractorStyle } from './InteractorStyle.js';
import { InputStyleHandler, INTERACTION_ACTION } from './InputStyleHandler.js';

const STATE = {
  NONE: 0,
  ROTATE: 1,
  PAN: 2,
  ZOOM_WINDOW: 3,
  TOUCH_ROTATE: 4,
  TOUCH_PAN_ZOOM: 5,
  RUBBER_BAND: 6,
};

// Chế độ chọn của rubber band, quyết định bởi HƯỚNG kéo ngang:
//   kéo sang PHẢI  -> CROSSING: chọn actor CHẠM hoặc nằm trong khung
//   kéo sang TRÁI  -> WINDOW  : chỉ chọn actor nằm GỌN trong khung
export const RUBBER_BAND_MODE = {
  CROSSING: 'crossing',
  WINDOW: 'window',
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Độ nhạy xoay CỐ ĐỊNH theo radian/pixel — không phụ thuộc kích thước viewport
// => cảm giác xoay đồng nhất, "chắc tay" ở mọi kích thước cửa sổ.
const ROTATE_RAD_PER_PX = 0.006;

// Bỏ qua các cú nhảy delta bất thường (chuyển tab, mất frame, pointer teleport)
const MAX_DELTA_PX = 120;

// Velocity chỉ được coi là "tươi" để kích inertia nếu lần move cuối < ngưỡng này
const INERTIA_IDLE_MS = 80;

// Sau khi kết thúc một cú DRAG thật sự (rotate/pan/zoom window/rubber band),
// isNavigating() giữ true thêm khoảng này để PickingController không nhầm
// cú nhả chuột cuối drag là một click chọn đơn (sẽ xóa mất selection vừa quét).
// Click/tap thuần (không di chuyển) KHÔNG bị guard này ảnh hưởng.
const CLICK_GUARD_MS = 150;

// Chặn camera lộn qua "cực" khi turntable (giữ chân trời luôn phẳng)
const POLAR_EPS = 0.02;

export class InteractorStyleOrbit extends InteractorStyle {
  constructor(camera, options = {}) {
    super();
    this.cadCamera = camera;

    this.rotateSpeed = options.rotateSpeed ?? 1.0;
    this.panSpeed = options.panSpeed ?? 1.0;
    this.zoomSpeed = options.zoomSpeed ?? 1.0;

    // MẶC ĐỊNH KHÔNG DÙNG DAMPING cho thao tác chuột (theo yêu cầu).
    this.enableDamping = options.enableDamping ?? false;
    this.inertiaDecay = options.inertiaDecay ?? 0.9;

    // 'trackball' (mặc định): xoay TỰ DO theo trục cục bộ của camera,
    // không khóa trục nào — muốn nghiêng thế nào cũng được.
    // 'turntable': yaw khóa quanh trục Y thế giới (kiểu Blender turntable),
    // dùng khi cần chân trời luôn phẳng.
    this.rotateMode = options.rotateMode ?? 'trackball';

    // Cho phép tắt hẳn Zoom Window (marquee chuột phải) bất kể nav style
    // đang map nút nào sang ZOOM_WINDOW. false => hành động đó bị bỏ qua.
    this.enableZoomWindow = options.enableZoomWindow ?? true;

    this.inputHandler = new InputStyleHandler(options.navStyle);

    this._state = STATE.NONE;
    this._lastClient = new THREE.Vector2();
    this._lastMoveTime = 0;
    this._gestureMoved = false;   // gesture hiện tại có di chuyển thật không
    this._gestureEndTime = 0;     // mốc kết thúc drag gần nhất (cho click guard)

    this._pointers = new Map(); // pointerId -> { x, y, type }
    this._pinchStartDist = 0;
    this._touchPanLast = new THREE.Vector2();

    this.rotateVelocity = new THREE.Vector2();
    this.panVelocity = new THREE.Vector2();
    this._inertiaActive = null;
    this._inertiaVelocity = new THREE.Vector2();
    this._inertiaRaf = null;

    this.marqueeStart = new THREE.Vector2();
    this.marqueeEnd = new THREE.Vector2();
    this.onMarqueeUpdate = options.onMarqueeUpdate || null;
    this.onMarqueeEnd = options.onMarqueeEnd || null;

    // ------------------------------------------------------------------
    // RUBBER BAND SELECTION (kéo chuột TRÁI):
    //   - Kéo sang PHẢI : crossing — chọn mọi actor chạm/nằm trong khung
    //   - Kéo sang TRÁI : window   — chỉ chọn actor nằm gọn trong khung
    // Click trái đơn thuần (di chuyển < threshold) vẫn đi qua Picker như cũ.
    // ------------------------------------------------------------------
    this.enableRubberBand = options.enableRubberBand ?? true;
    this.rubberBandThreshold = options.rubberBandThreshold ?? 5; // px
    // () => THREE.Object3D[] — danh sách ứng viên để test chọn (vd: scene.children)
    this.getSelectableObjects = options.getSelectableObjects || null;
    // (o) => boolean — lọc ứng viên; mặc định giống Picker của Scene
    this.rubberBandFilter =
      options.rubberBandFilter ||
      ((o) => o.visible && o.name !== 'system_grid');
    // (rect, mode) => void — vẽ overlay khung chọn (mode để đổi màu/kiểu viền)
    this.onRubberBandUpdate = options.onRubberBandUpdate || null;
    // () => void — ẩn overlay khi kết thúc
    this.onRubberBandEnd = options.onRubberBandEnd || null;
    // (selectedObjects, { rect, mode, additive }) => void — kết quả chọn
    this.onRubberBandSelect = options.onRubberBandSelect || null;

    this._rubberArmed = false;              // đã nhấn trái, chờ vượt threshold
    this._rubberStart = new THREE.Vector2();
    this._rubberEnd = new THREE.Vector2();

    // ------------------------------------------------------------------
    // LƯỚI AN TOÀN TOÀN CỤC — đây là phần sửa lỗi "không select được nữa".
    // Bất kỳ pointerup/pointercancel nào (kể cả ngoài canvas), hoặc mất focus
    // cửa sổ, đều đảm bảo state được giải phóng => isNavigating() không bao
    // giờ bị kẹt ở true và picker luôn hoạt động trở lại.
    // ------------------------------------------------------------------
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onWindowPointerUp = (e) => {
      if (this._pointers.has(e.pointerId)) this._pointerUp(e);
    };
    this._onWindowPointerCancel = () => this._forceRelease();
    this._onWindowBlur = () => this._forceRelease();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('pointerup', this._onWindowPointerUp, true);
    window.addEventListener('pointercancel', this._onWindowPointerCancel, true);
    window.addEventListener('blur', this._onWindowBlur);
  }

  get domElement() {
    return this.cadCamera.domElement;
  }

  setNavStyle(style) {
    this.inputHandler.setStyle(style);
  }

  setDamping(enabled) {
    this.enableDamping = enabled;
    if (!enabled) this._stopInertia();
  }

  /**
   * Picker dựa vào hàm này để quyết định có xử lý hover/select hay không.
   *   - true  : đang giữ thao tác, đang chạy quán tính, HOẶC vừa kết thúc
   *             một cú drag thật sự trong vòng CLICK_GUARD_MS (chặn Picker
   *             nhầm cú nhả chuột cuối drag thành click chọn đơn).
   *   - false : rảnh — click chọn đơn và hover hoạt động bình thường.
   */
  isNavigating() {
    if (this._state !== STATE.NONE || this._inertiaActive !== null) return true;
    return performance.now() - this._gestureEndTime < CLICK_GUARD_MS;
  }

  onLeftButtonDown(e) { this._pointerDown(e); }
  onMiddleButtonDown(e) { this._pointerDown(e); }
  onRightButtonDown(e) { this._pointerDown(e); }

  onLeftButtonUp(e) { this._pointerUp(e); }
  onMiddleButtonUp(e) { this._pointerUp(e); }
  onRightButtonUp(e) { this._pointerUp(e); }

  // ------------------------------------------------------------------
  // Pointer lifecycle
  // ------------------------------------------------------------------

  _pointerDown(e) {
    this._stopInertia();
    this.cadCamera.animation.stop();

    // SỬA LỖI GIẬT ĐẦU THAO TÁC: nếu THREE camera đã bị bên ngoài thay đổi
    // (gizmo, fitView, animation...) mà CameraState chưa biết, delta đầu tiên
    // sẽ apply trên state cũ => actor "nhảy" một khoảng. Đồng bộ lại TRƯỚC
    // khi bắt đầu thao tác để frame đầu tiên đi ra từ đúng vị trí hiện tại.
    this._syncFacadeWithThree();

    this._pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      type: e.pointerType,
    });

    if (this._pointers.size === 1) {
      this._lastClient.set(e.clientX, e.clientY);
      this._lastMoveTime = 0;
      this._gestureMoved = false;
      this.rotateVelocity.set(0, 0);
      this.panVelocity.set(0, 0);

      if (e.pointerType === 'touch') {
        this._state = STATE.TOUCH_ROTATE;
      } else {
        this._state = this._actionToState(this.inputHandler.determineAction(e));
        if (this._state === STATE.ZOOM_WINDOW) {
          this.marqueeStart.set(e.clientX, e.clientY);
          this.marqueeEnd.copy(this.marqueeStart);
        }

        // Chuột TRÁI đơn thuần (buttons === 1): "arm" rubber band nhưng CHƯA
        // kích hoạt — chỉ khi kéo vượt threshold mới thành RUBBER_BAND.
        // Nhờ đó click chọn đơn của Picker hoạt động y như cũ.
        if (
          this._state === STATE.NONE &&
          this.enableRubberBand &&
          e.buttons === 1
        ) {
          this._rubberArmed = true;
          this._rubberStart.set(e.clientX, e.clientY);
          this._rubberEnd.copy(this._rubberStart);
        }
      }
    } else if (this._pointers.size === 2 && e.pointerType === 'touch') {
      this._state = STATE.TOUCH_PAN_ZOOM;
      const pts = Array.from(this._pointers.values());
      this._pinchStartDist = this._dist(pts[0], pts[1]);
      this._touchPanLast.set((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
    }

    // Chỉ capture pointer khi đang thực sự điều hướng (không capture click
    // trái đơn thuần để không ảnh hưởng luồng select/hover của Picker).
    // Capture đảm bảo pointerup LUÔN được nhận kể cả khi nhả chuột ngoài canvas.
    if (this._state !== STATE.NONE) {
      this._capturePointer(e.pointerId);
    }
  }

  _pointerUp(e) {
    if (!this._pointers.has(e.pointerId)) return; // đã được dọn trước đó (chống gọi trùng)

    this._releasePointer(e.pointerId);

    const endedState = this._state;

    if (endedState === STATE.ZOOM_WINDOW) {
      const rect = this._getMarqueeRect();
      if (rect.width > 4 && rect.height > 4 && typeof this.cadCamera.zoomToWindow === 'function') {
        this.cadCamera.zoomToWindow(rect);
      }
      if (this.onMarqueeEnd) this.onMarqueeEnd();
    }

    if (endedState === STATE.RUBBER_BAND) {
      this._rubberEnd.set(e.clientX, e.clientY);
      if (this.onRubberBandEnd) this.onRubberBandEnd();

      const rect = this._getRubberRect();
      const mode = this._getRubberMode();
      if (rect.width > 2 && rect.height > 2) {
        const additive = e.shiftKey || e.ctrlKey;
        let selected = [];
        if (this.getSelectableObjects) {
          selected = this.computeRectSelection(
            this.getSelectableObjects(),
            rect,
            mode
          );
        }
        if (this.onRubberBandSelect) {
          this.onRubberBandSelect(selected, { rect, mode, additive });
        }
      }
    }
    this._rubberArmed = false;

    this._pointers.delete(e.pointerId);

    if (this._pointers.size === 0) {
      // Giải phóng hoàn toàn => Picker nhận lại quyền xử lý click SELECT ngay lập tức
      this._state = STATE.NONE;
    } else if (this._pointers.size === 1) {
      const [p] = this._pointers.values();
      this._lastClient.set(p.x, p.y);
      this._pinchStartDist = 0;
      this._state = p.type === 'touch' ? STATE.TOUCH_ROTATE : STATE.NONE;
    }

    // Kích click guard: chỉ khi gesture vừa kết thúc là một DRAG thật sự
    // (có state điều hướng/band VÀ có di chuyển). Click/tap thuần bỏ qua.
    if (endedState !== STATE.NONE && this._gestureMoved) {
      this._gestureEndTime = performance.now();
    }

    // Inertia chỉ kích khi: damping được bật VÀ velocity còn "tươi"
    // (người dùng nhả tay ngay sau khi đang di chuyển, không phải giữ yên rồi nhả).
    if (this.enableDamping && performance.now() - this._lastMoveTime < INERTIA_IDLE_MS) {
      if (endedState === STATE.ROTATE || endedState === STATE.TOUCH_ROTATE) {
        this._startInertia('rotate', this.rotateVelocity);
      } else if (endedState === STATE.PAN) {
        this._startInertia('pan', this.panVelocity);
      }
    }

    this.interactor?.render?.();
  }

  onMouseMove(e) {
    // Chuột di chuyển mà không giữ nút nào => nếu còn state/pointer sót lại
    // (mất pointerup do drag ra ngoài, context menu, v.v.) thì cưỡng bức reset.
    if (e.pointerType !== 'touch' && e.buttons === 0) {
      if (this._state !== STATE.NONE || this._pointers.size > 0) {
        this._forceRelease();
      }
      return;
    }

    // Move của pointer chưa từng down trên canvas (kéo từ ngoài vào) => bỏ qua
    if (!this._pointers.has(e.pointerId)) return;

    this._pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      type: e.pointerType,
    });

    // Chuyển đổi hành động động (quan trọng với chế độ combine-click của NX:
    // đang giữ Giữa mà nhấn thêm Phải => chuyển ROTATE -> PAN ngay lập tức).
    // BỎ QUA khi chuột trái đang được giữ (buttons & 1) — trái thuộc về
    // select/rubber band, không được để re-eval reset trạng thái.
    if (
      e.pointerType !== 'touch' &&
      this._pointers.size === 1 &&
      (e.buttons & 1) === 0
    ) {
      const next = this._actionToState(this.inputHandler.determineAction(e));
      if (next !== this._state) {
        if (this._state === STATE.ZOOM_WINDOW && this.onMarqueeEnd) this.onMarqueeEnd();
        if (next === STATE.ZOOM_WINDOW) {
          this.marqueeStart.set(e.clientX, e.clientY);
          this.marqueeEnd.copy(this.marqueeStart);
        }
        this.rotateVelocity.set(0, 0);
        this.panVelocity.set(0, 0);
        this._state = next;
      }
    }

    // Rubber band: đã arm bằng chuột trái, kéo vượt threshold => kích hoạt
    if (
      this._state === STATE.NONE &&
      this._rubberArmed &&
      (e.buttons & 1) !== 0
    ) {
      const moved = Math.hypot(
        e.clientX - this._rubberStart.x,
        e.clientY - this._rubberStart.y
      );
      if (moved > this.rubberBandThreshold) {
        this._state = STATE.RUBBER_BAND;
        this._capturePointer(e.pointerId); // đảm bảo nhận up ngoài canvas
      }
    }

    if (this._state === STATE.NONE) {
      this._lastClient.set(e.clientX, e.clientY);
      return;
    }

    const dx = e.clientX - this._lastClient.x;
    const dy = e.clientY - this._lastClient.y;
    if (dx !== 0 || dy !== 0) this._gestureMoved = true;

    // Chặn các cú nhảy bất thường => thao tác luôn mượt và ổn định.
    // (Không áp cho ZOOM_WINDOW / RUBBER_BAND vì chúng dùng tọa độ tuyệt đối.)
    if (
      this._state !== STATE.ZOOM_WINDOW &&
      this._state !== STATE.RUBBER_BAND &&
      (Math.abs(dx) > MAX_DELTA_PX || Math.abs(dy) > MAX_DELTA_PX)
    ) {
      this._lastClient.set(e.clientX, e.clientY);
      return;
    }

    switch (this._state) {
      case STATE.ROTATE:
      case STATE.TOUCH_ROTATE:
        this._rotate(dx, dy);
        this.rotateVelocity.set(dx, dy);
        this._lastMoveTime = performance.now();
        break;

      case STATE.PAN:
        this._pan(dx, dy);
        this.panVelocity.set(dx, dy);
        this._lastMoveTime = performance.now();
        break;

      case STATE.ZOOM_WINDOW:
        this.marqueeEnd.set(e.clientX, e.clientY);
        if (this.onMarqueeUpdate) this.onMarqueeUpdate(this._getMarqueeRect());
        break;

      case STATE.RUBBER_BAND:
        this._rubberEnd.set(e.clientX, e.clientY);
        if (this.onRubberBandUpdate) {
          this.onRubberBandUpdate(this._getRubberRect(), this._getRubberMode());
        }
        break;

      case STATE.TOUCH_PAN_ZOOM: {
        const pts = Array.from(this._pointers.values());
        if (pts.length < 2) break;

        const dist = this._dist(pts[0], pts[1]);
        const scale = dist / Math.max(this._pinchStartDist, 1e-6);
        if (Number.isFinite(scale) && scale > 0) {
          this.cadCamera.dolly(scale, null);
        }
        this._pinchStartDist = dist;

        const center = new THREE.Vector2((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
        this._pan(center.x - this._touchPanLast.x, center.y - this._touchPanLast.y);
        this._touchPanLast.copy(center);
        break;
      }
    }

    this._lastClient.set(e.clientX, e.clientY);
    this.interactor?.render?.();
  }

  onWheel(e) {
    this._stopInertia();
    this.cadCamera.animation.stop();
    this._syncFacadeWithThree();
    const ndc = this.cadCamera.getNDC(e.clientX, e.clientY);
    const factor = Math.pow(0.999, -e.deltaY * this.zoomSpeed * 0.5);
    this.cadCamera.dolly(factor, ndc);
    this.interactor?.render?.();
  }

  // ------------------------------------------------------------------
  // Rotate / Pan
  // ------------------------------------------------------------------

  /**
   * FREE TRACKBALL (mặc định): xoay tự do theo trục cục bộ của camera —
   * yaw quanh Up cục bộ, pitch quanh Right cục bộ, KHÔNG khóa trục nào.
   * Độ nhạy cố định (rad/px), không phụ thuộc kích thước viewport.
   *
   * 'turntable' (tùy chọn): yaw quanh trục Y thế giới + clamp góc cực,
   * dành cho khi cần chân trời luôn phẳng.
   */
  _rotate(dx, dy) {
    const yaw = dx * ROTATE_RAD_PER_PX * this.rotateSpeed;
    const pitch = dy * ROTATE_RAD_PER_PX * this.rotateSpeed;

    if (this.rotateMode !== 'turntable') {
      // Free rotate: ủy quyền thẳng cho CameraMath.orbitLocal qua facade
      this.cadCamera.rotateLocal(yaw, pitch);
      return;
    }

    const s = this.cadCamera.state;
    // Kéo chuột xuống (dy > 0) => eye đi lên, nhìn từ trên xuống
    let pitchWorld = -pitch;

    // Clamp pitch: góc cực phi = góc giữa hướng eye-offset và trục Y thế giới.
    const offsetDir = new THREE.Vector3(0, 0, 1).applyQuaternion(s.quaternion);
    const phi = offsetDir.angleTo(WORLD_UP); // 0..π
    pitchWorld = THREE.MathUtils.clamp(pitchWorld, POLAR_EPS - phi, Math.PI - POLAR_EPS - phi);

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(s.quaternion);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(right, pitchWorld);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, -yaw);

    s.quaternion.premultiply(qPitch).premultiply(qYaw).normalize();

    // Commit qua đường public: rotateLocal(0,0) chạy applyQuaternionToEye
    // + _afterStateChange (sync THREE camera, clipping, onChange, render).
    this.cadCamera.rotateLocal(0, 0);
  }

  _pan(dx, dy) {
    this.cadCamera.pan(dx * this.panSpeed, dy * this.panSpeed);
  }

  // ------------------------------------------------------------------
  // Rubber band selection — test hình học
  // ------------------------------------------------------------------

  _getRubberRect() {
    const x1 = Math.min(this._rubberStart.x, this._rubberEnd.x);
    const y1 = Math.min(this._rubberStart.y, this._rubberEnd.y);
    const x2 = Math.max(this._rubberStart.x, this._rubberEnd.x);
    const y2 = Math.max(this._rubberStart.y, this._rubberEnd.y);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  /** Hướng kéo ngang quyết định chế độ: phải = crossing, trái = window. */
  _getRubberMode() {
    return this._rubberEnd.x >= this._rubberStart.x
      ? RUBBER_BAND_MODE.CROSSING
      : RUBBER_BAND_MODE.WINDOW;
  }

  /**
   * Chọn các object theo khung chữ nhật màn hình (tọa độ client px).
   *   mode 'crossing': footprint màn hình của object GIAO với khung => chọn
   *   mode 'window'  : footprint màn hình nằm GỌN trong khung => chọn
   *
   * Footprint = AABB màn hình của 8 góc bounding box world (Box3.setFromObject),
   * chiếu qua camera trực giao. Đây là cách chuẩn của các CAD viewer; với
   * object gầy/chéo, crossing có thể hơi "rộng tay" một chút (AABB bao ngoài),
   * đổi lại chi phí O(8 điểm chiếu / object) — rất rẻ kể cả scene lớn.
   *
   * Public: có thể gọi độc lập từ PickingController nếu muốn tự quản luồng.
   */
  computeRectSelection(objects, rectPx, mode) {
    if (!Array.isArray(objects) || objects.length === 0) return [];

    const cam = this.cadCamera.three;
    const dom = this.domElement;
    if (!cam || !dom) return [];

    cam.updateMatrixWorld(true);
    const domRect = dom.getBoundingClientRect();
    const rL = rectPx.x;
    const rT = rectPx.y;
    const rR = rectPx.x + rectPx.width;
    const rB = rectPx.y + rectPx.height;

    const box = new THREE.Box3();
    const corner = new THREE.Vector3();
    const selected = [];

    for (const obj of objects) {
      if (!obj || !this.rubberBandFilter(obj)) continue;

      box.setFromObject(obj);
      if (box.isEmpty()) continue;

      // Chiếu 8 góc bounding box -> AABB màn hình (client px)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z
        );
        corner.project(cam); // -> NDC (ortho: an toàn với mọi vị trí)
        const px = domRect.left + ((corner.x + 1) / 2) * domRect.width;
        const py = domRect.top + ((1 - corner.y) / 2) * domRect.height;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }

      const hit =
        mode === RUBBER_BAND_MODE.WINDOW
          ? // Nằm GỌN trong khung
            minX >= rL && maxX <= rR && minY >= rT && maxY <= rB
          : // CHẠM hoặc nằm trong khung (giao AABB)
            minX <= rR && maxX >= rL && minY <= rB && maxY >= rT;

      if (hit) selected.push(obj);
    }

    return selected;
  }

  // ------------------------------------------------------------------
  // Keyboard
  // ------------------------------------------------------------------

  _handleKeyDown(e) {
    // Không cướp phím khi người dùng đang gõ trong input/textarea
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    const c = this.cadCamera;
    const step = 20;
    let handled = true;

    switch (e.key) {
      case 'ArrowLeft':  this._pan(-step, 0); break;
      case 'ArrowRight': this._pan(step, 0); break;
      case 'ArrowUp':    this._pan(0, -step); break;
      case 'ArrowDown':  this._pan(0, step); break;
      case '+': case '=': c.dolly(1.1, null); break;
      case '-': case '_': c.dolly(1 / 1.1, null); break;
      case '1': c.setStandardView('front'); break;
      case '2': c.setStandardView('back'); break;
      case '3': c.setStandardView('left'); break;
      case '4': c.setStandardView('right'); break;
      case '5': c.setStandardView('top'); break;
      case '6': c.setStandardView('bottom'); break;
      case '0': c.setStandardView('iso'); break;
      default:
        handled = false;
        return;
    }

    if (handled) {
      this.interactor?.render?.();
    }
  }

  // ------------------------------------------------------------------
  // Inertia (chỉ chạy khi enableDamping = true; mặc định TẮT)
  // ------------------------------------------------------------------

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
    if (this._inertiaActive === 'rotate') {
      this._rotate(this._inertiaVelocity.x, this._inertiaVelocity.y);
    } else if (this._inertiaActive === 'pan') {
      this._pan(this._inertiaVelocity.x, this._inertiaVelocity.y);
    }
    this.interactor?.render?.();
    if (this._inertiaVelocity.lengthSq() < 0.02) {
      this._inertiaActive = null;
      this._inertiaRaf = null;
      return;
    }
    this._inertiaRaf = requestAnimationFrame(this._inertiaTick);
  };

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Phát hiện CameraState (facade) và THREE camera thật bị lệch nhau —
   * xảy ra khi camera bị thay đổi qua đường khác ngoài facade (view cube
   * gizmo, fitView của SceneController...).
   *
   * QUAN TRỌNG: KHÔNG dùng cadCamera.syncFromThree() ở đây. Hàm đó giữ
   * target CŨ rồi tính lại eye = target + dir·distance, nên khi lệch thật
   * sự thì eye tính ra ≠ vị trí camera thật => chính nó gây ra cú "giật"
   * ở đầu thao tác. Thay vào đó ta ADOPT theo chiều ngược lại:
   *   - eye/quaternion lấy NGUYÊN từ THREE camera (không đổi 1 pixel nào)
   *   - target khôi phục bằng cách bắn tia nhìn về trước theo distance cũ
   * => zero thay đổi hình ảnh, và tâm quay/pan nằm đúng trên trục nhìn.
   */
  _syncFacadeWithThree() {
    const s = this.cadCamera.state;
    const t = this.cadCamera.three;
    if (!t) return;

    t.updateMatrixWorld();

    const posDrift = t.position.distanceToSquared(s.eye) > 1e-10;
    // |dot| ≈ 1 nghĩa là cùng orientation (q và -q là một)
    const quatDrift = Math.abs(t.quaternion.dot(s.quaternion)) < 1 - 1e-7;
    if (!posDrift && !quatDrift) return;

    s.quaternion.copy(t.quaternion).normalize();
    s.eye.copy(t.position);
    s.up.set(0, 1, 0).applyQuaternion(s.quaternion);

    // KHÔI PHỤC TÂM QUAY: không dùng distance cũ (với camera trực giao,
    // distance cũ vô nghĩa sau fitView — camera có thể bị đẩy ra rất xa,
    // target rơi ngay trước mũi camera => tay đòn quay khổng lồ, mô hình
    // văng khỏi khung hình chỉ với một cú xoay nhỏ).
    // Thay vào đó: chiếu một pivot CÓ Ý NGHĨA lên trục nhìn mới để lấy
    // đúng độ sâu của mô hình:
    //   1. bounding sphere của scene (nếu facade đã được set)
    //   2. target cũ — thường vẫn là tâm mô hình, chỉ có eye bị trôi
    //   3. fallback: distance cũ
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quaternion);
    const bs = this.cadCamera._boundingSphere;
    const pivot = (bs && bs.radius > 0) ? bs.center : s.target;

    let depth = new THREE.Vector3().subVectors(pivot, t.position).dot(forward);
    if (!Number.isFinite(depth) || depth < 1e-6) {
      depth = (Number.isFinite(s.distance) && s.distance > 0) ? s.distance : 10;
    }

    s.distance = depth;
    s.target.copy(t.position).addScaledVector(forward, depth);

    // KHÔNG gọi _afterStateChange / render ở đây — về mặt hình ảnh không có
    // gì thay đổi cả; delta đầu tiên của thao tác sẽ tự apply qua facade.
  }

  _actionToState(action) {
    switch (action) {
      case INTERACTION_ACTION.ROTATE:      return STATE.ROTATE;
      case INTERACTION_ACTION.PAN:         return STATE.PAN;
      case INTERACTION_ACTION.ZOOM_WINDOW:
        // Zoom window có thể bị tắt qua options.enableZoomWindow = false
        return this.enableZoomWindow ? STATE.ZOOM_WINDOW : STATE.NONE;
      default:                             return STATE.NONE;
    }
  }

  _capturePointer(pointerId) {
    try { this.domElement?.setPointerCapture?.(pointerId); } catch { /* pointer đã mất */ }
  }

  _releasePointer(pointerId) {
    try { this.domElement?.releasePointerCapture?.(pointerId); } catch { /* chưa capture */ }
  }

  /**
   * Cưỡng bức đưa toàn bộ hệ thống về trạng thái trống. Được gọi khi:
   *   - pointercancel (hệ điều hành thu hồi pointer)
   *   - window mất focus (Alt+Tab, mở context menu hệ thống...)
   *   - phát hiện chuột di chuyển với buttons === 0 nhưng state còn kẹt
   * Đây là chốt chặn đảm bảo isNavigating() luôn trở về false
   * => hover/select KHÔNG BAO GIỜ bị khóa vĩnh viễn.
   */
  _forceRelease() {
    if (this._state === STATE.ZOOM_WINDOW && this.onMarqueeEnd) this.onMarqueeEnd();
    if (this._state === STATE.RUBBER_BAND && this.onRubberBandEnd) this.onRubberBandEnd();
    this._rubberArmed = false;

    for (const id of this._pointers.keys()) {
      this._releasePointer(id);
    }
    this._pointers.clear();
    this._state = STATE.NONE;
    this._pinchStartDist = 0;
    this.rotateVelocity.set(0, 0);
    this.panVelocity.set(0, 0);
    this._stopInertia();
  }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  _getMarqueeRect() {
    const x1 = Math.min(this.marqueeStart.x, this.marqueeEnd.x);
    const y1 = Math.min(this.marqueeStart.y, this.marqueeEnd.y);
    const x2 = Math.max(this.marqueeStart.x, this.marqueeEnd.x);
    const y2 = Math.max(this.marqueeStart.y, this.marqueeEnd.y);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('pointerup', this._onWindowPointerUp, true);
    window.removeEventListener('pointercancel', this._onWindowPointerCancel, true);
    window.removeEventListener('blur', this._onWindowBlur);
    this._forceRelease();
  }
}

export default InteractorStyleOrbit;