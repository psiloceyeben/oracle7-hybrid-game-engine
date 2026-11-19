import { describe, it, expect } from 'vitest';
import { Group, Mesh } from 'three';
import { isRedundantStairTread } from '../src/engine/stairPhysicsSurface';
describe('straight stair physics surface selection',()=>{
 it('keeps the ramp but excludes its duplicate visual treads',()=>{
  const group=new Group(),ramp=new Mesh(),tread=new Mesh();
  ramp.userData={walkable_surface:true,stair_navigation_surface:true};
  tread.userData={walkable_surface:true};group.add(ramp,tread);
  expect(isRedundantStairTread(ramp)).toBe(false);
  expect(isRedundantStairTread(tread)).toBe(true);
 });
 it('preserves spiral treads, ordinary floors, and non-walkable railings',()=>{
  const group=new Group(),tread=new Mesh(),rail=new Mesh(),ramp=new Mesh();
  tread.userData.walkable_surface=true;group.add(tread,rail);
  expect(isRedundantStairTread(tread)).toBe(false);
  ramp.userData.stair_navigation_surface=true;group.add(ramp);
  expect(isRedundantStairTread(rail)).toBe(false);
  expect(isRedundantStairTread(new Mesh())).toBe(false);
 });
});
