(function () {
  'use strict';

  class LoginController {
    constructor(documentRef, windowRef) {
      this.document = documentRef;
      this.window = windowRef;
      this.form = this.document.getElementById('lgForm');

      if (!this.form) return;

      this.elements = {
        login: this.document.getElementById('lg-login'),
        password: this.document.getElementById('lg-pass'),
        eye: this.document.getElementById('lgEye'),
        error: this.document.getElementById('lgError'),
        submit: this.document.getElementById('lgSubmit'),
      };
      this.state = { login: '', password: '', passVisible: false, error: '', busy: false };
      this.redirectTo = this.form.getAttribute('data-redirect');
      this.askNotifications = this.form.getAttribute('data-notifications') === 'on';
      this.csrf = (this.document.querySelector('meta[name="csrf-token"]') || {}).content || '';

      this.bindEvents();
      this.render();
      this.initBackground();
      this.elements.login.focus();
    }

    initBackground() {
      const image = this.document.getElementById('loginBg');
      if (!image) return;
      const page = image.closest('.login-page');
      const reveal = () => {
        if (!image.naturalWidth) {
          page.classList.add('is-background-failed');
          return;
        }
        if (image.decode) {
          image.decode().then(
            () => page.classList.add('is-background-ready'),
            () => page.classList.add('is-background-failed'),
          );
        } else {
          page.classList.add('is-background-ready');
        }
      };
      if (image.complete) reveal();
      else {
        image.addEventListener('load', reveal, { once: true });
        image.addEventListener('error', () => page.classList.add('is-background-failed'), { once: true });
      }
    }

    bindEvents() {
      this.elements.login.addEventListener('input', (event) => this.onLoginChange(event));
      this.elements.password.addEventListener('input', (event) => this.onPasswordChange(event));
      this.elements.eye.addEventListener('click', () => this.onTogglePass());
      this.form.addEventListener('submit', (event) => this.onSubmit(event));
    }

    setState(patch) {
      Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch);
      this.render();
    }

    onLoginChange(event) {
      this.setState({ login: event.target.value, error: '' });
    }

    onPasswordChange(event) {
      this.setState({ password: event.target.value, error: '' });
    }

    onTogglePass() {
      this.setState((state) => ({ passVisible: !state.passVisible }));
    }

    async onSubmit(event) {
      event.preventDefault();
      if (this.state.busy) return;
      if (!this.state.login.trim() || !this.state.password) {
        this.setState({ error: 'Введите логин и пароль' });
        return;
      }

      this.setState({ busy: true, error: '' });
      try {
        const response = await this.window.fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRFToken': this.csrf,
          },
          body: JSON.stringify({ login: this.state.login.trim(), password: this.state.password }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          this.setState({ busy: false, password: '', error: this.errorText(data) });
          return;
        }

        await this.requestNotificationPermission();
        try {
          this.window.sessionStorage.setItem('omsa-show-loading-after-login', '1');
        } catch (error) {
          // Storage may be disabled; login still continues without the transition screen.
        }
        this.window.location.replace(this.redirectTo);
      } catch (error) {
        this.setState({ busy: false, error: 'Сервер недоступен. Повторите попытку' });
      }
    }

    async requestNotificationPermission() {
      if (!this.askNotifications || !('Notification' in this.window) || this.window.Notification.permission !== 'default') return;

      let request;
      try {
        request = Promise.resolve(this.window.Notification.requestPermission());
      } catch (error) {
        return;
      }
      await Promise.race([
        request.catch(() => null),
        new Promise((resolve) => this.window.setTimeout(resolve, 8000)),
      ]);
    }

    errorText(data) {
      const until = data.code === 'account_locked' && data.errors && data.errors.locked_until;
      if (until) {
        return 'Учётная запись временно заблокирована до ' + this.window.OMSA.time.time(until);
      }
      return data.detail || 'Неверный логин или пароль';
    }

    render() {
      const { login, password, passVisible, error, busy } = this.state;
      const eyeOpen = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5C7.5 5 3.8 8.1 2 12c1.8 3.9 5.5 7 10 7s8.2-3.1 10-7c-1.8-3.9-5.5-7-10-7z"></path><circle cx="12" cy="12" r="3.2"></circle></svg>';
      const eyeOff = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><circle cx="12" cy="12" r="3.2"></circle><line x1="1.5" y1="1.5" x2="22.5" y2="22.5"></line></svg>';

      if (this.elements.login.value !== login) this.elements.login.value = login;
      if (this.elements.password.value !== password) this.elements.password.value = password;

      const passwordType = passVisible ? 'text' : 'password';
      if (this.elements.password.type !== passwordType) this.elements.password.type = passwordType;

      const eyeIcon = passVisible ? eyeOff : eyeOpen;
      if (this.elements.eye.innerHTML !== eyeIcon) this.elements.eye.innerHTML = eyeIcon;
      this.elements.eye.setAttribute('aria-label', passVisible ? 'Скрыть пароль' : 'Показать пароль');

      if (this.elements.error.textContent !== error) this.elements.error.textContent = error;
      this.elements.submit.disabled = busy;
    }
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    new LoginController(document, window);
  }
})();
