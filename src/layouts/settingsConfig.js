// ---------------------------------------------------------------------------
// Central configuration for every application & scene property.
//
// This is the single place that owns all tunable settings. It is consumed by:
//   - MainLayout    (holds the live `settings` state, seeded from DEFAULT_SETTINGS)
//   - SettingsDialog (renders the editor UI from the option lists below)
//
// To expose a new property to the whole app: add it here once, then read it
// from `settings` in MainLayout and pass it down as a prop.
// ---------------------------------------------------------------------------

// Default value for every setting the app exposes.
export const DEFAULT_SETTINGS = {
    // --- Application / Interface ---
    theme: "dark",                 // "dark" | "light"
    navStyle: "Blender",           // mouse navigation preset (see NAV_STYLE_OPTIONS)
    displayMode: "modelWithEdges", // actor display mode (see DISPLAY_MODE_OPTIONS)
    isSplit: false,                // show two viewports side by side
    isViewLinked: true,            // synchronize cameras between viewports

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

// ---------------------------------------------------------------------------
// Selectable options for the dropdown-style settings.
//
// IMPORTANT: keep these aligned with what the backend actually supports.
//   - `navStyle` values must map to a NAV_STYLE preset in InputStyleHandler
//     (MainLayout upper-cases the value and looks it up; unknown -> BLENDER).
//   - `displayMode` values must be accepted by Actor.setDisplayMode().
// Add or remove entries here to grow/shrink the menus in one place.
// ---------------------------------------------------------------------------

export const THEME_OPTIONS = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
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