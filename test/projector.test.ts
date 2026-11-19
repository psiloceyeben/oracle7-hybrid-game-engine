import {it,expect,vi} from 'vitest';
import {Vector3} from 'three';
vi.mock('../src/materialRegistry',async()=>{const{MeshStandardMaterial}=await import('three');return {resolveMaterial:()=>new MeshStandardMaterial(),enableVertexColors:()=>{}};});
import {projectRecipe} from '../src/buildRecipeProjector';
import {emptyRecipe} from '../src/buildRecipe';
it('projects nested collider transforms after ancestry and root scale are applied',()=>{const r=emptyRecipe('structure.test',{scale:2,parts:[{id:'parent',kind:'box',position:[5,0,0],children:[{id:'child',kind:'box',position:[1,0,0],colliders:[{shape:'aabb',tag:'solid',size:[1,1,1]}]}]}]});const projected=projectRecipe(r);expect(new Vector3().setFromMatrixPosition(projected.colliders[0].worldMatrix).x).toBe(12);});
