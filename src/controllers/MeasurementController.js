import * as THREE from "three";

export default function MeasurementController(parentContainer, camera) {
    this.parentContainer = parentContainer;
    this.camera = camera;

    // Tạo phần tử DOM cho thước
    this.domElement = document.createElement("div");
    this.domElement.className = "measurement-ruler";
    
    // Chỉ set style hiển thị bên trong, không cố định vị trí tuyệt đối nữa
        Object.assign(this.domElement.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#333",
        marginTop: "0px"
    });

    // Tạo thanh ngang và 2 vạch đứng hai đầu
    this.rulerBar = document.createElement("div");
    Object.assign(this.rulerBar.style, {
        borderBottom: "2px solid #333",
        borderLeft: "2px solid #333",
        borderRight: "2px solid #333",
        height: "6px",
        transition: "width 0.1s ease",
        width: "100px" 
    });

    // Tạo text hiển thị kích thước
    this.label = document.createElement("div");
    this.label.style.marginBottom = "4px";
    this.label.innerText = "0";

    this.domElement.appendChild(this.label);
    this.domElement.appendChild(this.rulerBar);
    
    // Thêm vào container cha được chỉ định
    this.parentContainer.appendChild(this.domElement);

    // Tìm bước nhảy số chẵn gần nhất
    const getNiceNumber = (x) => {
        const exp = Math.floor(Math.log10(x));
        const f = x / Math.pow(10, exp);
        let nf;
        if (f < 1.5) nf = 1;
        else if (f < 3) nf = 2;
        else if (f < 7) nf = 5;
        else nf = 10;
        return nf * Math.pow(10, exp);
    };

    // Cập nhật trạng thái thước dựa trên zoom hiện tại
    this.update = () => {
        if (!this.camera || !this.parentContainer) return;

        // Lấy width của container chính (Scene) thay vì container cha nhỏ
        const mainContainer = this.parentContainer.parentElement;
        if (!mainContainer) return;
        const width = mainContainer.clientWidth;
        if (width === 0) return;

        const totalWorldWidth = (this.camera.right - this.camera.left) / this.camera.zoom;
        const unitsPerPixel = totalWorldWidth / width;

        const targetPixelWidth = 120;
        const targetWorldUnits = targetPixelWidth * unitsPerPixel;
        const niceWorldUnits = getNiceNumber(targetWorldUnits);
        const actualPixelWidth = niceWorldUnits / unitsPerPixel;

        this.rulerBar.style.width = `${actualPixelWidth}px`;
        
        const labelText = niceWorldUnits >= 1 
            ? `${Number(niceWorldUnits.toFixed(2))}` 
            : `${Number(niceWorldUnits.toFixed(5))}`;
            
        this.label.innerText = labelText;
    };

    // Giải phóng bộ nhớ
    this.dispose = () => {
        if (this.domElement && this.parentContainer.contains(this.domElement)) {
            this.parentContainer.removeChild(this.domElement);
        }
    };
}