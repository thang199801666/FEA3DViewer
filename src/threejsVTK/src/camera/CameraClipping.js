import * as THREE from 'three';

export class CameraClipping {
  constructor(camera, { margin = 1.5, minRange = 1e-3 } = {}) {
    this.camera = camera;
    this.margin = margin;     
    this.minRange = minRange; 
  }

  update(boundingSphere) {
    const three = this.camera.three;
    const state = this.camera.state;
    if (!state.isValid()) return;

    let near, far;

    if (boundingSphere && boundingSphere.radius > 0) {
      const viewDir = new THREE.Vector3()
        .subVectors(state.target, state.eye)
        .normalize();
      const toCenter = new THREE.Vector3()
        .subVectors(boundingSphere.center, state.eye);
      const distAlong = toCenter.dot(viewDir);

      const r = boundingSphere.radius * this.margin;
      near = distAlong - r;
      far = distAlong + r;
    } else {
      const d = Math.max(state.distance, 1);
      near = -d * 10;
      far = d * 10;
    }

    if (!Number.isFinite(near) || !Number.isFinite(far)) return;
    
    // Đối với Perspective Camera, near plane bắt buộc phải lớn hơn 0
    if (this.camera.type === 'perspective') {
        if (near < this.minRange) near = this.minRange;
        if (far <= near) far = near + 10;
    }

    this.camera.setClippingRange(near, far);
  }
}















// import * as THREE from 'three';

// export class CameraClipping {
//   /** * @param {import('./Camera.js').Camera} camera 
//    */
//   constructor(camera, { margin = 1.5, minRange = 1e-3 } = {}) {
//     this.camera = camera;
//     this.margin = margin;     
//     this.minRange = minRange; 
//   }

//   /**
//    * Automatically updates near and far planes based on the scene bounding sphere.
//    * Negative near limits are valid for orthographic setups to avoid geometry clipping.
//    * @param {THREE.Sphere|null} boundingSphere
//    */
//   update(boundingSphere) {
//     const three = this.camera.three;
//     const state = this.camera.state;
//     if (!state.isValid()) return;

//     let near, far;

//     if (boundingSphere && boundingSphere.radius > 0) {
//       const viewDir = new THREE.Vector3()
//         .subVectors(state.target, state.eye)
//         .normalize();
//       const toCenter = new THREE.Vector3()
//         .subVectors(boundingSphere.center, state.eye);
//       const distAlong = toCenter.dot(viewDir);

//       const r = boundingSphere.radius * this.margin;
//       near = distAlong - r;
//       far = distAlong + r;
//     } else {
//       const d = Math.max(state.distance, 1);
//       near = -d * 10;
//       far = d * 10;
//     }

//     if (!Number.isFinite(near) || !Number.isFinite(far)) return;
//     if (far - near < this.minRange) far = near + this.minRange;

//     if (three.near !== near || three.far !== far) {
//       three.near = near;
//       three.far = far;
//       three.updateProjectionMatrix();
//     }
//   }
// }

// export default CameraClipping;