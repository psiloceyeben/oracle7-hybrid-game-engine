import type { Object3D } from 'three';

/** The analytic ramp replaces straight-stair treads for capsule collision.
 * Keeping both creates riser contacts that pin the capsule against the ramp.
 * Spiral stairs without a navigation ramp retain their individual treads.
 */
export function isRedundantStairTread(mesh: Object3D): boolean {
  return mesh.userData.walkable_surface === true &&
    mesh.userData.stair_navigation_surface !== true &&
    mesh.parent?.children.some(child => child.userData.stair_navigation_surface === true) === true;
}
