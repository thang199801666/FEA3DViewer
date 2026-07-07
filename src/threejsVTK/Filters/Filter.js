// Filters/Filter.js
// Lớp cơ sở cho mọi filter trong pipeline: PolyData -> PolyData.

export class Filter {
    constructor() {
        this.input = null;
    }

    setInputData(polyData) {
        this.input = polyData;
        return this;
    }

    /** Cho phép nối filter: filterB.setInputConnection(filterA) */
    setInputConnection(upstreamFilter) {
        this.input = upstreamFilter.getOutputData();
        return this;
    }

    getOutputData() {
        throw new Error("Filter con phải override getOutputData()");
    }
}