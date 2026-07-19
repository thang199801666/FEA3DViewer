# FEA binary format v1

`.fea` is a little-endian, versioned container. The format library is independent of Abaqus.

## Layout

- 32-byte header: magic `FEA3D\r\n\x1a`, version, byte order, array count, directory offset and file size.
- Fixed 56-byte directory entries: kind, scalar type, association, component count, UTF-8 name (23 bytes + NUL), data offset, byte length and scalar-value count.
- Contiguous raw array payloads. Unknown array kinds may be skipped, allowing future extensions.

The archive layer stores typed arrays. The database schema on top of it models:

```text
Database
├─ metadata and source solver information
├─ Instance[]
│  └─ Mesh
│     ├─ NodeBlock[] (labels, xyz coordinates)
│     ├─ ElementBlock[] (one topology per block)
│     ├─ EntitySet[] (node or element labels)
│     └─ Surface[] (element labels and face IDs)
└─ Step[]
   └─ Frame[]
      └─ FieldOutput[]
         └─ FieldBlock[] (instance, labels, values, integration-point numbers)
```

This combines Exodus-style mesh partitioning with an ODB-style results hierarchy. An `ElementBlock` contains a single topology/material region, its original element labels, connectivity, optional offsets, and block metadata. Blocks may use solver names such as `C3D8R` or normalized names such as `HEX8`; the convention must be declared in database metadata.

Connectivity always contains zero-based indices into the instance's concatenated node blocks. Original solver node and element labels are stored separately. A UI adapter may map element-block topology to VTK types, but VTK is not part of the persistent database schema.

Fields can be `NODAL`, `ELEMENT_NODAL`, `INTEGRATION_POINT`, `CENTROID`, or `ELEMENT_FACE`. Each field block identifies its instance, region/element block, and optional section point. Do not silently flatten integration-point results into nodal data. Derived/averaged values should be written as a separate field and described in metadata.

## Block rules

- Node and element labels are solver IDs; connectivity contains internal zero-based indices.
- One element block has one topology and a fixed `nodes_per_element`. `offsets` is only required for variable-size topology.
- Result blocks must not mix positions, component layouts, instances, regions, or section points.
- Every large numeric payload is a separate archive block referenced by database metadata.
- Unknown archive block kinds are skipped, enabling forward-compatible additions.
- Sets and surfaces store labels, not internal array positions, so reordering mesh blocks does not invalidate them.

The current container v1 implementation loads the archive into memory and uses 32-bit array counts. Database schema 3 added history regions and history outputs. Schema 4 adds material definitions, generic material-property tables, section definitions, and per-instance section assignments. Readers remain compatible with schema 2 and 3 files. Block compression, true streaming/lazy block I/O and complex-valued fields remain planned extensions. The directory design permits unknown block kinds to be skipped.

## ODB adapter boundary

ODB is an Abaqus-owned format, not a public byte format. Build the converter inside an Abaqus installation against that release's ODB C++ API (or use Abaqus Python as the extraction front end). The adapter should:

1. Open the ODB with the vendor API and select step/frame/instance.
2. Create a stable map from Abaqus node labels to zero-based point indices.
3. Map Abaqus element names (`C3D4`, `C3D8[R]`, `C3D10`, `C3D20[R]`, `S3`, `S4[R]`, etc.) to VTK cell IDs and reorder connectivity when conventions differ.
4. Request field outputs at `NODAL` or `ELEMENT_NODAL`; explicitly document averaging of stress/strain.
5. Populate `fea::Writer` with the mesh, `U`, `S`, and other selected fields.

Keep this adapter in a separate executable linked to both `fea_format` and the Abaqus libraries. This keeps every other native app—and the WASM reader—free of Abaqus runtime and licensing dependencies:

```text
odb2fea.exe -> Abaqus ODB C++ API + libfea
Windows app -> libfea
Web app     -> libfea.wasm -> JavaScript rendering adapter
```

`libfea` must never include an Abaqus header in its public interface. Put all `odb_API.h`/`odb_*.h` includes and Abaqus element-order conversion tables inside `odb2fea`.

## Build

Native library and example:

```powershell
cmake -S native/fea -B build/fea
cmake --build build/fea --config Release
```

WASM reader (after activating Emscripten):

```powershell
./native/fea/build-wasm.ps1
```

This writes `public/wasm/fea_reader.wasm`, loaded by `FEAReader` in the browser.
