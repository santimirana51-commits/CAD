/** Thin dynamic wrapper around legacy window.NasjCadDocument.
 *  Loaded only when agent calls cad_document — not on initial page load.
 */
export async function run(N, args, ctx) {
  if (window.NasjCadDocument?.run) return window.NasjCadDocument.run(N, args, ctx);
  // lazy-load legacy script if not yet loaded
  await import('@core/document/cad-document-loader.js').catch(() => {});
  if (window.NasjCadDocument?.run) return window.NasjCadDocument.run(N, args, ctx);
  return { ok: false, error: 'Native CAD tools are unavailable. Update the application.' };
}
export default { run };
