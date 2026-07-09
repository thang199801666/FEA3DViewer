// Actors/ScalarBarActor.js
// Abaqus-style color legend: discrete color cells with edge-aligned value labels
// formatted in signed exponential notation (+1.697e+02), customizable 2-line titles, and 4 anchor positions.
//
// Rendered using a 2D overlay <canvas> (position: absolute) on top of the viewport to keep text crisp.
// IMPORTANT: This actor DOES NOT strictly require a lookupTable. If no valid LUT is provided,
// it falls back to a built-in rainbow colormap -> always rendering successfully.

const ANCHORS = ["TopLeft", "BottomLeft", "TopRight", "BottomRight"];

export class ScalarBarActor {
    constructor(options = {}) {
        // --- Content (Customizable 2-Line Header) ---
        this.title = options.title ?? "";                 // Line 1: Main title text
        this.subTitle = options.subTitle ?? "";           // Line 2: Sub-field/Unit text
        this.lookupTable = options.lookupTable ?? null;   // Optional (vtk-style)
        this.range = options.range ?? null;               // Explicit [min, max] (takes priority)

        // --- Discrete Color Cells ---
        this.numberOfColors = options.numberOfColors ?? 12; // N cells -> N+1 labels

        // --- Anchor Positions ---
        this.anchor = ANCHORS.includes(options.anchor) ? options.anchor : "TopLeft";
        this.margin = options.margin ?? 16;

        // --- Cell Dimensions & Cell Outlines ---
        this.cellWidth = options.cellWidth ?? 22;
        this.cellHeight = options.cellHeight ?? 16;
        // Set spacing to 0 so cells stack directly on top of each other (Abaqus continuous bar)
        this.cellSpacing = options.cellSpacing ?? 0; 
        // Defaulted to semi-transparent black to always display cell borders
        this.cellOutlineColor = options.cellOutlineColor ?? "rgba(0, 0, 0, 0.5)"; 

        // --- Overall ScalarBar Outline (Entire Panel) ---
        this.showOutline = options.showOutline ?? false;          // Toggle panel outline visibility
        this.outlineColor = options.outlineColor ?? "#ffffff";    // Defaulted to sharp white

        // --- Font & Text Styling ---
        this.fontSize = options.fontSize ?? 12;
        this.titleFontSize = options.titleFontSize ?? this.fontSize;
        this.fontFamily = options.fontFamily ?? "sans-serif";
        this.textColor = options.textColor ?? "#f0f0f0";

        // --- Number Formatting ---
        this.precision = options.precision ?? 3;
        this.labelFormat = options.labelFormat ?? "exp"; // "exp" | "fixed" | "auto"

        // --- Background Panel ---
        // Defaulted to 'transparent' to see the underlying 3D scene clearly
        this.background = options.background ?? "transparent"; 
        this.padding = options.padding ?? 8;

        this._dpr = window.devicePixelRatio || 1;

        this.domElement = document.createElement("canvas");
        Object.assign(this.domElement.style, {
            position: "absolute",
            pointerEvents: "none",
            zIndex: 50
        });
        this._container = null;
        this._applyAnchor();
    }

    attachTo(container) {
        this._container = container;                // Container requires position: relative/absolute
        container.appendChild(this.domElement);
        this.update();
        return this;
    }

    // ---- Setters (Chaining + Redraw) ----
    setLookupTable(lut) { this.lookupTable = lut; return this.update(); }
    setRange(mn, mx) { this.range = [mn, mx]; return this.update(); }
    setTitle(t) { this.title = t; return this.update(); }
    setSubTitle(st) { this.subTitle = st; return this.update(); }
    setTextColor(c) { this.textColor = c; return this.update(); }
    setBackground(bg) { this.background = bg; return this.update(); }
    setNumberOfColors(n) { this.numberOfColors = Math.max(1, n | 0); return this.update(); }
    setCellOutlineColor(c) { this.cellOutlineColor = c; return this.update(); }
    setShowOutline(b) { this.showOutline = !!b; return this.update(); }
    setOutlineColor(c) { this.outlineColor = c; return this.update(); }
    setPrecision(p) { this.precision = Math.max(0, p | 0); return this.update(); }
    setLabelFormat(f) { this.labelFormat = f; return this.update(); }
    setFont(family, size) {
        if (family) this.fontFamily = family;
        if (size) this.fontSize = size;
        return this.update();
    }
    setAnchor(a) {
        if (ANCHORS.includes(a)) this.anchor = a;
        this._applyAnchor();
        return this;
    }
    setMargin(m) { this.margin = m; this._applyAnchor(); return this; }

    /** Quick configuration and display in a single call */
    show(options = {}) {
        if (options.title !== undefined) this.title = options.title;
        if (options.subTitle !== undefined) this.subTitle = options.subTitle;
        if (options.range) this.range = options.range;
        if (options.lookupTable !== undefined) this.lookupTable = options.lookupTable;
        if (options.background !== undefined) this.background = options.background;
        if (options.numberOfColors) this.numberOfColors = Math.max(1, options.numberOfColors | 0);
        if (options.cellOutlineColor !== undefined) this.cellOutlineColor = options.cellOutlineColor;
        if (options.showOutline !== undefined) this.showOutline = options.showOutline;
        if (options.outlineColor !== undefined) this.outlineColor = options.outlineColor;
        if (options.precision !== undefined) this.precision = options.precision;
        if (options.anchor) this.setAnchor(options.anchor);
        this.update();
        return this.setVisible(true);
    }

    _applyAnchor() {
        const m = `${this.margin}px`;
        const s = this.domElement.style;
        s.top = s.bottom = s.left = s.right = "";
        s.transform = "";
        switch (this.anchor) {
            case "BottomLeft": s.bottom = m; s.left = m; break;
            case "TopRight": s.top = m; s.right = m; break;
            case "BottomRight": s.bottom = m; s.right = m; break;
            case "TopLeft":
            default: s.top = m; s.left = m; break;
        }
    }

    /** Built-in rainbow colormap (blue->cyan->green->yellow->red), t in [0,1] */
    _defaultColor(t, out) {
        const stops = [
            [0.0, 0, 0, 1],
            [0.25, 0, 1, 1],
            [0.5, 0, 1, 0],
            [0.75, 1, 1, 0],
            [1.0, 1, 0, 0]
        ];
        t = Math.max(0, Math.min(1, t));
        for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i], b = stops[i + 1];
            if (t >= a[0] && t <= b[0]) {
                const f = (t - a[0]) / (b[0] - a[0] || 1);
                out[0] = a[1] + (b[1] - a[1]) * f;
                out[1] = a[2] + (b[2] - a[2]) * f;
                out[2] = a[3] + (b[3] - a[3]) * f;
                return out;
            }
        }
        out[0] = 1; out[1] = 0; out[2] = 0;
        return out;
    }

    _format(v) {
        if (this.labelFormat === "fixed") {
            const s = v.toFixed(this.precision);
            return v >= 0 ? "+" + s : s;
        }
        if (this.labelFormat === "auto") {
            const abs = Math.abs(v);
            if (v !== 0 && (abs >= 1e5 || abs < 1e-3)) return this._toExp(v);
            const s = Number(v.toPrecision(this.precision + 1)).toString();
            return v >= 0 ? "+" + s : s;
        }
        return this._toExp(v);
    }

    _toExp(v) {
        let s = v.toExponential(this.precision).replace(/e([+-])(\d)$/, "e$10$2");
        if (v >= 0) s = "+" + s;
        return s;
    }

    /** Redraw the legend. Works even without a valid lookupTable. */
    update() {
        // --- Determine Value Range ---
        let range = this.range;
        const lut = this.lookupTable;
        const useLut = lut && typeof lut.getColor === "function";
        if (useLut && !lut.table && lut.build) lut.build();
        if (!range && lut && Array.isArray(lut.range)) range = lut.range;
        if (!range || range[0] === range[1]) range = range && range[0] === range[1]
            ? [range[0], range[0] + 1] : [0, 1];
        const [mn, mx] = range;

        const dpr = this._dpr;
        const N = Math.max(1, this.numberOfColors | 0);

        // Calculate values at N+1 edges, upper edge = max
        const values = new Array(N + 1);
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            values[i] = mx + (mn - mx) * t;
        }

        // --- Handle 2-Line Header Content ---
        const titleLines = [];
        if (this.title) titleLines.push(String(this.title));
        if (this.subTitle) titleLines.push(String(this.subTitle));

        const pad = this.padding;
        const labelGap = 8;
        const titleLineH = this.titleFontSize + 4;
        const titleH = titleLines.length ? titleLines.length * titleLineH + 6 : 0;
        const labelHalf = Math.ceil(this.fontSize * 0.6);

        const cv = this.domElement;
        const ctx = cv.getContext("2d");

        // --- Measure Width ---
        ctx.font = `${this.fontSize}px ${this.fontFamily}`;
        let maxLabelW = 0;
        const labels = values.map((v) => {
            const txt = this._format(v);
            maxLabelW = Math.max(maxLabelW, ctx.measureText(txt).width);
            return txt;
        });
        
        ctx.font = `bold ${this.titleFontSize}px ${this.fontFamily}`;
        let maxTitleW = 0;
        for (const line of titleLines) {
            maxTitleW = Math.max(maxTitleW, ctx.measureText(line).width);
        }

        const columnW = this.cellWidth + labelGap + maxLabelW;
        const columnH = N * this.cellHeight;
        const w = pad * 2 + Math.max(columnW, maxTitleW);
        const h = pad * 2 + titleH + columnH + labelHalf * 2;

        // --- Resize Canvas ---
        cv.width = Math.ceil(w * dpr);
        cv.height = Math.ceil(h * dpr);
        cv.style.width = `${Math.ceil(w)}px`;
        cv.style.height = `${Math.ceil(h)}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // --- Background Panel & Panel Outline ---
        const hasBg = this.background && this.background !== "transparent";
        if (hasBg || this.showOutline) {
            const r = 6;
            ctx.beginPath();
            ctx.moveTo(r, 0);
            ctx.arcTo(w, 0, w, h, r);
            ctx.arcTo(w, h, 0, h, r);
            ctx.arcTo(0, h, 0, 0, r);
            ctx.arcTo(0, 0, w, 0, r);
            ctx.closePath();

            if (hasBg) {
                ctx.fillStyle = this.background;
                ctx.fill();
            }

            if (this.showOutline) {
                ctx.strokeStyle = this.outlineColor;
                ctx.lineWidth = 1.5; 
                ctx.stroke();
            }
        }

        const originX = pad;

        // --- Render 2-Line Header (Title + Sub-field) ---
        if (titleLines.length) {
            ctx.fillStyle = this.textColor;
            ctx.font = `bold ${this.titleFontSize}px ${this.fontFamily}`;
            ctx.textBaseline = "top";
            ctx.textAlign = "left";
            titleLines.forEach((line, i) => ctx.fillText(line, originX, pad + i * titleLineH));
        }

        // --- Render Discrete Color Cells ---
        const cellsTop = pad + titleH + labelHalf;
        const gap = this.cellSpacing;
        const tmp = [0, 0, 0];
        
        for (let i = 0; i < N; i++) {
            const t = 1 - (i + 0.5) / N;
            if (useLut) {
                const vMid = mn + t * (mx - mn);
                try { lut.getColor(vMid, tmp); }
                catch { this._defaultColor(t, tmp); }
            } else {
                this._defaultColor(t, tmp);
            }
            
            const y = cellsTop + i * this.cellHeight + gap * 0.5;
            const rw = this.cellWidth;
            const rh = this.cellHeight - gap;

            // Fill cell body
            ctx.fillStyle = `rgb(${(tmp[0] * 255) | 0},${(tmp[1] * 255) | 0},${(tmp[2] * 255) | 0})`;
            ctx.fillRect(originX, y, rw, rh);

            // Draw crisp flat cell borders (1px alignment without pixel shifting artifacts)
            if (this.cellOutlineColor) {
                ctx.strokeStyle = this.cellOutlineColor;
                ctx.lineWidth = 1; 
                ctx.strokeRect(originX, y, rw, rh);
            }
        }
        
        // Solid bounding outline enclosing the full color column (Abaqus style)
        ctx.strokeStyle = "rgba(200, 200, 200, 0.6)";
        ctx.lineWidth = 1.5; 
        ctx.strokeRect(originX + 0.5, cellsTop + 0.5, this.cellWidth - 1, columnH - 1);

        // --- Render Edge Labels ---
        ctx.fillStyle = this.textColor;
        ctx.font = `${this.fontSize}px ${this.fontFamily}`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        const labelX = originX + this.cellWidth + labelGap;
        for (let i = 0; i <= N; i++) {
            ctx.fillText(labels[i], labelX, cellsTop + i * this.cellHeight);
        }

        return this;
    }

    setVisible(v) {
        this.domElement.style.display = v ? "block" : "none";
        if (v) {
            this.update();
        }
        return this;
    }

    dispose() {
        if (this.domElement.parentNode) this.domElement.parentNode.removeChild(this.domElement);
        this._container = null;
    }
}