/** Material words emitted by the authored furniture catalogue. Keep these
 * identical in the legacy registry and op-tree renderer; no geometry changes. */
export const CATALOGUE_MATERIAL_PALETTE = {
 oak:      {color:0xb88a54,roughness:.78,metalness:0,toon:true,procedural:'wood'},
 walnut:   {color:0x674632,roughness:.76,metalness:0,toon:true,procedural:'wood'},
 pine:     {color:0xd4b77c,roughness:.82,metalness:0,toon:true,procedural:'wood'},
 mahogany: {color:0x874a3a,roughness:.72,metalness:0,toon:true,procedural:'wood'},
 ebony:    {color:0x302c2b,roughness:.68,metalness:0,toon:true,procedural:'wood'},
 birch:    {color:0xdac8a1,roughness:.80,metalness:0,toon:true,procedural:'wood'},
 fabric:   {color:0x91a9a0,roughness:.96,metalness:0,toon:true,procedural:'fabric'},
 velvet:   {color:0x756078,roughness:.99,metalness:0,toon:true,procedural:'fabric'},
 granite:  {color:0x68757b,roughness:.55,metalness:0,toon:true,procedural:'stone'},
 slate:    {color:0x465662,roughness:.83,metalness:0,toon:true,procedural:'stone'},
 brass:    {color:0xc6a15c,roughness:.39,metalness:.82,toon:false,procedural:'metal_brushed'},
} as const;
