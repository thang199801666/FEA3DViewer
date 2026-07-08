import { useEffect, useRef } from "react";
import * as THREE from "three";

// --- threejsVTK core (NEW directory structure) ---
import { RenderWindow }              from "../threejsVTK/Rendering/RenderWindow";
import { Renderer }                  from "../threejsVTK/Rendering/Renderer";
import { RenderWindowInteractor }    from "../threejsVTK/Interaction/RenderWindowInteractor";
import { Picker }                    from "../threejsVTK/Interaction/Picker"; 
import { OrientationTriadActor }     from "../threejsVTK/Actors/OrientationTriadActor";
import { CameraNavigationActor }     from "../threejsVTK/Actors/CameraNavigationActor";
import { ScalarBarActor }            from "../threejsVTK/Actors/ScalarBarActor";
import { MeasurementRulerActor }     from "../threejsVTK/Actors/MeasurementRulerActor";

// --- Cameras ---
import { VTKCamera }                 from "../threejsVTK/Rendering/VTKCamera";
import { Camera as CadCamera }       from "../threejsVTK/Rendering/Camera";
import { InteractorStyleOrbit }      from "../threejsVTK/Interaction/InteractorStyleOrbit";
import { NAV_STYLE }                 from "../threejsVTK/Interaction/InputStyleHandler";

// --- app controllers ---
import SceneController                from "../controllers/SceneController";
import { PickingController }          from "../controllers/PickingController";
import TextBlockController            from "../controllers/TextBlockController";

export default function Scene({
    viewportIndex = 1,
    sharedScene,
    onControllerReady,
    otherController = null,   
    isViewLinked = true,      
    showTextBlock = false,
    showAxes = true,
    showRuler = true,
    showGrid = false,
    isGradientBackground = true,
    topColor = "#ffffff",
    bottomColor = "#000000",
    navStyle = NAV_STYLE.BLENDER,
    antialias = true,
    addDefaultLights = false,
    ambientIntensity = 0.5,
    directionalIntensity = 1.0,
}) {
    const containerRef = useRef();
    const textBlockRef = useRef(null);
    const showAxesRef = useRef(showAxes);
    const showGridRef = useRef(showGrid);

    const rulerActorRef = useRef(null);
    const sceneControllerRef = useRef(null);

    const otherControllerRef = useRef(otherController);
    const isViewLinkedRef = useRef(isViewLinked);
    useEffect(() => { otherControllerRef.current = otherController; }, [otherController]);
    useEffect(() => { isViewLinkedRef.current = isViewLinked; }, [isViewLinked]);

    useEffect(() => { showAxesRef.current = showAxes; }, [showAxes]);
    useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);

    useEffect(() => {
        if (textBlockRef.current) {
            textBlockRef.current.style.display = showTextBlock ? "block" : "none";
        }
    }, [showTextBlock]);

    useEffect(() => {
        if (rulerActorRef.current?.group) {
            rulerActorRef.current.group.visible = showRuler;
        }
    }, [showRuler]);

    useEffect(() => {
        if (sceneControllerRef.current?.interactorStyle) {
            sceneControllerRef.current.interactorStyle.setNavStyle(navStyle);
        }
    }, [navStyle]);

    // --- Tunable scene lighting ---
    // Lights live in the shared scene, so only the primary viewport (index 1)
    // owns them; otherwise the split view would add a duplicate set of lights.
    // The lights are looked up by name so intensity changes update in place.
    useEffect(() => {
        if (viewportIndex !== 1 || !sharedScene) return;

        const AMBIENT_NAME = "settings_ambient_light";
        const DIRECTIONAL_NAME = "settings_directional_light";

        let ambient = sharedScene.getObjectByName(AMBIENT_NAME);
        if (!ambient) {
            ambient = new THREE.AmbientLight(0xffffff, ambientIntensity);
            ambient.name = AMBIENT_NAME;
            sharedScene.add(ambient);
        } else {
            ambient.intensity = ambientIntensity;
        }

        let directional = sharedScene.getObjectByName(DIRECTIONAL_NAME);
        if (!directional) {
            directional = new THREE.DirectionalLight(0xffffff, directionalIntensity);
            directional.name = DIRECTIONAL_NAME;
            directional.position.set(1, 1, 1);
            sharedScene.add(directional);
        } else {
            directional.intensity = directionalIntensity;
        }

        sceneControllerRef.current?.requestRender?.();
    }, [viewportIndex, sharedScene, ambientIntensity, directionalIntensity]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !sharedScene) return;

        const triadConfig = { position: "bottom-left", size: 120 };
        const padding = 20;

        // ------------------------------------------------------------------
        // 1) RenderWindow - owns WebGLRenderer + canvas
        // ------------------------------------------------------------------
        const renderWindow = new RenderWindow({
            container,
            // NOTE: antialiasing is locked in when the WebGL context is created,
            // so changing it later requires reloading the scene.
            rendererParams: { antialias, alpha: true },
        });
        const renderer = renderWindow.renderer; 
        renderer.setClearColor(0x000000, 0);
        renderer.localClippingEnabled = true; 

        // Keep the WebGL canvas transparent so the container's CSS background
        // (driven live by isGradientBackground / topColor / bottomColor) shows
        // through. Assigning an opaque scene.background here would cover it and
        // is exactly why background changes previously had no visible effect.
        sharedScene.background = null;

        // ------------------------------------------------------------------
        // 2) Camera (Orthographic)
        // ------------------------------------------------------------------
        const aspect = container.clientWidth / container.clientHeight || 1;
        const frustumSize = 10;
        const camera = new THREE.OrthographicCamera(
            (-frustumSize * aspect) / 2,
            (frustumSize * aspect) / 2,
            frustumSize / 2,
            -frustumSize / 2,
            0.01,
            10000
        );
        camera.position.set(10, 10, 10);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);
        camera.layers.enable(0);
        camera.layers.enable(viewportIndex);

        const vtkCamera = new VTKCamera({ threeCamera: camera });

        // ------------------------------------------------------------------
        // 3) VTK Renderer
        // ------------------------------------------------------------------
        const vtkRenderer = new Renderer({
            scene: sharedScene,
            camera: vtkCamera,
            // Renderer built-in lights are decided at construction time (applied on reload).
            addDefaultLights,
        });
        vtkRenderer.viewport = [0, 0, 1, 1];
        renderWindow.addRenderer(vtkRenderer);

        // ------------------------------------------------------------------
        // 4) SceneController
        // ------------------------------------------------------------------
        const sceneController = new SceneController(camera, null, sharedScene);
        sceneControllerRef.current = sceneController;

        // Enable camera navigation by default and bind toggle function
        sceneController.showCameraNav = true;
        sceneController.ToggleCameraNav = () => {
            sceneController.showCameraNav = !sceneController.showCameraNav;
        };

        sceneController.attachRendering({
            renderWindow,
            renderer: vtkRenderer,
            vtkCamera,
            domElement: renderWindow.domElement,
        });

        const pushCameraToLinked = () => {
            if (sceneController._applyingLinked) return;   
            if (!isViewLinkedRef.current) return;          
            const other = otherControllerRef.current;
            if (other && typeof other.applyLinkedCamera === "function") {
                other.applyLinkedCamera(camera);
            }
        };

        // --- DOUBLE ADAPTIVE CAD GRID SYSTEM ---
        const majorGrid = new THREE.GridHelper(2000, 200, 0x444444, 0x888888);
        majorGrid.name = "system_grid";
        majorGrid.frustumCulled = false;
        majorGrid.layers.set(viewportIndex);
        majorGrid.material.transparent = true;
        majorGrid.material.opacity = 0.5;
        majorGrid.material.depthWrite = true;
        majorGrid.material.polygonOffset = true;
        majorGrid.material.polygonOffsetFactor = 1;
        majorGrid.material.polygonOffsetUnits = 1;
        sceneController.scene.add(majorGrid);

        const minorGrid = new THREE.GridHelper(2000, 2000, 0x999999, 0xcccccc);
        minorGrid.name = "system_grid";
        minorGrid.frustumCulled = false;
        minorGrid.layers.set(viewportIndex);
        minorGrid.material.transparent = true;
        minorGrid.material.opacity = 0.25;
        minorGrid.material.depthWrite = true;
        minorGrid.material.polygonOffset = true;
        minorGrid.material.polygonOffsetFactor = 1.1;
        minorGrid.material.polygonOffsetUnits = 1.1;
        sceneController.scene.add(minorGrid);

        // ------------------------------------------------------------------
        // 5) Overlay DOM: TextBlock
        // ------------------------------------------------------------------
        const textBlockContainer = document.createElement("div");
        textBlockRef.current = textBlockContainer;
        const leftPosition = triadConfig.position === "bottom-left" ? `${triadConfig.size + padding}px` : `${padding}px`;
        const rightPosition = triadConfig.position === "bottom-right" ? `${triadConfig.size + padding}px` : `${padding}px`;
        Object.assign(textBlockContainer.style, {
            position: "absolute", bottom: "70px", left: leftPosition, right: rightPosition,
            pointerEvents: "none", zIndex: 10, display: showTextBlock ? "block" : "none",
        });
        container.appendChild(textBlockContainer);

        const textBlockController = new TextBlockController(textBlockContainer, {
            position: "relative",
            triadPosition: triadConfig.position,
            triadSize: triadConfig.size,
        });
        sceneController.textBlock = textBlockController;

        // ------------------------------------------------------------------
        // INITIALIZE MEASUREMENT RULER ACTOR
        // ------------------------------------------------------------------
        const measurementRulerActor = new MeasurementRulerActor(sharedScene, camera, {
            color: 0xffffff,
            targetPixelWidth: 120,
            tickHeight: 0.08,
            fontSize: 40
        });
        measurementRulerActor.group.visible = showRuler;
        rulerActorRef.current = measurementRulerActor;

        const applyRulerLayer = () => {
            measurementRulerActor?.group?.traverse((o) => o.layers.set(viewportIndex));
        };
        applyRulerLayer();

        // ------------------------------------------------------------------
        // 6) Overlay actors: Triad + Navigation Gizmo
        // ------------------------------------------------------------------
        const triad = new OrientationTriadActor(renderer, {
            position: triadConfig.position,
            size: triadConfig.size,
        });

        const gizmo = new CameraNavigationActor(renderer, container, vtkCamera, {
            position: "top-right",
            size: 150,
            animateSpeed: 0.15,
            dragRotateSpeed: 1,
            spriteScale: 0.4,
            onChange: () => {
                sceneController.cadCamera?.syncFromThree();
                sceneController.updateClipping();
                renderWindow.render();
                pushCameraToLinked();   
            },
            onTranslate: (delta) => {
                const hasActorAncestor = (o) => {
                    let p = o.parent;
                    while (p) { if (p.isActor) return true; p = p.parent; }
                    return false;
                };
                sharedScene.traverse((o) => {
                    if (o.isActor && o.name !== "system_grid" && !hasActorAncestor(o)) {
                        o.position.add(delta);
                        o.updateMatrixWorld?.(true);
                    }
                });
                sceneController.updateClipping?.();
                renderWindow.render();
                pushCameraToLinked();
            },
        });

        // ------------------------------------------------------------------
        // 7) Interactor + Camera Facade + InteractorStyleOrbit + Picker
        // ------------------------------------------------------------------
        const interactor = new RenderWindowInteractor();
        renderWindow.setInteractor(interactor);

        const cadCamera = new CadCamera(camera, renderWindow.domElement, {
            autoResize: false,
            autoClipping: false,
            onChange: () => {
                vtkCamera.setFromThree?.(); 
                sceneController.updateClipping?.();
                sceneController.requestRender?.();
                pushCameraToLinked();   
            },
        });
        sceneController.cadCamera = cadCamera;

        sceneController.applyLinkedCamera = (srcCam) => {
            if (!srcCam) return;
            sceneController._applyingLinked = true;      
            camera.position.copy(srcCam.position);
            camera.quaternion.copy(srcCam.quaternion);
            camera.up.copy(srcCam.up);
            camera.zoom = srcCam.zoom;
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld(true);
            vtkCamera.setFromThree?.();
            cadCamera.syncFromThree?.();                 
            sceneController.updateClipping?.();
            sceneController.requestRender?.();
            sceneController._applyingLinked = false;
        };

        const RUBBER_BAND_STYLES = {
            crossing: { border: "1.5px solid #4da3ff", background: "rgba(77, 163, 255, 0.15)" },
            window: { border: "1.5px dashed #35c159", background: "rgba(53, 193, 89, 0.15)" },
        };

        const rubberBandEl = document.createElement("div");
        Object.assign(rubberBandEl.style, { position: "fixed", display: "none", pointerEvents: "none", zIndex: 20 });
        document.body.appendChild(rubberBandEl);

        const collectSelectableActors = () => {
            const actors = [];
            sharedScene.traverse((o) => {
                if (o.isActor && o.visible && o.name !== "system_grid") actors.push(o);
            });
            return actors;
        };

        const style = new InteractorStyleOrbit(cadCamera, {
            enableDamping: false,
            navStyle: navStyle,
            enableZoomWindow: false,
            enableRubberBand: true,
            getSelectableObjects: collectSelectableActors,
            rubberBandFilter: (o) => o.visible && o.name !== "system_grid",
            onRubberBandUpdate: (r, mode) => {
                const c = RUBBER_BAND_STYLES[mode] ?? RUBBER_BAND_STYLES.crossing;
                Object.assign(rubberBandEl.style, {
                    display: "block", left: `${r.x}px`, top: `${r.y}px`,
                    width: `${r.width}px`, height: `${r.height}px`,
                    border: c.border, background: c.background,
                });
            },
            onRubberBandEnd: () => { rubberBandEl.style.display = "none"; },
            onRubberBandSelect: (selected, { mode, additive }) => {
                const pc = sceneController.pickingController;
                if (!pc) return;

                if (typeof pc.selectObjects === "function") {
                    pc.selectObjects(selected, { additive, mode });
                } else if (typeof pc.setSelection === "function") {
                    pc.setSelection(selected, additive);
                } else if (typeof pc.selectActors === "function") {
                    pc.selectActors(selected, additive);
                } else if (typeof pc.select === "function") {
                    if (!additive && typeof pc.clearSelection === "function") pc.clearSelection();
                    selected.forEach((o) => pc.select(o));
                }
                sceneController.requestRender?.();
            },
        });
        interactor.setInteractorStyle(style);
        sceneController.interactorStyle = style;

        const picker = new Picker({ filter: (o) => o.visible && o.name !== "system_grid" });
        interactor.setPicker(picker);
        interactor.initialize();

        const pickingController = new PickingController(sceneController);
        sceneController.pickingController = pickingController;

        const scalarBar = new ScalarBarActor({
            anchor: "BottomRight", range: [0, 1], numberOfColors: 12, precision: 3,
            textColor: "#f0f0f0", showOutline: true, outlineColor: "#ffffff",
        }).attachTo(container);
        scalarBar.setVisible(false);

        sceneController.scalarBar = scalarBar;
        sceneController.updateClipping();

        sceneController.PlotContour = (visibleState) => {
            if (!sceneController.scene) return;
            let lastActor = null;
            sceneController.scene.children.forEach((child) => {
                if (child.isActor && typeof child.setScalarVisibility === "function") {
                    child.setScalarVisibility(visibleState);
                    lastActor = child;
                }
            });

            if (sceneController.scalarBar) {
                if (visibleState && lastActor) {
                    let range = [0, 1];
                    const lut = lastActor.mapper?.lookupTable ?? lastActor.mapper?.getLookupTable?.() ?? null;
                    if (lut && Array.isArray(lut.range) && lut.range[0] !== lut.range[1]) {
                        range = lut.range.slice();
                    } else {
                        const polyData = lastActor.mapper?.input ?? lastActor.mapper?.getInputData?.() ?? lastActor.inputData ?? null;
                        const pointData = polyData?.pointData ?? polyData?.getPointData?.();
                        if (pointData) {
                            const scalars = pointData.getScalars?.();
                            if (scalars && typeof scalars.getRange === "function") range = scalars.getRange();
                        }
                    }
                    sceneController.scalarBar.show({ title: lastActor.name || "Contour", range: range, numberOfColors: 12, anchor: "TopLeft" });
                } else if (typeof sceneController.scalarBar.setVisible === "function") {
                    sceneController.scalarBar.setVisible(false);
                }
            }
            if (typeof sceneController.requestRender === "function") sceneController.requestRender(); else renderWindow.render();
        };

        sceneController.AddToRenderer = (actor, options = {}) => {
            if (!actor) return;
            const { showContour = false } = options;
            sceneController.scene.add(actor);
            sceneController.updateClipping();
            sceneController.fitView();
            sceneController.PlotContour(showContour);
        };


        function updateRulerPosition() {
            if (!camera || !measurementRulerActor) return;
            camera.updateMatrixWorld(true);
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
            const targetPoint = new THREE.Vector3().copy(camera.position).addScaledVector(forward, 10);
            const orthoHeightAtZoom = camera.bottom / camera.zoom;
            
            // Adjusted factor from 0.85 to 0.92 to move the ruler further towards the bottom edge
            const finalPosition = new THREE.Vector3().copy(targetPoint).addScaledVector(up, orthoHeightAtZoom * 0.95);

            measurementRulerActor.position.copy(finalPosition);
            measurementRulerActor.group.position.copy(finalPosition);
            measurementRulerActor.group.quaternion.copy(camera.quaternion);
            measurementRulerActor.group.updateMatrixWorld(true);
        }

        function resize() {
            if (!container) return;
            const w = container.clientWidth, h = container.clientHeight;
            if (w === 0 || h === 0) return;
            renderer.setSize(w, h, false);
            const a = w / h;
            const halfH = (camera.top - camera.bottom) / 2;
            camera.left = -halfH * a; camera.right = halfH * a;
            camera.updateProjectionMatrix();

            if (measurementRulerActor) {
                updateRulerPosition();
                measurementRulerActor.update(w);
                applyRulerLayer();   
            }
        }

        sceneController.onResize = resize;
        if (onControllerReady) onControllerReady(sceneController);
        const resizeObserver = new ResizeObserver(() => resize());
        resizeObserver.observe(container);

        // ------------------------------------------------------------------
        // 10) Render Animation Loop
        // ------------------------------------------------------------------
        let rafId;
        function animate() {
            rafId = requestAnimationFrame(animate);

            if (showGridRef.current) {
                majorGrid.visible = true; minorGrid.visible = true;
                const zoom = camera.zoom || 1;
                const exponent = Math.floor(Math.log10(1 / zoom));
                const majorScale = Math.pow(10, exponent);
                majorGrid.scale.set(majorScale, 1, majorScale);
                minorGrid.scale.set(majorScale, 1, majorScale);
                const fractional = (1 / zoom) / majorScale;
                minorGrid.material.opacity = Math.max(0, Math.min(0.3, (1 - fractional) * 1.5));
                sceneController.updateClipping();
            } else {
                majorGrid.visible = false; minorGrid.visible = false;
            }

            if (measurementRulerActor && measurementRulerActor.group.visible) {
                updateRulerPosition();
                measurementRulerActor.update(container.clientWidth);
                applyRulerLayer();   
            }

            renderWindow.render();

            camera.updateMatrixWorld(true);
            
            // --- FIX: USE INTERNAL FLAG DIRECTLY ON SCENECONTROLLER TO SYNC VISIBILITY ---
            
            // 1. Only update and render Orientation Triad (Origin Axes) when showAxes is enabled
            if (showAxesRef.current) {
                triad.update(camera);
                triad.render();
            }

            // 2. Only update and render CameraNavigationActor when the controller's showCameraNav state is true
            if (sceneController.showCameraNav) {
                gizmo.update(camera);
                gizmo.render();
            }

            // 3. Fallback to clear depth buffer normally when both are disabled
            if (!showAxesRef.current && !sceneController.showCameraNav) {
                renderer.clearDepth();
            }
        }
        animate();

        return () => {
            cancelAnimationFrame(rafId);
            resizeObserver.disconnect();

            style.dispose();
            cadCamera.dispose();
            interactor.dispose();
            if (rubberBandEl.parentNode) rubberBandEl.parentNode.removeChild(rubberBandEl);
            pickingController.dispose();
            textBlockController.dispose();

            if (measurementRulerActor) {
                measurementRulerActor.dispose();
            }

            scalarBar.dispose();
            gizmo.dispose();
            triad.dispose();

            if (sceneController.scene) {
                sceneController.scene.remove(majorGrid);
                sceneController.scene.remove(minorGrid);
                majorGrid.geometry.dispose();
                majorGrid.material.dispose();
                minorGrid.geometry.dispose();
                minorGrid.material.dispose();
            }

            if (container.contains(textBlockContainer)) container.removeChild(textBlockContainer);
        };
    }, [onControllerReady, sharedScene, viewportIndex]); 

    const backgroundStyle = isGradientBackground
        ? `linear-gradient(to top, ${bottomColor}, ${topColor})`
        : bottomColor;

    return (
        <div
            ref={containerRef}
            className="scene-container"
            style={{ width: "100%", height: "100%", position: "relative", background: backgroundStyle }}
        />
    );
}