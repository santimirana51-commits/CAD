export async function run(N, args, ctx) {
  if (window.NasjWorkspace?.run) return window.NasjWorkspace.run(N, args, { ...ctx, snapshot: ctx.snapshot });
  await import('@core/document/cad-workspace-loader.js').catch(() => {});
  if (window.NasjWorkspace?.run) return window.NasjWorkspace.run(N, args, { ...ctx, snapshot: ctx.snapshot });
  return { ok: false, error: 'Update the application to use workspace tools.' };
}
export default { run };
