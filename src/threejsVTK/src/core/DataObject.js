// Core/DataObject.js

let GLOBAL_MTIME = 0;

/** Shared monotonic clock. Every DataObject.modified() and every Algorithm
 *  execution timestamp is drawn from this single counter, so "is my cached
 *  output newer than my input?" comparisons (see Algorithm.js) are always
 *  well-ordered across the whole object graph, not just within one object. */
export function nextMTime() {
    return ++GLOBAL_MTIME;
}

export class DataObject {
    constructor() {
        this._mtime = nextMTime();
        this.metadata = new Map();
    }

    modified() {
        this._mtime = nextMTime();
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



























// // Core/DataObject.js

// let GLOBAL_MTIME = 0;

// export class DataObject {
//     constructor() {
//         this._mtime = ++GLOBAL_MTIME;
//         this.metadata = new Map();
//     }

//     modified() {
//         this._mtime = ++GLOBAL_MTIME;
//         return this;
//     }

//     getMTime() {
//         return this._mtime;
//     }

//     setMetadata(k, v) {
//         this.metadata.set(k, v);
//         return this;
//     }

//     getMetadata(k) {
//         return this.metadata.get(k);
//     }

//     getBounds() {
//         throw new Error("DataObject.getBounds() must be overridden");
//     }

//     clone() {
//         throw new Error("DataObject.clone() must be overridden");
//     }
// }