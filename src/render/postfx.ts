import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * Pós-processamento (bloom nas luzes, chamas e nitro). Usado só no PC.
 * O limiar alto (HDR) faz só o que é emissivo de verdade brilhar, não o asfalto ao sol.
 */
export class PostFx {
  private composer: EffectComposer;
  private renderPass: RenderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, new THREE.PerspectiveCamera());
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 2.4));
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
    this.composer.render();
  }
}
