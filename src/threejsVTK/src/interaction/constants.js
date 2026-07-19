export const NAV_STYLE = {
    ABAQUS: "Abaqus",
    BLENDER: "Blender",
    INVENTOR: "Inventor",
    NX: "NX",
};

export const INTERACTION_ACTION = {
    NONE: "NONE",
    ROTATE: "ROTATE",
    PAN: "PAN",
    ZOOM_WINDOW: "ZOOM_WINDOW",
    DOLLY: "DOLLY",
};

export const INTERACTION_MODE = {
    SELECT: "select",
    PAN: "pan",
    ROTATE: "rotate",
    ZOOM: "zoom",
    DOLLY: "dolly",
};

/** Internal state of the interactor style */
export const NAV_STATE = {
    NONE: 0,
    ROTATE: 1,
    PAN: 2,
    ZOOM_WINDOW: 3,
    TOUCH_ROTATE: 4,
    TOUCH_PAN_ZOOM: 5,
    RUBBER_BAND: 6,
    DOLLY: 7,
};

/** * Selection mode for rubber band based on horizontal drag direction:
 * Right drag -> CROSSING: selects intersecting or fully contained actors
 * Left drag  -> WINDOW  : selects fully contained actors only
 */
export const RUBBER_BAND_MODE = {
    CROSSING: "crossing",
    WINDOW: "window",
};
