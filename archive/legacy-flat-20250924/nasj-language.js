/* The CAD language is a deliberate app preference, independent of the website.
 * Runs in <head>, before the renderer, including on old localized CAD links. */
(() => {
  'use strict';
  const languages = { en: 'English', ar: 'العربية', zh: '简体中文', ja: '日本語' };
  const preferenceKey = 'nasj.cad.language';
  const siteKey = 'nasj.cad.websiteLanguage';
  const valid = value => Object.hasOwn(languages, value) ? value : null;
  const read = (storage, key) => { try { return window[storage].getItem(key); } catch (_) { return null; } };
  const write = (storage, key, value) => { try { window[storage].setItem(key, value); } catch (_) { /* URL still works in private mode. */ } };
  const url = new URL(location.href);
  const requested = valid(url.searchParams.get('cad_lang'));
  const preferred = requested || valid(read('localStorage', preferenceKey)) || 'en';
  const current = document.documentElement.lang === 'zh-Hans' ? 'zh' : valid(document.documentElement.lang) || 'en';
  const cadPath = /^\/(?:ar\/|zh\/|ja\/)?cad\/?$/;
  const staticPath = /^\/nasjicad\/(?:ar\/|zh\/|ja\/)?(?:index\.html)?$/;
  if (!cadPath.test(url.pathname) && !staticPath.test(url.pathname)) return;

  // Remember where Back to Website should lead without making it an app choice.
  let websiteLanguage = valid(read('sessionStorage', siteKey)) || 'en';
  if (!requested) {
    const entryLanguage = /^\/(ar|zh|ja)\/cad\/?$/.exec(url.pathname)?.[1];
    if (entryLanguage) websiteLanguage = entryLanguage;
    else if (document.referrer) {
      try {
        const referrer = new URL(document.referrer);
        if (referrer.origin === url.origin && !cadPath.test(referrer.pathname) && !staticPath.test(referrer.pathname)) {
          websiteLanguage = /^\/(ar|zh|ja)(?:\/|$)/.exec(referrer.pathname)?.[1] || 'en';
        }
      } catch (_) { /* no usable referrer */ }
    }
    write('sessionStorage', siteKey, websiteLanguage);
  }

  const destination = language => {
    const next = new URL(location.href);
    next.pathname = language === 'en' ? '/cad' : '/' + language + '/cad';
    next.searchParams.set('cad_lang', language);
    return next;
  };
  if (current !== preferred) {
    // Preserve library file handoffs, campaign parameters and URL fragments.
    location.replace(destination(preferred).href);
    return;
  }

  const copy = {
    en: { label: 'CAD interface language', busy: 'Finish or stop the current drawing operation before changing language.', unsaved: 'Save all open drawings before changing language. Changing language reloads the app.' },
    ar: { label: 'لغة واجهة الكاد', busy: 'انتظر انتهاء عملية الرسم الحالية أو أوقفها قبل تغيير اللغة.', unsaved: 'احفظ كل الرسومات المفتوحة قبل تغيير اللغة. تغيير اللغة يعيد تحميل البرنامج.' },
    zh: { label: 'CAD 界面语言', busy: '请先完成或停止当前绘图操作，然后再更改语言。', unsaved: '更改语言前请保存所有打开的图纸。更改语言会重新加载应用。' },
    ja: { label: 'CAD の表示言語', busy: '言語を変更する前に、現在の描画操作を完了または停止してください。', unsaved: '言語を変更する前に、開いている図面をすべて保存してください。言語を変更するとアプリが再読み込みされます。' },
  }[current];

  document.addEventListener('DOMContentLoaded', () => {
    const search = document.getElementById('titlebar-search');
    if (!search || document.getElementById('nasj-cad-language')) return;
    const control = document.createElement('label');
    control.id = 'nasj-cad-language-control';
    control.title = copy.label;
    control.innerHTML = '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke="currentColor"/><ellipse cx="10" cy="10" rx="3.5" ry="8" stroke="currentColor"/><path d="M2 10h16" stroke="currentColor"/></svg>';
    const select = document.createElement('select');
    select.id = 'nasj-cad-language';
    select.setAttribute('aria-label', copy.label);
    select.dir = 'ltr';
    for (const [value, name] of Object.entries(languages)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = name;
      option.lang = value;
      select.appendChild(option);
    }
    select.value = current;
    select.addEventListener('change', () => {
      const next = valid(select.value);
      if (!next || next === current) return;
      const docs = Array.from(window.Nasj?.docs || []);
      if (window.Nasj?.doc && !docs.includes(window.Nasj.doc)) docs.push(window.Nasj.doc);
      const busy = docs.some(doc => doc.loading) || window.NasjAgent?.isBusy?.();
      const unsafe = docs.some(doc => doc.modified);
      if (busy || unsafe) {
        select.value = current;
        const message = busy ? copy.busy : copy.unsaved;
        if (window.Nasj?.toast) window.Nasj.toast(message);
        else window.alert(message);
        return;
      }
      write('localStorage', preferenceKey, next);
      location.assign(destination(next).href);
    });
    control.appendChild(select);
    search.insertAdjacentElement('afterend', control);
    const home = document.getElementById('nasj-web-home');
    if (home) home.href = websiteLanguage === 'en' ? '/' : '/' + websiteLanguage;
  }, { once: true });
})();
