import * as THREE from 'three';
/** Canvas CSS colors are sRGB; Three Color components are linear-light.
 * Encode once before an SRGBColorSpace CanvasTexture decodes on the GPU. */
export function materialCanvasColor(color: THREE.Color, alpha=1): string {
 const srgb=color.clone().convertLinearToSRGB();
 const channel=(n:number)=>Math.round(Math.max(0,Math.min(1,n))*255);
 const rgb=[srgb.r,srgb.g,srgb.b].map(channel).join(',');
 return alpha===1?`rgb(${rgb})`:`rgba(${rgb},${Math.max(0,Math.min(1,alpha))})`;
}
