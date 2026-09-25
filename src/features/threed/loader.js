// Lazy 3D — gl3d, solid3d, csg3d, tools3d only when 3D view entered
export async function load3d() {
  await Promise.all([
    import('../../../gl3d.js').catch(() => {}),
    import('../../../solid3d.js').catch(() => {}),
    import('../../../csg3d.js').catch(() => {}),
    import('../../../tools3d.js').catch(() => {})
  ]);
  return window.Nasj3d || null;
}
export default { load3d };
