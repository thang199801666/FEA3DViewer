import assert from "node:assert/strict";
import { VTKReader } from "../src/io/VTKReader.js";
import { PolyDataMapper } from "../src/mappers/PolyDataMapper.js";

// Bảo vệ hai bug: (1) VTKReader.parseFile cũ gọi detectFormat("", name) — input rỗng,
// Files without an extension used to be treated as "vtk". Toolbar.tsx detects
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

function beFloat32(values) {
  const buf = new ArrayBuffer(values.length * 4);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setFloat32(i * 4, v, false));
  return new Uint8Array(buf);
}

function beInt32(values) {
  const buf = new ArrayBuffer(values.length * 4);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setInt32(i * 4, v, false));
  return new Uint8Array(buf);
}

function bytes(...parts) {
  const enc = new TextEncoder();
  const chunks = parts.map(p => typeof p === "string" ? enc.encode(p) : p);
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const LEGACY_BINARY = bytes(
  "# vtk DataFile Version 3.0\n",
  "binary triangle\n",
  "BINARY\n",
  "DATASET POLYDATA\n",
  "POINTS 3 float\n",
  beFloat32([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  "\nPOLYGONS 1 4\n",
  beInt32([3, 0, 1, 2]),
  "\nPOINT_DATA 3\n",
  "SCALARS temp float 1\n",
  "LOOKUP_TABLE default\n",
  beFloat32([10, 20, 30]),
  "\n"
);

const LEGACY_LINES = `# vtk DataFile Version 3.0
line
ASCII
DATASET POLYDATA
POINTS 3 float
0 0 0
1 0 0
1 1 0
LINES 1 4
3 0 1 2
`;

const LEGACY_VERTS = `# vtk DataFile Version 3.0
verts
ASCII
DATASET POLYDATA
POINTS 2 float
0 0 0
1 0 0
VERTICES 2 4
1 0
1 1
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

await t("legacy BINARY .vtk -> đọc point, polygon và scalar big-endian", async () => {
  const pd = await new VTKReader().parseFile(fakeFile("tri_binary.vtk", LEGACY_BINARY));
  assert.equal(pd.points.length, 9);
  assert.equal(pd.polys.length, 1);
  assert.deepEqual([...pd.pointData.getArray("temp").values], [10, 20, 30]);
});

await t("line-only POLYDATA -> mapper tạo primitiveType=line với 2 segments", async () => {
  const pd = new VTKReader().parse(LEGACY_LINES);
  const geom = new PolyDataMapper().setInputData(pd).buildGeometry();
  assert.equal(geom.userData.primitiveType, "line");
  assert.equal(geom.getAttribute("position").count, 4);
  assert.equal(geom.getIndex(), null);
  geom.dispose();
});

await t("vertex-only POLYDATA -> mapper tạo primitiveType=point", async () => {
  const pd = new VTKReader().parse(LEGACY_VERTS);
  const geom = new PolyDataMapper().setInputData(pd).buildGeometry();
  assert.equal(geom.userData.primitiveType, "point");
  assert.equal(geom.getAttribute("position").count, 2);
  assert.equal(geom.getIndex(), null);
  geom.dispose();
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
