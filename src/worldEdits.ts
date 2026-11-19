import type { BuildRecipe } from './buildRecipe.js';
import { Matrix4, Vector3, Quaternion, Euler } from 'three';

export type Principal = { id: string };
export type Edit = { type: 'put'; recipe: unknown } | { type: 'remove'; entityId: string };
export type Receipt = { id: string; actorId: string; key: string; requestId: string; revision: number; before: BuildRecipe[]; entityIds: string[]; undoOf?: string };
export type WorldSnapshot = { schema: 'oracle7.world.v1'; worldId: string; revision: number; entities: BuildRecipe[]; receipts: Receipt[] };
export interface WorldStore {
  read(): WorldSnapshot;
  /** Atomically persist next only if current revision equals expected. Must throw on I/O failure. */
  compareAndSwap(expected: number, next: WorldSnapshot): boolean;
}
export type EditLimits = { maxEntities: number; maxPartsPerRecipe: number; maxTotalParts: number; maxDepth: number; maxBytes: number; extent: number; previewTtlMs: number; maxPreviews: number; history: number };
export const DEFAULT_EDIT_LIMITS: Readonly<EditLimits> = Object.freeze({maxEntities:128,maxPartsPerRecipe:256,maxTotalParts:4096,maxDepth:8,maxBytes:262144,extent:1024,previewTtlMs:300000,maxPreviews:128,history:128});
const clone = <T>(x:T):T => structuredClone(x);
function fail(message:string):never {throw new Error(message);}
function record(value:unknown):Record<string,any> {if(!value || typeof value!=='object' || Array.isArray(value) || Object.getPrototypeOf(value)!==Object.prototype) fail('expected plain object');return value as Record<string,any>;}
function keys(o:Record<string,any>, allowed:string[]) {for(const k of Object.keys(o)) if(!allowed.includes(k)) fail(`unsupported field: ${k}`);}
function id(x:unknown):string {if(typeof x!=='string'|| !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(x)) fail('invalid identifier');return x as string;}
function number(x:unknown,min:number,max:number):number {if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max) fail('number outside allowed range');return x as number;}
function vector(x:unknown,limit:number,positive=false) {if(!Array.isArray(x)||x.length!==3)fail('expected three-vector');for(const n of x as unknown[])number(n,positive?.001:-limit,limit);}
function empty(x:unknown) {if(x!==undefined&&(!Array.isArray(x)||x.length))fail('unsupported capability: sockets, behaviors, handles, modifiers or LOD');}
const shapes = ['box','shaft_cylinder','sphere','cone','plane'];
const materials = ['marble','concrete','wood','brick','stone','bark','cloth','leather','fur','skin','grass','crystal','plaster','rune_glow','glass','steel','gold','copper','water','_default'];

/** Strict developer-preview subset. Rejects unsupported fields instead of silently falling back. */
export function validateRecipe(input:unknown, limits:EditLimits={...DEFAULT_EDIT_LIMITS}):BuildRecipe {
  // Bound traversal before serialization: cycles/functions/accessors/non-finite numbers are not JSON.
  let nodes=0, chars=0;const seen=new Set<object>();
  function json(v:unknown,depth=0):void {
    if(++nodes>50000||depth>40)fail('JSON complexity budget exceeded');
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='string'){chars+=v.length;if(chars>limits.maxBytes)fail('text budget exceeded');return;}
    if(typeof v==='number'){if(!Number.isFinite(v))fail('non-finite JSON');return;}
    if(typeof v!=='object')fail('non-JSON value');
    if(seen.has(v as object))fail('cyclic JSON');seen.add(v as object);
    if(!Array.isArray(v))record(v);
    for(const [k,d] of Object.entries(Object.getOwnPropertyDescriptors(v))){if(Array.isArray(v)&&k==='length')continue;if(!('value' in d))fail('accessors not allowed');json(d.value,depth+1);}
    seen.delete(v as object);
  }
  json(input);
  if(new TextEncoder().encode(JSON.stringify(input)).length>limits.maxBytes)fail('recipe byte budget exceeded');
  const r=record(input);keys(r,['id','kind','tags','style','scale','materialSlots','parts','sockets','colliders','handles','behavior','saveLoad']);
  id(r.id);id(r.kind);if(r.style!=='WANDER_TOON_PHYSICAL')fail('unsupported aesthetic');
  number(r.scale,.01,10);
  if(!Array.isArray(r.tags)||r.tags.length>32)fail('invalid tags');r.tags.forEach(id);
  const slots=record(r.materialSlots);if(Object.keys(slots).length>32)fail('material budget exceeded');
  for(const [name,value] of Object.entries(slots)){id(name);const m=record(value);keys(m,['base','tint','ao']);if(!materials.includes(m.base))fail('unsupported material');if(m.tint!==undefined){number(m.tint,0,0xffffff);if(!Number.isInteger(m.tint))fail('invalid tint');}if(m.ao!==undefined)number(m.ao,0,1);}
  const ids=new Set<string>();let count=0;
  function colliders(value:unknown) {if(!Array.isArray(value)||value.length>8)fail('collider budget exceeded');for(const raw of value as unknown[]){const c=record(raw);keys(c,['shape','tag','size','offset','surface_y']);const n=({aabb:3,cylinder:2,sphere:1,capsule:2,cone:2} as Record<string,number>)[c.shape];if(!n||!['solid','walkable','pass_through','climbable','interior','portal','trigger'].includes(c.tag))fail('unsupported collider');if(!Array.isArray(c.size)||c.size.length!==n)fail('invalid collider dimensions');c.size.forEach((v:unknown)=>number(v,.001,limits.extent));if(c.offset!==undefined)vector(c.offset,limits.extent);if(c.surface_y!==undefined)number(c.surface_y,-limits.extent,limits.extent);}}
  function parts(list:unknown,depth:number) {if(!Array.isArray(list)||depth>limits.maxDepth)fail('part depth budget exceeded');for(const raw of list as unknown[]){if(++count>limits.maxPartsPerRecipe)fail('part budget exceeded');const p=record(raw);keys(p,['id','kind','params','position','rotation','scale','material_slot','colliders','children']);const pid=id(p.id);if(ids.has(pid))fail('duplicate part id');ids.add(pid);if(!shapes.includes(p.kind))fail(`unsupported part kind: ${p.kind}`);if(p.position!==undefined)vector(p.position,limits.extent);if(p.rotation!==undefined)vector(p.rotation,Math.PI*2);if(p.scale!==undefined){if(Array.isArray(p.scale))vector(p.scale,10,true);else number(p.scale,.01,10);}if(p.material_slot!==undefined&&!Object.hasOwn(slots,p.material_slot))fail('unknown material slot');if(p.params!==undefined){const pms=record(p.params);const allowed=p.kind==='box'?['width','height','depth']:p.kind==='plane'?['width','height']:p.kind==='shaft_cylinder'?['radius','height','segments','taper']:p.kind==='cone'?['radius','height']:['radius'];keys(pms,allowed);for(const [k,v] of Object.entries(pms)){if(k==='segments'){number(v,3,64);if(!Number.isInteger(v))fail('invalid segments');}else number(v,k==='taper'?0:.001,k==='taper'?.95:limits.extent);}}if(p.colliders!==undefined)colliders(p.colliders);if(p.children!==undefined)parts(p.children,depth+1);}}
  parts(r.parts,1);if(!count)fail('recipe must contain geometry');colliders(r.colliders);
  function bounds(list:BuildRecipe['parts'],parent:Matrix4){for(const p of list){const scale=typeof p.scale==='number'?[p.scale,p.scale,p.scale]:p.scale??[1,1,1];const matrix=parent.clone().multiply(new Matrix4().compose(new Vector3(...(p.position??[0,0,0])),new Quaternion().setFromEuler(new Euler(...(p.rotation??[0,0,0]))),new Vector3(...scale)));const values=Object.values(p.params??{}).filter((v):v is number=>typeof v==='number');const radius=Math.max(1,...values)*2*matrix.getMaxScaleOnAxis();const center=new Vector3().setFromMatrixPosition(matrix);if(!Number.isFinite(radius)||Math.max(Math.abs(center.x),Math.abs(center.y),Math.abs(center.z))+radius>limits.extent)fail('composed world bounds exceeded');if(p.children)bounds(p.children,matrix);}}
  bounds(r.parts,new Matrix4().makeScale(r.scale,r.scale,r.scale));
  empty(r.sockets);empty(r.handles);empty(r.behavior);
  const save=record(r.saveLoad);keys(save,['persist_version','description']);if(save.persist_version!==1)fail('unsupported persistence version');if(save.description!==undefined&&(typeof save.description!=='string'||save.description.length>2000))fail('invalid description');
  return clone(r) as BuildRecipe;
}

export class MemoryWorldStore implements WorldStore {
  private state:WorldSnapshot;
  constructor(worldId='local-world', initial?:WorldSnapshot){this.state=clone(initial??{schema:'oracle7.world.v1',worldId:id(worldId),revision:0,entities:[],receipts:[]});}
  read(){return clone(this.state);}
  compareAndSwap(expected:number,next:WorldSnapshot){if(this.state.revision!==expected)return false;this.state=clone(next);return true;}
}

type Preview = {id:string;actorId:string;revision:number;expiresAt:number;entities:BuildRecipe[];entityIds:string[]};
export class WorldEditService {
  private previews=new Map<string,Preview>();
  readonly limits:EditLimits;
  constructor(private store:WorldStore,private authorize:(principal:Principal,action:'read'|'write',worldId:string)=>boolean,limits:Partial<EditLimits>={},private now=()=>Date.now()){
    this.limits={...DEFAULT_EDIT_LIMITS,...limits};
    for(const v of Object.values(this.limits))if(!Number.isFinite(v)||v<=0)fail('invalid host limits');
  }
  private access(p:Principal,action:'read'|'write'){id(p.id);const s=this.store.read();if(!this.authorize(p,action,s.worldId))fail('permission denied');return s;}
  inspect(p:Principal){const s=this.access(p,'read');return {schema:s.schema,worldId:s.worldId,revision:s.revision,entities:clone(s.entities)};}
  preview(p:Principal,expectedRevision:number,edits:Edit[]){
    const s=this.access(p,'write');if(s.revision!==expectedRevision)fail('revision conflict');if(!Array.isArray(edits)||!edits.length||edits.length>32)fail('edit budget exceeded');
    const entities=new Map(s.entities.map(r=>[r.id,clone(r)]));const changed=new Set<string>();
    for(const raw of edits){const e=record(raw);keys(e,e.type==='put'?['type','recipe']:['type','entityId']);if(e.type==='put'){const r=validateRecipe(e.recipe,this.limits);if(changed.has(r.id))fail('duplicate target');changed.add(r.id);entities.set(r.id,r);}else if(e.type==='remove'){const entityId=id(e.entityId);if(changed.has(entityId))fail('duplicate target');changed.add(entityId);if(!entities.delete(entityId))fail('unknown entity');}else fail('unsupported action');}
    this.checkBudget([...entities.values()]);
    for(const [key,v] of this.previews)if(v.expiresAt<=this.now())this.previews.delete(key);
    if(this.previews.size>=this.limits.maxPreviews)fail('preview budget exceeded');
    const preview:Preview={id:crypto.randomUUID(),actorId:p.id,revision:s.revision,expiresAt:this.now()+this.limits.previewTtlMs,entities:[...entities.values()],entityIds:[...changed]};this.previews.set(preview.id,clone(preview));
    return {previewId:preview.id,revision:s.revision,expiresAt:preview.expiresAt,entities:clone(preview.entities),entityIds:[...changed],warnings:['Collider declarations require host physics registration; behavior execution is not provided by this edit service.']};
  }
  private checkBudget(entities:BuildRecipe[]){if(entities.length>this.limits.maxEntities)fail('entity budget exceeded');let parts=0;function count(list:BuildRecipe['parts']){for(const p of list){parts++;if(p.children)count(p.children);}}entities.forEach(r=>count(r.parts));if(parts>this.limits.maxTotalParts)fail('world part budget exceeded');}
  commit(p:Principal,previewId:string,expectedRevision:number,key:string){
    id(key);const s=this.access(p,'write');const old=s.receipts.find(r=>r.actorId===p.id&&r.key===key);if(old){if(old.requestId!==previewId||old.undoOf)fail('idempotency key conflict');return this.publicReceipt(old);}
    const v=this.previews.get(previewId);if(!v||v.actorId!==p.id)fail('unknown preview');if(v.expiresAt<=this.now())fail('preview expired');if(expectedRevision!==s.revision||v.revision!==s.revision)fail('revision conflict');
    const entities=v.entities.map(r=>validateRecipe(r,this.limits));this.checkBudget(entities);
    const receipt:Receipt={id:crypto.randomUUID(),actorId:p.id,key,requestId:previewId,revision:s.revision+1,before:s.entities,entityIds:v.entityIds};
    this.save(s,entities,receipt);this.previews.delete(previewId);return this.publicReceipt(receipt);
  }
  undo(p:Principal,receiptId:string,expectedRevision:number,key:string){
    id(key);const s=this.access(p,'write');const old=s.receipts.find(r=>r.actorId===p.id&&r.key===key);if(old){if(old.undoOf!==receiptId)fail('idempotency key conflict');return this.publicReceipt(old);}
    const original=s.receipts.find(r=>r.id===receiptId&&r.actorId===p.id);if(!original)fail('unknown receipt');if(s.revision!==expectedRevision||original.revision!==s.revision)fail('undo conflict: newer edits exist');
    const entities=original.before.map(r=>validateRecipe(r,this.limits));this.checkBudget(entities);
    const receipt:Receipt={id:crypto.randomUUID(),actorId:p.id,key,requestId:receiptId,undoOf:receiptId,revision:s.revision+1,before:s.entities,entityIds:original.entityIds};this.save(s,entities,receipt);return this.publicReceipt(receipt);
  }
  private save(s:WorldSnapshot,entities:BuildRecipe[],receipt:Receipt){const next={...s,entities:clone(entities),revision:s.revision+1,receipts:[...s.receipts,clone(receipt)].slice(-this.limits.history)};if(!this.store.compareAndSwap(s.revision,next))fail('revision conflict');}
  private publicReceipt(r:Receipt){return {receiptId:r.id,revision:r.revision,entityIds:[...r.entityIds],undoOf:r.undoOf};}
}
