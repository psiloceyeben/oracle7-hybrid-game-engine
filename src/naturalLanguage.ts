import {WorldEditService,type Principal,type Edit} from './worldEdits.js';
export type WorldContext = ReturnType<WorldEditService['inspect']>;
export interface LanguageProvider {
  /** Return declarative edits, never code. Secrets/host endpoints stay in the host implementation. */
  plan(text:string, context:WorldContext, signal:AbortSignal):Promise<{execution_authorized:false;edits:Edit[];explanation?:string}>;
}
/** AI creates a proposal, not permission to commit it. Host supplies authenticated principal. */
export async function describeWorldChange(service:WorldEditService,principal:Principal,text:string,provider:LanguageProvider,timeoutMs=30000){
  if(typeof text!=='string'||!text.trim()||text.length>4000)throw Error('invalid description');
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw Error('invalid timeout');
  const context=service.inspect(principal),controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  try {
    const result=await Promise.race([provider.plan(text.trim(),structuredClone(context),controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('provider timeout: no edit applied'));},timeoutMs);})]);
    if(!result||result.execution_authorized!==false||!Array.isArray(result.edits))throw Error('invalid provider proposal');
    if(result.explanation!==undefined&&(typeof result.explanation!=='string'||result.explanation.length>4000))throw Error('invalid explanation');
    // This revision check also rejects results arriving after another player edited the world.
    return {...service.preview(principal,context.revision,result.edits),explanation:result.explanation??''};
  } finally {clearTimeout(timer!);controller.abort();}
}
