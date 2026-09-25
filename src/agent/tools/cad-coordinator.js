export async function run(N, args, ctx) {
  // placeholder for cad-coordination.js lazy wrapper
  if (window.NasjCoordination?.run) return window.NasjCoordination.run(N, args, ctx);
  await import('@core/document/cad-coordination-loader.js').catch(() => {});
  if (window.NasjCoordination?.run) return window.NasjCoordination.run(N, args, ctx);
  return { ok: false, error: 'Coordination tools unavailable.' };
}
export default { run };
