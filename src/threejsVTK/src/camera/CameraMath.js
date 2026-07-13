import * as THREE from 'three';

export const CameraMath = {
  orbit(state, deltaQuat) {
    state.quaternion.premultiply(deltaQuat).normalize();
    this.applyQuaternionToEye(state);
  },

  orbitLocal(state, angleYaw, anglePitch) {
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angleYaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -anglePitch);
    state.quaternion.multiply(qYaw).multiply(qPitch).normalize();
    this.applyQuaternionToEye(state);
  },

  applyQuaternionToEye(state) {
    const offset = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(state.quaternion)
      .multiplyScalar(state.distance);
    state.eye.copy(state.target).add(offset);
    state.up.set(0, 1, 0).applyQuaternion(state.quaternion);
  },

  pan(state, deltaScreenPx, viewportHeightPx, camera) {
    if (viewportHeightPx <= 0) return;
    
    let factor = 1;
    if (camera.isOrthographicCamera) {
      factor = (camera.top - camera.bottom) / (viewportHeightPx * camera.zoom);
    } else if (camera.isPerspectiveCamera) {
      const vFovRad = THREE.MathUtils.degToRad(camera.fov);
      factor = (2 * Math.tan(vFovRad / 2) * state.distance) / viewportHeightPx;
    }

    const dx = -deltaScreenPx.x * factor;
    const dy = deltaScreenPx.y * factor;

    const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(state.quaternion);
    const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(state.quaternion);

    const move = new THREE.Vector3()
      .addScaledVector(localX, dx)
      .addScaledVector(localY, dy);

    state.eye.add(move);
    state.target.add(move);
  },

  /**
   * Đồng bộ thu phóng (Dolly) đa cấu hình Camera (Ortho & Perspective)
   * Hỗ trợ Zoom tập trung vào vị trí con trỏ chuột (cursorNDC)
   */
  dolly(state, factor, camera, cursorNDC = null) {
    if (!Number.isFinite(factor) || factor <= 0) return;

    if (camera.isOrthographicCamera) {
      let newZoom = camera.zoom * factor;
      newZoom = THREE.MathUtils.clamp(newZoom, 1e-4, 1e6);
      if (!Number.isFinite(newZoom) || newZoom <= 0) return;

      if (cursorNDC) {
        // Phóng to/thu nhỏ tập trung theo tọa độ chuột trong Orthographic mode
        const worldBefore = this.ndcToWorld(cursorNDC, camera, state);
        camera.zoom = newZoom;
        camera.updateProjectionMatrix();
        const worldAfter = this.ndcToWorld(cursorNDC, camera, state);
        
        const shift = new THREE.Vector3().subVectors(worldBefore, worldAfter);
        state.eye.add(shift);
        state.target.add(shift);
      } else {
        camera.zoom = newZoom;
        camera.updateProjectionMatrix();
      }
    } else if (camera.isPerspectiveCamera) {
      if (cursorNDC) {
        // Đối với Perspective Camera: Tính ma trận di chuyển vị trí chuột (Zoom to mouse)
        const mousePoint = new THREE.Vector3(cursorNDC.x, cursorNDC.y, 0.5).unproject(camera);
        const rayDir = new THREE.Vector3().subVectors(mousePoint, state.eye).normalize();
        
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(state.quaternion);
        const currentDist = new THREE.Vector3().subVectors(state.eye, state.target).dot(forward);
        const newDist = THREE.MathUtils.clamp(currentDist / factor, 1e-3, 1e6);
        
        const targetMoveFactor = currentDist - newDist;
        state.eye.addScaledVector(rayDir, targetMoveFactor);
        state.target.addScaledVector(rayDir, targetMoveFactor);
        state.distance = newDist;
      } else {
        // Thu phóng vào chính tâm màn hình (Center dolly)
        state.distance = THREE.MathUtils.clamp(state.distance * (1 / factor), 1e-3, 1e6);
        this.applyQuaternionToEye(state);
      }
    }
  },

  worldToNDC(worldPos, camera, state) {
    const viewMat = new THREE.Matrix4().lookAt(state.eye, state.target, state.up);
    const projMat = camera.projectionMatrix;
    const vpMat = new THREE.Matrix4().multiplyMatrices(projMat, viewMat);
    const vec = worldPos.clone().applyMatrix4(vpMat);
    return new THREE.Vector2(vec.x, vec.y);
  },

  ndcToWorld(ndc, camera, state) {
    if (camera.isOrthographicCamera) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(state.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(state.quaternion);
      const halfW = (camera.right - camera.left) / (2 * camera.zoom);
      const halfH = (camera.top - camera.bottom) / (2 * camera.zoom);

      return new THREE.Vector3()
        .copy(state.target)
        .addScaledVector(right, ndc.x * halfW)
        .addScaledVector(up, ndc.y * halfH);
    } else {
      const viewMat = new THREE.Matrix4().lookAt(state.eye, state.target, state.up);
      const projMat = camera.projectionMatrix;
      const vpMat = new THREE.Matrix4().multiplyMatrices(projMat, viewMat);
      const invVP = new THREE.Matrix4().copy(vpMat).invert();
      const vec = new THREE.Vector3(ndc.x, ndc.y, 0).applyMatrix4(invVP);
      return vec;
    }
  },

  fitBox(state, camera, box, padding = 1.2) {
    if (!box || box.isEmpty()) return null;

    const center = new THREE.Vector3();
    box.getCenter(center);

    const corners = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];

    const invQuat = state.quaternion.clone().invert();
    let maxRight = 1e-6, maxUp = 1e-6, maxForward = 1e-6;

    for (const c of corners) {
      const local = c.clone().sub(center).applyQuaternion(invQuat);
      maxRight = Math.max(maxRight, Math.abs(local.x));
      maxUp = Math.max(maxUp, Math.abs(local.y));
      maxForward = Math.max(maxForward, Math.abs(local.z));
    }

    const resultState = state.clone();
    resultState.target.copy(center);

    let zoom = camera.zoom;
    if (camera.isOrthographicCamera) {
      const halfW = maxRight * padding;
      const halfH = maxUp * padding;
      const camHalfW = (camera.right - camera.left) / 2;
      const camHalfH = (camera.top - camera.bottom) / 2;
      zoom = Math.min(camHalfW / halfW, camHalfH / halfH);
      if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;
      resultState.distance = Math.max(maxForward * 3, 1);
    } else if (camera.isPerspectiveCamera) {
      const vFovRad = THREE.MathUtils.degToRad(camera.fov);
      const distToFitY = maxUp * padding / Math.tan(vFovRad / 2);
      const distToFitX = (maxRight * padding / camera.aspect) / Math.tan(vFovRad / 2);
      resultState.distance = Math.max(distToFitX, distToFitY) + maxForward;
    }

    this.applyQuaternionToEye(resultState);
    return { state: resultState, zoom };
  },

  fitWindow(state, camera, ndcMin, ndcMax) {
    const sizeNDC = new THREE.Vector2(
      Math.abs(ndcMax.x - ndcMin.x),
      Math.abs(ndcMax.y - ndcMin.y)
    );
    if (sizeNDC.x < 1e-4 || sizeNDC.y < 1e-4) return null;

    const centerNDC = new THREE.Vector2(
      (ndcMin.x + ndcMax.x) / 2,
      (ndcMin.y + ndcMax.y) / 2
    );
    const worldCenter = this.ndcToWorld(centerNDC, camera, state);

    const scale = Math.min(2 / sizeNDC.x, 2 / sizeNDC.y);
    let zoom = camera.zoom * scale;
    zoom = THREE.MathUtils.clamp(zoom, 1e-4, 1e6);
    if (!Number.isFinite(zoom) || zoom <= 0) zoom = camera.zoom;

    const shift = new THREE.Vector3().subVectors(worldCenter, state.target);
    const resultState = state.clone();
    resultState.target.add(shift);
    resultState.eye.add(shift);

    return { state: resultState, zoom };
  },

  standardViewQuaternion(name) {
    const dirs = {
      front:  [0, 0, 1],
      back:   [0, 0, -1],
      left:   [-1, 0, 0],
      right:  [1, 0, 0],
      top:    [0, 1, 0],
      bottom: [0, -1, 0],
      iso:    [1, 1, 1],
    };
    const ups = {
      top:    [0, 0, -1],
      bottom: [0, 0, 1],
    };

    const eyeDir = new THREE.Vector3(...(dirs[name.toLowerCase()] || dirs.iso)).normalize();
    const up = new THREE.Vector3(...(ups[name.toLowerCase()] || [0, 1, 0]));

    const m = new THREE.Matrix4().lookAt(eyeDir, new THREE.Vector3(0, 0, 0), up);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }
};

export default CameraMath;



























// import * as THREE from 'three';

// export const CameraMath = {
//   /**
//    * Orbit around the target using a world-space delta quaternion.
//    */
//   orbit(state, deltaQuat) {
//     state.quaternion.premultiply(deltaQuat).normalize();
//     this.applyQuaternionToEye(state);
//   },

//   /**
//    * Orbit around the camera's local axes (Trackball style).
//    */
//   orbitLocal(state, angleYaw, anglePitch) {
//     const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angleYaw);
//     const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -anglePitch);
//     state.quaternion.multiply(qYaw).multiply(qPitch).normalize();
//     this.applyQuaternionToEye(state);
//   },

//   /**
//    * Recalculates eye position and up vector based on quaternion and distance, keeping target fixed.
//    */
//   applyQuaternionToEye(state) {
//     const offset = new THREE.Vector3(0, 0, 1)
//       .applyQuaternion(state.quaternion)
//       .multiplyScalar(state.distance);
//     state.eye.copy(state.target).add(offset);
//     state.up.set(0, 1, 0).applyQuaternion(state.quaternion);
//   },

//   /**
//    * Pans the camera in screen space.
//    */
//   pan(state, deltaScreenPx, viewportHeightPx, camera) {
//     if (viewportHeightPx <= 0) return;
//     const worldPerPixel = (camera.top - camera.bottom) / camera.zoom / viewportHeightPx;
//     if (!Number.isFinite(worldPerPixel)) return;

//     const right = new THREE.Vector3(1, 0, 0).applyQuaternion(state.quaternion);
//     const up = new THREE.Vector3(0, 1, 0).applyQuaternion(state.quaternion);

//     const offset = new THREE.Vector3()
//       .addScaledVector(right, -deltaScreenPx.x * worldPerPixel)
//       .addScaledVector(up, deltaScreenPx.y * worldPerPixel);

//     state.eye.add(offset);
//     state.target.add(offset);
//   },

//   /**
//    * Converts a Normalized Device Coordinate (NDC) point to World Space on the target plane.
//    */
//   ndcToWorld(ndc, camera, state) {
//     const right = new THREE.Vector3(1, 0, 0).applyQuaternion(state.quaternion);
//     const up = new THREE.Vector3(0, 1, 0).applyQuaternion(state.quaternion);
//     const halfW = (camera.right - camera.left) / (2 * camera.zoom);
//     const halfH = (camera.top - camera.bottom) / (2 * camera.zoom);

//     return new THREE.Vector3()
//       .copy(state.target)
//       .addScaledVector(right, ndc.x * halfW)
//       .addScaledVector(up, ndc.y * halfH);
//   },

//   /**
//    * Zooms into a target point or cursor NDC location (Dolly).
//    */
//   dolly(state, factor, camera, cursorNDC) {
//     if (!Number.isFinite(factor) || factor <= 0) return;
//     let newZoom = camera.zoom * factor;
//     newZoom = THREE.MathUtils.clamp(newZoom, 1e-4, 1e6);
//     if (!Number.isFinite(newZoom) || newZoom <= 0) return;

//     if (cursorNDC) {
//       const worldBefore = this.ndcToWorld(cursorNDC, camera, state);
//       camera.zoom = newZoom;
//       camera.updateProjectionMatrix();
//       const worldAfter = this.ndcToWorld(cursorNDC, camera, state);
//       const shift = new THREE.Vector3().subVectors(worldBefore, worldAfter);
//       state.eye.add(shift);
//       state.target.add(shift);
//     } else {
//       camera.zoom = newZoom;
//       camera.updateProjectionMatrix();
//     }
//   },

//   /**
//    * Fits the bounding box into the current camera viewport view.
//    */
//   fitBox(state, camera, box, padding = 1.2) {
//     if (!box || box.isEmpty()) return null;

//     const center = new THREE.Vector3();
//     box.getCenter(center);

//     const corners = [
//       new THREE.Vector3(box.min.x, box.min.y, box.min.z),
//       new THREE.Vector3(box.min.x, box.min.y, box.max.z),
//       new THREE.Vector3(box.min.x, box.max.y, box.min.z),
//       new THREE.Vector3(box.min.x, box.max.y, box.max.z),
//       new THREE.Vector3(box.max.x, box.min.y, box.min.z),
//       new THREE.Vector3(box.max.x, box.min.y, box.max.z),
//       new THREE.Vector3(box.max.x, box.max.y, box.min.z),
//       new THREE.Vector3(box.max.x, box.max.y, box.max.z),
//     ];

//     const invQuat = state.quaternion.clone().invert();
//     let maxRight = 1e-6, maxUp = 1e-6, maxForward = 1e-6;

//     for (const c of corners) {
//       const local = c.clone().sub(center).applyQuaternion(invQuat);
//       maxRight = Math.max(maxRight, Math.abs(local.x));
//       maxUp = Math.max(maxUp, Math.abs(local.y));
//       maxForward = Math.max(maxForward, Math.abs(local.z));
//     }

//     const halfW = maxRight * padding;
//     const halfH = maxUp * padding;
//     const camHalfW = (camera.right - camera.left) / 2;
//     const camHalfH = (camera.top - camera.bottom) / 2;

//     let zoom = Math.min(camHalfW / halfW, camHalfH / halfH);
//     if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;

//     const resultState = state.clone();
//     resultState.target.copy(center);
//     resultState.distance = Math.max(maxForward * 3, 1);
//     this.applyQuaternionToEye(resultState);

//     return { state: resultState, zoom };
//   },

//   /**
//    * Fits a window selection rectangle defined by NDC min/max corners.
//    */
//   fitWindow(state, camera, ndcMin, ndcMax) {
//     const sizeNDC = new THREE.Vector2(
//       Math.abs(ndcMax.x - ndcMin.x),
//       Math.abs(ndcMax.y - ndcMin.y)
//     );
//     if (sizeNDC.x < 1e-4 || sizeNDC.y < 1e-4) return null;

//     const centerNDC = new THREE.Vector2(
//       (ndcMin.x + ndcMax.x) / 2,
//       (ndcMin.y + ndcMax.y) / 2
//     );
//     const worldCenter = this.ndcToWorld(centerNDC, camera, state);

//     const scale = Math.min(2 / sizeNDC.x, 2 / sizeNDC.y);
//     let zoom = camera.zoom * scale;
//     zoom = THREE.MathUtils.clamp(zoom, 1e-4, 1e6);
//     if (!Number.isFinite(zoom) || zoom <= 0) zoom = camera.zoom;

//     const shift = new THREE.Vector3().subVectors(worldCenter, state.target);
//     const resultState = state.clone();
//     resultState.target.add(shift);
//     resultState.eye.add(shift);

//     return { state: resultState, zoom };
//   },

//   /**
//    * Returns predefined orientation quaternions for standard CAD views.
//    */
//   standardViewQuaternion(name) {
//     const dirs = {
//       front:  [0, 0, 1],
//       back:   [0, 0, -1],
//       left:   [-1, 0, 0],
//       right:  [1, 0, 0],
//       top:    [0, 1, 0],
//       bottom: [0, -1, 0],
//       iso:    [1, 1, 1],
//     };
//     const ups = {
//       top:    [0, 0, -1],
//       bottom: [0, 0, 1],
//     };

//     const eyeDir = new THREE.Vector3(...(dirs[name] || dirs.iso)).normalize();
//     const up = new THREE.Vector3(...(ups[name] || [0, 1, 0]));

//     const m = new THREE.Matrix4().lookAt(eyeDir, new THREE.Vector3(0, 0, 0), up);
//     return new THREE.Quaternion().setFromRotationMatrix(m);
//   },
// };

// export default CameraMath;