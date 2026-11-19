import type {PhysicsVector3,StaticBoxCollider} from './operationalPhysicsCanary.js';
export const MIN_STATIC_HALF_EXTENT=.015;
export const MAX_STATIC_HALF_EXTENT=80;
/** Distance to the oriented box surface, not its potentially distant centre. */
export function staticColliderDistanceSquared(box:StaticBoxCollider,point:PhysicsVector3):number{
 let x=point.x-box.center.x,y=point.y-box.center.y,z=point.z-box.center.z;
 const q=box.rotation;
 if(q){
  const n=Math.hypot(q.x,q.y,q.z,q.w);
  if(Number.isFinite(n)&&n>1e-8){
   const qx=-q.x/n,qy=-q.y/n,qz=-q.z/n,qw=q.w/n;
   const tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);
   const nx=x+qw*tx+qy*tz-qz*ty,ny=y+qw*ty+qz*tx-qx*tz,nz=z+qw*tz+qx*ty-qy*tx;
   x=nx;y=ny;z=nz;
  }
 }
 const extent=(v:number)=>Math.max(MIN_STATIC_HALF_EXTENT,Math.min(MAX_STATIC_HALF_EXTENT,v));
 const dx=Math.max(0,Math.abs(x)-extent(box.halfExtents.x)),dy=Math.max(0,Math.abs(y)-extent(box.halfExtents.y)),dz=Math.max(0,Math.abs(z)-extent(box.halfExtents.z));
 return dx*dx+dy*dy+dz*dz;
}
