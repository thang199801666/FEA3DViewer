import * as THREE from "three";

/**
 * Hai tứ diện chung mặt (v0,v1,v2). 8 tam giác; mặt chung xuất hiện 2 lần.
 * Kết quả đúng: 6 tam giác biên.
 *
 * `d` = độ lệch toạ độ giữa hai BẢN SAO của mặt chung (mô phỏng 2 part FEA
 * meshed rời rồi ghép — toạ độ mặt tiếp xúc lệch vài ulp).
 *
 * Toạ độ cơ sở đặt tại 0.0015 / 1.0015 để x*1000 rơi đúng ranh giới .5 của
 * Math.round — đây là điều kiện kích hoạt bug của weld naive.
 */
export function twoTetsSharedFace(d = 0) {
  const B = 0.0015;      // *1000 = 1.5  -> ranh giới round()
  const L = 1.0015;      // *1000 = 1001.5
  const v = [
    B, B, B,             // v0 ─┐
    L, B, B,             // v1  │ mặt chung, bản của tet A
    B, L, B,             // v2 ─┘
    B, B, L,             // v3  đỉnh tet A
    B, B, -0.9985,       // v4  đỉnh tet B
    B - d, B - d, B - d, // v5 ─┐
    L - d, B - d, B - d, // v6  │ mặt chung, bản của tet B (lệch d)
    B - d, L - d, B - d, // v7 ─┘
  ];
  const tris = [
    0, 1, 2,  0, 1, 3,  1, 2, 3,  2, 0, 3,   // tet A
    5, 6, 7,  5, 6, 4,  6, 7, 4,  7, 5, 4,   // tet B
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(v), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(tris), 1));
  return g;
}

export const triCount = (g) =>
  (g.getIndex() ? g.getIndex().count : g.getAttribute("position").count) / 3;
