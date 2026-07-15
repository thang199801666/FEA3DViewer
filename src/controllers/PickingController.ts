// src/controllers/PickingController.js
// ---------------------------------------------------------------------------
// App-level PickingController: listens to pointer events, owns hover/selection state,
// and emits events. It delegates raycasting to Picker and drawing to ActorHighlighter.
//
//   DOM events ──> PickingController ──> Picker (ray/cell/point)
//                        │
//                        -> ActorHighlighter (surface/edge style)
//
// Name note: the library also has interaction/picking/PickingController.js.
// Scene imports this app controller as AppPickingController to avoid confusion.
//
// Events registered through .on(name, cb):
//   'hover'           (actor|null, pickResult|null)
//   'select'          (actor|null, pickResult|null)     <- last actor, kept for backward compatibility
//   'selectionchange' (Actor[])                          <- full selection
// ---------------------------------------------------------------------------
import { Picker, ActorHighlighter } from "../threejsVTK";

const GRID_NAME = "system_grid";

// Pick modes corresponding to the StatusBar selection combobox.
// Actors currently expose one pickable `surface` mesh, so every mode hits the
// same object. The mode changes how pickResult is interpreted.
export const SelectionMode = Object.freeze({
    PART: "Part",        // select the whole actor, matching the legacy behavior
    SURFACE: "Surface",  // select the hit sub-mesh
    POINT: "Point",      // select by pointId
    ELEMENT: "Element",  // select by cellId or faceIndex
    NODE: "Node",        // point selection alias for FEA node workflows
});

export class PickingController {
    /**
     * @param {Object} sceneController  Must provide { camera, scene, domElement };
     *                                  optional: requestRender(), interactorStyle, getProps()
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

        /** @type {Set<Object>} source of truth for selection */
        this.selectedActors = new Set();
        /** @type {Object|null} last selected actor for getSelectedActor */
        this._lastSelected = null;

        /** @type {string} current pick mode, see SelectionMode above */
        this.selectionMode = options.selectionMode ?? SelectionMode.PART;

        this._listeners = new Map();

        this._onPointerMove = this._handlePointerMove.bind(this);
        this._onPointerDown = this._handlePointerDown.bind(this);
        this.domElement.addEventListener("pointermove", this._onPointerMove);
        this.domElement.addEventListener("pointerdown", this._onPointerDown);
    }

    /** Backward compatibility: legacy code reads `pc.selectedActor`. */
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
        // Skip hover while orbiting, panning, or zooming to avoid per-frame raycasts.
        if (this.sceneController.interactorStyle?.isNavigating?.()) return;
        const result = this.picker.pickFromClient(event.clientX, event.clientY);
        this._setHover(result?.actor ?? null, result);
    }

    _handlePointerDown(event) {
        if (event.button !== 0) return;                       // left mouse button only
        const result = this.picker.pickFromClient(event.clientX, event.clientY);
        const actor = result?.actor ?? null;
        // Ctrl/Shift adds to the current selection, matching rubber-band additive mode.
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
            // Keep selected surface color and only emphasize hover edges.
            this.highlighter.apply(actor, "hover", {
                skipSurface: this._isSelected(actor),
                mode: this.selectionMode,
                pickResult,
            });
        }
        this._emit("hover", actor, pickResult, this.selectionMode);
    }

    // ---------------------------------------------------------- public API

    /**
     * Sets the selection. Scene.onRubberBandSelect calls this method.
     *
     * Legacy bug: the controller only exposed select(actor), so Scene had to loop over selected actors. Each call reset the previous highlight, leaving only the last actor selected.
     *
     * @param {Object[]} actors
     * @param {Object}  [opts]
     * @param {boolean} [opts.additive=false]  add to the existing selection
     * @param {Object}  [opts.pickResult=null]
     */
    selectObjects(actors, { additive = false, pickResult = null } = {}) {
        const next = additive ? new Set(this.selectedActors) : new Set();
        for (const a of actors) if (a) next.add(a);

        // Clear highlights for actors leaving the selection.
        for (const a of this.selectedActors) {
            if (!next.has(a)) this.highlighter.reset(a);
        }
        // Highlight actors entering the selection.
        for (const a of next) {
            if (!this.selectedActors.has(a)) {
                this.highlighter.apply(a, "select", { mode: this.selectionMode, pickResult });
            }
        }

        this.selectedActors = next;
        this._lastSelected = actors.length ? actors[actors.length - 1] : null;

        // Redraw hover when it points at an actor whose selection state changed.
        if (this.hoveredActor) {
            this.highlighter.apply(this.hoveredActor, "hover", {
                skipSurface: this._isSelected(this.hoveredActor),
                mode: this.selectionMode,
            });
        }

        this._emit("select", this._lastSelected, pickResult, this.selectionMode);
        this._emit("selectionchange", [...this.selectedActors], this.selectionMode);
        this.sceneController.requestRender?.();
    }

    /** Selects one actor programmatically, replacing the existing selection. */
    select(actor) { this.selectObjects(actor ? [actor] : []); }

    /** Toggles an actor in the current selection. */
    toggle(actor) {
        if (!actor) return;
        const next = new Set(this.selectedActors);
        if (next.has(actor)) next.delete(actor);
        else next.add(actor);
        this.selectObjects([...next]);
    }

    clearSelection() { this.selectObjects([]); }

    getSelectedActor() { return this._lastSelected; }
    getSelectedActors() { return [...this.selectedActors]; }
    getHoveredActor() { return this.hoveredActor; }

    /**
     * Changes pick mode (Part / Surface / Point / Element / Node).
     * Scene calls this when the `selectionMode` prop changes.
     * (qua combobox "Select" trong StatusBar).
     *
     * Changing mode clears selection and hover because the meaning of a selected item changes between whole actors and specific points/elements.
     *
     * @param {string} mode  One SelectionMode value.
     */
    setSelectionMode(mode) {
        if (!mode || !Object.values(SelectionMode).includes(mode)) {
            console.warn(`[PickingController] Unknown selectionMode: ${mode}`);
            return this;
        }
        if (mode === this.selectionMode) return this;

        this.selectionMode = mode;

        // Point/Node picks target nearly zero-width positions, so widen the threshold.
        // This is prepared for future point rendering; current picking still raycasts the surface mesh.
        const isPointMode = mode === SelectionMode.POINT || mode === SelectionMode.NODE;
        this.picker.setTolerance({ points: isPointMode ? 8 : 1 });

        this._setHover(null);
        this.clearSelection();

        this._emit("selectionmodechange", this.selectionMode);
        return this;
    }

    getSelectionMode() { return this.selectionMode; }

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
