// Interaction/RenderWindowInteractor.js  — vtkRenderWindowInteractor
export class RenderWindowInteractor {
  constructor() {
    this.renderWindow = null;
    this.style = null;
    this.picker = null;
    this.state = {
      pointer: { x: 0, y: 0 },
      lastPointer: { x: 0, y: 0 },
      button: -1,                      // 0 left, 1 middle, 2 right
      shift: false, ctrl: false, alt: false,
      currentRenderer: null,
    };
    this._bound = {};
  }

  setRenderWindow(rw) { this.renderWindow = rw; }
  setInteractorStyle(style) { this.style = style; style.setInteractor(this); return style; }
  setPicker(picker) { this.picker = picker; return picker; }

  initialize() {
    const el = this.renderWindow.domElement;
    el.style.touchAction = 'none';
    this._bound.down = e => this._onPointerDown(e);
    this._bound.move = e => this._onPointerMove(e);
    this._bound.up = e => this._onPointerUp(e);
    this._bound.wheel = e => this._onWheel(e);
    this._bound.ctx = e => e.preventDefault();
    el.addEventListener('pointerdown', this._bound.down);
    el.addEventListener('pointermove', this._bound.move);
    window.addEventListener('pointerup', this._bound.up);
    el.addEventListener('wheel', this._bound.wheel, { passive: false });
    el.addEventListener('contextmenu', this._bound.ctx);
  }

  dispose() {
    const el = this.renderWindow?.domElement;
    if (!el) return;
    el.removeEventListener('pointerdown', this._bound.down);
    el.removeEventListener('pointermove', this._bound.move);
    window.removeEventListener('pointerup', this._bound.up);
    el.removeEventListener('wheel', this._bound.wheel);
    el.removeEventListener('contextmenu', this._bound.ctx);
  }

  render() { this.renderWindow.render(); }

  _updatePointer(e) {
    const rect = this.renderWindow.domElement.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = 1 - (e.clientY - rect.top) / rect.height; // y-up
    this.state.lastPointer = { ...this.state.pointer };
    this.state.pointer = { x: nx, y: ny };
    this.state.shift = e.shiftKey;
    this.state.ctrl = e.ctrlKey;
    this.state.alt = e.altKey;
    this.state.currentRenderer = this.renderWindow.getRendererAt(nx, ny);
  }

  _onPointerDown(e) {
    this._updatePointer(e);
    this.state.button = e.button;
    this.renderWindow.domElement.setPointerCapture?.(e.pointerId);
    if (!this.style) return;
    if (e.button === 0) this.style.onLeftButtonDown(e);
    else if (e.button === 1) this.style.onMiddleButtonDown(e);
    else if (e.button === 2) this.style.onRightButtonDown(e);
  }

  _onPointerMove(e) { this._updatePointer(e); this.style?.onMouseMove(e); }

  _onPointerUp(e) {
    this._updatePointer(e);
    if (this.style) {
      if (this.state.button === 0) this.style.onLeftButtonUp(e);
      else if (this.state.button === 1) this.style.onMiddleButtonUp(e);
      else if (this.state.button === 2) this.style.onRightButtonUp(e);
    }
    this.state.button = -1;
  }

  _onWheel(e) { e.preventDefault(); this._updatePointer(e); this.style?.onWheel(e); }
}