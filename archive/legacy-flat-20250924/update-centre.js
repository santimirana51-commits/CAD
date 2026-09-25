/* A permanent way back to Updates, independent of the start-page notice.
 * Desktop uses the verified updater; web checks the deployed CAD build.
 * Both installation paths cross the existing drawing-save barrier. */
(() => {
  'use strict';
  const boot = () => {
    const N = window.Nasj, search = document.getElementById('titlebar-search');
    if (!N || !search || document.getElementById('nasj-updates')) return;
    const api = () => N.fileIO || window.nasjAPI || {};
    const desktop = () => typeof api().updateDetails === 'function';
    const own = Array.from(document.scripts).find(s => /\/update-centre\.js(?:\?|$)/.test(s.src));
    const build = own ? new URL(own.src).searchParams.get('v') : null;
    let state = { current: String(window.NASJ_VERSION || ''), latest: null, notice: null }, pending = null, saving = false;
    let latestBuild = null, lastAttempt = 0, localError = '';
    const valid = v => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
    const newer = (a, b) => {
      if (!valid(a) || !valid(b)) return false;
      const x = a.split('.').map(Number), y = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
      return false;
    };
    const available = () => !!state.notice || newer(state.latest, state.current) ||
      (!desktop() && !!build && !!latestBuild && latestBuild !== build);
    const make = (tag, cls, text) => {
      const e = document.createElement(tag); if (cls) e.className = cls;
      if (text) e.textContent = text; return e;
    };
    const button = make('button', 'nasj-updates'); button.id = 'nasj-updates';
    button.type = 'button'; button.setAttribute('aria-haspopup', 'dialog');
    const symbol = make('span', 'nu-symbol', '↻'); symbol.setAttribute('aria-hidden', 'true');
    const label = make('span', 'nu-label', 'Updates'), badge = make('span', 'nu-version');
    button.append(symbol, label, badge); search.after(button);
    const dialog = make('dialog', 'nasj-update-centre'); dialog.id = 'nasj-update-centre';
    dialog.setAttribute('aria-labelledby', 'nu-heading');
    const heading = make('h2', '', 'Nasjicad updates'); heading.id = 'nu-heading';
    const close = make('button', 'nu-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close updates');
    const head = make('div', 'nu-head'); head.append(heading, close);
    const versions = make('dl', 'nu-versions');
    const current = make('dd'), latest = make('dd');
    versions.append(make('dt', '', 'Current version'), current, make('dt', '', 'Latest version'), latest);
    const status = make('p', 'nu-status'); status.setAttribute('role', 'status');
    const error = make('p', 'nu-error'); error.setAttribute('role', 'alert');
    const note = make('p', 'nu-note');
    const actions = make('div', 'nu-actions');
    const checkButton = make('button', '', 'Check for updates'), upgrade = make('button', 'primary', 'Upgrade');
    checkButton.type = upgrade.type = 'button'; actions.append(checkButton, upgrade);
    dialog.append(head, versions, status, error, note, actions); document.body.append(dialog);
    const render = () => {
      const n = state.notice || {}, hasUpdate = available();
      const fault = localError || state.error || n.error || '';
      label.textContent = n.installing ? 'Installing…' : n.downloading ? 'Downloading' : hasUpdate ? 'Upgrade' : 'Updates';
      badge.textContent = n.downloading ? Math.round(Number(n.percent) || 0) + '%' : 'v' + state.current;
      button.classList.toggle('available', hasUpdate); button.classList.toggle('failed', !!fault);
      button.title = 'Current: v' + state.current + ' · Latest: ' + (state.latest ? 'v' + state.latest : 'not checked') + '. Open updates';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-expanded', String(dialog.open));
      current.textContent = 'v' + state.current;
      latest.textContent = state.latest ? 'v' + state.latest : pending ? 'Checking…' : 'Not checked';
      status.textContent = saving ? 'Saving your drawings…' : n.installing ? 'Installing the update…' : n.downloading ?
        'Downloading inside Nasjicad: ' + Math.round(Number(n.percent) || 0) + '%' : n.ready ? 'Downloaded and ready to install.' :
        pending ? 'Checking for updates…' : hasUpdate ? (!desktop() && !newer(state.latest, state.current) ? 'A newer web build is available.' : 'An update is available.') :
        state.error ? 'Latest release could not be verified.' : state.latest ? (newer(state.current, state.latest) ? 'You are running a newer version than the published release.' : 'You are up to date.') : 'Check for the latest release.';
      error.textContent = fault; error.hidden = !fault;
      note.textContent = desktop() ? 'Updates download inside the app. Your drawings are saved before restarting.' : 'Save and reload to use the latest web version. Your drawings will be saved first.';
      upgrade.hidden = !hasUpdate;
      upgrade.textContent = n.installing ? 'Installing…' : n.downloading ? 'Downloading…' : desktop() ? n.ready ? 'Save and restart' : n.error ? 'Retry update' : 'Download update' : 'Save and reload';
      upgrade.disabled = saving || !!pending || !!n.installing || !!n.downloading;
      checkButton.disabled = saving || !!pending || !!n.installing;
      close.disabled = saving;
    };
    const receive = data => {
      if (!data || !valid(data.current)) return;
      state = { ...data, latest: valid(data.latest) ? data.latest : null }; render();
    };
    const check = () => {
      if (pending) return pending;
      lastAttempt = Date.now(); localError = '';
      pending = (async () => {
        if (desktop()) { receive(await api().updateDetails(true)); return; }
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
        try {
          // Query and no-store bypass old service workers and HTTP caches.
          const r = await fetch('/nasjicad/version.json?check=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
          if (!r.ok) throw new Error('version request');
          const j = await r.json();
          if (!valid(j.appVersion) || typeof j.v !== 'string' || !/^[a-f0-9]{12}$/.test(j.v)) throw new Error('version response');
          latestBuild = j.v; state.latest = j.appVersion; state.error = null;
        } finally { clearTimeout(timer); }
      })().catch(() => { state.error = 'Could not check the latest release. Check your connection and retry.'; })
        .finally(() => { pending = null; render(); });
      render(); return pending;
    };
    const dismiss = () => { if (!saving) { dialog.close(); render(); button.focus(); } };
    close.addEventListener('click', dismiss);
    dialog.addEventListener('cancel', e => { e.preventDefault(); dismiss(); });
    // CAD shortcuts must not run behind the update dialog (Escape included).
    for (const event of ['keydown', 'keyup', 'keypress']) window.addEventListener(event, e => {
      if (!dialog.open) return;
      e.stopImmediatePropagation();
      if (event === 'keydown' && e.key === 'Escape') { e.preventDefault(); dismiss(); }
    }, true);
    button.addEventListener('click', () => { dialog.showModal(); render(); check(); });
    checkButton.addEventListener('click', check);
    upgrade.addEventListener('click', async () => {
      if (saving || pending) return;
      localError = '';
      if (desktop()) {
        const n = state.notice;
        if (!n || !N.updateNotice) { await check(); return; }
        dialog.close(); render();
        // Reopen the existing notice even if it was hidden earlier.
        N.updateNotice.show(n);
        await (n.ready ? N.updateNotice.install() : N.updateNotice.open());
        return;
      }
      saving = true; render();
      try {
        const result = await N.prepareUpdate();
        if (!result || !result.ok) { localError = result && result.error || 'Could not save your drawings. Please retry.'; return; }
        // Revalidate after potentially long Save As dialogs; offline never reloads.
        await check();
        if (state.error) return;
        location.reload();
      } catch (_) { localError = 'Could not update. Your drawing remains open. Please retry.'; }
      finally { saving = false; render(); }
    });
    if (desktop()) {
      api().updateDetails(false).then(receive).catch(() => {});
      api().onUpdateDetails(receive);
      api().onUpdateProgress(p => {
        if (state.notice && p && p.version === state.notice.version) { state.notice.percent = p.percent; render(); }
      });
    }
    const recheck = () => { if (!document.hidden && Date.now() - lastAttempt >= 30000) check(); };
    window.addEventListener('online', recheck); window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    // QA must not contact production; normal sessions check in the background.
    if (/^https?:$/.test(location.protocol) || (window.nasjAPI && window.nasjAPI.isPackaged)) {
      setTimeout(check, 3500); setInterval(recheck, 5 * 60 * 1000);
    }
    render();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
