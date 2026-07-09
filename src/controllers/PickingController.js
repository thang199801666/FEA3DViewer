// src/controllers/PickingController.js
// ---------------------------------------------------------------------------
// PickingController (TẦNG APP) — lắng nghe pointer event, giữ state hover/select
// và phát event. KHÔNG tự raycast (dùng Picker), KHÔNG tự tô màu (dùng ActorHighlighter).
//
//   DOM events ──> PickingController ──> Picker (ray/cell/point)
//                        │
//                        └────────────> ActorHighlighter (màu/edge)
//
// ⚠ TRÙNG TÊN: thư viện cũng có interaction/picking/PickingController.js — một lớp
//   KHÁC. Scene.jsx import file này với alias AppPickingController để tránh nhầm.
//
// Events (đăng ký qua .on(name, cb)):
//   'hover'           (actor|null, pickResult|null)
//   'select'          (actor|null, pickResult|null)     ← actor cuối cùng, tương thích ngược
//   'selectionchange' (Actor[])                          ← toàn bộ selection
// ---------------------------------------------------------------------------
import { Picker, ActorHighlighter } from "../threejsVTK";

const GRID_NAME = "system_grid";

export class PickingController {
    /**
     * @param {Object} sceneController  Phải có { camera, scene, domElement };
     *                                  tùy chọn: requestRender(), interactorStyle, getProps()
     * @param {Object} [options]
     * @param {Picker} [options.picker]
     * @param {ActorHighlighter} [options.highlighter]
     * @param {Object} [options.highlightStyle]
     * @param {Function} [options.filter]
     */
    constructor(sceneController, options = {}) {
        this.sceneController = sceneController;
        this.domElement = sceneController.domElement;

        this.picker = options.picker ?? new Picker({
            renderer: sceneController,
            recursive: true,
            filter: options.filter ?? ((obj) => obj.isMesh && obj.name !== GRID_NAME),
        });

        this.highlighter = options.highlighter ?? new ActorHighlighter({
            style: options.highlightStyle,
            onNeedsRender: () => sceneController.requestRender?.(),
        });

        /** @type {Object|null} */
        this.hoveredActor = null;

        /** @type {Set<Object>} nguồn sự thật của selection */
        this.selectedActors = new Set();
        /** @type {Object|null} actor được chọn sau cùng (cho getSelectedActor) */
        this._lastSelected = null;

        this._listeners = new Map();

        this._onPointerMove = this._handlePointerMove.bind(this);
        this._onPointerDown = this._handlePointerDown.bind(this);
        this.domElement.addEventListener("pointermove", this._onPointerMove);
        this.domElement.addEventListener("pointerdown", this._onPointerDown);
    }

    /** Tương thích ngược: code cũ đọc `pc.selectedActor`. */
    get selectedActor() { return this._lastSelected; }

    // ------------------------------------------------------------ emitter

    on(name, cb) {
        if (!this._listeners.has(name)) this._listeners.set(name, new Set());
        this._listeners.get(name).add(cb);
        return this;
    }
    off(name, cb) { this._listeners.get(name)?.delete(cb); return this; }
    _emit(name, ...args) { this._listeners.get(name)?.forEach((cb) => cb(...args)); }

    // ------------------------------------------------------- DOM handlers

    _handlePointerMove(event) {
        // Bỏ qua hover khi đang xoay/pan/zoom để không tốn raycast mỗi frame
        if (this.sceneController.interactorStyle?.isNavigating?.()) return;
        const result = this.picker.pickFromClient(event.clientX, event.clientY);
        this._setHover(result?.actor ?? null, result);
    }

    _handlePointerDown(event) {
        if (event.button !== 0) return;                       // chỉ chuột trái
        const result = this.picker.pickFromClient(event.clientX, event.clientY);
        const actor = result?.actor ?? null;
        // Ctrl/Shift = cộng dồn, giống rubber band additive
        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        this.selectObjects(actor ? [actor] : [], { additive, pickResult: result });
    }

    // -------------------------------------------------------- state logic

    _isSelected(actor) { return this.selectedActors.has(actor); }

    _setHover(actor, pickResult = null) {
        if (actor === this.hoveredActor) return;

        const prev = this.hoveredActor;
        if (prev) this.highlighter.apply(prev, this._isSelected(prev) ? "select" : "default");

        this.hoveredActor = actor;
        if (actor) {
            // actor đang selected thì giữ màu surface select, chỉ nhấn edge hover
            this.highlighter.apply(actor, "hover", { skipSurface: this._isSelected(actor) });
        }
        this._emit("hover", actor, pickResult);
    }

    // ---------------------------------------------------------- public API

    /**
     * Đặt selection. Đây là method mà Scene.onRubberBandSelect gọi.
     *
     * BUG CŨ: controller chỉ có `select(actor)`, và Scene phải lặp
     * `selected.forEach(o => pc.select(o))`. Mỗi lời gọi `_setSelect` lại RESET
     * actor trước đó, nên quét 10 actor chỉ còn 1 actor cuối được highlight.
     *
     * @param {Object[]} actors
     * @param {Object}  [opts]
     * @param {boolean} [opts.additive=false]  cộng dồn vào selection hiện có
     * @param {Object}  [opts.pickResult=null]
     */
    selectObjects(actors, { additive = false, pickResult = null } = {}) {
        const next = additive ? new Set(this.selectedActors) : new Set();
        for (const a of actors) if (a) next.add(a);

        // Bỏ highlight những actor rời khỏi selection
        for (const a of this.selectedActors) {
            if (!next.has(a)) this.highlighter.reset(a);
        }
        // Highlight những actor mới vào
        for (const a of next) {
            if (!this.selectedActors.has(a)) this.highlighter.apply(a, "select");
        }

        this.selectedActors = next;
        this._lastSelected = actors.length ? actors[actors.length - 1] : null;

        // Hover đang trỏ vào actor vừa đổi trạng thái -> vẽ lại cho đúng
        if (this.hoveredActor) {
            this.highlighter.apply(this.hoveredActor, "hover", {
                skipSurface: this._isSelected(this.hoveredActor),
            });
        }

        this._emit("select", this._lastSelected, pickResult);
        this._emit("selectionchange", [...this.selectedActors]);
        this.sceneController.requestRender?.();
    }

    /** Select một actor bằng code (thay thế selection hiện có). */
    select(actor) { this.selectObjects(actor ? [actor] : []); }

    /** Thêm/bớt một actor khỏi selection. */
    toggle(actor) {
        if (!actor) return;
        const next = new Set(this.selectedActors);
        next.has(actor) ? next.delete(actor) : next.add(actor);
        this.selectObjects([...next]);
    }

    clearSelection() { this.selectObjects([]); }

    getSelectedActor() { return this._lastSelected; }
    getSelectedActors() { return [...this.selectedActors]; }
    getHoveredActor() { return this.hoveredActor; }

    dispose() {
        this._setHover(null);
        this.clearSelection();
        this.domElement.removeEventListener("pointermove", this._onPointerMove);
        this.domElement.removeEventListener("pointerdown", this._onPointerDown);
        this.highlighter.dispose();
        this._listeners.clear();
    }
}

































// // threejsVTK/Picking/PickingController.js
// // ---------------------------------------------------------------------------
// // PickingController — tầng "interactor": lắng nghe pointer event, giữ state
// // hover/select và phát event. KHÔNG tự raycast (dùng Picker của thư viện),
// // KHÔNG tự tô màu (dùng ActorHighlighter).
// //
// //   DOM events ──> PickingController ──> Picker (ray/cell/point)
// //                        │
// //                        └────────────> ActorHighlighter (màu/edge)
// //
// // Events (đăng ký qua .on(name, cb)):
// //   'hover'  (actor|null, pickResult|null)
// //   'select' (actor|null, pickResult|null)
// // ---------------------------------------------------------------------------
// import { Picker } from '../threejsVTK/Picking/Picker.js';
// import { ActorHighlighter } from '../threejsVTK/Picking/ActorHighlighter.js';

// export class PickingController {
//   /**
//    * @param {Object} sceneController  Phải có { camera, scene, domElement };
//    *                                  tùy chọn: requestRender(), interactorStyle, getProps()
//    * @param {Object} [options]
//    * @param {Picker} [options.picker]             Truyền picker riêng nếu muốn dùng chung
//    * @param {ActorHighlighter} [options.highlighter]
//    * @param {Object} [options.highlightStyle]     Override palette (xem ActorHighlighter)
//    * @param {Function} [options.filter]           Predicate lọc object pickable
//    */
//   constructor(sceneController, options = {}) {
//     this.sceneController = sceneController;
//     this.domElement = sceneController.domElement;

//     // --- Picker: dùng lớp thư viện, mặc định bỏ qua grid hệ thống
//     this.picker = options.picker ?? new Picker({
//       renderer: sceneController,
//       recursive: true,
//       filter: options.filter ?? ((obj) => obj.isMesh && obj.name !== 'system_grid'),
//     });

//     // --- Highlighter: tách riêng phần "vẽ"
//     this.highlighter = options.highlighter ?? new ActorHighlighter({
//       style: options.highlightStyle,
//       onNeedsRender: () => sceneController.requestRender?.(),
//     });

//     /** @type {Object|null} */ this.hoveredActor = null;
//     /** @type {Object|null} */ this.selectedActor = null;

//     this._listeners = new Map(); // eventName -> Set<cb>

//     this._onPointerMove = this._handlePointerMove.bind(this);
//     this._onPointerDown = this._handlePointerDown.bind(this);
//     this.domElement.addEventListener('pointermove', this._onPointerMove);
//     this.domElement.addEventListener('pointerdown', this._onPointerDown);
//   }

//   // ---------------------------------------------------------- event emitter

//   on(name, cb)  { (this._listeners.get(name) ?? this._listeners.set(name, new Set()).get(name)).add(cb); return this; }
//   off(name, cb) { this._listeners.get(name)?.delete(cb); return this; }
//   _emit(name, ...args) { this._listeners.get(name)?.forEach((cb) => cb(...args)); }

//   // ------------------------------------------------------------ DOM handlers

//   _handlePointerMove(event) {
//     // Bỏ qua hover khi đang xoay/pan/zoom để không tốn raycast mỗi frame
//     const style = this.sceneController.interactorStyle;
//     if (style?.isNavigating?.()) return;

//     const result = this.picker.pickFromClient(event.clientX, event.clientY);
//     this._setHover(result?.actor ?? null, result);
//   }

//   _handlePointerDown(event) {
//     if (event.button !== 0) return; // chỉ chuột trái
//     const result = this.picker.pickFromClient(event.clientX, event.clientY);
//     this._setSelect(result?.actor ?? null, result);
//   }

//   // ------------------------------------------------------------ state logic

//   _setHover(actor, pickResult = null) {
//     if (actor === this.hoveredActor) return;

//     // trả actor hover cũ về đúng trạng thái của nó
//     const prev = this.hoveredActor;
//     if (prev) {
//       this.highlighter.apply(prev, prev === this.selectedActor ? 'select' : 'default');
//     }

//     this.hoveredActor = actor;
//     if (actor) {
//       // actor đang selected thì giữ màu surface select, chỉ nhấn edge hover
//       this.highlighter.apply(actor, 'hover', { skipSurface: actor === this.selectedActor });
//     }
//     this._emit('hover', actor, pickResult);
//   }

//   _setSelect(actor, pickResult = null) {
//     if (this.hoveredActor) this._setHover(null);

//     const prev = this.selectedActor;
//     if (prev && prev !== actor) this.highlighter.reset(prev);

//     this.selectedActor = actor;
//     if (actor) this.highlighter.apply(actor, 'select');
//     this._emit('select', actor, pickResult);
//   }

//   // -------------------------------------------------------------- public API

//   /** Select actor bằng code (không qua chuột) */
//   select(actor) { this._setSelect(actor); }

//   clearSelection() { this._setSelect(null); }

//   getSelectedActor() { return this.selectedActor; }
//   getHoveredActor()  { return this.hoveredActor; }

//   dispose() {
//     this._setHover(null);
//     this._setSelect(null);
//     this.domElement.removeEventListener('pointermove', this._onPointerMove);
//     this.domElement.removeEventListener('pointerdown', this._onPointerDown);
//     this.highlighter.dispose();
//     this._listeners.clear();
//   }
// }