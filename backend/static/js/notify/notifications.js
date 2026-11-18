(function (global) {
  'use strict';

  const POLL_INTERVAL_MS = 10 * 1000;
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

  class RealtimeChannel {
    constructor(api, onNotify, onStateChange) {
      this.api = api;
      this.onNotify = onNotify;
      this.onStateChange = onStateChange;
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
        if (data.type === 'ready') {
          this.retryMs = 2000;
          this.onStateChange(true);
          this.onNotify();
        }
        if (data.type === 'notifications') this.onNotify();
      });
      ws.addEventListener('close', (event) => {
        this.ws = null;
        this.onStateChange(false);
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
    constructor(api) {
      this.api = api;
      this.shown = new ShownStore();
      this.channel = new RealtimeChannel(
        api,
        () => this.poll(),
        (connected) => this.setPollingFallback(!connected),
      );
      this.polling = false;
      this.pollTimer = null;
      this.workerRegistration = null;
    }

    static permission() {
      if (!('Notification' in global)) return 'unsupported';
      return global.Notification.permission;
    }

    async start() {
      if (NotificationCenter.permission() === 'granted' && 'serviceWorker' in navigator) {
        this.getWorker().then((registration) => registration.update()).catch(() => {});
      }
      this.subscribe();
      this.setPollingFallback(true);
      await this.poll();
      this.channel.connect();
    }

    setPollingFallback(enabled) {
      if (enabled && this.pollTimer === null) {
        this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
      } else if (!enabled && this.pollTimer !== null) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
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
        this.shown.add(n.id);
      }
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

  global.OMSA.NotificationCenter = NotificationCenter;
})(window);
