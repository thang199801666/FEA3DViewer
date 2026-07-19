const TYPES = new Map([[Float32Array, 1], [Float64Array, 2], [Int32Array, 3], [Uint32Array, 4], [Uint8Array, 5]]);

function cString(memory, ptr) {
    const bytes = new Uint8Array(memory.buffer); let end = ptr;
    while (end < bytes.length && bytes[end]) end++;
    return new TextDecoder().decode(bytes.subarray(ptr, end));
}

/** Writes the FEA archive through libfea.wasm rather than duplicating its binary codec in JavaScript. */
export class FEAWriter {
    constructor({ wasmUrl = "/wasm/fea_reader.wasm" } = {}) { this.wasmUrl = wasmUrl; }

    async writeMesh({ points, connectivity, offsets, cellTypes, pointData = {}, cellData = {}, metadata = null }) {
        const response = await fetch(this.wasmUrl);
        if (!response.ok) throw new Error(`FEAWriter: cannot load WASM (${response.status})`);
        const imports = { env: { emscripten_notify_memory_growth() {} } };
        const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), imports), x = instance.exports;
        const arrays = [
            ["points", 1, 1, 3, points], ["connectivity", 2, 2, 1, connectivity],
            ["offsets", 3, 2, 1, offsets], ["cellTypes", 4, 2, 1, cellTypes],
            ...Object.entries(pointData).map(([n, a]) => [n, 100, 1, a.components, a.values]),
            ...Object.entries(cellData).map(([n, a]) => [n, 100, 2, a.components, a.values]),
        ];
        if (metadata) arrays.push(["appmeta", 1001, 0, 1, new TextEncoder().encode(JSON.stringify(metadata))]);
        x.fea_write_begin();
        for (const [name, kind, association, components, input] of arrays) {
            const values = ArrayBuffer.isView(input) ? input : Float32Array.from(input);
            const type = TYPES.get(values.constructor);
            if (!type) throw new Error(`FEAWriter: unsupported array type for ${name}`);
            const nameBytes = new TextEncoder().encode(`${name}\0`), namePtr = x.malloc(nameBytes.length), dataPtr = x.malloc(values.byteLength);
            new Uint8Array(x.memory.buffer, namePtr, nameBytes.length).set(nameBytes);
            new Uint8Array(x.memory.buffer, dataPtr, values.byteLength).set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
            const ok = x.fea_write_add(namePtr, kind, type, association, components, dataPtr, values.byteLength, values.length);
            x.free(namePtr); x.free(dataPtr);
            if (!ok) throw new Error(`FEAWriter: ${cString(x.memory, x.fea_last_error())}`);
        }
        if (!x.fea_write_finish()) throw new Error(`FEAWriter: ${cString(x.memory, x.fea_last_error())}`);
        const ptr = x.fea_write_data(), size = x.fea_write_size();
        return x.memory.buffer.slice(ptr, ptr + size);
    }
}
