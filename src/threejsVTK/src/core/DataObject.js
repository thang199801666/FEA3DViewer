// Core/DataObject.js

let GLOBAL_MTIME = 0;

export class DataObject {
    constructor() {
        this._mtime = ++GLOBAL_MTIME;
        this.metadata = new Map();
    }

    modified() {
        this._mtime = ++GLOBAL_MTIME;
        return this;
    }

    getMTime() {
        return this._mtime;
    }

    setMetadata(k, v) {
        this.metadata.set(k, v);
        return this;
    }

    getMetadata(k) {
        return this.metadata.get(k);
    }

    getBounds() {
        throw new Error("DataObject.getBounds() must be overridden");
    }

    clone() {
        throw new Error("DataObject.clone() must be overridden");
    }
}