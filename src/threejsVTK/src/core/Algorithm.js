// Core/Algorithm.js
//
// Minimal port of native VTK's demand-driven pipeline (vtkAlgorithm + its
// executive): SetInputData(...) / Update() / GetOutputData(). An Algorithm
// only re-executes (requestData) when it or its input has been modified
// since the last successful execution — exactly like vtkAlgorithm skipping
// RequestData() when the pipeline is already up to date.
//
// This turns previously "recompute every call" operations (e.g.
// UnstructuredGrid.extractSurface(), see ExtractSurfaceFilter in
// UnstructuredGrid.js) into cached pipeline stages: calling the same filter
// repeatedly with unchanged input/parameters is O(1) after the first run.

import { DataObject, nextMTime } from "./DataObject.js";

export class Algorithm extends DataObject {
    constructor() {
        super();
        this._inputData = null;
        this._output = null;
        this._executeTime = 0;
    }

    setInputData(data) {
        if (this._inputData !== data) {
            this._inputData = data;
            this.modified();
        }
        return this;
    }

    getInputData() {
        return this._inputData;
    }

    /** Re-execute requestData() only if this algorithm's parameters or its
     *  input have changed since the last run. */
    update() {
        const input = this._inputData;
        const inputMTime = input && typeof input.getMTime === "function" ? input.getMTime() : 0;
        const upToDate = this._output !== null
            && this._executeTime > this.getMTime()
            && this._executeTime > inputMTime;
        if (!upToDate) {
            this._output = this.requestData(input);
            // Stamp with a clock value guaranteed to be greater than any
            // mtime that existed at the moment execution finished (this
            // algorithm's own mtime and its input's mtime included), so the
            // up-to-date check above holds until something calls modified()
            // again — on either this algorithm or its input.
            this._executeTime = nextMTime();
        }
        return this;
    }

    getOutputData() {
        this.update();
        return this._output;
    }

    /** Classic VTK alias for getOutputData(). */
    getOutput() {
        return this.getOutputData();
    }

    // eslint-disable-next-line class-methods-use-this, no-unused-vars
    requestData(_input) {
        throw new Error(`${this.constructor.name}.requestData() must be overridden`);
    }
}