// Rendering/RenderWindow.js  — vtkRenderWindow
import * as THREE from 'three';

export class RenderWindow {
  constructor({ container, rendererParams = { antialias: true } } = {}) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer(rendererParams);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.autoClear = false; // clear/scissor per Renderer
    container.appendChild(this.renderer.domElement);

    this.renderers = [];
    this.interactor = null;

    this._running = false;
    this._animate = this._animate.bind(this);
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._onResize();
  }

  get domElement() { return this.renderer.domElement; }

  addRenderer(renderer) {
    renderer.setRenderWindow(this);
    this.renderers.push(renderer);
    return renderer;
  }

  setInteractor(interactor) {
    this.interactor = interactor;
    interactor.setRenderWindow(this);
    return interactor;
  }

  getSize() {
    const r = this.container.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }

  getRendererAt(nx, ny) {
    for (let i = this.renderers.length - 1; i >= 0; i--) {
      const [x0, y0, x1, y1] = this.renderers[i].viewport;
      if (nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1) return this.renderers[i];
    }
    return this.renderers[0] ?? null;
  }

  render() {
    const { width, height } = this.getSize();
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    for (const ren of this.renderers) {
      const [x0, y0, x1, y1] = ren.viewport;
      const vx = Math.floor(x0 * width), vy = Math.floor(y0 * height);
      const vw = Math.floor((x1 - x0) * width), vh = Math.floor((y1 - y0) * height);
      if (vw <= 0 || vh <= 0) continue;
      this.renderer.setViewport(vx, vy, vw, vh);
      this.renderer.setScissor(vx, vy, vw, vh);
      this.renderer.setScissorTest(true);
      ren.updateCameraAspect(vw / vh);
      this.renderer.render(ren.scene, ren.camera);
    }
  }

  start() { if (!this._running) { this._running = true; this._animate(); } }
  stop() { this._running = false; }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.interactor?.dispose();
    this.renderer.dispose();
  }

  _animate() {
    if (!this._running) return;
    requestAnimationFrame(this._animate);
    this.render();
  }

  _onResize() {
    const { width, height } = this.getSize();
    this.renderer.setSize(width, height, false);
  }
}