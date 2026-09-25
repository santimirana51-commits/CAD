/** Dynamic draw pipeline — thin facade over legacy pipeline.
 *  Imported only on draw_cad / draw_plan calls.
 *  Keeps heavy cleanForVectorizer + geometry out of initial bundle.
 */
import { cleanForVectorizer } from './clean.js';

export async function runDrawCad(brief, row, args) {
  // delegate to legacy if available (keeps 1:1 compat during migration)
  if (window.NasjAgent?._clean) {
    // legacy path still owns aiImage->aiRaster->pen — we just provide clean
    return { cleanForVectorizer };
  }
  return { cleanForVectorizer };
}

export { cleanForVectorizer };
export default { runDrawCad, cleanForVectorizer };
