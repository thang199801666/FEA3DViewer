self.onmessage = async ({ data }) => {
    try {
        const imports = {
            env: { memory: data.memory },
            wasi_snapshot_preview1: { proc_exit() {}, fd_close() { return 0; }, fd_seek() { return 0; }, fd_write() { return 0; } },
        };
        const instance = await WebAssembly.instantiate(data.module, imports);
        const fn = instance.exports.warp_points_range ?? instance.exports._warp_points_range;
        fn(data.pointsPtr, data.pointValueCount, data.vectorsPtr, data.vectorValueCount,
            data.vectorComponents, data.scale, data.startPoint, data.endPoint);
        self.postMessage({ ok: true });
    } catch (error) {
        self.postMessage({ ok: false, message: error?.message ?? String(error) });
    }
};
