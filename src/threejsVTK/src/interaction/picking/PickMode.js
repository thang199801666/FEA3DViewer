// Interaction/PickMode.js

export const PickMode = Object.freeze({
    PART: "part",
    SURFACE: "surface",
    EDGE: "edge",
    POINT: "point",
    ELEMENT: "element",
    NODE: "node"
});

/** Modes that operate on sub-entities of an actor rather than the entire actor. */
export const SUB_ENTITY_MODES = Object.freeze([
    PickMode.SURFACE,
    PickMode.EDGE,
    PickMode.POINT,
    PickMode.ELEMENT,
    PickMode.NODE
]);

/** Modes evaluated using screen-space distance thresholding instead of raycasting. */
export const SCREEN_SPACE_MODES = Object.freeze([
    PickMode.EDGE,
    PickMode.POINT,
    PickMode.NODE
]);

export function isSubEntityMode(mode) {
    return SUB_ENTITY_MODES.indexOf(mode) !== -1;
}

export function isScreenSpaceMode(mode) {
    return SCREEN_SPACE_MODES.indexOf(mode) !== -1;
}

/** Unique key used for comparing and merging selections. */
export function pickKey(actor, mode, id) {
    return `${actor.uuid}|${mode}|${id ?? ""}`;
}

export default PickMode;