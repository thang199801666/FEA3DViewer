// threejsVTK/Picking/PickingController.js
// ---------------------------------------------------------------------------
// PickingController — tầng "interactor": lắng nghe pointer event, giữ state
// hover/select và phát event. KHÔNG tự raycast (dùng Picker của thư viện),
// KHÔNG tự tô màu (dùng ActorHighlighter).
//
//   DOM events ──> PickingController ──> Picker (ray/cell/point)
//                        │
//                        └────────────> ActorHighlighter (màu/edge)
//
// Events (đăng ký qua .on(name, cb)):
//   'hover'  (actor|null, pickResult|null)
//   'select' (actor|null, pickResult|null)
// ---------------------------------------------------------------------------
import { Picker } from '../threejsVTK/Picking/Picker.js';
import { ActorHighlighter } from '../threejsVTK/Picking/ActorHighlighter.js';

export class PickingController {
  /**
   * @param {Object} sceneController  Phải có { camera, scene, domElement };
   *                                  tùy chọn: requestRender(), interactorStyle, getProps()
   * @param {Object} [options]
   * @param {Picker} [options.picker]             Truyền picker riêng nếu muốn dùng chung
   * @param {ActorHighlighter} [options.highlighter]
   * @param {Object} [options.highlightStyle]     Override palette (xem ActorHighlighter)
   * @param {Function} [options.filter]           Predicate lọc object pickable
   */
  constructor(sceneController, options = {}) {
    this.sceneController = sceneController;
    this.domElement = sceneController.domElement;

    // --- Picker: dùng lớp thư viện, mặc định bỏ qua grid hệ thống
    this.picker = options.picker ?? new Picker({
      renderer: sceneController,
      recursive: true,
      filter: options.filter ?? ((obj) => obj.isMesh && obj.name !== 'system_grid'),
    });

    // --- Highlighter: tách riêng phần "vẽ"
    this.highlighter = options.highlighter ?? new ActorHighlighter({
      style: options.highlightStyle,
      onNeedsRender: () => sceneController.requestRender?.(),
    });

    /** @type {Object|null} */ this.hoveredActor = null;
    /** @type {Object|null} */ this.selectedActor = null;

    this._listeners = new Map(); // eventName -> Set<cb>

    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this.domElement.addEventListener('pointermove', this._onPointerMove);
    this.domElement.addEventListener('pointerdown', this._onPointerDown);
  }

  // ---------------------------------------------------------- event emitter

  on(name, cb)  { (this._listeners.get(name) ?? this._listeners.set(name, new Set()).get(name)).add(cb); return this; }
  off(name, cb) { this._listeners.get(name)?.delete(cb); return this; }
  _emit(name, ...args) { this._listeners.get(name)?.forEach((cb) => cb(...args)); }

  // ------------------------------------------------------------ DOM handlers

  _handlePointerMove(event) {
    // Bỏ qua hover khi đang xoay/pan/zoom để không tốn raycast mỗi frame
    const style = this.sceneController.interactorStyle;
    if (style?.isNavigating?.()) return;

    const result = this.picker.pickFromClient(event.clientX, event.clientY);
    this._setHover(result?.actor ?? null, result);
  }

  _handlePointerDown(event) {
    if (event.button !== 0) return; // chỉ chuột trái
    const result = this.picker.pickFromClient(event.clientX, event.clientY);
    this._setSelect(result?.actor ?? null, result);
  }

  // ------------------------------------------------------------ state logic

  _setHover(actor, pickResult = null) {
    if (actor === this.hoveredActor) return;

    // trả actor hover cũ về đúng trạng thái của nó
    const prev = this.hoveredActor;
    if (prev) {
      this.highlighter.apply(prev, prev === this.selectedActor ? 'select' : 'default');
    }

    this.hoveredActor = actor;
    if (actor) {
      // actor đang selected thì giữ màu surface select, chỉ nhấn edge hover
      this.highlighter.apply(actor, 'hover', { skipSurface: actor === this.selectedActor });
    }
    this._emit('hover', actor, pickResult);
  }

  _setSelect(actor, pickResult = null) {
    if (this.hoveredActor) this._setHover(null);

    const prev = this.selectedActor;
    if (prev && prev !== actor) this.highlighter.reset(prev);

    this.selectedActor = actor;
    if (actor) this.highlighter.apply(actor, 'select');
    this._emit('select', actor, pickResult);
  }

  // -------------------------------------------------------------- public API

  /** Select actor bằng code (không qua chuột) */
  select(actor) { this._setSelect(actor); }

  clearSelection() { this._setSelect(null); }

  getSelectedActor() { return this.selectedActor; }
  getHoveredActor()  { return this.hoveredActor; }

  dispose() {
    this._setHover(null);
    this._setSelect(null);
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.highlighter.dispose();
    this._listeners.clear();
  }
}