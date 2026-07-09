import * as THREE from 'three';
import { Camera } from '../camera/Camera.js';

export class Renderer {
  constructor({
    background = 0x101014, 
    viewport = [0, 0, 1, 1],
    scene = null, 
    camera = null, 
    addDefaultLights,
  } = {}) {
    const usingSharedScene = !!scene;
    this.scene = scene ?? new THREE.Scene();
    
    if (!usingSharedScene && background !== null) {
      this.scene.background = new THREE.Color(background);
    }

    this.activeCamera = camera ?? new Camera();
    this.viewport = viewport;
    this.renderWindow = null;

    this.actors = [];
    this._props = [];
    this._objectToActor = new Map();

    const doLights = addDefaultLights ?? !usingSharedScene;
    if (doLights) {
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
      const key = new THREE.DirectionalLight(0xffffff, 0.9);
      key.position.set(1, 1, 1);
      this.scene.add(key);
    }
  }

  get camera() { 
    return this.activeCamera.getThreeCamera(); 
  }
  
  setActiveCamera(cam) { 
    this.activeCamera = cam; 
    return cam; 
  }
  
  setRenderWindow(rw) { 
    this.renderWindow = rw; 
  }

  addActor(actor) {
    const obj = this._asObject3D(actor);
    this.actors.push(actor);
    this._props.push(obj);
    this._objectToActor.set(obj, actor);
    this.scene.add(obj);
    return actor;
  }

  removeActor(actor) {
    const obj = this._asObject3D(actor);
    this.actors = this.actors.filter(a => a !== actor);
    this._props = this._props.filter(o => o !== obj);
    this._objectToActor.delete(obj);
    this.scene.remove(obj);
  }

  getProps() { 
    return this._props; 
  }

  getActorForObject(object3D) {
    let o = object3D;
    while (o) { 
      if (this._objectToActor.has(o)) return this._objectToActor.get(o); 
      o = o.parent; 
    }
    return null;
  }

  _asObject3D(actor) {
    if (actor.isObject3D) return actor;
    if (typeof actor.getObject3D === 'function') return actor.getObject3D();
    if (typeof actor.getProp === 'function') return actor.getProp();
    if (actor.object3D) return actor.object3D;
    if (actor.mesh) return actor.mesh;
    throw new Error('Renderer: Cannot resolve a THREE.Object3D from actor. Adjust _asObject3D().');
  }

  updateCameraAspect(aspect) { 
    this.activeCamera.setAspect(aspect); 
  }

  resetCamera() {
    const box = new THREE.Box3();
    (this._props.length ? this._props : this.scene.children).forEach(o => box.expandByObject(o));
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.activeCamera.reset(sphere.center, sphere.radius * 1.2);
  }
}