export class Filter {
    constructor() {
        this.input = null;
        this._output = null;
        this._inputMTime = -1;
    }

    setInputData(data) {
        this.input = data;
        this._output = null;
        return this;
    }

    setInputConnection(upstream) {
        return this.setInputData(upstream.getOutputData());
    }

    getOutputData() {
        if (!this.input) throw new Error(`${this.constructor.name}: Input is not set.`);
        const mtime = this.input.getMTime?.() ?? -1;
        if (this._output && mtime === this._inputMTime) return this._output;
        this._output = this.execute(this.input);
        this._inputMTime = mtime;
        return this._output;
    }

    execute(_input) {
        throw new Error(`${this.constructor.name} must override execute()`);
    }

    update() { return this.getOutputData(); }
}