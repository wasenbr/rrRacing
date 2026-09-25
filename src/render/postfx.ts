import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** teto da luminância (acima do limiar) que alimenta o bloom */
const BLOOM_CAP = 1.0;

/**
 * Pós-processamento (bloom nas luzes, chamas e nitro). Usado só no PC.
 * O limiar alto (HDR) faz só o que é emissivo de verdade brilhar, não o asfalto ao sol.
 */
export class PostFx {
  private composer: EffectComposer;
  private renderPass: RenderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    // alvo com MSAA (WebGL2): sem ele o bloom desenhava sem antisserrilhado e as bordas ficavam em escada
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 4 : 0 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, new THREE.PerspectiveCamera());
    this.composer.addPass(this.renderPass);
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.72, 0.4, 3.2);
    // Só o excesso acima do limiar entra no bloom, e limitado (HDR): chama de nitro colada na
    // câmera, sol de Nho ou várias partículas aditivas somadas não estouram mais a tela em branco.
    (bloom.highPassUniforms as { smoothWidth: { value: number } }).smoothWidth.value = 0.6;
    bloom.materialHighPassFilter.fragmentShader = /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float luminosityThreshold;
      uniform float smoothWidth;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        float v = max(luminance(texel.rgb), 1e-4);
        float knee = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
        // excesso acima do limiar, com teto: cor preservada, energia limitada
        float excess = min(max(v - luminosityThreshold, 0.0), ${BLOOM_CAP.toFixed(2)});
        vec3 c = min(texel.rgb * (excess / v), vec3(${BLOOM_CAP.toFixed(2)}));
        gl_FragColor = vec4(c * knee, 1.0);
      }`;
    bloom.materialHighPassFilter.needsUpdate = true;
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
  }

  /** tamanho alocado dos alvos (CSS) e densidade */
  private allocW = 0;
  private allocH = 0;
  private allocPr = 0;

  /**
   * Cada realocação do alvo MSAA/HalfFloat (e das mips do bloom) é um engasgo. Os degraus da resolução
   * dinâmica (±5–10%) não realocam: os alvos ficam no maior tamanho pedido e a saída reduz para a
   * tela. Só realoca quando a janela muda, quando a densidade sobe ou quando cai mais de 20% (aí o
   * ganho de GPU compensa o engasgo). Devolve true se realocou.
   */
  setSize(w: number, h: number, pixelRatio: number): boolean {
    if (w === this.allocW && h === this.allocH && pixelRatio <= this.allocPr && pixelRatio >= this.allocPr * 0.8) return false;
    this.allocW = w;
    this.allocH = h;
    this.allocPr = pixelRatio;
    // setPixelRatio já chama setSize com o tamanho antigo: tamanho primeiro, uma alocação só
    (this.composer as unknown as { _pixelRatio: number })._pixelRatio = pixelRatio;
    this.composer.setSize(w, h);
    return true;
  }

  /** Libera os alvos e passes (queda automática desliga o bloom: o jogo passa a desenhar direto na tela). */
  dispose(): void {
    this.composer.dispose();
    for (const p of this.composer.passes) p.dispose();
  }

  render(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
    this.composer.render();
  }
}
