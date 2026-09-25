export async function run(N, args, ctx) {
  if (window.NasjCadLibrary?.run) return window.NasjCadLibrary.run(N, args, ctx);
  await import('@core/document/cad-library-loader.js').catch(() => {});
  if (window.NasjCadLibrary?.run) return window.NasjCadLibrary.run(N, args, ctx);
  return { ok: false, error: 'Library tools unavailable.' };
}
export default { run };
