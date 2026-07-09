import { PolyDataMapper } from "./PolyDataMapper.js";
import { toSurfacePolyData } from "../core/conversion.js";

/**
 * General mapper for any DataSet, equivalent to vtkDataSetMapper.
 * Automatically extracts external surfaces if the input is an UnstructuredGrid.
 */
export class DataSetMapper extends PolyDataMapper {
    constructor() {
        super();
        this.isDataSetMapper = true;
        this._rawInput = null;
    }

    setInputData(dataSet) {
        this._rawInput = dataSet;
        // Normalize the input data into surface PolyData
        super.setInputData(toSurfacePolyData(dataSet));
        return this;
    }

    /**
     * Gets the original un-extracted DataSet.
     * Useful when volumetric warping or clipping operations are required.
     */
    getRawInput() { 
        return this._rawInput; 
    }
}