# threejsVTK

Pipeline visualization kiểu VTK trên three.js. Gói này là bản **đã tái cấu trúc**
(Phase 0 + Phase 1) của thư viện gốc: 61 file, 0 import gãy, 33 test xanh,
0 vi phạm chiều phụ thuộc.

```bash
npm install
npm run check      # verify-imports + tests + dependency-cruiser
```

---

## ⚠ Hai file bạn PHẢI tự điền vào

Gói này **không chạy được ngay** cho tới khi bạn thay hai placeholder. Tôi cố tình
không viết chúng: cả hai đều thiếu trong bản source được cung cấp, và bịa ra
implementation sẽ cho bạn code trông đúng mà sai contract.

| File | Tình trạng | Cách khôi phục |
|---|---|---|
| `src/interaction/picking/ActorTopology.js` | Gốc **0 byte** | `git log --all --diff-filter=D -- '**/ActorTopology.js'` |
| `src/camera/Camera.js` | Gốc là `Rendering/Camera.js`, không có trong bản copy | Chép đè file thật của bạn |

Cả hai placeholder đều **ném lỗi rõ ràng** khi bị dùng, và chú thích đầu file liệt kê
đầy đủ interface được **trích ra từ call site thật** (24 thành viên cho `ActorTopology`,
7 cho `Camera`) — không phải phỏng đoán.

Chừng nào `ActorTopology` chưa có, sub-entity picking (`PickMode.CELL/SURFACE/NODE`)
không hoạt động. Điều này **đã đúng với repo hiện tại của bạn** — file 0 byte nghĩa là
tính năng đó đang chết, chỉ là chưa ai nhận ra vì `import` một file rỗng không báo lỗi.

---

## Cấu trúc

```
src/
├─ core/           DataObject DataSet PolyData UnstructuredGrid FieldData CellTypes conversion
├─ geometry/       weld surfaceTopology surfaceVisibility featureEdges     ← thuần BufferGeometry
├─ filters/        Filter SurfaceFilter DataSetSurfaceFilter ContourFilter
│                  ClipFilter ClipClosedSurfaceFilter CutterFilter SmoothFilter WarpFilter
├─ color/          LookupTable ColorTransferFunction presets
├─ mappers/        PolyDataMapper DataSetMapper
├─ camera/         Camera* CameraState CameraMath CameraAnimation CameraClipping
├─ rendering/      RenderWindow Renderer materials/{ContourShaderMaterial,HatchMaterial}
├─ actors/         Actor LineActor SectionActor VectorGlyphActor
├─ widgets/        ScalarBarActor OrientationTriadActor NavigationCube MeasurementRuler
├─ interaction/    RenderWindowInteractor InteractorStyle{,Orbit,CAD,TrackballCamera}
│                  InputStyleHandler constants
│   ├─ picking/    PickMode Picker SubPicker ActorTopology* PickingController
│   └─ highlight/  ActorHighlighter SelectionHighlighter
└─ index.js        API công khai duy nhất
```
`*` = placeholder

### Bất biến kiến trúc

```
core → geometry → filters → color → mappers → camera → rendering → actors → widgets → interaction
```

Import chỉ đi từ trái sang phải. `.dependency-cruiser.cjs` enforce, `npm run depcruise`.

> Thứ tự này **khác** với đề xuất trong bản audit đầu tiên. Khi chạy thật, `Renderer`
> import `Camera` và `SectionActor` import `rendering/materials` — nên `camera` phải
> đứng trước `rendering`, và `rendering` trước `actors`. Bản audit đoán sai; công cụ
> sửa lại.

---

## Ba bug thật đã vá

### 1. Vách trong không bị loại khi toạ độ lệch vài ulp

`GeometryFilter` và `ExternalSurfaceFilter` hàn đỉnh bằng `Math.round(x/tol)*tol`.
Hai đỉnh cách nhau `1e-6` (với `tol = 1e-3`) vẫn rơi vào hai bucket khác nhau nếu nằm
hai bên ranh giới `.5`. Mặt chung của hai phần tử không được nhận là trùng →
vách trong nằm lại → clipping/section hiện tiết diện rỗng có gân.

```
$ node tests/regression_old_vs_new.mjs

  case                                    GeometryFilter(cũ)    extractByTopology(mới)
  mặt chung trùng khít       (d=0)        6  ok                 6  ok
  mặt chung lệch 1e-6        (d=1e-6)     8  SAI               6  ok
  mặt chung lệch 1e-5        (d=1e-5)     8  SAI               6  ok
```

`8` = cả hai bản của mặt chung được giữ. Đây là sai số bình thường khi ghép hai part
đã transform. Chạy file này trước tiên nếu bạn từng thấy tiết diện lạ sau khi cắt.

`externalSurfaceGeometry.js` và `FeatureEdges._weld()` vốn đã dùng thuật toán đúng
(spatial hash 27 ô). Bản gộp giữ thuật toán đó — nay chỉ còn **một** bản trong
`geometry/weld.js` thay vì bốn.

### 2. Filter đánh rơi pointData / cellData

`SurfaceFilter` giữ nguyên `pointData` (point id không đổi khi chỉ lọc index) và
**remap** `cellData` qua `geometry.userData.cellMap` — đúng convention `Picker.js` đang đọc.

### 3. `ColorTransferFunction` im lặng nuốt preset sai

`COLORMAP_PRESETS[preset] ?? null` → gõ `"viridus"` cho ra rainbow, không báo gì.
Nay ném lỗi kèm danh sách preset hợp lệ.

---

## Đã gộp / xoá

| Xoá | Thay bằng |
|---|---|
| `Filters/GeometryFilter.js` | `geometry/surfaceTopology.js` |
| `Filters/externalSurfaceGeometry.js` | `geometry/surfaceTopology.js` |
| `Filters/ExternalSurfaceFilter.js` | `geometry/surfaceVisibility.js` |
| `Filters/earcut.js` (1018 dòng) | `npm i earcut` |
| `Rendering/VTKCamera.js` | hợp nhất vào `camera/Camera.js` |
| `Camera/Camera.js`, `Picking/index.js` | shim/barrel, không còn cần |

Ba lớp trích mặt ngoài + một hàm → một `SurfaceFilter` với hai strategy:

```js
import { SurfaceFilter, SURFACE_STRATEGY } from "threejs-vtk";

const surf = new SurfaceFilter({ strategy: SURFACE_STRATEGY.TOPOLOGY });   // nhanh, runtime
const shell = new SurfaceFilter({ strategy: SURFACE_STRATEGY.VISIBILITY }); // chậm, offline
mapper.setInputData(surf.setInputData(grid).getOutputData());
```

`Actor` vẫn dùng API thấp hơn (`extractByTopology` / `extractByVisibility` nhận
`BufferGeometry`), vì nó làm việc trực tiếp trên geometry chứ không qua PolyData.
`Actor.keepOuterShell = true` chọn strategy **visibility** — trùng tên nhưng khác nghĩa
với cờ `keepOuterShell` của `extractByTopology`.

---

## Còn lại (Phase 2)

Chặn bởi hai file thiếu ở trên:

- Gộp `InteractorStyleOrbit` (756) + `InteractorStyleCAD` (497) → `InteractorStyleNavigation`
  (cần API của `Camera` facade). ~500 dòng trùng lặp.
- `SubPicker` compose `Picker` thay vì viết lại raycast (cần `ActorTopology`).
- Tách `Actor.js` (680 dòng, 6 trách nhiệm) → `Actor` + `ActorAppearance` + `ActorEdges` + `ActorDisplayMode`.
- Base `Highlighter` cho `ActorHighlighter` + `SelectionHighlighter`.
- `VTPReader` / `VTKLegacyReader` dùng `io/dataArrayCodec.js` (file đã có, đã test, chưa nối vào).

---

## Công cụ

| Lệnh | Việc |
|---|---|
| `npm run verify` | mọi import trỏ tới file thật, mọi symbol có export (kể cả barrel) |
| `npm test` | 33 test, 5 suite |
| `npm run depcruise` | chiều phụ thuộc + circular |
| `node tools/migrate.mjs --root <repo>` | codemod áp layout mới lên repo gốc (dry-run mặc định) |

Trước khi làm gì: thêm `.gitattributes`, chạy `git add --renormalize .` trong một
**commit riêng**. Repo gốc trộn CRLF và LF (`Actor.js` CRLF, `PolyData.js` LF); nếu không
normalize trước, mọi diff refactor sẽ bị nhiễu toàn bộ file.
