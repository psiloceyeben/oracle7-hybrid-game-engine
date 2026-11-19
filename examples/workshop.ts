import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EngineClock, emptyRecipe, projectRecipe, MemoryWorldStore, WorldEditService, type BuildRecipe } from '../src/index';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#adcbd8');
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .1, 300);
camera.position.set(13, 12, 18);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled = true;
document.body.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0,2,0); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xd9f0ff,0x697644,2));
const sun = new THREE.DirectionalLight(0xffe2b5,3); sun.position.set(8,16,10); sun.castShadow=true; scene.add(sun);
const ground = new THREE.Mesh(new THREE.BoxGeometry(60,.25,60),new THREE.MeshStandardMaterial({color:0x7d9c75,roughness:1}));
ground.position.y=-.125;ground.receiveShadow=true;scene.add(ground);
const objects = new THREE.Group(); scene.add(objects);
let recipes:BuildRecipe[]=[];
const principal={id:'local-developer'};
const service=new WorldEditService(new MemoryWorldStore(),p=>p.id===principal.id);
let preview:ReturnType<WorldEditService['preview']>|null=null,lastReceipt:string|null=null;
const status=document.querySelector('#status')!;
const confirm=document.createElement('button');confirm.textContent='Confirm edit';
const undo=document.createElement('button');undo.textContent='Undo';
status.before(confirm,undo);
function renderSaved(){objects.clear();recipes=service.inspect(principal).entities;for(const r of recipes)objects.add(projectRecipe(r).object3d);}
confirm.addEventListener('click',()=>{try{if(!preview)return;const r=service.commit(principal,preview.previewId,preview.revision,crypto.randomUUID());lastReceipt=r.receiptId;preview=null;renderSaved();status.textContent=`Committed revision ${r.revision}.`; }catch(e){status.textContent=String(e);}});
undo.addEventListener('click',()=>{try{if(!lastReceipt)return;service.undo(principal,lastReceipt,service.inspect(principal).revision,crypto.randomUUID());lastReceipt=null;preview=null;renderSaved();status.textContent='Latest edit undone.';}catch(e){status.textContent=String(e);}});
function add(){
  if(recipes.length>=9){status.textContent='Example limit: 9 pavilions. Clear to start again.';return;}
  const recipe=emptyRecipe('structure.pavilion',{id:`pavilion-${recipes.length+1}`,materialSlots:{stone:{base:'stone'},roof:{base:'wood'}},parts:[
    {id:'floor',kind:'box',params:{width:6,height:.3,depth:6},position:[0,.15,0],material_slot:'stone',colliders:[{shape:'aabb',tag:'walkable',size:[6,.3,6]}]},
    ...[-2.5,2.5].flatMap(x=>[-2.5,2.5].map(z=>({id:`column-${x<0?'w':'e'}-${z<0?'n':'s'}`,kind:'shaft_cylinder',params:{radius:.25,height:3},position:[x,1.8,z] as [number,number,number],material_slot:'stone'}))),
    {id:'roof',kind:'box',params:{width:6.5,height:.4,depth:6.5},position:[0,3.5,0],material_slot:'roof'}
  ]});
  const i=recipes.length,offsetX=i===0?0:((i-1)%3-1)*8,offsetZ=i===0?0:(Math.floor((i-1)/3)+1)*8;
  for(const p of recipe.parts){p.position![0]+=offsetX;p.position![2]+=offsetZ;}
  preview=service.preview(principal,service.inspect(principal).revision,[{type:'put',recipe}]);
  objects.clear();for(const r of preview.entities)objects.add(projectRecipe(r).object3d);
  status.textContent=`Preview: ${preview.entities.length} object(s). Confirm to save; no world edit yet.`;
}
document.querySelector('#add')!.addEventListener('click',add);
document.querySelector('#clear')!.addEventListener('click',()=>{const state=service.inspect(principal);if(!state.entities.length){preview=null;renderSaved();status.textContent='Preview cancelled.';return;}preview=service.preview(principal,state.revision,state.entities.map(r=>({type:'remove' as const,entityId:r.id})));objects.clear();status.textContent='Clear preview: confirm to remove saved objects.';});
document.querySelector('#export')!.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(service.inspect(principal),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='oracle7-world.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
add();
const clock=new EngineClock({schedulerMode:'fixed-time-tiers'});
renderer.setAnimationLoop(now=>{clock.advance(now);controls.update();renderer.render(scene,camera);});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
