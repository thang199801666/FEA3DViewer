import * as THREE from "three";

export default class OrientationTriad {

    constructor(renderer) {

        this.renderer = renderer;

        //-----------------------------------------
        // Overlay Scene
        //-----------------------------------------

        this.scene = new THREE.Scene();
        this.scene.background = null;

        //-----------------------------------------
        // Camera
        //-----------------------------------------

        this.camera = new THREE.OrthographicCamera(
            -1.4,
            1.4,
            1.4,
            -1.4,
            0.1,
            10
        );

        this.camera.position.set(0, 0, 3);
        this.camera.lookAt(0, 0, 0);

        //-----------------------------------------
        // Root
        //-----------------------------------------

        this.root = new THREE.Group();
        this.scene.add(this.root);

        //-----------------------------------------
        // Lights
        //-----------------------------------------

        const ambient = new THREE.AmbientLight(0xffffff, 1.4);
        this.scene.add(ambient);

        const dir = new THREE.DirectionalLight(0xffffff, 1.8);
        dir.position.set(4, 4, 5);
        this.scene.add(dir);

        //-----------------------------------------
        // Axes
        //-----------------------------------------

        this.root.add(
            this.createAxis(
                new THREE.Vector3(1, 0, 0),
                0xff4040,
                "X"
            )
        );

        this.root.add(
            this.createAxis(
                new THREE.Vector3(0, 1, 0),
                0x40ff40,
                "Y"
            )
        );

        this.root.add(
            this.createAxis(
                new THREE.Vector3(0, 0, 1),
                0x4090ff,
                "Z"
            )
        );
    }

    //-----------------------------------------
    // Create Label
    //-----------------------------------------

    createLabel(text, color) {

        const canvas = document.createElement("canvas");

        canvas.width = 128;
        canvas.height = 128;

        const ctx = canvas.getContext("2d");

        ctx.clearRect(0, 0, 128, 128);

        ctx.font = "Bold 84px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");

        ctx.fillText(text, 64, 64);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });

        const sprite = new THREE.Sprite(material);

        sprite.scale.set(0.32, 0.32, 1);
        sprite.renderOrder = 999;

        return sprite;
    }

    //-----------------------------------------
    // Create Axis
    //-----------------------------------------

    createAxis(direction, color, labelText) {

        const group = new THREE.Group();

        //---------------------------------
        // Material
        //---------------------------------

        const material = new THREE.MeshPhongMaterial({
            color: color,
            shininess: 80
        });

        //---------------------------------
        // Cylinder
        //---------------------------------

        const body = new THREE.Mesh(
            new THREE.CylinderGeometry(
                0.035,
                0.035,
                0.75,
                24
            ),
            material
        );

        body.position.y = 0.375;

        //---------------------------------
        // Cone
        //---------------------------------

        const head = new THREE.Mesh(
            new THREE.ConeGeometry(
                0.09,
                0.22,
                24
            ),
            material
        );

        head.position.y = 0.86;

        //---------------------------------
        // Label
        //---------------------------------

        const label = this.createLabel(
            labelText,
            color
        );

        label.position.set(
            0,
            1.18,
            0
        );

        //---------------------------------

        group.add(body);
        group.add(head);
        group.add(label);

        //---------------------------------
        // Rotate Y -> Axis
        //---------------------------------

        const q = new THREE.Quaternion();

        q.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            direction
        );

        group.quaternion.copy(q);

        return group;
    }

    //-----------------------------------------
    // Sync Orientation
    //-----------------------------------------

    update(mainCamera) {

        this.root.quaternion
            .copy(mainCamera.quaternion)
            .invert();

    }

    //-----------------------------------------
    // Render Overlay
    //-----------------------------------------

    render() {

        const renderer = this.renderer;

        //-------------------------------------
        // Widget Size
        //-------------------------------------

        const widgetSize = 120;
        const margin = 16;

        const canvas = renderer.domElement;

        // Canvas drawing buffer size (không phải CSS size)
        const fullWidth = canvas.width;
        const fullHeight = canvas.height;

        // Bottom-left
        const viewportX = margin;
        const viewportY = margin;

        //-------------------------------------
        // Save Renderer State
        //-------------------------------------

        const previousAutoClear = renderer.autoClear;

        const previousViewport = new THREE.Vector4();
        renderer.getViewport(previousViewport);

        const previousScissor = new THREE.Vector4();
        renderer.getScissor(previousScissor);

        const previousScissorTest = renderer.getScissorTest();

        //-------------------------------------
        // Render Overlay
        //-------------------------------------

        renderer.autoClear = false;

        // Widget luôn nằm trên cùng
        renderer.clearDepth();

        renderer.setScissorTest(true);

        renderer.setViewport(
            viewportX,
            viewportY,
            widgetSize,
            widgetSize
        );

        renderer.setScissor(
            viewportX,
            viewportY,
            widgetSize,
            widgetSize
        );

        renderer.render(this.scene, this.camera);

        //-------------------------------------
        // Restore Renderer State
        //-------------------------------------

        renderer.setViewport(
            0,
            0,
            fullWidth,
            fullHeight
        );

        renderer.setScissor(
            0,
            0,
            fullWidth,
            fullHeight
        );

        renderer.setScissorTest(false);

        renderer.autoClear = previousAutoClear;
    }

}
