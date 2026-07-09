// Chặn phụ thuộc đi ngược chiều. Nếu không có kiểm tra tự động,
// quy tắc kiến trúc sẽ tự phân rã trong vài tháng.
//   core -> geometry -> filters -> color -> mappers -> camera -> rendering
//        -> actors -> widgets -> interaction
//   (camera TRƯỚC rendering: Renderer import Camera. rendering TRƯỚC actors:
//    SectionActor import rendering/materials.)
const LAYERS = ["core","sources","geometry","filters","color","mappers","camera","rendering","actors","widgets","interaction"];

module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    { name: "no-orphans", severity: "warn",
      from: { orphan: true, pathNot: "(^src/index\\.js$|\\.d\\.ts$)" }, to: {} },
    // Mỗi tầng chỉ được import từ tầng của nó hoặc tầng ĐỨNG TRƯỚC.
    ...LAYERS.map((layer, i) => ({
      name: `layer-${layer}`,
      comment: `src/${layer} chỉ được import từ: ${LAYERS.slice(0, i + 1).join(", ")}`,
      severity: "error",
      from: { path: `^src/${layer}/` },
      to:   { path: `^src/(${LAYERS.slice(i + 1).join("|") || "\\0"})/` },
    })),
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: false,
    exclude: { path: "^(tests|legacy|tools)/" },
  },
};
