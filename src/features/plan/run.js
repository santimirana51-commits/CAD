/** Lazy wrapper for plan.js (108k) — only loaded when agent calls draw_plan */

export async function run(N, args, ctx) {
  // if legacy plan runner exists, use it
  if (window.NasjPlan?.run) return window.NasjPlan.run(N, args, ctx);
  await import('@core/document/plan-loader.js').catch(() => {});
  if (window.NasjPlan?.run) return window.NasjPlan.run(N, args, ctx);
  return { ok: false, error: 'Plan engine unavailable.' };
}

export default { run };
