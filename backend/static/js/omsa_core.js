(function (global) {
  'use strict';

  const OMSA = global.OMSA || (global.OMSA = {});

  OMSA.esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  OMSA.csrfToken = () => {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  };

  









  const EVENTS = {
    click: 'data-click', dblclick: 'data-dblclick', input: 'data-input',
    change: 'data-change', keydown: 'data-keydown', blur: 'data-blur',
  };
  const SELECTOR = '[data-click],[data-dblclick],[data-input],[data-change],[data-keydown],[data-blur]';

  const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-mk') : null);
  const sameKind = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || a.nodeName === b.nodeName);

  function syncAttrs(from, to) {
    Array.from(to.attributes).forEach((a) => {
      if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
    });
    Array.from(from.attributes).forEach((a) => {
      if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
    });

    
    if (from.nodeName === 'INPUT') {
      const v = to.getAttribute('value');
      if (v !== null && from !== document.activeElement && from.value !== v) from.value = v;
      if (from.type === 'checkbox') from.checked = to.hasAttribute('checked');
    }
    if (from.nodeName === 'TEXTAREA' && from !== document.activeElement) {
      const v = to.textContent;
      if (from.value !== v) from.value = v;
    }
    if ('disabled' in from) from.disabled = to.hasAttribute('disabled');
    if ('readOnly' in from) from.readOnly = to.hasAttribute('readonly');
  }

  function morph(from, to) {
    if (from.nodeType === 3) {
      if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
      return;
    }
    syncAttrs(from, to);
    if (from.nodeName !== 'TEXTAREA') morphChildren(from, to);
    if (from.nodeName === 'SELECT') {
      const picked = to.querySelector('option[selected]');
      if (picked && from.value !== picked.value) from.value = picked.value;
    }
  }

  function morphChildren(parent, source) {
    const byKey = new Map();
    Array.from(parent.childNodes).forEach((n) => { const k = keyOf(n); if (k) byKey.set(k, n); });

    let cursor = parent.firstChild;

    Array.from(source.childNodes).forEach((fresh) => {
      const k = keyOf(fresh);
      let match = null;

      if (k) {
        const candidate = byKey.get(k);
        if (candidate && sameKind(candidate, fresh)) match = candidate;
      } else if (cursor && !keyOf(cursor) && sameKind(cursor, fresh)) {
        match = cursor;
      }

      if (!match) {
        parent.insertBefore(fresh, cursor);   
        return;
      }
      if (match === cursor) cursor = cursor.nextSibling;
      else parent.insertBefore(match, cursor);
      morph(match, fresh);
    });

    while (cursor) {                          
      const next = cursor.nextSibling;
      parent.removeChild(cursor);
      cursor = next;
    }
  }

  

  OMSA.createRenderer = function (handlers) {
    function bindOne(el) {
      if (el.__bound) return;
      el.__bound = true;
      Object.keys(EVENTS).forEach((type) => {
        const name = el.getAttribute(EVENTS[type]);
        if (name && handlers[name]) el.addEventListener(type, handlers[name]);
      });
    }
    function bindEvents(root) {
      if (root.nodeType === 1 && root.matches(SELECTOR)) bindOne(root);
      root.querySelectorAll(SELECTOR).forEach(bindOne);
    }
    const scratch = document.createElement('div');
    function patch(container, html) {
      scratch.innerHTML = html;
      morphChildren(container, scratch);
      bindEvents(container);
    }
    
    const scratchTable = document.createElement('table');
    function patchRows(tbody, html) {
      scratchTable.innerHTML = '<tbody>' + html + '</tbody>';
      morphChildren(tbody, scratchTable.tBodies[0]);
      bindEvents(tbody);
    }
    return { patch, patchRows, bindEvents };
  };

  


  class ApiError extends Error {
    constructor(status, message, payload) {
      super(message);
      this.status = status;
      this.payload = payload || {};
    }
  }

  class ApiClient {
    constructor(options) {
      const opts = options || {};
      this.loginUrl = opts.loginUrl || '/login';
      this.csrf = OMSA.csrfToken();
      this.token = null;
      this.tokenExpiresAt = 0;
      this.user = null;
      this.refreshing = null;
      this.listeners = [];
      this.keepAliveTimer = null;
    }

    onSession(listener) { this.listeners.push(listener); }

    setSession(data) {
      this.token = data.access_token;
      
      this.tokenExpiresAt = Date.now() + Math.max(0, (data.expires_in - 30)) * 1000;
      this.user = data.user;
      this.startKeepAlive();
      this.listeners.forEach((fn) => fn(data));
    }

    startKeepAlive() {
      if (this.keepAliveTimer) return;
      const renewIfNeeded = () => {
        if (!this.token || Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) return;
        if (global.document && global.document.visibilityState === 'hidden') return;
        this.refresh().catch((error) => {
          if (error.status === 401) this.redirectToLogin();
        });
      };
      this.keepAliveTimer = global.setInterval(renewIfNeeded, 60 * 1000);
      if (global.document) global.document.addEventListener('visibilitychange', renewIfNeeded);
    }

    

    refresh() {
      if (!this.refreshing) {
        this.refreshing = fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-CSRFToken': this.csrf, Accept: 'application/json' },
        })
          .then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              if (res.status === 401) this.token = null;
              throw new ApiError(res.status, data.detail || 'Сессия завершена', data);
            }
            this.setSession(data);
            return data;
          })
          .finally(() => { this.refreshing = null; });
      }
      return this.refreshing;
    }

    async accessToken() {
      if (!this.token || Date.now() >= this.tokenExpiresAt) await this.refresh();
      return this.token;
    }

    redirectToLogin() {
      global.location.replace(this.loginUrl);
    }

    async request(method, path, body, retry) {
      let token;
      try {
        token = await this.accessToken();
      } catch (e) {
        if (e.status === 401) this.redirectToLogin();
        throw e;
      }
      const headers = { Authorization: 'Bearer ' + token, 'X-CSRFToken': this.csrf, Accept: 'application/json' };
      const init = { method, headers, credentials: 'same-origin' };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const res = await fetch(path, init);
      if (res.status === 401 && retry !== false) {
        
        this.token = null;
        return this.request(method, path, body, false);
      }
      if (res.status === 401) {
        this.redirectToLogin();
        throw new ApiError(401, 'Требуется вход в систему');
      }
      if (res.status === 204) return null;
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, (data && data.detail) || 'Ошибка сервера', data);
      return data;
    }

    get(path) { return this.request('GET', path); }
    post(path, body) { return this.request('POST', path, body === undefined ? {} : body); }
    put(path, body) { return this.request('PUT', path, body); }
    patch(path, body) { return this.request('PATCH', path, body); }
    del(path) { return this.request('DELETE', path); }

    async logout() {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-CSRFToken': this.csrf, Accept: 'application/json' },
        });
      } finally {
        this.token = null;
        this.redirectToLogin();
      }
    }
  }

  OMSA.ApiError = ApiError;
  OMSA.ApiClient = ApiClient;

  
  OMSA.query = (params) => {
    const usp = new URLSearchParams();
    Object.keys(params).forEach((k) => {
      const v = params[k];
      if (v !== undefined && v !== null && v !== '') usp.append(k, String(v));
    });
    const s = usp.toString();
    return s ? '?' + s : '';
  };
})(window);
