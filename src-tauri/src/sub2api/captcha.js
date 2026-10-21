// Native authentication owns the form and credentials. This window receives
// only a public site key and can submit one bounded captcha proof, once.
(() => {
  if (window.top !== window || location.origin !== __SERVER_JSON__) return;
  const render = () => {
    document.title = '安全验证 · Verification';
    document.documentElement.style.cssText = 'background:#fafaf9;color:#292524;font-family:system-ui,sans-serif';
    document.body.replaceChildren();
    document.body.style.cssText = 'margin:0;padding:24px;display:grid;justify-items:center;gap:16px';
    const hint = document.createElement('p');
    hint.textContent = '请完成服务器要求的安全验证 / Complete verification';
    hint.style.cssText = 'margin:0;font-size:13px;text-align:center';
    const widget = document.createElement('div');
    document.body.append(hint, widget);
    let submitted = false;
    const finish = (token) => {
      if (submitted) return;
      submitted = true;
      window.__TAURI_INTERNALS__.invoke('plugin:sub2api-captcha|complete', {
        nonce: __NONCE_JSON__, token,
      }).catch(() => { hint.textContent = '验证未完成，请关闭窗口后重试 / Close and try again'; });
    };
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onerror = () => finish('');
    script.onload = () => {
      try {
        window.turnstile.render(widget, {
          sitekey: __SITE_KEY_JSON__,
          callback: finish,
          'error-callback': () => { hint.textContent = '验证加载失败，请关闭窗口后重试 / Close and try again'; },
          'expired-callback': () => { window.turnstile.reset(widget); },
        });
      } catch { finish(''); }
    };
    document.head.append(script);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true });
  else render();
})();
