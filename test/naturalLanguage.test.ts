import {describe,it,expect,vi} from 'vitest';
import {describeWorldChange} from '../src/naturalLanguage';
import {createWorldTools} from '../src/tools';
import {MemoryWorldStore,WorldEditService} from '../src/worldEdits';
import {emptyRecipe} from '../src/buildRecipe';
import {SpecialistRequests} from '../src/specialistRequests';
const p={id:'owner'};
const recipe=()=>emptyRecipe('structure.pavilion',{id:'pavilion',parts:[{id:'floor',kind:'box'}]});
const setup=()=>new WorldEditService(new MemoryWorldStore(),a=>a.id===p.id);
describe('natural language to validated world',()=>{
 it('composes a provider result, previews, confirms and exports',async()=>{const service=setup();const provider={plan:vi.fn(async()=>({execution_authorized:false as const,edits:[{type:'put' as const,recipe:recipe()}]}))};const tools=createWorldTools(service,p,provider);const preview:any=await tools.call('world.describe',{text:'Build a pavilion'});expect(service.inspect(p).entities).toHaveLength(0);await tools.call('world.commit',{previewId:preview.previewId,expectedRevision:0,idempotencyKey:'create-pavilion'});expect((await tools.call('world.export') as any).entities[0].id).toBe('pavilion');expect(provider.plan).toHaveBeenCalledOnce();});
 it('fails honestly when no model is connected',async()=>{await expect(createWorldTools(setup(),p).call('world.describe',{text:'house'})).rejects.toThrow('not connected');});
 it('rejects authority claims and unsupported generated geometry',async()=>{const service=setup();await expect(describeWorldChange(service,p,'house',{plan:async()=>({execution_authorized:true,edits:[]}) as any})).rejects.toThrow('invalid provider');const r=recipe();r.parts[0].kind='unknown';await expect(describeWorldChange(service,p,'house',{plan:async()=>({execution_authorized:false,edits:[{type:'put',recipe:r}]})})).rejects.toThrow('unsupported part');expect(service.inspect(p).revision).toBe(0);});
 it('times out without applying an edit',async()=>{const service=setup();await expect(describeWorldChange(service,p,'house',{plan:()=>new Promise(()=>{})},5)).rejects.toThrow('timeout');expect(service.inspect(p).revision).toBe(0);});
 it('rejects stale model results',async()=>{const service=setup();await expect(describeWorldChange(service,p,'house',{plan:async()=>{const preview=service.preview(p,0,[{type:'put',recipe:recipe()}]);service.commit(p,preview.previewId,0,'intervening-edit');return {execution_authorized:false,edits:[{type:'put',recipe:recipe()}]};}})).rejects.toThrow('revision conflict');});
 it('does not accept principal injection through tool arguments',async()=>{await expect(createWorldTools(setup(),p).call('world.inspect',{principal:{id:'admin'}})).rejects.toThrow('unsupported argument');});
 it('retains existing specialist correlation and ignores unrelated replies',async()=>{let packet:any;const requests=new SpecialistRequests((type,data)=>{packet={type,data};return true;});const pending=requests.request('specialist_conversation',{text:'build a room'});expect(requests.receive('specialist_reply',{request_id:'other'})).toBe(false);requests.receive('specialist_reply',{request_id:packet.data.request_id,execution_authorized:false});expect((await pending).execution_authorized).toBe(false);});
 it('retains existing disconnect cancellation',async()=>{const requests=new SpecialistRequests(()=>true);const pending=requests.request('specialist_conversation',{text:'house'});requests.cancel('world changed');await expect(pending).rejects.toThrow('world changed');});
});
