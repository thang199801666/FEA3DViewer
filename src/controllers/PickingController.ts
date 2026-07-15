import {
    PickMode,
    SubPicker,
    SelectionHighlighter,
    RUBBER_BAND_MODE,
} from "../threejsVTK";

const GRID_NAME = "system_grid";

export const SelectionMode = Object.freeze({
    PART: "Part",
    SURFACE: "Surface",
    POINT: "Point",
    ELEMENT: "Element",
    NODE: "Node",
});

const SELECTION_TO_PICK_MODE = Object.freeze({
    [SelectionMode.PART]: PickMode.PART,
    [SelectionMode.SURFACE]: PickMode.SURFACE,
    [SelectionMode.POINT]: null,
    [SelectionMode.ELEMENT]: PickMode.ELEMENT,
    [SelectionMode.NODE]: PickMode.NODE,
});

const PICK_TO_SELECTION_MODE = Object.freeze({
    [PickMode.PART]: SelectionMode.PART,
    [PickMode.SURFACE]: SelectionMode.SURFACE,
    [PickMode.ELEMENT]: SelectionMode.ELEMENT,
    [PickMode.NODE]: SelectionMode.NODE,
});

function pickModeFromSelectionMode(mode) {
    return SELECTION_TO_PICK_MODE[mode] ?? PickMode.PART;
}

function selectionModeFromPickMode(mode) {
    return PICK_TO_SELECTION_MODE[mode] ?? SelectionMode.PART;
}

function actorResult(actor) {
    if (!actor) return null;
    return {
        mode: PickMode.PART,
        actor,
        id: actor.uuid,
        key: `${actor.uuid}|${PickMode.PART}|${actor.uuid}`,
        point: null,
        tri: null,
    };
}

export class PickingController {
    constructor(sceneController, options = {}) {
        this.sceneController = sceneController;
        this.domElement = sceneController.domElement;

        this.picker = options.picker ?? new SubPicker({
            camera: sceneController.cadCamera ?? sceneController.vtkCamera ?? sceneController.camera,
            domElement: this.domElement,
            getActors: () => this._getSelectableActors(),
            tolerancePx: options.tolerancePx ?? 8,
        });

        this.highlighter = options.highlighter ?? new SelectionHighlighter({
            renderer: sceneController.renderWindow?.renderer ?? null,
            hoverColor: options.hoverColor ?? 0xff8c00,
            selectColor: options.selectColor ?? 0xff0000,
            opacity: options.opacity ?? 0.3,
        });

        this.hoveredActor = null;
        this.hoveredResult = null;
        this.selectedResults = [];
        this.selectedActors = new Set();
        this._lastSelected = null;
        this.selectionMode = options.selectionMode ?? SelectionMode.PART;
        this._listeners = new Map();
        this._downPos = null;

        this._onPointerMove = this._handlePointerMove.bind(this);
        this._onPointerDown = this._handlePointerDown.bind(this);
        this._onPointerUp = this._handlePointerUp.bind(this);
        this._onPointerLeave = this._handlePointerLeave.bind(this);

        this.domElement.addEventListener("pointermove", this._onPointerMove);
        this.domElement.addEventListener("pointerdown", this._onPointerDown);
        this.domElement.addEventListener("pointerup", this._onPointerUp);
        this.domElement.addEventListener("pointerleave", this._onPointerLeave);
    }

    get selectedActor() { return this._lastSelected; }

    on(name, cb) {
        if (!this._listeners.has(name)) this._listeners.set(name, new Set());
        this._listeners.get(name).add(cb);
        return this;
    }

    off(name, cb) {
        this._listeners.get(name)?.delete(cb);
        return this;
    }

    _emit(name, ...args) {
        this._listeners.get(name)?.forEach((cb) => cb(...args));
    }

    _getSelectableActors() {
        const actors = [];
        this.sceneController.scene?.traverse?.((obj) => {
            if (obj?.isActor && obj.visible && obj.name !== GRID_NAME) actors.push(obj);
        });
        return actors;
    }

    _currentPickMode() {
        return pickModeFromSelectionMode(this.selectionMode);
    }

    _pick(clientX, clientY) {
        const mode = this._currentPickMode();
        if (!mode) return null;
        return this.picker.pick(clientX, clientY, mode);
    }

    _handlePointerMove(event) {
        if (this.sceneController.interactorStyle?.isNavigating?.()) {
            this._setHover(null);
            return;
        }
        if (event.buttons !== 0) return;
        this._setHover(this._pick(event.clientX, event.clientY));
    }

    _handlePointerDown(event) {
        if (event.button !== 0) return;
        this._downPos = { x: event.clientX, y: event.clientY };
    }

    _handlePointerUp(event) {
        if (event.button !== 0 || !this._downPos) return;

        const moved = Math.hypot(event.clientX - this._downPos.x, event.clientY - this._downPos.y);
        this._downPos = null;
        const threshold = this.sceneController.interactorStyle?.rubberBandThreshold ?? 3;
        if (moved > threshold || this.sceneController.interactorStyle?.isNavigating?.()) return;

        const result = this._pick(event.clientX, event.clientY);
        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        this.selectResults(result ? [result] : [], { additive });
    }

    _handlePointerLeave() {
        this._setHover(null);
    }

    _setHover(result) {
        if ((result?.key ?? null) === (this.hoveredResult?.key ?? null)) return;
        this.hoveredResult = result;
        this.hoveredActor = result?.actor ?? null;
        this.highlighter.setHover(result);
        this._emit("hover", this.hoveredActor, result, this.selectionMode);
        this.sceneController.requestRender?.();
    }

    selectResults(results, { additive = false } = {}) {
        const next = additive
            ? new Map(this.selectedResults.map((r) => [r.key, r]))
            : new Map();

        for (const result of results) {
            if (!result) continue;
            if (additive && next.has(result.key)) next.delete(result.key);
            else next.set(result.key, result);
        }

        this.selectedResults = Array.from(next.values());
        this.selectedActors = new Set(this.selectedResults.map((r) => r.actor).filter(Boolean));
        this._lastSelected = this.selectedResults.length
            ? this.selectedResults[this.selectedResults.length - 1].actor
            : null;

        this.highlighter.setSelection(this.selectedResults);
        this._emit("select", this._lastSelected, this.selectedResults[this.selectedResults.length - 1] ?? null, this.selectionMode);
        this._emit("selectionchange", [...this.selectedActors], this.selectionMode, this.selectedResults);
        this.sceneController.requestRender?.();
    }

    selectObjects(actors, { additive = false, rect = null, mode = null } = {}) {
        const pickMode = this._currentPickMode();

        if (rect && pickMode) {
            const crossing = mode === RUBBER_BAND_MODE.CROSSING;
            this.selectResults(this.picker.pickRect(rect, pickMode, crossing), { additive });
            return;
        }

        this.selectResults((actors || []).map(actorResult).filter(Boolean), { additive });
    }

    setSelection(results, additive = false) {
        if (!Array.isArray(results)) {
            this.selectResults([], { additive });
            return;
        }
        if (results.length && results[0]?.key) this.selectResults(results, { additive });
        else this.selectObjects(results, { additive });
    }

    selectActors(actors, additive = false) {
        this.selectObjects(actors, { additive });
    }

    select(actor) {
        this.selectObjects(actor ? [actor] : []);
    }

    toggle(actor) {
        if (!actor) return;
        this.selectObjects([actor], { additive: true });
    }

    clearSelection() {
        this.selectResults([]);
    }

    getSelectedActor() { return this._lastSelected; }
    getSelectedActors() { return [...this.selectedActors]; }
    getSelectedResults() { return [...this.selectedResults]; }
    getHoveredActor() { return this.hoveredActor; }
    getHoveredResult() { return this.hoveredResult; }

    setSelectionMode(mode) {
        if (!mode || !Object.values(SelectionMode).includes(mode)) {
            console.warn(`[PickingController] Unknown selectionMode: ${mode}`);
            return this;
        }
        if (mode === this.selectionMode) return this;

        this.selectionMode = mode;
        const pickMode = this._currentPickMode();
        this.picker.tolerancePx = pickMode === PickMode.NODE ? 10 : 8;

        if (!pickMode) {
            console.info("[PickingController] Point selection is not implemented yet.");
        }

        this._setHover(null);
        this.clearSelection();
        this._emit("selectionmodechange", this.selectionMode);
        return this;
    }

    setPickMode(mode) {
        return this.setSelectionMode(selectionModeFromPickMode(mode));
    }

    getSelectionMode() { return this.selectionMode; }
    getPickMode() { return this._currentPickMode(); }

    dispose() {
        this._setHover(null);
        this.clearSelection();
        this.domElement.removeEventListener("pointermove", this._onPointerMove);
        this.domElement.removeEventListener("pointerdown", this._onPointerDown);
        this.domElement.removeEventListener("pointerup", this._onPointerUp);
        this.domElement.removeEventListener("pointerleave", this._onPointerLeave);
        this.highlighter.dispose();
        this._listeners.clear();
    }
}
