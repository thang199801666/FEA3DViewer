import { Filter } from "./Filter.js";
import { toSurfacePolyData, polyDataToGeometry, polyDataFromExtracted } from "../core/conversion.js";
import { extractByTopology } from "../geometry/surfaceTopology.js";
import { extractByVisibility } from "../geometry/surfaceVisibility.js";

export const SURFACE_STRATEGY = {
    TOPOLOGY: "topology",
    VISIBILITY: "visibility",
};

export class SurfaceFilter extends Filter {
    constructor(options = {}) {
        super();
        this.strategy = options.strategy ?? SURFACE_STRATEGY.TOPOLOGY;
        this.weldTolerance = options.weldTolerance ?? null;
        this.recomputeNormals = options.recomputeNormals ?? true;

        this.removeInternalWalls = options.removeInternalWalls ?? true;
        this.keepOuterShell = options.keepOuterShell ?? false;

        this.rayCount = options.rayCount ?? 64;
        this.escapeConeAngle = options.escapeConeAngle ?? 72;
        this.testBothSides = options.testBothSides ?? true;
        this.dedupeCoincident = options.dedupeCoincident ?? true;
    }

    setStrategy(s) {
        if (!Object.values(SURFACE_STRATEGY).includes(s)) {
            throw new Error(`SurfaceFilter: Invalid strategy "${s}"`);
        }
        this.strategy = s; this._output = null; return this;
    }
    setWeldTolerance(t) {
        this.weldTolerance = Array.isArray(t) ? t[0] : Number(t);
        this._output = null; return this;
    }
    setRemoveInternalWalls(b) { this.removeInternalWalls = !!b; this._output = null; return this; }
    setKeepOuterShell(b)      { this.keepOuterShell = !!b;      this._output = null; return this; }
    setRecomputeNormals(b)    { this.recomputeNormals = !!b;    this._output = null; return this; }
    setRayCount(n)            { this.rayCount = Math.max(8, n | 0); this._output = null; return this; }
    setEscapeConeAngle(deg)   { this.escapeConeAngle = Math.min(90, Math.max(5, +deg)); this._output = null; return this; }
    setTestBothSides(b)       { this.testBothSides = !!b;       this._output = null; return this; }

    execute(input) {
        const polyData = toSurfacePolyData(input);
        const geometry = polyDataToGeometry(polyData);

        const out = this.strategy === SURFACE_STRATEGY.VISIBILITY
            ? extractByVisibility(geometry, this)
            : extractByTopology(geometry, this);

        return polyDataFromExtracted(polyData, out);
    }
}