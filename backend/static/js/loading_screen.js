(function () {
  'use strict';

  const key = 'omsa-show-loading-after-login';
  let active = false;
  try {
    active = window.sessionStorage.getItem(key) === '1';
    window.sessionStorage.removeItem(key);
  } catch (error) {
    active = false;
  }

  window.OMSA_LOGIN_LOADING = {
    active,
    hide() {
      this.active = false;
      document.documentElement.classList.remove('is-login-loading');
    },
  };

  if (active) document.documentElement.classList.add('is-login-loading');
})();
