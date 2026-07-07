export const NAV_STYLE = {
  ABAQUS: 'Abaqus',
  BLENDER: 'Blender',
  INVENTOR: 'Inventor',
  NX: 'NX'
};

export const INTERACTION_ACTION = {
  NONE: 'NONE',
  ROTATE: 'ROTATE',
  PAN: 'PAN',
  ZOOM_WINDOW: 'ZOOM_WINDOW'
};

export class InputStyleHandler {
  constructor(style = NAV_STYLE.BLENDER) {
    this.currentStyle = style;
  }

  setStyle(style) {
    if (Object.values(NAV_STYLE).includes(style)) {
      this.currentStyle = style;
    }
  }

  determineAction(event) {
    const shift = event.shiftKey;
    const ctrl = event.ctrlKey;
    const alt = event.altKey;

    // Bitmask kiểm tra nút chuột: 1 = Trái, 2 = Phải, 4 = Giữa
    const isLeftPressed = (event.buttons & 1) !== 0;
    const isRightPressed = (event.buttons & 2) !== 0;
    const isMiddlePressed = (event.buttons & 4) !== 0;
    
    // Kiểm tra đồng thời Giữa (4) + Phải (2) = 6
    const isMiddleAndRightPressed = (event.buttons === 6);

    // BẢO VỆ SELECTION: Chuột trái tuyệt đối không can thiệp vào camera điều hướng
    if (isLeftPressed) {
      return INTERACTION_ACTION.NONE;
    }

    switch (this.currentStyle) {
      case NAV_STYLE.ABAQUS:
        // Thực tế Abaqus: Giữa = Rotate | Ctrl + Alt + Giữa = Pan
        if (isMiddlePressed) {
          return (ctrl && alt) ? INTERACTION_ACTION.PAN : INTERACTION_ACTION.ROTATE;
        }
        if (isRightPressed && event.buttons === 2) {
          return INTERACTION_ACTION.ZOOM_WINDOW;
        }
        break;

      case NAV_STYLE.BLENDER:
        // Thực tế Blender: Giữa = Rotate | Shift + Giữa = Pan
        if (isMiddlePressed) {
          return shift ? INTERACTION_ACTION.PAN : INTERACTION_ACTION.ROTATE;
        }
        if (isRightPressed && event.buttons === 2) {
          return INTERACTION_ACTION.ZOOM_WINDOW;
        }
        break;

      case NAV_STYLE.INVENTOR:
        // Thực tế Inventor: F4 + Trái (bỏ qua vì bảo vệ trái) -> Chuẩn hóa: Shift + Giữa = Rotate | Giữa = Pan
        if (isMiddlePressed) {
          return shift ? INTERACTION_ACTION.ROTATE : INTERACTION_ACTION.PAN;
        }
        if (isRightPressed && event.buttons === 2) {
          return INTERACTION_ACTION.ZOOM_WINDOW;
        }
        break;

      case NAV_STYLE.NX:
        // Thực tế Siemens NX: Giữa = Rotate | Giữa + Phải HOẶC Shift + Giữa = Pan
        if (isMiddleAndRightPressed) {
          return INTERACTION_ACTION.PAN;
        }
        if (isMiddlePressed) {
          return shift ? INTERACTION_ACTION.PAN : INTERACTION_ACTION.ROTATE;
        }
        if (isRightPressed && event.buttons === 2) {
          return INTERACTION_ACTION.ZOOM_WINDOW;
        }
        break;
    }

    return INTERACTION_ACTION.NONE;
  }
}