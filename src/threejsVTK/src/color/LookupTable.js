function hsvToRgb(h, s, v, out) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        default: r = v; g = p; b = q; break;
    }
    out[0] = r; out[1] = g; out[2] = b;
    return out;
}

export class LookupTable {
    constructor(options = {}) {
        this.numberOfColors = options.numberOfColors ?? 256;
        this.hueRange = options.hueRange ?? [0.6667, 0.0]; // Default VTK style: Blue -> Red
        this.saturationRange = options.saturationRange ?? [1, 1];
        this.valueRange = options.valueRange ?? [1, 1];
        this.range = options.range ?? [0, 1];
        this.nanColor = options.nanColor ?? [0.5, 0.5, 0.5];
        this.controlPoints = options.controlPoints ?? null;
        this.table = null;
    }

    setRange(min, max) {
        this.range = [min, max];
        return this;
    }

    setNumberOfColors(n) {
        this.numberOfColors = Math.max(1, n | 0);
        this.table = null;
        return this;
    }

    setRangeFromArray(dataArray, component = 0) {
        this.range = dataArray.getRange(component);
        return this;
    }

    setControlPoints(points) {
        this.controlPoints = points;
        this.table = null;
        return this;
    }

    build() {
        const n = this.numberOfColors;
        this.table = new Float32Array(n * 3);
        const tmp = [0, 0, 0];

        for (let i = 0; i < n; i++) {
            const t = n === 1 ? 0 : i / (n - 1);
            if (this.controlPoints) {
                this._interpControlPoints(t, tmp);
            } else {
                const h = this.hueRange[0] + t * (this.hueRange[1] - this.hueRange[0]);
                const s = this.saturationRange[0] + t * (this.saturationRange[1] - this.saturationRange[0]);
                const v = this.valueRange[0] + t * (this.valueRange[1] - this.valueRange[0]);
                hsvToRgb(((h % 1) + 1) % 1, s, v, tmp);
            }
            this.table[i * 3] = tmp[0];
            this.table[i * 3 + 1] = tmp[1];
            this.table[i * 3 + 2] = tmp[2];
        }
        return this;
    }

    _interpControlPoints(t, out) {
        const cps = this.controlPoints;
        if (t <= cps[0][0]) { out[0] = cps[0][1]; out[1] = cps[0][2]; out[2] = cps[0][3]; return; }
        for (let i = 0; i + 1 < cps.length; i++) {
            const a = cps[i], b = cps[i + 1];
            if (t <= b[0]) {
                const f = (t - a[0]) / Math.max(b[0] - a[0], 1e-12);
                out[0] = a[1] + f * (b[1] - a[1]);
                out[1] = a[2] + f * (b[2] - a[2]);
                out[2] = a[3] + f * (b[3] - a[3]);
                return;
            }
        }
        const last = cps[cps.length - 1];
        out[0] = last[1]; out[1] = last[2]; out[2] = last[3];
    }

    /** Maps a single scalar value to [r, g, b] based on the current range settings */
    getColor(value, out = [0, 0, 0]) {
        if (!this.table) this.build();
        if (Number.isNaN(value)) {
            out[0] = this.nanColor[0]; out[1] = this.nanColor[1]; out[2] = this.nanColor[2];
            return out;
        }
        const [mn, mx] = this.range;
        const span = mx - mn;
        let t = span === 0 ? 0.5 : (value - mn) / span;
        t = Math.max(0, Math.min(1, t));
        const idx = Math.min(this.numberOfColors - 1, Math.round(t * (this.numberOfColors - 1)));
        out[0] = this.table[idx * 3];
        out[1] = this.table[idx * 3 + 1];
        out[2] = this.table[idx * 3 + 2];
        return out;
    }

    /** Exports the colormap to a Uint8Array RGBA array for texture initialization */
    getUint8Table() {
        if (!this.table) this.build();
        const n = this.numberOfColors;
        const rgba = new Uint8Array(n * 4);
        const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
        for (let i = 0; i < n; i++) {
            rgba[i * 4]     = Math.round(clamp01(this.table[i * 3])     * 255);
            rgba[i * 4 + 1] = Math.round(clamp01(this.table[i * 3 + 1]) * 255);
            rgba[i * 4 + 2] = Math.round(clamp01(this.table[i * 3 + 2]) * 255);
            rgba[i * 4 + 3] = 255;
        }
        return rgba;
    }

    /** Maps a DataArray to a flat Float32Array of RGB colors per vertex */
    mapScalars(dataArray, component = 0) {
        const n = dataArray.getNumberOfTuples();
        const colors = new Float32Array(n * 3);
        const tmp = [0, 0, 0];
        for (let i = 0; i < n; i++) {
            const v = component === -1 ? dataArray.getMagnitude(i) : dataArray.getComponent(i, component);
            this.getColor(v, tmp);
            colors[i * 3] = tmp[0];
            colors[i * 3 + 1] = tmp[1];
            colors[i * 3 + 2] = tmp[2];
        }
        return colors;
    }
}