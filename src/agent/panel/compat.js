/**
 * Compat layer — exposes new ES modules on legacy window.* so existing
 * plain scripts (app.js, engine.js, commands.js) keep working unchanged
 * during migration. New code imports directly; old code reads window.*.
 */

import { cleanForVectorizer, otsuThreshold } from '../pipeline/clean.js';
import * as Site from '../pipeline/site.js';
import * as Sel from '../pipeline/selection.js';
import { AI_ICONS, registerAgentIcons } from '@ui/icons/agent-icons.js';
import * as Tunables from '@shared/config/tunables.js';
import * as Helpers from '@shared/utils/helpers.js';

// Ensure icons registered (idempotent)
registerAgentIcons();

// Expose on window for legacy shims & harness tests
const g = (window.__nasjCompat = window.__nasjCompat || {});
g.cleanForVectorizer = cleanForVectorizer;
g.otsuThreshold = otsuThreshold;
g.Site = Site;
g.Sel = Sel;
g.AI_ICONS = AI_ICONS;
g.Tunables = Tunables;
g.Helpers = Helpers;

// Legacy QA hooks that agent-panel.js exposed: keep them
// window.NasjAgent._clean, _plotMetres, _findLand, _stated, _geo
// New modules will be wired there after Panel.js migration.

// Bridge for selsNote lazy deps (selection.js reads globals)
window.__nasjSite = Site;
window.__nasjMetresNote = Site.metresNote;
window.__nasjSidesWord = Site.sidesWord;

export default g;
