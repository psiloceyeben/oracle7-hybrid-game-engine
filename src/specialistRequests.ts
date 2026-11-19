/** Correlated requests: never queue creation across reconnect/world changes. */
export class SpecialistRequests {
  private pending=new Map<string,{resolve:(data:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;requestType:string}>();
  constructor(private send:(type:string,data:any)=>boolean,private timeoutMs=15000){}
  requestSurface(action:'preview'|'confirm'|'cancel'|'recover',data:Record<string,unknown>):Promise<any>{
    return this.correlated(`specialist_surface_${action}`,data);
  }
  request(type:`dimension_edit_${'preview'|'review'|'commit'}`|`specialist_room_program_${'choices'|'preview'|'confirm'|'cancel'|'recover'|'undo_preview'|'undo_confirm'|'undo_cancel'|'undo_recover'}`|`specialist_room_appearance_${'select'|'preview'|'undo_preview'|'confirm'|'cancel'|'recover'}`|`specialist_room_${'preview'|'undo_preview'|'confirm'|'cancel'|'recover'}`|`specialist_transform_${'room_preview'|'preview'|'undo_preview'|'confirm'|'cancel'|'recover'}`|`specialist_furnishing_${'rooms'|'inspect_rooms'|'inspect'|'preview'|'revise'|'cancel'|'confirm'|'recover'|'undo_preview'|'undo_confirm'|'undo_cancel'|'undo_recover'}`|'specialist_conversation'|'specialist_part_edit_preview'|'specialist_edit_preview'|'specialist_edit_confirm'|'specialist_edit_undo'|'specialist_entity_context'|'specialist_ask'|'specialist_confirm'|'specialist_build_preview'|'specialist_build_confirm'|'specialist_build_finalize',data:Record<string,unknown>):Promise<any>{
    return this.correlated(type,data);
  }
  private correlated(type:string,data:Record<string,unknown>):Promise<any>{
    if(this.pending.size>=2)return Promise.reject(new Error('specialist_request_pending'));
    const request_id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(request_id);reject(new Error('specialist_timeout_check_world_before_retry'));},type==='specialist_conversation'?30000:this.timeoutMs);
      this.pending.set(request_id,{resolve,reject,timer,requestType:type});
      if(!this.send(type,{...data,request_id})){
        clearTimeout(timer);this.pending.delete(request_id);reject(new Error('specialist_disconnected'));
      }
    });
  }
  receive(type:string,data:any):boolean{
    const pending=this.pending.get(data?.request_id);if(!pending)return false;
    const buildingCommit=pending.requestType==='specialist_build_confirm';
    const dimensionEdit=pending.requestType.startsWith('dimension_edit_');
    const allowed=dimensionEdit
      ? [pending.requestType==='dimension_edit_commit'?'dimension_edit_committed':'dimension_edit_preview','dimension_edit_rejected']
      : buildingCommit
      ? ['op_appended','op_group_confirmed','op_group_rejected','op_rejected','axiom_rejected','entity_rejected','error','specialist_rejected']
      : ['specialist_reply','specialist_unhandled','specialist_rejected','dimension_created'];
    if(!allowed.includes(type))return false;
    if(type==='dimension_edit_rejected') {
      clearTimeout(pending.timer);this.pending.delete(data.request_id);
      pending.reject(new Error(String(data.reason||'dimension_edit_rejected')));return true;
    }
    if(buildingCommit && type!=='specialist_rejected' && data?.source!=='wanderaround-build-specialist')return false;
    clearTimeout(pending.timer);this.pending.delete(data.request_id);
    if(pending.requestType==='specialist_surface_confirm'&&type==='specialist_rejected'){
      pending.reject(Object.assign(new Error(String(data.reason||'surface_request_rejected')),{surfaceNotApplied:data.may_have_committed===false}));return true;
    }
    if(['specialist_rejected','specialist_unhandled','op_group_rejected','op_rejected','axiom_rejected','entity_rejected','error'].includes(type))pending.reject(Object.assign(new Error(String(data.reason||'specialist_request_rejected')),{appearanceNotApplied:pending.requestType==='specialist_room_appearance_confirm'&&type==='specialist_rejected'&&data.may_have_committed===false,transformNotApplied:['specialist_transform_confirm','specialist_room_confirm'].includes(pending.requestType)&&type==='specialist_rejected'&&data.may_have_committed===false,safeToRepreview:pending.requestType.startsWith('specialist_furnishing_')&&data.safe_to_repreview===true,undoNotApplied:pending.requestType==='specialist_furnishing_undo_confirm'&&type==='specialist_rejected'&&data.undo_not_applied===true}));
    else pending.resolve(data);
    return true;
  }
  cancel(reason:string):void{
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(reason));}
    this.pending.clear();
  }
}
