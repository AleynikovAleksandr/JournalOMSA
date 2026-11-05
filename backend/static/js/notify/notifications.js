(function (global) {
  'use strict';

  const OMSA = global.OMSA;
  const POLL_INTERVAL_MS = 60 * 1000;
  const STORE_KEY = 'omsa_shown_notifications';
  const STORE_LIMIT = 500;

  class ShownStore {
    constructor() {
      this.ids = [];
      try {
        const raw = global.localStorage.getItem(STORE_KEY);
        this.ids = raw ? JSON.parse(raw) : [];
      } catch (e) {
        this.ids = [];
      }
      this.set = new Set(this.ids);
    }
    has(id) { return this.set.has(id); }
    add(id) {
      if (this.set.has(id)) return;
      this.set.add(id);
      this.ids.push(id);
      if (this.ids.length > STORE_LIMIT) this.ids = this.ids.slice(-STORE_LIMIT);
      try { global.localStorage.setItem(STORE_KEY, JSON.stringify(this.ids)); } catch (e) {}
    }
  }

  class InAppBanner {
    constructor(root) {
      this.root = root;
      this.items = [];
      this.permissionPrompt = null;
    }

    push(item) {
      if (this.items.some((x) => x.n.id === item.n.id)) return;
      this.items.push(item);
      this.render();
    }

    remove(id) {
      this.items = this.items.filter((x) => x.n.id !== id);
      this.render();
    }

    askPermission(onAllow) {
      this.permissionPrompt = onAllow;
      this.render();
    }

    hidePermissionPrompt() {
      this.permissionPrompt = null;
      this.render();
    }

    render() {
      const esc = OMSA.esc;
      let html = '';
      if (this.permissionPrompt) {
        html += '<div class="nt-card nt-card--hint" role="status">' +
          '<span class="nt-title">Разрешите уведомления браузера</span>' +
          '<span class="nt-body">Напоминания о задачах будут приходить, даже когда вкладка свёрнута. ' +
          'Без разрешения они показываются здесь.</span>' +
          '<div class="nt-actions"><button class="nt-btn nt-btn--primary" type="button" data-nt="allow">Разрешить</button></div>' +
          '</div>';
      }
      this.items.slice(0, 4).forEach(({ n }) => {
        const actions = (Array.isArray(n.actions) ? n.actions : [])
          .filter((action) => action.action === 'open');
        html += '<div class="nt-card" role="alert" data-id="' + n.id + '">' +
          '<div class="nt-content">' +
            '<img class="nt-icon" src="' + esc(n.icon || '/static/images/brand.png') + '" alt="" aria-hidden="true">' +
            '<div class="nt-copy">' +
              '<span class="nt-title">' + esc(n.title) + '</span>' +
              '<span class="nt-body">' + esc(n.body) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="nt-actions">' +
            actions.map((action) => '<button class="nt-btn' +
              (action.action === 'open' ? ' nt-btn--primary' : '') +
              '" type="button" data-nt="' + action.action + '" data-id="' + n.id + '">' +
              esc(action.title) + '</button>').join('') +
          '</div>' +
          '</div>';
      });
      if (this.items.length > 4) {
        html += '<div class="nt-more">Ещё уведомлений: ' + (this.items.length - 4) + '</div>';
      }
      this.root.innerHTML = html ? '<div class="nt-stack">' + html + '</div>' : '';
      this.root.querySelectorAll('[data-nt]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.getAttribute('data-nt');
          if (action === 'allow') { if (this.permissionPrompt) this.permissionPrompt(); return; }
          const id = Number(btn.getAttribute('data-id'));
          const item = this.items.find((x) => x.n.id === id);
          if (!item) return;
          this.remove(id);
          if (action === 'open') item.onOpen();
        });
      });
    }
  }

  class RealtimeChannel {
    constructor(api, onNotify) {
      this.api = api;
      this.onNotify = onNotify;
      this.ws = null;
      this.retryMs = 2000;
      this.stopped = false;
    }

    async connect() {
      if (this.stopped || !('WebSocket' in global)) return;
      let token;
      try {
        token = await this.api.accessToken();
      } catch (e) {
        this.scheduleReconnect();
        return;
      }
      const scheme = global.location.protocol === 'https:' ? 'wss://' : 'ws://';
      const ws = new WebSocket(scheme + global.location.host + '/ws');
      this.ws = ws;
      ws.addEventListener('open', () => ws.send(JSON.stringify({ token })));
      ws.addEventListener('message', (event) => {
        let data = null;
        try { data = JSON.parse(event.data); } catch (e) { return; }
        if (data.type === 'ready') this.retryMs = 2000;
        if (data.type === 'notifications') this.onNotify();
      });
      ws.addEventListener('close', (event) => {
        this.ws = null;
        if (event.code === 4003) this.api.token = null;
        this.scheduleReconnect();
      });
    }

    scheduleReconnect() {
      if (this.stopped) return;
      const delay = this.retryMs;
      this.retryMs = Math.min(this.retryMs * 2, 60000);
      setTimeout(() => this.connect(), delay);
    }
  }

  class NotificationCenter {
    constructor(api, options) {
      this.api = api;
      this.onOpen = options.onOpen;
      this.shown = new ShownStore();
      this.banner = new InAppBanner(options.root);
      this.channel = new RealtimeChannel(api, () => this.poll());
      this.polling = false;
      this.workerRegistration = null;
    }

    static permission() {
      if (!('Notification' in global)) return 'unsupported';
      return global.Notification.permission;
    }

    async start() {
      this.subscribe();
      if (NotificationCenter.permission() === 'default') {
        this.banner.askPermission(() => this.requestPermission());
      }
      await this.poll();
      setInterval(() => this.poll(), POLL_INTERVAL_MS);
      this.channel.connect();
    }

    async requestPermission() {
      try {
        await global.Notification.requestPermission();
      } catch (e) {}
      this.banner.hidePermissionPrompt();
      await this.subscribe();
    }

    async subscribe() {
      const permission = NotificationCenter.permission();
      this.api.post('/api/notifications/subscribe', { permission }).catch(() => {});
      if (permission !== 'granted') {
        if (permission === 'denied') this.api.del('/api/auth/push-subscribe').catch(() => {});
        return;
      }
      if (!('serviceWorker' in navigator) || !('PushManager' in global)) return;
      try {
        const config = await this.api.get('/api/notifications/push-config');
        if (!config.enabled || !config.public_key) return;
        const worker = await this.getWorker();
        const key = this.decodeKey(config.public_key);
        let subscription = await worker.pushManager.getSubscription();
        if (subscription && subscription.options && subscription.options.applicationServerKey) {
          const current = new Uint8Array(subscription.options.applicationServerKey);
          if (current.length !== key.length || current.some((byte, i) => byte !== key[i])) {
            await subscription.unsubscribe();
            subscription = null;
          }
        }
        if (!subscription) {
          subscription = await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        }
        const details = subscription.toJSON();
        await this.api.post('/api/auth/push-subscribe', {
          endpoint: details.endpoint, p256dh: details.keys.p256dh, auth: details.keys.auth,
        });
      } catch (e) {}
    }

    getWorker() {
      if (!this.workerRegistration) {
        this.workerRegistration = navigator.serviceWorker.register('/notification-sw.js', { scope: '/' })
          .catch((error) => { this.workerRegistration = null; throw error; });
      }
      return this.workerRegistration;
    }

    decodeKey(encoded) {
      const padded = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
      return Uint8Array.from(global.atob(padded), (char) => char.charCodeAt(0));
    }

    async poll() {
      if (this.polling) return;
      this.polling = true;
      try {
        const list = await this.api.get('/api/notifications/pending');
        await Promise.all(list.map(async (n) => {
          if (this.shown.has(n.id)) return;
          await this.display(n);
        }));
      } catch (e) {
      } finally {
        this.polling = false;
      }
    }

    async display(n) {
      if (NotificationCenter.permission() === 'granted' && await this.showSystem(n)) {
        return;
      }
      this.banner.push({
        n,
        onOpen: async () => { if (await this.onOpen(n.journal_id)) await this.ack(n); },
      });
    }

    async showSystem(n) {
      if (!('serviceWorker' in navigator)) return false;
      try {
        const worker = await this.getWorker();
        await worker.showNotification(n.title, {
          body: n.body,
          tag: 'omsa-' + n.id,
          requireInteraction: true,
          silent: false,
          icon: n.icon,
          badge: n.icon,
          actions: n.actions,
          data: { url: new URL(n.url, global.location.origin).href, notification_id: n.id },
        });
        return true;
      } catch (e) { return false; }
    }

    async ack(n) {
      try {
        await this.api.post('/api/notifications/' + n.id + '/ack');
        this.shown.add(n.id);
        return true;
      } catch (e) {
        return false;
      }
    }
  }

  OMSA.NotificationCenter = NotificationCenter;
})(window);
