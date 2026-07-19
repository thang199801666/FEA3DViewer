#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace {

struct FaceKey {
    int32_t ids[4] = {0, 0, 0, 0};
    uint8_t size = 0;

    bool operator==(const FaceKey& other) const {
        if (size != other.size) return false;
        for (uint8_t i = 0; i < size; ++i) {
            if (ids[i] != other.ids[i]) return false;
        }
        return true;
    }
};

struct FaceKeyHash {
    size_t operator()(const FaceKey& key) const {
        size_t h = key.size;
        for (uint8_t i = 0; i < key.size; ++i) {
            h ^= static_cast<uint32_t>(key.ids[i]) + 0x9e3779b9U + (h << 6U) + (h >> 2U);
        }
        return h;
    }
};

struct FaceRecord {
    int32_t ids[4] = {0, 0, 0, 0};
    int32_t sourceCell = -1;
    uint8_t size = 0;
    uint32_t count = 0;
};

struct FaceDef {
    uint8_t size;
    uint8_t ids[4];
};

struct SpatialKey {
    int64_t x, y, z;
    bool operator==(const SpatialKey& other) const {
        return x == other.x && y == other.y && z == other.z;
    }
};

struct SpatialKeyHash {
    size_t operator()(const SpatialKey& key) const {
        size_t h = std::hash<int64_t>{}(key.x);
        h ^= std::hash<int64_t>{}(key.y) + 0x9e3779b9U + (h << 6U) + (h >> 2U);
        h ^= std::hash<int64_t>{}(key.z) + 0x9e3779b9U + (h << 6U) + (h >> 2U);
        return h;
    }
};

std::vector<int32_t> polyOffsets;
std::vector<int32_t> polyConnectivity;
std::vector<int32_t> polySources;
std::vector<int32_t> stripOffsets;
std::vector<int32_t> stripConnectivity;
std::vector<int32_t> stripSources;
std::vector<float> pointOutput;
std::vector<uint8_t> byteOutput;
std::vector<float> scalarOutput;
std::vector<int32_t> interpolationSourceA;
std::vector<int32_t> interpolationSourceB;
std::vector<float> interpolationAmount;
int32_t uniquePointCount = 0;

constexpr uint8_t VTK_TRIANGLE = 5;
constexpr uint8_t VTK_TRIANGLE_STRIP = 6;
constexpr uint8_t VTK_POLYGON = 7;
constexpr uint8_t VTK_PIXEL = 8;
constexpr uint8_t VTK_QUAD = 9;
constexpr uint8_t VTK_TETRA = 10;
constexpr uint8_t VTK_VOXEL = 11;
constexpr uint8_t VTK_HEXAHEDRON = 12;
constexpr uint8_t VTK_WEDGE = 13;
constexpr uint8_t VTK_PYRAMID = 14;
constexpr uint8_t VTK_QUADRATIC_TRIANGLE = 22;
constexpr uint8_t VTK_QUADRATIC_QUAD = 23;
constexpr uint8_t VTK_QUADRATIC_TETRA = 24;
constexpr uint8_t VTK_QUADRATIC_HEXAHEDRON = 25;
constexpr uint8_t VTK_QUADRATIC_WEDGE = 26;
constexpr uint8_t VTK_QUADRATIC_PYRAMID = 27;

constexpr FaceDef TETRA_FACES[] = {
    {3, {0, 1, 3, 0}}, {3, {1, 2, 3, 0}},
    {3, {2, 0, 3, 0}}, {3, {0, 2, 1, 0}},
};
constexpr FaceDef HEX_FACES[] = {
    {4, {0, 3, 2, 1}}, {4, {4, 5, 6, 7}}, {4, {0, 1, 5, 4}},
    {4, {1, 2, 6, 5}}, {4, {2, 3, 7, 6}}, {4, {3, 0, 4, 7}},
};
constexpr FaceDef VOXEL_FACES[] = {
    {4, {0, 2, 3, 1}}, {4, {4, 5, 7, 6}}, {4, {0, 1, 5, 4}},
    {4, {1, 3, 7, 5}}, {4, {3, 2, 6, 7}}, {4, {2, 0, 4, 6}},
};
constexpr FaceDef WEDGE_FACES[] = {
    {3, {0, 1, 2, 0}}, {3, {3, 5, 4, 0}}, {4, {0, 3, 4, 1}},
    {4, {1, 4, 5, 2}}, {4, {2, 5, 3, 0}},
};
constexpr FaceDef PYRAMID_FACES[] = {
    {4, {0, 3, 2, 1}}, {3, {0, 1, 4, 0}}, {3, {1, 2, 4, 0}},
    {3, {2, 3, 4, 0}}, {3, {3, 0, 4, 0}},
};

bool is2DCell(uint8_t type) {
    return type == VTK_TRIANGLE || type == VTK_QUAD || type == VTK_POLYGON ||
           type == VTK_PIXEL || type == VTK_QUADRATIC_TRIANGLE || type == VTK_QUADRATIC_QUAD;
}

bool getFaces(uint8_t type, const FaceDef*& faces, size_t& count, int32_t& corners) {
    switch (type) {
        case VTK_TETRA:
        case VTK_QUADRATIC_TETRA:
            faces = TETRA_FACES; count = 4; corners = 4; return true;
        case VTK_HEXAHEDRON:
        case VTK_QUADRATIC_HEXAHEDRON:
            faces = HEX_FACES; count = 6; corners = 8; return true;
        case VTK_VOXEL:
            faces = VOXEL_FACES; count = 6; corners = 8; return true;
        case VTK_WEDGE:
        case VTK_QUADRATIC_WEDGE:
            faces = WEDGE_FACES; count = 5; corners = 6; return true;
        case VTK_PYRAMID:
        case VTK_QUADRATIC_PYRAMID:
            faces = PYRAMID_FACES; count = 5; corners = 5; return true;
        default:
            return false;
    }
}

void appendCell(std::vector<int32_t>& offsets, std::vector<int32_t>& connectivity,
                const int32_t* ids, int32_t size) {
    connectivity.insert(connectivity.end(), ids, ids + size);
    offsets.push_back(static_cast<int32_t>(connectivity.size()));
}

template <typename T>
uintptr_t dataPointer(const std::vector<T>& values) {
    return values.empty() ? 0 : reinterpret_cast<uintptr_t>(values.data());
}

} // namespace

extern "C" {

// Returns 0 on success. Input arrays are borrowed only for the duration of this call.
int32_t surface_extract(const int32_t* connectivity, int32_t connectivityLength,
                        const int32_t* offsets, int32_t offsetsLength,
                        const uint8_t* cellTypes, int32_t cellTypesLength) {
    if (!connectivity || !offsets || !cellTypes || offsetsLength != cellTypesLength + 1 ||
        connectivityLength < 0 || offsetsLength < 1 || offsets[0] != 0 ||
        offsets[offsetsLength - 1] > connectivityLength) {
        return 1;
    }

    polyOffsets.assign(1, 0);
    polyConnectivity.clear();
    polySources.clear();
    stripOffsets.assign(1, 0);
    stripConnectivity.clear();
    stripSources.clear();

    std::unordered_map<FaceKey, size_t, FaceKeyHash> faceIndex;
    std::vector<FaceRecord> faceRecords;
    faceIndex.reserve(static_cast<size_t>(cellTypesLength) * 3U);
    faceRecords.reserve(static_cast<size_t>(cellTypesLength) * 3U);

    for (int32_t cellId = 0; cellId < cellTypesLength; ++cellId) {
        const int32_t start = offsets[cellId];
        const int32_t end = offsets[cellId + 1];
        if (start < 0 || end < start || end > connectivityLength) return 2;
        const int32_t cellSize = end - start;
        const uint8_t type = cellTypes[cellId];

        if (type == VTK_TRIANGLE_STRIP) {
            appendCell(stripOffsets, stripConnectivity, connectivity + start, cellSize);
            stripSources.push_back(cellId);
            continue;
        }
        if (is2DCell(type)) {
            appendCell(polyOffsets, polyConnectivity, connectivity + start, cellSize);
            polySources.push_back(cellId);
            continue;
        }

        const FaceDef* faces = nullptr;
        size_t faceCount = 0;
        int32_t cornerCount = 0;
        if (!getFaces(type, faces, faceCount, cornerCount) || cellSize < cornerCount) continue;

        for (size_t faceId = 0; faceId < faceCount; ++faceId) {
            const FaceDef& face = faces[faceId];
            FaceKey key;
            key.size = face.size;
            FaceRecord record;
            record.size = face.size;
            record.sourceCell = cellId;
            record.count = 1;
            for (uint8_t i = 0; i < face.size; ++i) {
                const int32_t pointId = connectivity[start + face.ids[i]];
                key.ids[i] = pointId;
                record.ids[i] = pointId;
            }
            std::sort(key.ids, key.ids + key.size);

            const auto found = faceIndex.find(key);
            if (found == faceIndex.end()) {
                const size_t index = faceRecords.size();
                faceRecords.push_back(record);
                faceIndex.emplace(key, index);
            } else {
                ++faceRecords[found->second].count;
            }
        }
    }

    for (const FaceRecord& face : faceRecords) {
        if (face.count != 1) continue;
        appendCell(polyOffsets, polyConnectivity, face.ids, face.size);
        polySources.push_back(face.sourceCell);
    }
    return 0;
}

uintptr_t surface_poly_offsets_ptr() { return dataPointer(polyOffsets); }
int32_t surface_poly_offsets_len() { return static_cast<int32_t>(polyOffsets.size()); }
uintptr_t surface_poly_connectivity_ptr() { return dataPointer(polyConnectivity); }
int32_t surface_poly_connectivity_len() { return static_cast<int32_t>(polyConnectivity.size()); }
uintptr_t surface_poly_sources_ptr() { return dataPointer(polySources); }
int32_t surface_poly_sources_len() { return static_cast<int32_t>(polySources.size()); }
uintptr_t surface_strip_offsets_ptr() { return dataPointer(stripOffsets); }
int32_t surface_strip_offsets_len() { return static_cast<int32_t>(stripOffsets.size()); }
uintptr_t surface_strip_connectivity_ptr() { return dataPointer(stripConnectivity); }
int32_t surface_strip_connectivity_len() { return static_cast<int32_t>(stripConnectivity.size()); }
uintptr_t surface_strip_sources_ptr() { return dataPointer(stripSources); }
int32_t surface_strip_sources_len() { return static_cast<int32_t>(stripSources.size()); }

int32_t warp_points(const float* points, int32_t pointValueCount,
                    const float* vectors, int32_t vectorValueCount,
                    int32_t vectorComponents, float scale) {
    if (!points || !vectors || pointValueCount < 0 || pointValueCount % 3 != 0 ||
        vectorComponents < 3 || vectorValueCount < (pointValueCount / 3) * vectorComponents) {
        return 1;
    }
    pointOutput.resize(static_cast<size_t>(pointValueCount));
    const int32_t pointCount = pointValueCount / 3;
    for (int32_t i = 0; i < pointCount; ++i) {
        const int32_t p = i * 3;
        const int32_t v = i * vectorComponents;
        pointOutput[p] = points[p] + scale * vectors[v];
        pointOutput[p + 1] = points[p + 1] + scale * vectors[v + 1];
        pointOutput[p + 2] = points[p + 2] + scale * vectors[v + 2];
    }
    return 0;
}

void warp_points_range(float* points, int32_t pointValueCount, const float* vectors,
                       int32_t vectorValueCount, int32_t vectorComponents, float scale,
                       int32_t startPoint, int32_t endPoint) {
    if (!points || !vectors || vectorComponents < 3) return;
    const int32_t pointCount = pointValueCount / 3;
    startPoint = std::max(0, startPoint);
    endPoint = std::min(pointCount, endPoint);
    for (int32_t point = startPoint; point < endPoint; ++point) {
        const int32_t p = point * 3, v = point * vectorComponents;
        if (v + 2 >= vectorValueCount) break;
        points[p] += scale * vectors[v];
        points[p + 1] += scale * vectors[v + 1];
        points[p + 2] += scale * vectors[v + 2];
    }
}

int32_t smooth_points(const float* points, int32_t pointValueCount,
                      const int32_t* triangles, int32_t triangleValueCount,
                      int32_t iterations, float relaxation) {
    if (!points || !triangles || pointValueCount < 0 || pointValueCount % 3 != 0 ||
        triangleValueCount < 0 || triangleValueCount % 3 != 0 || iterations < 0) {
        return 1;
    }
    const int32_t pointCount = pointValueCount / 3;
    std::vector<std::vector<int32_t>> neighbors(static_cast<size_t>(pointCount));
    const auto addNeighbor = [&](int32_t a, int32_t b) {
        if (a >= 0 && a < pointCount && b >= 0 && b < pointCount && a != b) {
            neighbors[static_cast<size_t>(a)].push_back(b);
        }
    };
    for (int32_t t = 0; t < triangleValueCount; t += 3) {
        const int32_t a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
        if (a < 0 || b < 0 || c < 0 || a >= pointCount || b >= pointCount || c >= pointCount) return 2;
        addNeighbor(a, b); addNeighbor(a, c);
        addNeighbor(b, a); addNeighbor(b, c);
        addNeighbor(c, a); addNeighbor(c, b);
    }
    for (auto& list : neighbors) {
        std::sort(list.begin(), list.end());
        list.erase(std::unique(list.begin(), list.end()), list.end());
    }

    pointOutput.assign(points, points + pointValueCount);
    std::vector<float> next(static_cast<size_t>(pointValueCount));
    for (int32_t iteration = 0; iteration < iterations; ++iteration) {
        for (int32_t i = 0; i < pointCount; ++i) {
            const auto& list = neighbors[static_cast<size_t>(i)];
            const int32_t p = i * 3;
            if (list.empty()) {
                next[p] = pointOutput[p]; next[p + 1] = pointOutput[p + 1]; next[p + 2] = pointOutput[p + 2];
                continue;
            }
            float x = 0, y = 0, z = 0;
            for (const int32_t neighbor : list) {
                const int32_t q = neighbor * 3;
                x += pointOutput[q]; y += pointOutput[q + 1]; z += pointOutput[q + 2];
            }
            const float inverse = 1.0f / static_cast<float>(list.size());
            next[p] = pointOutput[p] + relaxation * (x * inverse - pointOutput[p]);
            next[p + 1] = pointOutput[p + 1] + relaxation * (y * inverse - pointOutput[p + 1]);
            next[p + 2] = pointOutput[p + 2] + relaxation * (z * inverse - pointOutput[p + 2]);
        }
        pointOutput.swap(next);
    }
    return 0;
}

uintptr_t point_output_ptr() { return dataPointer(pointOutput); }
int32_t point_output_len() { return static_cast<int32_t>(pointOutput.size()); }

int32_t contour_lines(const float* points, int32_t pointValueCount,
                      const int32_t* triangles, int32_t triangleValueCount,
                      const float* scalars, int32_t scalarCount,
                      const float* isoValues, int32_t isoCount) {
    if (!points || !triangles || !scalars || !isoValues || pointValueCount < 0 ||
        pointValueCount % 3 != 0 || triangleValueCount < 0 || triangleValueCount % 3 != 0 ||
        isoCount < 0 || scalarCount < pointValueCount / 3) {
        return 1;
    }
    const int32_t pointCount = pointValueCount / 3;
    pointOutput.clear();
    scalarOutput.clear();
    pointOutput.reserve(static_cast<size_t>(triangleValueCount) * static_cast<size_t>(isoCount));
    scalarOutput.reserve(static_cast<size_t>(triangleValueCount / 3) * 2U * static_cast<size_t>(isoCount));

    for (int32_t isoId = 0; isoId < isoCount; ++isoId) {
        const float iso = isoValues[isoId];
        for (int32_t t = 0; t < triangleValueCount; t += 3) {
            const int32_t ids[3] = {triangles[t], triangles[t + 1], triangles[t + 2]};
            if (ids[0] < 0 || ids[1] < 0 || ids[2] < 0 ||
                ids[0] >= pointCount || ids[1] >= pointCount || ids[2] >= pointCount) return 2;
            float crossings[6];
            int32_t crossingCount = 0;
            for (int32_t edge = 0; edge < 3; ++edge) {
                const int32_t a = ids[edge], b = ids[(edge + 1) % 3];
                const float sa = scalars[a], sb = scalars[b];
                const float lo = std::min(sa, sb), hi = std::max(sa, sb);
                if (iso < lo || iso > hi || sa == sb) continue;
                if (crossingCount >= 2) { ++crossingCount; continue; }
                const float amount = (iso - sa) / (sb - sa);
                for (int32_t axis = 0; axis < 3; ++axis) {
                    const float pa = points[a * 3 + axis], pb = points[b * 3 + axis];
                    crossings[crossingCount * 3 + axis] = pa + (pb - pa) * amount;
                }
                ++crossingCount;
            }
            if (crossingCount == 2) {
                pointOutput.insert(pointOutput.end(), crossings, crossings + 6);
                scalarOutput.push_back(iso);
                scalarOutput.push_back(iso);
            }
        }
    }
    return 0;
}

uintptr_t scalar_output_ptr() { return dataPointer(scalarOutput); }
int32_t scalar_output_len() { return static_cast<int32_t>(scalarOutput.size()); }

int32_t clip_triangles(const float* points, int32_t pointValueCount,
                       const int32_t* triangles, int32_t triangleValueCount,
                       float nx, float ny, float nz,
                       float ox, float oy, float oz, int32_t insideOut) {
    if (!points || !triangles || pointValueCount < 0 || pointValueCount % 3 != 0 ||
        triangleValueCount < 0 || triangleValueCount % 3 != 0) return 1;
    const int32_t pointCount = pointValueCount / 3;
    const float sign = insideOut ? -1.0f : 1.0f;
    pointOutput.clear();
    polyOffsets.assign(1, 0);
    polyConnectivity.clear();
    interpolationSourceA.clear();
    interpolationSourceB.clear();
    interpolationAmount.clear();

    const auto emit = [&](int32_t a, int32_t b, float amount) {
        const int32_t outputId = static_cast<int32_t>(pointOutput.size() / 3U);
        for (int32_t axis = 0; axis < 3; ++axis) {
            const float valueA = points[a * 3 + axis];
            pointOutput.push_back(b < 0 ? valueA : valueA + amount * (points[b * 3 + axis] - valueA));
        }
        interpolationSourceA.push_back(a);
        interpolationSourceB.push_back(b);
        interpolationAmount.push_back(amount);
        polyConnectivity.push_back(outputId);
    };

    for (int32_t t = 0; t < triangleValueCount; t += 3) {
        const int32_t ids[3] = {triangles[t], triangles[t + 1], triangles[t + 2]};
        float distance[3];
        bool inside[3];
        int32_t insideCount = 0;
        for (int32_t i = 0; i < 3; ++i) {
            const int32_t id = ids[i];
            if (id < 0 || id >= pointCount) return 2;
            distance[i] = sign * (nx * (points[id * 3] - ox) +
                                  ny * (points[id * 3 + 1] - oy) +
                                  nz * (points[id * 3 + 2] - oz));
            inside[i] = distance[i] >= 0.0f;
            if (inside[i]) ++insideCount;
        }
        if (insideCount == 0) continue;
        if (insideCount == 3) {
            emit(ids[0], -1, 0); emit(ids[1], -1, 0); emit(ids[2], -1, 0);
            polyOffsets.push_back(static_cast<int32_t>(polyConnectivity.size()));
            continue;
        }
        const size_t before = polyConnectivity.size();
        for (int32_t edge = 0; edge < 3; ++edge) {
            const int32_t next = (edge + 1) % 3;
            if (inside[edge]) emit(ids[edge], -1, 0);
            if (inside[edge] != inside[next]) {
                const float amount = distance[edge] / (distance[edge] - distance[next]);
                emit(ids[edge], ids[next], amount);
            }
        }
        if (polyConnectivity.size() - before >= 3U) {
            polyOffsets.push_back(static_cast<int32_t>(polyConnectivity.size()));
        }
    }
    return 0;
}

uintptr_t interpolation_source_a_ptr() { return dataPointer(interpolationSourceA); }
int32_t interpolation_source_a_len() { return static_cast<int32_t>(interpolationSourceA.size()); }
uintptr_t interpolation_source_b_ptr() { return dataPointer(interpolationSourceB); }
int32_t interpolation_source_b_len() { return static_cast<int32_t>(interpolationSourceB.size()); }
uintptr_t interpolation_amount_ptr() { return dataPointer(interpolationAmount); }
int32_t interpolation_amount_len() { return static_cast<int32_t>(interpolationAmount.size()); }

int32_t cut_segments(const float* points, int32_t pointValueCount,
                     const int32_t* triangles, int32_t triangleValueCount,
                     float nx, float ny, float nz, float ox, float oy, float oz) {
    if (!points || !triangles || pointValueCount < 0 || pointValueCount % 3 != 0 ||
        triangleValueCount < 0 || triangleValueCount % 3 != 0) return 1;
    const int32_t pointCount = pointValueCount / 3;
    const float normalLength = std::sqrt(nx * nx + ny * ny + nz * nz);
    if (normalLength > 0) { nx /= normalLength; ny /= normalLength; nz /= normalLength; }

    float minValue[3] = {0, 0, 0}, maxValue[3] = {0, 0, 0};
    if (pointCount > 0) {
        for (int32_t axis = 0; axis < 3; ++axis) minValue[axis] = maxValue[axis] = points[axis];
        for (int32_t i = 1; i < pointCount; ++i) {
            for (int32_t axis = 0; axis < 3; ++axis) {
                minValue[axis] = std::min(minValue[axis], points[i * 3 + axis]);
                maxValue[axis] = std::max(maxValue[axis], points[i * 3 + axis]);
            }
        }
    }
    const double dx = maxValue[0] - minValue[0], dy = maxValue[1] - minValue[1], dz = maxValue[2] - minValue[2];
    const double diagonal = std::sqrt(dx * dx + dy * dy + dz * dz);
    const double epsilon = std::max(diagonal * 1e-6, 1e-9);
    const double epsilonSquared = epsilon * epsilon;

    pointOutput.clear();
    polyConnectivity.clear(); // Flat [segmentA, segmentB, ...].
    interpolationSourceA.clear();
    interpolationSourceB.clear();
    interpolationAmount.clear();
    std::unordered_map<SpatialKey, std::vector<int32_t>, SpatialKeyHash> buckets;
    std::unordered_set<uint64_t> segmentSet;
    buckets.reserve(static_cast<size_t>(triangleValueCount / 3));
    segmentSet.reserve(static_cast<size_t>(triangleValueCount / 3));

    const auto weld = [&](int32_t a, int32_t b, float amount) {
        float position[3];
        for (int32_t axis = 0; axis < 3; ++axis) {
            const float valueA = points[a * 3 + axis];
            position[axis] = valueA + amount * (points[b * 3 + axis] - valueA);
        }
        const SpatialKey cell = {
            static_cast<int64_t>(std::floor(position[0] / epsilon)),
            static_cast<int64_t>(std::floor(position[1] / epsilon)),
            static_cast<int64_t>(std::floor(position[2] / epsilon)),
        };
        for (int64_t ix = -1; ix <= 1; ++ix) for (int64_t iy = -1; iy <= 1; ++iy) for (int64_t iz = -1; iz <= 1; ++iz) {
            const auto found = buckets.find({cell.x + ix, cell.y + iy, cell.z + iz});
            if (found == buckets.end()) continue;
            for (const int32_t id : found->second) {
                const double px = pointOutput[id * 3] - position[0];
                const double py = pointOutput[id * 3 + 1] - position[1];
                const double pz = pointOutput[id * 3 + 2] - position[2];
                if (px * px + py * py + pz * pz <= epsilonSquared) return id;
            }
        }
        const int32_t id = static_cast<int32_t>(pointOutput.size() / 3U);
        pointOutput.insert(pointOutput.end(), position, position + 3);
        interpolationSourceA.push_back(a);
        interpolationSourceB.push_back(b);
        interpolationAmount.push_back(amount);
        buckets[cell].push_back(id);
        return id;
    };

    for (int32_t t = 0; t < triangleValueCount; t += 3) {
        const int32_t ids[3] = {triangles[t], triangles[t + 1], triangles[t + 2]};
        float distance[3];
        for (int32_t i = 0; i < 3; ++i) {
            const int32_t id = ids[i];
            if (id < 0 || id >= pointCount) return 2;
            distance[i] = nx * (points[id * 3] - ox) + ny * (points[id * 3 + 1] - oy) + nz * (points[id * 3 + 2] - oz);
        }
        int32_t crossings[3];
        int32_t crossingCount = 0;
        for (int32_t edge = 0; edge < 3; ++edge) {
            const int32_t next = (edge + 1) % 3;
            const float a = distance[edge], b = distance[next];
            if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) {
                const float amount = a / (a - b);
                crossings[crossingCount++] = weld(ids[edge], ids[next], amount);
            }
        }
        if (crossingCount != 2 || crossings[0] == crossings[1]) continue;
        const uint32_t lo = static_cast<uint32_t>(std::min(crossings[0], crossings[1]));
        const uint32_t hi = static_cast<uint32_t>(std::max(crossings[0], crossings[1]));
        const uint64_t key = (static_cast<uint64_t>(lo) << 32U) | hi;
        if (segmentSet.insert(key).second) {
            polyConnectivity.push_back(crossings[0]);
            polyConnectivity.push_back(crossings[1]);
        }
    }
    return 0;
}

int32_t weld_points(const float* points, int32_t pointValueCount, double tolerance) {
    if (!points || pointValueCount < 0 || pointValueCount % 3 != 0 || !(tolerance > 0)) return 1;
    const int32_t pointCount = pointValueCount / 3;
    const double toleranceSquared = tolerance * tolerance;
    polyConnectivity.assign(static_cast<size_t>(pointCount), -1);
    uniquePointCount = 0;
    std::unordered_map<SpatialKey, std::vector<int32_t>, SpatialKeyHash> buckets;
    buckets.reserve(static_cast<size_t>(pointCount));

    for (int32_t i = 0; i < pointCount; ++i) {
        const float x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
        const SpatialKey cell = {
            static_cast<int64_t>(std::floor(x / tolerance)),
            static_cast<int64_t>(std::floor(y / tolerance)),
            static_cast<int64_t>(std::floor(z / tolerance)),
        };
        int32_t matched = -1;
        for (int64_t ix = -1; ix <= 1 && matched < 0; ++ix)
            for (int64_t iy = -1; iy <= 1 && matched < 0; ++iy)
                for (int64_t iz = -1; iz <= 1 && matched < 0; ++iz) {
                    const auto found = buckets.find({cell.x + ix, cell.y + iy, cell.z + iz});
                    if (found == buckets.end()) continue;
                    for (const int32_t representative : found->second) {
                        const double dx = x - points[representative * 3];
                        const double dy = y - points[representative * 3 + 1];
                        const double dz = z - points[representative * 3 + 2];
                        if (dx * dx + dy * dy + dz * dz <= toleranceSquared) {
                            matched = polyConnectivity[representative];
                            break;
                        }
                    }
                }
        if (matched < 0) {
            matched = uniquePointCount++;
            buckets[cell].push_back(i);
        }
        polyConnectivity[i] = matched;
    }
    return 0;
}

int32_t weld_unique_count() { return uniquePointCount; }

int32_t parse_ascii_f32(const uint8_t* bytes, int32_t length) {
    if (!bytes || length < 0) return 1;
    pointOutput.clear();
    pointOutput.reserve(static_cast<size_t>(length / 6));
    int32_t i = 0;
    while (i < length) {
        while (i < length && bytes[i] <= 32) ++i;
        if (i >= length) break;
        float sign = 1.0f;
        if (bytes[i] == '-' || bytes[i] == '+') { if (bytes[i++] == '-') sign = -1.0f; }
        double value = 0.0;
        bool hasDigits = false;
        while (i < length && bytes[i] >= '0' && bytes[i] <= '9') {
            value = value * 10.0 + static_cast<double>(bytes[i++] - '0'); hasDigits = true;
        }
        if (i < length && bytes[i] == '.') {
            ++i;
            double place = 0.1;
            while (i < length && bytes[i] >= '0' && bytes[i] <= '9') {
                value += static_cast<double>(bytes[i++] - '0') * place; place *= 0.1; hasDigits = true;
            }
        }
        int32_t exponent = 0, exponentSign = 1;
        if (i < length && (bytes[i] == 'e' || bytes[i] == 'E')) {
            ++i;
            if (i < length && (bytes[i] == '-' || bytes[i] == '+')) { if (bytes[i++] == '-') exponentSign = -1; }
            while (i < length && bytes[i] >= '0' && bytes[i] <= '9') exponent = exponent * 10 + (bytes[i++] - '0');
        }
        if (hasDigits) {
            if (exponent) value *= std::pow(10.0, static_cast<double>(exponentSign * exponent));
            pointOutput.push_back(static_cast<float>(sign * value));
        } else {
            // Preserve token count for uncommon nan/inf spellings.
            while (i < length && bytes[i] > 32) ++i;
            pointOutput.push_back(0.0f);
        }
    }
    return 0;
}

int32_t parse_ascii_i32(const uint8_t* bytes, int32_t length) {
    if (!bytes || length < 0) return 1;
    polyConnectivity.clear();
    polyConnectivity.reserve(static_cast<size_t>(length / 3));
    int32_t i = 0;
    while (i < length) {
        while (i < length && bytes[i] <= 32) ++i;
        if (i >= length) break;
        int32_t sign = 1;
        if (bytes[i] == '-' || bytes[i] == '+') { if (bytes[i++] == '-') sign = -1; }
        int64_t value = 0;
        bool hasDigits = false;
        while (i < length && bytes[i] >= '0' && bytes[i] <= '9') {
            value = value * 10 + (bytes[i++] - '0'); hasDigits = true;
        }
        while (i < length && bytes[i] > 32) ++i;
        if (hasDigits) polyConnectivity.push_back(static_cast<int32_t>(sign * value));
    }
    return 0;
}

uintptr_t byte_output_ptr() { return dataPointer(byteOutput); }
int32_t byte_output_len() { return static_cast<int32_t>(byteOutput.size()); }

// Decodes VTK XML inline/appended base64 without creating a JS binary string.
// Whitespace, padding and the appended-data '_' marker are ignored.
int32_t decode_base64(const uint8_t* input, int32_t length) {
    if (!input || length < 0) return 1;
    static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    int8_t table[256];
    std::fill(table, table + 256, static_cast<int8_t>(-1));
    for (int32_t i = 0; i < 64; ++i) table[static_cast<uint8_t>(alphabet[i])] = static_cast<int8_t>(i);
    byteOutput.clear();
    byteOutput.reserve(static_cast<size_t>(length / 4) * 3U + 3U);
    uint32_t accumulator = 0;
    int32_t bits = 0;
    for (int32_t i = 0; i < length; ++i) {
        const int32_t value = table[input[i]];
        if (value < 0) continue;
        accumulator = (accumulator << 6U) | static_cast<uint32_t>(value);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            byteOutput.push_back(static_cast<uint8_t>((accumulator >> bits) & 0xffU));
        }
    }
    return 0;
}

} // extern "C"
