// Interaction/PickingController.js

import { PickMode, isSubEntityMode } from "./PickMode.js";
import { SubPicker } from "./SubPicker.js";
import { SelectionHighlighter } from "../highlight/SelectionHighlighter.js";
import { RUBBER_BAND_MODE } from "../constants.js";

export class PickingController {
    /**
     * @param {object} o
     * @param {HTMLElement} o.domElement
     * @param {object} o.camera
     * @param {object} o.interactor
     * @param {() => Actor[]} o.getActors
     * @param {THREE.WebGLRenderer} [o.renderer]
     * @param {() => void} [o.requestRender]
     */
    constructor({ domElement, camera, interactor, getActors, renderer, requestRender, tolerancePx = 8 }) {
        this.domElement = domElement;
        this.interactor = interactor;
        this.getActors = getActors;
        this.requestRender = requestRender || (() => {});

        this.mode = PickMode.PART;
        this.enableHover = true;

        this.picker = new SubPicker({ camera, domElement, getActors, tolerancePx });
        this.highlighter = new SelectionHighlighter({ renderer });

        /** @type {Array} Current active picked selection items collection */
        this.selection = [];
        this.onSelectionChange = null;
        this.onHoverChange = null;

        this._hoverKey = null;
        this._hoverRaf = null;
        this._pendingHover = null;
        this._downPos = null;

        this._onPointerMove = this._handlePointerMove.bind(this);
        this._onPointerDown = this._handlePointerDown.bind(this);
        this._onPointerUp = this._handlePointerUp.bind(this);
        this._onPointerLeave = this._handlePointerLeave.bind(this);

        domElement.addEventListener("pointermove", this._onPointerMove);
        domElement.addEventListener("pointerdown", this._onPointerDown);
        domElement.addEventListener("pointerup", this._onPointerUp);
        domElement.addEventListener("pointerleave", this._onPointerLeave);

        this._wireRubberBand();
    }

    // ------------------------------------------------------------------
    // Mode Management
    // ------------------------------------------------------------------

    setPickMode(mode) {
        if (mode === this.mode) return this;
        if (!Object.values(PickMode).includes(mode)) {
            console.warn(`[PickingController] Invalid pick mode token structure: ${mode}`);
            return this;
        }
        this.mode = mode;
        this.clearSelection();
        this._setHover(null);
        this._wireRubberBand();
        return this;
    }

    getPickMode() { return this.mode; }

    setTolerance(px) { this.picker.tolerancePx = px; return this; }

    // ------------------------------------------------------------------
    // Selection API
    // ------------------------------------------------------------------

    clearSelection() {
        this.selection = [];
        this.highlighter.setSelection([]);
        this._emitSelection();
        this.requestRender();
    }

    _select(results, additive) {
        if (!additive) {
            this.selection = results;
        } else {
            const byKey = new Map(this.selection.map((r) => [r.key, r]));
            for (const r of results) {
                if (byKey.has(r.key)) byKey.delete(r.key); // Toggle entity selection
                else byKey.set(r.key, r);
            }
            this.selection = Array.from(byKey.values());
        }
        this.highlighter.setSelection(this.selection);
        this._emitSelection();
        this.requestRender();
    }

    _emitSelection() {
        if (this.onSelectionChange) this.onSelectionChange(this.selection);
    }

    // ------------------------------------------------------------------
    // Hover Management
    // ------------------------------------------------------------------

    _setHover(result) {
        const key = result ? result.key : null;
        if (key === this._hoverKey) return;
        this._hoverKey = key;
        this.highlighter.setHover(result);
        if (this.onHoverChange) this.onHoverChange(result);
        this.requestRender();
    }

    _handlePointerMove(e) {
        if (!this.enableHover || e.pointerType === "touch") return;
        if (this.interactor && this.interactor.isNavigating()) {
            this._setHover(null);
            return;
        }
        if (e.buttons !== 0) return; // Ignore tracking while clicking or executing a drag event sequence

        // Throttles high-frequency pointer interaction cycles down into single frame animation render steps
        this._pendingHover = { x: e.clientX, y: e.clientY };
        if (this._hoverRaf) return;
        this._hoverRaf = requestAnimationFrame(() => {
            this._hoverRaf = null;
            const p = this._pendingHover;
            if (!p) return;
            this._setHover(this.picker.pick(p.x, p.y, this.mode));
        });
    }

    _handlePointerLeave() {
        this._setHover(null);
    }

    // ------------------------------------------------------------------
    // Discrete Click Events Handling
    // ------------------------------------------------------------------

    _handlePointerDown(e) {
        if (e.button !== 0) return;
        this._downPos = { x: e.clientX, y: e.clientY };
    }

    _handlePointerUp(e) {
        if (e.button !== 0 || !this._downPos) return;
        const moved = Math.hypot(e.clientX - this._downPos.x, e.clientY - this._downPos.y);
        this._downPos = null;

        const threshold = (this.interactor && this.interactor.rubberBandThreshold) || 3;
        if (moved > threshold) return;
        if (this.interactor && this.interactor.isNavigating()) return;

        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        const hit = this.picker.pick(e.clientX, e.clientY, this.mode);

        if (!hit) {
            if (!additive) this.clearSelection();
            return;
        }
        this._select([hit], additive);
    }

    // ------------------------------------------------------------------
    // Rubber Band / Marquee Integration Hooks
    // ------------------------------------------------------------------

    _wireRubberBand() {
        const it = this.interactor;
        if (!it) return;

        it.getSelectableObjects = () => (isSubEntityMode(this.mode) ? [] : this.getActors());

        it.onRubberBandSelect = (actorsSelected, { rect, mode, additive }) => {
            const crossing = mode === RUBBER_BAND_MODE.CROSSING;

            let results;
            if (this.mode === PickMode.PART) {
                results = actorsSelected.map((a) => ({
                    mode: PickMode.PART,
                    actor: a,
                    id: a.uuid,
                    key: `${a.uuid}|${PickMode.PART}|${a.uuid}`,
                    point: null,
                    tri: null
                }));
            } else {
                results = this.picker.pickRect(rect, this.mode, crossing);
            }

            this._select(results, additive);
        };
    }

    // ------------------------------------------------------------------

    dispose() {
        this.domElement.removeEventListener("pointermove", this._onPointerMove);
        this.domElement.removeEventListener("pointerdown", this._onPointerDown);
        this.domElement.removeEventListener("pointerup", this._onPointerUp);
        this.domElement.removeEventListener("pointerleave", this._onPointerLeave);
        if (this._hoverRaf) cancelAnimationFrame(this._hoverRaf);
        this.highlighter.dispose();
    }
}

export default PickingController;