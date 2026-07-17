// ---------------------------------------------------------------------------
// Three.js scene: renderer, lights, floor, and the character loader.
// Swapping characters = disposing the old glb and loading another config
// from characters.js — the Retargeter is rebuilt by main.js.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class Stage {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x11151c);
    this.scene.fog = new THREE.Fog(0x11151c, 6, 14);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    this.camera.position.set(0, 1.3, 3.4);
    this.camera.lookAt(0, 0.9, 0);

    // Simple three-point-ish lighting that reads well on dark video.
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(2, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -3;
    key.shadow.camera.right = key.shadow.camera.top = 3;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x2dd4bf, 1.1);
    rim.position.set(-3, 2, -2);
    this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    // Floor: subtle grid + shadow catcher.
    const grid = new THREE.GridHelper(20, 40, 0x2dd4bf, 0x1d2430);
    grid.material.opacity = 0.28;
    grid.material.transparent = true;
    this.scene.add(grid);
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ opacity: 0.4 })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    this.scene.add(shadowPlane);

    this.character = null;
    this.loader = new GLTFLoader();

    this.#resize();
    new ResizeObserver(() => this.#resize()).observe(container);
  }

  #resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Load a rigged character. Returns the root Object3D, already normalized:
   * uniformly scaled to config.targetHeight and stood on the floor at origin.
   */
  async loadCharacter(config) {
    const gltf = await this.loader.loadAsync(config.url);
    const root = gltf.scene;

    root.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = true;
        n.frustumCulled = false; // skinned meshes move; don't let culling clip them
      }
    });

    // Normalize size/placement so any rig drops in at a sensible scale.
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const scale = config.targetHeight / (size.y || 1);
    root.scale.setScalar(scale);
    box.setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;
    root.updateWorldMatrix(true, true);

    this.removeCharacter();
    this.character = root;
    this.scene.add(root);
    return root;
  }

  removeCharacter() {
    if (!this.character) return;
    this.scene.remove(this.character);
    this.character.traverse((n) => {
      if (n.isMesh) {
        n.geometry?.dispose();
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        for (const m of mats) m?.dispose();
      }
    });
    this.character = null;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
