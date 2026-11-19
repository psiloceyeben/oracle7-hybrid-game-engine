import {WorldEditService,type Principal,type Edit} from './worldEdits.js';
import {describeWorldChange,type LanguageProvider} from './naturalLanguage.js';
export const TOOL_NAMES=['world.inspect','world.describe','world.preview','world.commit','world.undo','world.export'] as const;
/** Transport-independent handlers for Claude's MCP adapter. Principal is HOST-owned, never tool arguments. */
export function createWorldTools(service:WorldEditService,principal:Principal,provider?:LanguageProvider){
  const bound=Object.freeze({...principal});
  return {async call(name:string,input:unknown={}){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype)throw Error('invalid arguments');
    const a=input as Record<string,unknown>;
    const fields:Record<string,string[]>={'world.inspect':[],'world.export':[],'world.describe':['text'],'world.preview':['expectedRevision','edits'],'world.commit':['previewId','expectedRevision','idempotencyKey'],'world.undo':['receiptId','expectedRevision','idempotencyKey']};
    if(!Object.hasOwn(fields,name))throw Error('unknown tool');
    if(Object.keys(a).some(k=>!fields[name].includes(k)))throw Error('unsupported argument');
    const str=(key:string)=>{if(typeof a[key]!=='string')throw Error(`missing ${key}`);return a[key] as string;};
    const revision=()=>{if(!Number.isSafeInteger(a.expectedRevision)||Number(a.expectedRevision)<0)throw Error('invalid revision');return a.expectedRevision as number;};
    switch(name){
      case 'world.inspect':case 'world.export':return service.inspect(bound);
      case 'world.describe':if(!provider)throw Error('language provider not connected');return describeWorldChange(service,bound,str('text'),provider);
      case 'world.preview':return service.preview(bound,revision(),a.edits as Edit[]);
      case 'world.commit':return service.commit(bound,str('previewId'),revision(),str('idempotencyKey'));
      case 'world.undo':return service.undo(bound,str('receiptId'),revision(),str('idempotencyKey'));
    }
  }};
}
