import assert from "node:assert/strict";
import { VTKReader } from "../src/io/VTKReader.js";

// Bảo vệ hai bug: (1) VTKReader.parseFile cũ gọi detectFormat("", name) — input rỗng,
// nên file không đuôi luôn bị đoán là "vtk". (2) Toolbar.jsx dò đuôi bằng
// endsWith(".vtk") — phân biệt hoa/thường, "MODEL.VTK" bị từ chối.

// Giả lập browser File API tối thiểu mà parseFile() dùng: name, slice().text(), text(), arrayBuffer()
function fakeFile(name, content) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return {
    name,
    slice: (a, b) => ({ text: async () => new TextDecoder().decode(bytes.slice(a, b)) }),
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const LEGACY_ASCII = `# vtk DataFile Version 3.0
tam giac
ASCII
DATASET POLYDATA
POINTS 3 float
0 0 0
1 0 0
0 1 0
POLYGONS 1 4
3 0 1 2
`;

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); console.log("  ok  " + n); pass++; }
                            catch (e) { console.log("  FAIL " + n + "\n       " + e.message); fail++; } };

console.log("\nVTKReader.parseFile (bản đã vá)");

await t("legacy ASCII .vtk -> PolyData 3 điểm, 1 poly", async () => {
  const pd = await new VTKReader().parseFile(fakeFile("tri.vtk", LEGACY_ASCII));
  assert.equal(pd.points.length, 9);
  assert.equal(pd.polys.length, 1);
});

await t("[BUG Toolbar] đuôi VIẾT HOA .VTK vẫn đọc được", async () => {
  const pd = await new VTKReader().parseFile(fakeFile("TRI.VTK", LEGACY_ASCII));
  assert.equal(pd.polys.length, 1);
});

await t("[BUG CŨ đã vá] file KHÔNG đuôi -> detect từ nội dung, không mặc định 'vtk'", async () => {
  const pd = await new VTKReader().parseFile(fakeFile("blob", LEGACY_ASCII));
  assert.equal(pd.polys.length, 1);
});

await t("file .txt chứa legacy header -> vẫn parse đúng nhờ sniff nội dung", async () => {
  const pd = await new VTKReader().parseFile(fakeFile("model.txt", LEGACY_ASCII));
  assert.equal(pd.points.length, 9);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
