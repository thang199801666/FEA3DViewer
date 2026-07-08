// threejsVTK/Picking/ActorHighlighter.js
// ---------------------------------------------------------------------------
// ActorHighlighter — chịu trách nhiệm DUY NHẤT về "vẽ" trạng thái highlight
// (surface color, edge color, edge thickness) lên một Actor.
// Không biết gì về chuột, sự kiện hay raycast — chỉ nhận actor + trạng thái.
//
// Trạng thái hỗ trợ: 'default' | 'hover' | 'select'
// ---------------------------------------------------------------------------
import * as THREE from 'three';

/** Palette CAD mặc định — override từng phần qua constructor options. */
export const DEFAULT_HIGHLIGHT_STYLE = {
  hover: {
    surfaceColor: 0xffb366,
    edgeColor: 0xe65c00,
    edgeThicknessFactor: 2.0, // nhân với base thickness của actor
  },
  select: {
    surfaceColor: 0xff9999,
    edgeColor: 0xb30000,
    edgeThicknessFactor: 1.5,
  },
  default: {
    surfaceColor: null,       // null = trả về màu gốc đã lưu
    edgeColor: 0x111111,
    edgeThicknessFactor: 1.0,
  },
};

export class ActorHighlighter {
  /**
   * @param {Object} [options]
   * @param {Object} [options.style]           Merge đè lên DEFAULT_HIGHLIGHT_STYLE
   * @param {Function} [options.onNeedsRender] Callback yêu cầu re-render (vd: sceneController.requestRender)
   */
  constructor({ style = {}, onNeedsRender = null } = {}) {
    this.style = this._mergeStyle(DEFAULT_HIGHLIGHT_STYLE, style);
    this.onNeedsRender = onNeedsRender;
    /** meshId -> THREE.Color gốc của surface */
    this._originalColors = new Map();
  }

  // ------------------------------------------------------------- public API

  /** Áp một trạng thái ('hover' | 'select' | 'default') lên actor. */
  apply(actor, state, { skipSurface = false } = {}) {
    if (!actor) return;
    const s = this.style[state];
    if (!s) throw new Error(`ActorHighlighter: unknown state "${state}"`);

    if (!skipSurface) this._applySurfaceColor(actor, s.surfaceColor);
    this._applyEdgeColor(actor, s.edgeColor);
    this._applyEdgeThickness(actor, s.edgeThicknessFactor);
    this._requestRender();
  }

  /** Trả actor về trạng thái mặc định. */
  reset(actor) {
    this.apply(actor, 'default');
  }

  dispose() {
    this._originalColors.clear();
  }

  // ---------------------------------------------------------------- private

  /**
   * Chỉ đổi màu surface khi actor KHÔNG đang hiển thị contour scalar —
   * kiểm tra qua hasActiveScalarColoring() (không dùng getScalarVisibility()
   * vì flag đó mặc định true kể cả với model trơn).
   */
  _isScalarColored(actor) {
    return typeof actor.hasActiveScalarColoring === 'function'
      ? actor.hasActiveScalarColoring()
      : false;
  }

  _applySurfaceColor(actor, color) {
    if (this._isScalarColored(actor)) return;

    // Actor kiểu Group mới expose thẳng component surface
    const mesh = actor.surface;
    if (!mesh?.isMesh) return;

    // Clone material một lần để không lây màu sang actor dùng chung material
    if (!mesh.userData.isMaterialCloned) {
      mesh.material = mesh.material.clone();
      mesh.userData.isMaterialCloned = true;
    }
    if (!this._originalColors.has(mesh.id)) {
      this._originalColors.set(mesh.id, mesh.material.color.clone());
    }

    if (color == null) {
      // reset về màu gốc
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

  /**
   * factor được nhân với thickness gốc của actor (base * factor), nên actor
   * có base thickness khác 1px vẫn giữ đúng tỉ lệ khi hover/select.
   */
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