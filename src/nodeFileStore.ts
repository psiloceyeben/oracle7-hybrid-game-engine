import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MemoryWorldStore, validateRecipe, type WorldSnapshot, type WorldStore } from './worldEdits.js';

/** Local developer host storage. Atomic rename + exclusive lock; never break a stale lock automatically. */
export class NodeFileWorldStore implements WorldStore {
  constructor(private path:string, worldId='local-world') {
    mkdirSync(dirname(path),{recursive:true});
    if(!existsSync(path)){try{writeFileSync(path,JSON.stringify(new MemoryWorldStore(worldId).read()),{flag:'wx',mode:0o600});}catch(e:any){if(e.code!=='EEXIST')throw e;}}
    this.read();
  }
  read():WorldSnapshot {
    const raw=readFileSync(this.path);if(raw.length>64*1024*1024)throw Error('snapshot budget exceeded');
    const s=JSON.parse(raw.toString('utf8')) as WorldSnapshot;
    if(s.schema!=='oracle7.world.v1'||typeof s.worldId!=='string'||!Number.isSafeInteger(s.revision)||s.revision<0||!Array.isArray(s.entities)||!Array.isArray(s.receipts)||s.entities.length>128||s.receipts.length>128)throw Error('invalid saved world');
    s.entities.forEach(r=>validateRecipe(r));
    if(new Set(s.entities.map(r=>r.id)).size!==s.entities.length)throw Error('duplicate saved entity');
    for(const r of s.receipts){if(typeof r.id!=='string'||typeof r.actorId!=='string'||typeof r.key!=='string'||typeof r.requestId!=='string'||!Number.isSafeInteger(r.revision)||r.revision>s.revision||!Array.isArray(r.before)||r.before.length>128||!Array.isArray(r.entityIds))throw Error('invalid saved receipt');r.before.forEach(v=>validateRecipe(v));}
    return s;
  }
  compareAndSwap(expected:number,next:WorldSnapshot):boolean {
    const lock=this.path+'.lock';const fd=openSync(lock,'wx',0o600);const temp=this.path+'.'+crypto.randomUUID()+'.tmp';
    try {const current=this.read();if(current.revision!==expected)return false;if(next.worldId!==current.worldId||next.revision!==expected+1)throw Error('invalid snapshot transition');const data=JSON.stringify(next);if(Buffer.byteLength(data)>64*1024*1024)throw Error('snapshot budget exceeded');writeFileSync(temp,data,{flag:'wx',mode:0o600});renameSync(temp,this.path);return true;}
    finally {if(existsSync(temp))unlinkSync(temp);closeSync(fd);unlinkSync(lock);}
  }
}
