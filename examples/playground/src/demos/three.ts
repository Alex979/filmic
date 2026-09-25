import * as THREE from "three";
import { elementSource } from "filmic";
import type { DemoInstance } from "./types";

/**
 * A Three.js scene rendering to its own (off-page) WebGL canvas. It needs
 * `preserveDrawingBuffer: true` so the canvas still holds the last frame when
 * filmic reads it.
 */
export function threeDemo(): DemoInstance {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(1280, 720, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#14110f");
  const camera = new THREE.PerspectiveCamera(35, 1280 / 720, 0.1, 100);
  camera.position.set(0, 0, 9);

  const geometry = new THREE.TorusKnotGeometry(1.6, 0.5, 256, 48);
  const material = new THREE.MeshStandardMaterial({
    color: "#d9632f",
    roughness: 0.35,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const key = new THREE.DirectionalLight("#ffe2c4", 3);
  key.position.set(3, 4, 5);
  const rim = new THREE.DirectionalLight("#5583bd", 2.5);
  rim.position.set(-4, -2, -3);
  scene.add(key, rim, new THREE.AmbientLight("#ffffff", 0.15));

  renderer.setAnimationLoop((t) => {
    mesh.rotation.set(t * 0.0003, t * 0.0005, 0);
    renderer.render(scene, camera);
  });

  return {
    source: (fit) => elementSource(renderer.domElement, { fit, live: true }),
    dispose() {
      renderer.setAnimationLoop(null);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      // Free the WebGL context now; browsers cap how many can exist at once.
      renderer.forceContextLoss();
    },
  };
}
