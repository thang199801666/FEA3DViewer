import { LookupTable } from "./LookupTable.js";
import { COLORMAP_PRESETS } from "./presets.js";

export { COLORMAP_PRESETS };

export class ColorTransferFunction extends LookupTable {
    constructor(options = {}) {
        const preset = options.preset ?? "rainbow";
        if (!(preset in COLORMAP_PRESETS)) {
            throw new Error(
                `ColorTransferFunction: preset "${preset}" does not exist. ` +
                `Available presets: ${Object.keys(COLORMAP_PRESETS).join(", ")}`
            );
        }
        super({
            numberOfColors: options.numberOfColors ?? 256,
            range: options.range ?? [0, 1],
            controlPoints: COLORMAP_PRESETS[preset],
            hueRange: options.hueRange,
        });
        this.preset = preset;
        this.discrete = options.discrete ?? false;
    }

    setPreset(name) {
        if (!(name in COLORMAP_PRESETS)) {
            throw new Error(`ColorTransferFunction: preset "${name}" does not exist`);
        }
        this.preset = name;
        this.controlPoints = COLORMAP_PRESETS[name];
        this.table = null;
        return this;
    }

    /** Sets discrete contour banding configurations */
    setDiscrete(n) {
        this.discrete = true;
        this.setNumberOfColors(n);
        return this;
    }

    static listPresets() { return Object.keys(COLORMAP_PRESETS); }
}