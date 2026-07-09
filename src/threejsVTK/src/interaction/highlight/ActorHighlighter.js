import * as THREE from 'three';

export const DEFAULT_HIGHLIGHT_STYLE = {
  hover: {
    surfaceColor: 0xffb366,
    edgeColor: 0xe65c00,
    edgeThicknessFactor: 2.0,
  },
  select: {
    surfaceColor: 0xff9999,
    edgeColor: 0xb30000,
    edgeThicknessFactor: 1.5,
  },
  default: {
    surfaceColor: null,
    edgeColor: 0x111111,
    edgeThicknessFactor: 1.0,
  },
};

export class ActorHighlighter {
  /**
   * @param {Object} [options]
   * @param {Object} [options.style]           Overrides fields in DEFAULT_HIGHLIGHT_STYLE
   * @param {Function} [options.onNeedsRender] Callback to request a scene re-render
   */
  constructor({ style = {}, onNeedsRender = null } = {}) {
    this.style = this._mergeStyle(DEFAULT_HIGHLIGHT_STYLE, style);
    this.onNeedsRender = onNeedsRender;
    this._originalColors = new Map();
  }

  /** Applies a visual state ('hover' | 'select' | 'default') to the given actor. */
  apply(actor, state, { skipSurface = false } = {}) {
    if (!actor) return;
    const s = this.style[state];
    if (!s) throw new Error(`ActorHighlighter: unknown state "${state}"`);

    if (!skipSurface) this._applySurfaceColor(actor, s.surfaceColor);
    this._applyEdgeColor(actor, s.edgeColor);
    this._applyEdgeThickness(actor, s.edgeThicknessFactor);
    this._requestRender();
  }

  /** Resets the actor back to its default state. */
  reset(actor) {
    this.apply(actor, 'default');
  }

  dispose() {
    this._originalColors.clear();
  }

  // ---------------------------------------------------------------- Private

  /** Checks if the actor has active contour scalar coloring. */
  _isScalarColored(actor) {
    return typeof actor.hasActiveScalarColoring === 'function'
      ? actor.hasActiveScalarColoring()
      : false;
  }

  _applySurfaceColor(actor, color) {
    if (this._isScalarColored(actor)) return;

    const mesh = actor.surface;
    if (!mesh?.isMesh) return;

    if (!mesh.userData.isMaterialCloned) {
      mesh.material = mesh.material.clone();
      mesh.userData.isMaterialCloned = true;
    }
    if (!this._originalColors.has(mesh.id)) {
      this._originalColors.set(mesh.id, mesh.material.color.clone());
    }

    if (color == null) {
      const orig = this._originalColors.get(mesh.id);
      if (orig) mesh.material.color.copy(orig);
    } else {
      mesh.material.color.set(color);
    }
  }

  _applyEdgeColor(actor, color) {
    if (color == null) return;
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    if (typeof actor.setEdgeColor === 'function') {
      actor.setEdgeColor(c);
    } else if (typeof actor.setFeatureEdgeColor === 'function') {
      actor.setFeatureEdgeColor(c);
    }
  }

  _applyEdgeThickness(actor, factor) {
    if (factor == null) return;
    if (typeof actor.setFeatureEdgeThickness !== 'function') return;
    const base = actor._baseEdgeThickness ?? 1.0;
    actor.setFeatureEdgeThickness(base * factor);
  }

  _requestRender() {
    this.onNeedsRender?.();
  }

  _mergeStyle(defaults, overrides) {
    const out = {};
    for (const key of Object.keys(defaults)) {
      out[key] = { ...defaults[key], ...(overrides[key] ?? {}) };
    }
    return out;
  }
}