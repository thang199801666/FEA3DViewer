export default function TextBlockController(container, options = {}) {
    this.container = container;
    this.element = null;
    
    this.position = options.position || "bottom-left"; 
    this.triadPosition = options.triadPosition || "bottom-left"; 
    this.triadSize = options.triadSize || 100; // The bounding width of your triad viewport

    this.init = function() {
        this.element = document.createElement("div");
        
        Object.assign(this.element.style, {
            position: "absolute",
            fontFamily: '"Courier New", Courier, monospace',
            fontSize: "12px",
            fontWeight: "bold",
            color: "#ffffff",
            lineHeight: "1.5",
            pointerEvents: "none",
            textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
            userSelect: "none",
            zIndex: "10"
        });

        this.applyPlacement();

        this.data = {
            modelName: "Model-1",
            stepName: "Step-1, General Static",
            increment: "Increment     1: Step Time =   1.000",
            primaryVar: "Primary Var: S, Mises",
            deformedVar: "Deformed Var: U  Deformation Scale Factor: +1.000e+00",
        };

        this.container.appendChild(this.element);
        this.updateDOM();
    };

    this.applyPlacement = function() {
        const basePadding = 20; 
        // 20px base padding + size of triad + 20px padding between them
        const offsetPadding = basePadding + this.triadSize + 20; 

        this.element.style.bottom = `${basePadding}px`;
        this.element.style.top = "auto";
        this.element.style.left = "auto";
        this.element.style.right = "auto";

        // Handle X-axis shifts
        if (this.position === "bottom-left") {
            if (this.triadPosition === "bottom-left") {
                this.element.style.left = `${offsetPadding}px`;
            } else {
                this.element.style.left = `${basePadding}px`;
            }
        } 
        else if (this.position === "bottom-right") {
            if (this.triadPosition === "bottom-right") {
                this.element.style.right = `${offsetPadding}px`;
            } else {
                this.element.style.right = `${basePadding}px`;
            }
        }
    };

    this.update = function(newData) {
        this.data = { ...this.data, ...newData };
        this.updateDOM();
    };

    this.updateDOM = function() {
        if (!this.element) return;
        this.element.innerHTML = `
            <div>${this.data.modelName}</div>
            <div>${this.data.stepName}</div>
            <div>${this.data.increment}</div>
            <div>${this.data.primaryVar}</div>
            <div>${this.data.deformedVar}</div>
        `;
    };

    this.dispose = function() {
        if (this.element && this.container.contains(this.element)) {
            this.container.removeChild(this.element);
        }
        this.element = null;
    };

    this.init();
}