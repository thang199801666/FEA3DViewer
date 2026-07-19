import { RenderingBackend } from "../../threejsVTK";

export default class RendererController {

    constructor(container) {

        this.container = container;

        this.renderer = RenderingBackend.createWebGLRenderer({

            antialias: true,
            alpha: true
        });

        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.autoClear = true;

        this.resize();

        container.appendChild(this.renderer.domElement);
    }

    resize() {

        this.renderer.setSize(

            this.container.clientWidth,
            this.container.clientHeight

        );

    }

    render(scene, camera) {

        this.renderer.setViewport(
            0,
            0,
            this.container.clientWidth,
            this.container.clientHeight
        );

        this.renderer.setScissorTest(false);

        this.renderer.clear(true, true, true);

        this.renderer.render(scene, camera);

    }

    dispose() {

        this.renderer.dispose();

    }

}
