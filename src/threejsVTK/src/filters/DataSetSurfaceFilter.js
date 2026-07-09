import { Filter } from "./Filter.js";
import { toSurfacePolyData } from "../core/conversion.js";

export class DataSetSurfaceFilter extends Filter {
    constructor({ passCellData = true } = {}) {
        super();
        this.passCellData = passCellData;
    }
    execute(input) {
        return toSurfacePolyData(input, { passCellData: this.passCellData });
    }
}