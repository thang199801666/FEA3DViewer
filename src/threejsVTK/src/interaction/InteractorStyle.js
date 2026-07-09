export class InteractorStyle {
  constructor() { this.interactor = null; }
  setInteractor(i) { this.interactor = i; }
  get state() { return this.interactor.state; }

  onLeftButtonDown() {}
  onLeftButtonUp() {}
  onMiddleButtonDown() {}
  onMiddleButtonUp() {}
  onRightButtonDown() {}
  onRightButtonUp() {}
  onMouseMove() {}
  onWheel() {}
}