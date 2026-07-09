import { NAV_STYLE, INTERACTION_ACTION } from "./constants.js";
export { NAV_STYLE, INTERACTION_ACTION };

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

    // Mouse button bitmask checks: 1 = Left, 2 = Right, 4 = Middle
    const isLeftPressed = (event.buttons & 1) !== 0;
    const isRightPressed = (event.buttons & 2) !== 0;
    const isMiddlePressed = (event.buttons & 4) !== 0;
    
    // Concurrent Middle (4) + Right (2) = 6
    const isMiddleAndRightPressed = (event.buttons === 6);

    // Left click is absolute safety guard for object selection/manipulation
    if (isLeftPressed) {
      return INTERACTION_ACTION.NONE;
    }

    switch (this.currentStyle) {
      case NAV_STYLE.ABAQUS:
        if (isMiddlePressed) {
          return (ctrl && alt) ? INTERACTION_ACTION.PAN : INTERACTION_ACTION.ROTATE;
        }
        if (isRightPressed && event.buttons === 2) {
          return INTERACTION_ACTION.ZOOM_WINDOW;
        }
        break;

      case NAV_STYLE.BLENDER:
        if (isMiddlePressed) {
          return shift ? INTERACTION_ACTION.PAN : INTERACTION_ACTION.ROTATE;
        }
        if (isRightPressed && event.buttons === 2) {
          return INTERACTION_ACTION.ZOOM_WINDOW;
        }
        break;

      case NAV_STYLE.INVENTOR:
        if (isMiddlePressed) {
          return shift ? INTERACTION_ACTION.ROTATE : INTERACTION_ACTION.PAN;
        }
        if (isRightPressed && event.buttons === 2) {
          return INTERACTION_ACTION.ZOOM_WINDOW;
        }
        break;

      case NAV_STYLE.NX:
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