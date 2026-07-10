export const DEFAULT_SETTINGS = {
    // --- Application / Interface ---
    theme: "light",                 // "dark" | "light" | "blue"
    navStyle: "Blender",           // mouse navigation preset (see NAV_STYLE_OPTIONS)
    displayMode: "modelWithEdges", // actor display mode (see DISPLAY_MODE_OPTIONS)
    isSplit: false,                // show two viewports side by side
    isViewLinked: false,            // synchronize cameras between viewports

    // --- Scene / Graphics ---
    isGradientBackground: true,    // gradient background vs. solid color
    topColor: "#ffffff",           // gradient top color
    bottomColor: "#000000",        // gradient bottom color / solid color
    antialias: true,               // WebGL antialiasing (applied on reload)

    // --- Lighting ---
    addDefaultLights: false,       // let the renderer add its built-in lights (applied on reload)
    ambientIntensity: 0.5,         // ambient light intensity [0..1]
    directionalIntensity: 1.0,     // directional light intensity [0..2]

    // --- Overlays / Helpers ---
    showAxes: true,                // origin orientation triad
    showRuler: true,               // on-screen measurement ruler
    showGrid: false,               // adaptive ground grid
    showTextBlock: false,          // notes / text overlay
};

export const THEME_OPTIONS = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
    { value: "blue", label: "Blue (Office)" },
];

export const NAV_STYLE_OPTIONS = [
    { value: "Blender", label: "Blender" },
    { value: "Maya", label: "Maya" },
];

export const DISPLAY_MODE_OPTIONS = [
    { value: "model", label: "Surface" },
    { value: "modelWithEdges", label: "Surface with edges" },
    { value: "wireframe", label: "Wireframe" },
    { value: "points", label: "Points" },
];

// Convenience helper: build a fresh, independent copy of the defaults.
// Useful for seeding state and for the "Reset to defaults" action.
export const createDefaultSettings = () => ({ ...DEFAULT_SETTINGS });