extern "C" {
void warp_points_range(float* points, int pointValueCount, const float* vectors,
                       int vectorValueCount, int vectorComponents, float scale,
                       int startPoint, int endPoint) {
    if (!points || !vectors || vectorComponents < 3) return;
    const int pointCount = pointValueCount / 3;
    if (startPoint < 0) startPoint = 0;
    if (endPoint > pointCount) endPoint = pointCount;
    for (int point = startPoint; point < endPoint; ++point) {
        const int p = point * 3, v = point * vectorComponents;
        if (v + 2 >= vectorValueCount) break;
        points[p] += scale * vectors[v];
        points[p + 1] += scale * vectors[v + 1];
        points[p + 2] += scale * vectors[v + 2];
    }
}
}
