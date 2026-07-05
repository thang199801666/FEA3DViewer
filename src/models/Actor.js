import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export class Actor extends THREE.Group {
  constructor(geometry, material, name = 'CAD_Actor') {
    super();
    this.name = name;
    this.isActor = true; // Flag định danh nhanh

    // 1. Khởi tạo Mesh chính (Bề mặt vật thể)
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = `${name}_mesh`;
    this.add(this.mesh);

    // 2. Khởi tạo Edge (Đường cạnh sắc) dưới dạng null, chỉ tính toán khi được bật
    this.edges = null;
    this.defaultThresholdAngle = 20; // Góc mặc định 20 độ

    // Luôn hiển thị Feature Edges mặc định, không phụ thuộc hover/select
    this.showFeatureEdges();
  }

  /**
   * Tính toán và hiển thị các cạnh sắc (Feature Edges) dựa trên góc ngưỡng
   * Sử dụng LineSegments2 (Fat Lines) của Three.js giúp chỉnh được độ dày pixel nét CAD một cách mượt mà.
   * @param {number} thresholdAngle Góc giới hạn (độ), mặc định 20 độ
   */
  showFeatureEdges(thresholdAngle = this.defaultThresholdAngle) {
    // Nếu đã tồn tại Edges cũ, xóa đi để tính lại theo góc mới nếu cần
    if (this.edges) {
      this.hideFeatureEdges();
    }

    // Tạo EdgesGeometry chuẩn từ Mesh
    const edgesGeom = new THREE.EdgesGeometry(this.mesh.geometry, thresholdAngle);
    
    // Chuyển đổi sang LineSegmentsGeometry để hỗ trợ độ dày nét vẽ (linewidth) ổn định trên mọi thiết bị
    const wideEdgesGeom = new LineSegmentsGeometry().fromEdgesGeometry(edgesGeom);

    // Tạo vật liệu cho đường nét CAD mảnh nhưng sắc nét
    const lineMaterial = new LineMaterial({
      color: 0x111111,       // Màu đen hoặc xám đậm cho cạnh sắc CAD
      linewidth: 1.5,        // Độ dày nét vẽ (tính theo pixel)
      dashed: false,
    });

    // Đảm bảo vật liệu dòng tương thích với kích thước viewport hiện tại
    lineMaterial.resolution.set(window.innerWidth, window.innerHeight);

    this.edges = new LineSegments2(wideEdgesGeom, lineMaterial);
    this.edges.name = `${this.name}_edges`;
    
    // Đẩy nhẹ vị trí cạnh lên trước bề mặt Mesh một chút để tránh hiện tượng z-fighting (nhấp nháy nét vẽ)
    this.edges.renderOrder = 1;
    if (lineMaterial.polygonOffset) {
      lineMaterial.polygonOffset = true;
      lineMaterial.polygonOffsetFactor = -1;
      lineMaterial.polygonOffsetUnits = -1;
    }

    this.add(this.edges);
    edgesGeom.dispose(); // Giải phóng bộ nhớ đệm hình học gốc
  }

  /**
   * Ẩn và giải phóng bộ nhớ của Feature Edges
   */
  hideFeatureEdges() {
    if (!this.edges) return;

    this.remove(this.edges);
    
    if (this.edges.geometry) this.edges.geometry.dispose();
    if (this.edges.material) this.edges.material.dispose();
    
    this.edges = null;
  }

  /**
   * Cập nhật độ phân giải nét vẽ khi màn hình resize (Yêu cầu bắt buộc của LineMaterial)
   */
  updateEdgeResolution(width, height) {
    if (this.edges && this.edges.material) {
      this.edges.material.resolution.set(width, height);
    }
  }

  /**
   * Hàm dọn dẹp giải phóng bộ nhớ hoàn toàn cho Actor này
   */
  dispose() {
    this.hideFeatureEdges();
    if (this.mesh) {
      if (this.mesh.geometry) this.mesh.geometry.dispose();
      if (this.mesh.material) {
        if (Array.isArray(this.mesh.material)) {
          this.mesh.material.forEach(m => m.dispose());
        } else {
          this.mesh.material.dispose();
        }
      }
    }
  }
}