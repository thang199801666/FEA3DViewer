// Rendering/ColorTransferFunction.js
// Bảng màu (LUT) cấp cao với PRESET khoa học chuẩn, tương thích drop-in với
// PolyDataMapper.setLookupTable() (đủ interface: setRange/mapScalars/getUint8Table/
// getColor/numberOfColors). Hỗ trợ banding rời rạc (discrete) kiểu Abaqus.
//
//   const ctf = new ColorTransferFunction({ preset: "coolToWarm", numberOfColors: 12 });
//   mapper.setLookupTable(ctf);

import { LookupTable } from "../Mappers/LookupTable.js";

// Control points [t, r, g, b] với t∈[0..1], màu 0..1.
export const COLORMAP_PRESETS = {
    // Rainbow HSV blue->red (mặc định VTK) — để null controlPoints, dùng hueRange.
    rainbow: null,

    // Cool-to-Warm phân kỳ (mặc định ParaView) — tốt cho dữ liệu có mốc 0.
    coolToWarm: [
        [0.0, 0.230, 0.299, 0.754],
        [0.5, 0.865, 0.865, 0.865],
        [1.0, 0.706, 0.016, 0.150],
    ],

    // Jet (MATLAB) — quen thuộc với dân kỹ thuật.
    jet: [
        [0.0, 0, 0, 0.5], [0.125, 0, 0, 1], [0.375, 0, 1, 1],
        [0.625, 1, 1, 0], [0.875, 1, 0, 0], [1.0, 0.5, 0, 0],
    ],

    // Viridis (perceptually-uniform) — mượt, an toàn cho người mù màu.
    viridis: [
        [0.0, 0.267, 0.005, 0.329], [0.25, 0.229, 0.322, 0.545],
        [0.5, 0.128, 0.567, 0.551], [0.75, 0.369, 0.789, 0.383],
        [1.0, 0.993, 0.906, 0.144],
    ],

    grayscale: [[0, 0, 0, 0], [1, 1, 1, 1]],
};

export class ColorTransferFunction extends LookupTable {
    constructor(options = {}) {
        const preset = options.preset ?? "rainbow";
        const cps = COLORMAP_PRESETS[preset] ?? null;
        super({
            numberOfColors: options.numberOfColors ?? 256,
            range: options.range ?? [0, 1],
            controlPoints: cps,
            hueRange: options.hueRange, // chỉ dùng khi preset=rainbow (cps=null)
        });
        this.preset = preset;
        this.discrete = options.discrete ?? false; // true = band sắc nét
    }

    /** Đổi preset màu tại runtime. */
    setPreset(name) {
        this.preset = name;
        this.controlPoints = COLORMAP_PRESETS[name] ?? null;
        this.table = null;
        return this;
    }

    /** Bật banding rời rạc: số band = n màu; kết hợp mapper.interpolateScalarsBeforeMapping. */
    setDiscrete(n) {
        this.discrete = true;
        this.setNumberOfColors(n);
        return this;
    }

    static listPresets() { return Object.keys(COLORMAP_PRESETS); }
}
