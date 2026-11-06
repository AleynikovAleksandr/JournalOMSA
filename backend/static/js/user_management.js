(function () {
  'use strict';

  const OMSA = window.OMSA;
  const esc = OMSA.esc;
  const api = new OMSA.ApiClient({ loginUrl: '/login' });
  const SYSTEM_ADMIN_FIO = 'Администратор системы';

  


  function rightsMap(list) {
    const map = {};
    state.RIGHTS_TREE.forEach((g) => g.items.forEach((i) => { map[i.key] = false; }));
    (list || []).forEach((k) => { map[k] = true; });
    return map;
  }
  const toUser = (u) => ({
    id: u.id, groupId: u.group_id, fio: u.fio, profile: u.profile || '', login: u.login,
    password: '', fired: u.is_fired, rights: rightsMap(u.rights),
    lockedUntil: u.locked_until, isLocked: u.is_locked, isNew: false,
  });
  const toGroup = (g, prev) => ({
    id: g.id, name: g.name, isArchive: g.is_archive, members: g.members,
    rights: rightsMap(g.rights), savedRights: rightsMap(g.rights), configured: g.rights_configured,
    collapsed: prev ? prev.collapsed : true,
  });
  const clone = (u) => ({ ...u, rights: { ...u.rights } });
  const rightKeys = () => state.RIGHTS_TREE.flatMap((g) => g.items.map((i) => i.key));
  const restrictiveKeys = () => state.RIGHTS_TREE.flatMap((g) => g.items.filter((i) => i.restrictive).map((i) => i.key));

  


  const state = {
    loaded: false,
    GROUPS: [], USERS: [], SAVED: [], RIGHTS_TREE: [],
    activeGroupId: null,
    search: '', selId: null, expandedId: null, detailsOpen: false,
    passVisible: false, renamingGroupId: null, renameOriginal: '', toast: null, showArchive: false,
    saving: false,
  };

  function setState(patch, cb) {
    Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
    render();
    if (cb) cb();
  }

  let toastTimer = null;
  function showToast(msg) {
    clearTimeout(toastTimer);
    setState({ toast: msg });
    toastTimer = setTimeout(() => setState({ toast: null }), 2200);
  }
  const showError = (err) => showToast((err && err.message) || 'Ошибка сервера');

  function sel() { return state.USERS.find((u) => u.id === state.selId) || null; }
  function activeGroup() { return state.GROUPS.find((g) => g.id === state.activeGroupId) || null; }
  function isSystemAdmin(u) { return !!u && u.fio === SYSTEM_ADMIN_FIO; }
  function groupHasSystemAdmin(groupId) {
    return state.USERS.some((u) => !u.isNew && u.groupId === groupId && isSystemAdmin(u));
  }
  function patchGroup(patch) {
    setState((s) => ({ GROUPS: s.GROUPS.map((g) => g.id === s.activeGroupId ? { ...g, ...patch } : g) }));
  }
  function savedOf(id) { return state.SAVED.find((u) => u.id === id) || null; }
  function patchSel(patch) {
    setState((s) => ({ USERS: s.USERS.map((u) => (u.id === s.selId ? { ...u, ...patch } : u)) }));
  }

  async function refreshSelectedLock() {
    const selected = sel();
    if (!selected || selected.isNew || !selected.isLocked) return;
    try {
      const latest = toUser(await api.get('/api/users/' + selected.id));
      setState((s) => ({
        USERS: s.USERS.map((u) => u.id === selected.id
          ? { ...u, isLocked: latest.isLocked, lockedUntil: latest.lockedUntil }
          : u),
        SAVED: s.SAVED.map((u) => u.id === selected.id
          ? { ...u, isLocked: latest.isLocked, lockedUntil: latest.lockedUntil }
          : u),
      }));
    } catch (error) {
      // Временная ошибка обновления не меняет текущий статус поля пароля.
    }
  }
  
  function commitUser(user, replaceId) {
    const id = replaceId == null ? user.id : replaceId;
    setState((s) => {
      const has = s.USERS.some((u) => u.id === id);
      return {
        USERS: has ? s.USERS.map((u) => (u.id === id ? clone(user) : u)) : [...s.USERS, clone(user)],
        SAVED: s.SAVED.some((u) => u.id === user.id)
          ? s.SAVED.map((u) => (u.id === user.id ? clone(user) : u))
          : [...s.SAVED, clone(user)],
        selId: s.selId === id ? user.id : s.selId,
        expandedId: s.expandedId === id ? user.id : s.expandedId,
      };
    });
  }
  async function reloadGroups() {
    const list = await api.get('/api/user-groups');
    setState((s) => ({ GROUPS: list.map((g) => toGroup(g, s.GROUPS.find((x) => x.id === g.id))) }));
  }

  
  function placedFired(u) {
    const base = savedOf(u.id);
    return base ? base.fired : u.fired;
  }
  function placedGroupId(u) {
    const base = savedOf(u.id);
    return base ? base.groupId : u.groupId;
  }

  


  const H = {};


  H.onToggleArchive = () => {
    const next = !state.showArchive;
    setState({ showArchive: next });
    showToast(next ? 'Архив уволенных показан' : 'Архив уволенных скрыт');
  };
  H.onSearchChange = (e) => setState({ search: e.target.value });
  H.onClearSearch = () => setState({ search: '' });
  H.onLogout = () => api.logout();

  H.onToggleGroup = (e) => {
    e.stopPropagation();
    const gid = Number(e.currentTarget.getAttribute('data-gid'));
    setState((s) => {
      const opening = (s.GROUPS.find((g) => g.id === gid) || {}).collapsed;
      return {
        GROUPS: s.GROUPS.map((g) => ({ ...g, collapsed: opening ? g.id !== gid : true })),
        activeGroupId: opening ? gid : null,
        ...clearSelection(s),
      };
    });
  };
  H.onRenameGroup = (e) => {
    e.stopPropagation();
    const gid = Number(e.currentTarget.getAttribute('data-gid'));
    const g = state.GROUPS.find((x) => x.id === gid);
    if (g) setState({ renamingGroupId: gid, renameOriginal: g.name });
  };
  H.onGroupNameChange = (e) => {
    const gid = Number(e.currentTarget.getAttribute('data-gid'));
    const name = e.target.value;
    setState((s) => ({ GROUPS: s.GROUPS.map((g) => (g.id === gid ? { ...g, name } : g)) }));
  };
  async function finishRename(cancel) {
    const gid = state.renamingGroupId;
    if (gid == null) return;
    const original = state.renameOriginal;
    const g = state.GROUPS.find((x) => x.id === gid);
    setState({ renamingGroupId: null });
    if (!g) return;
    const name = g.name.trim();
    const revert = () => setState((s) => ({ GROUPS: s.GROUPS.map((x) => (x.id === gid ? { ...x, name: original } : x)) }));
    if (cancel || !name) { revert(); return; }
    if (name === original) return;
    try {
      const saved = await api.put('/api/user-groups/' + gid, { name });
      setState((s) => ({ GROUPS: s.GROUPS.map((x) => (x.id === gid ? toGroup(saved, x) : x)) }));
      showToast('Группа переименована');
    } catch (err) {
      revert();
      showError(err);
    }
  }
  H.onGroupNameKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finishRename(false); }
    if (e.key === 'Escape') finishRename(true);
  };
  H.onGroupNameBlur = () => finishRename(false);
  H.onAddGroup = async () => {
    const names = new Set(state.GROUPS.map((g) => g.name.toLowerCase()));
    let name = 'Новая группа';
    for (let i = 2; names.has(name.toLowerCase()); i++) name = 'Новая группа ' + i;
    try {
      const created = await api.post('/api/user-groups', { name });
      const g = { ...toGroup(created), collapsed: false };
      setState((s) => ({
        GROUPS: [...s.GROUPS, g], renamingGroupId: g.id, renameOriginal: g.name,
        activeGroupId: g.id, ...clearSelection(s),
      }), () => {
        const input = document.querySelector('.group__name-input');
        if (input) {
          input.scrollIntoView({ block: 'center', behavior: 'smooth' });
          input.focus();
          input.select();
        }
      });
      showToast('Группа создана');
    } catch (err) {
      showError(err);
    }
  };
  H.onDeleteGroup = async (e) => {
    e.stopPropagation();
    const gid = Number(e.currentTarget.getAttribute('data-gid'));
    const g = state.GROUPS.find((x) => x.id === gid);
    if (!g) return;
    if (!window.confirm('Удалить группу «' + g.name + '»?')) return;
    try {
      await api.del('/api/user-groups/' + gid);
      setState((s) => ({ GROUPS: s.GROUPS.filter((x) => x.id !== gid) }));
      showToast('Группа удалена');
    } catch (err) {
      showError(err);
    }
  };

  function clearSelection(s) {
    return { USERS: revertUnsaved(s.USERS, s.SAVED, s.selId), selId: null, expandedId: null, detailsOpen: false, passVisible: false };
  }

  function revertUnsaved(users, saved, id) {
    if (id == null) return users;
    const base = saved.find((x) => x.id === id);
    if (!base) return users;
    const cur = users.find((x) => x.id === id);
    if (cur && JSON.stringify(cur) === JSON.stringify(base)) return users;
    return users.map((u) => (u.id === id ? clone(base) : u));
  }

  H.onSelectUser = (e) => {
    const id = Number(e.currentTarget.getAttribute('data-id'));
    const gid = Number(e.currentTarget.getAttribute('data-gid'));
    setState((s) => {
      const users = s.selId !== id ? revertUnsaved(s.USERS, s.SAVED, s.selId) : s.USERS;
      const picked = users.find((x) => x.id === id);
      return {
        USERS: users,
        activeGroupId: picked ? gid : s.activeGroupId,
        selId: id,
        expandedId: s.expandedId === id ? null : id,
        detailsOpen: s.expandedId === id ? s.detailsOpen : false,
        passVisible: false,
      };
    });
  };
  H.onToggleDetails = () => setState((s) => ({ detailsOpen: !s.detailsOpen }));
  H.onTogglePassVisible = () => setState((s) => ({ passVisible: !s.passVisible }));

  H.onCredLoginChange = (e) => patchSel({ login: e.target.value });
  H.onCredPasswordChange = (e) => patchSel({ password: e.target.value });
  H.onCredFioChange = (e) => patchSel({ fio: e.target.value });
  H.onCredGroupChange = (e) => patchSel({ groupId: Number(e.target.value) });
  H.onToggleFired = () => { const u = sel(); if (u && !isSystemAdmin(u)) patchSel({ fired: !u.fired }); };

  H.onRowToggleFired = async (e) => {
    e.stopPropagation();
    const id = Number(e.currentTarget.getAttribute('data-id'));
    const u = state.USERS.find((x) => x.id === id);
    if (!u || u.isNew || isSystemAdmin(u)) return;
    const next = !placedFired(u);
    try {
      const saved = await api.patch('/api/users/' + id + '/fired', { is_fired: next });
      commitUser(toUser(saved));
      reloadGroups().catch(() => {});
      showToast(next ? 'Отмечен как уволенный' : 'Признак увольнения снят');
    } catch (err) {
      showError(err);
    }
  };

  H.onCopy = (e) => {
    e.stopPropagation();
    const which = e.currentTarget.getAttribute('data-copy');
    const u = sel();
    if (!u) return;
    const val = which === 'login' ? u.login : u.password;
    if (which === 'password' && !val) {
      showToast('Пароль хранится только в виде хеша — введите новый пароль');
      return;
    }
    if (navigator.clipboard) navigator.clipboard.writeText(val).catch(() => {});
    showToast(which === 'login' ? 'Логин скопирован' : 'Пароль скопирован');
  };

  H.onToggleRight = (e) => {
    const g = activeGroup();
    if (!g || g.isArchive) { showToast('Раскройте рабочую группу'); return; }
    const k = e.currentTarget.getAttribute('data-key');
    patchGroup({ rights: { ...g.rights, [k]: !g.rights[k] } });
  };
  
  function allRightsOn(g) {
    const restrictive = new Set(restrictiveKeys());
    return !!g && rightKeys().every((k) => (restrictive.has(k) ? !g.rights[k] : g.rights[k]));
  }
  H.onToggleAllRights = () => {
    const g = activeGroup();
    if (!g || g.isArchive) { showToast('Раскройте рабочую группу'); return; }
    const restrictive = new Set(restrictiveKeys());
    const turnOn = !allRightsOn(g);
    const next = {};
    rightKeys().forEach((k) => { next[k] = restrictive.has(k) ? !turnOn : turnOn; });
    patchGroup({ rights: next });
  };

  let tempId = 0;
  H.onAddUser = () => {
    const s = state;
    const cur = sel();
    const active = s.GROUPS.find((g) => g.id === s.activeGroupId);
    if (active && active.isArchive) {
      showToast('В архив нельзя добавлять — отметьте сотрудника как уволенного');
      return;
    }
    const firstWorking = s.GROUPS.find((g) => !g.isArchive);
    const gid = (cur && !cur.isNew && cur.groupId) || (active && active.id) || (firstWorking && firstWorking.id);
    if (!gid) { showToast('Сначала создайте группу'); return; }
    const rights = { ...(s.GROUPS.find((g) => g.id === gid) || {}).rights };
    const id = --tempId;
    const gname = (s.GROUPS.find((g) => g.id === gid) || {}).name || '';
    setState({
      GROUPS: s.GROUPS.map((g) => (g.id === gid ? { ...g, collapsed: false } : g)),
      USERS: [...revertUnsaved(s.USERS, s.SAVED, s.selId),
        { id, groupId: gid, fio: '', profile: '', login: '', password: '', fired: false, rights, lockedUntil: null, isLocked: false, isNew: true }],
      selId: id, expandedId: id, detailsOpen: true, passVisible: false, activeGroupId: gid,
    });
    showToast('Новый сотрудник в группе «' + gname + '»');
  };

  H.onSave = async () => {
    const u = sel();
    const group = activeGroup();
    if (!u && (!group || group.isArchive)) { showToast('Раскройте рабочую группу'); return; }
    if (state.saving) return;
    setState({ saving: true });
    try {
      if (group && !group.isArchive && ((!group.configured && !u) || JSON.stringify(group.rights) !== JSON.stringify(group.savedRights))) {
        const rights = Object.keys(group.rights).filter((k) => group.rights[k]);
        await api.put('/api/user-groups/' + group.id + '/rights', { rights });
        setState((s) => ({ GROUPS: s.GROUPS.map((g) => g.id === group.id
          ? { ...g, savedRights: { ...g.rights }, configured: true } : g) }));
      }
      let saved = null;
      if (u && u.isNew) {
        saved = await api.post('/api/users', {
          fio: u.fio, login: u.login, password: u.password, profile: u.profile,
          group_id: u.groupId,
        });
      } else if (u) {
        const base = savedOf(u.id);
        const cardChanged = !base || u.fio !== base.fio || u.login !== base.login || u.profile !== base.profile ||
          u.groupId !== base.groupId || u.fired !== base.fired || !!u.password;
        if (cardChanged) {
          saved = await api.put('/api/users/' + u.id, {
            fio: u.fio, login: u.login, profile: u.profile, group_id: u.groupId,
            is_fired: u.fired, password: u.password || null,
          });
        }
      }
      setState({ saving: false });
      if (saved) commitUser(toUser(saved), u.id);
      reloadGroups().catch(() => {});
      showToast(u ? 'Сотрудник и права группы сохранены' : 'Права группы сохранены');
    } catch (err) {
      setState({ saving: false });
      showError(err);
    }
  };

  H.onDelete = async () => {
    const u = sel();
    if (!u) { showToast('Выберите сотрудника'); return; }
    if (!window.confirm('Удалить сотрудника «' + (u.fio || 'без имени') + '»?')) return;
    try {
      if (!u.isNew) await api.del('/api/users/' + u.id);
      setState((s) => ({
        USERS: s.USERS.filter((x) => x.id !== u.id),
        SAVED: s.SAVED.filter((x) => x.id !== u.id),
        selId: null, expandedId: null, detailsOpen: false,
      }));
      reloadGroups().catch(() => {});
      showToast('Сотрудник удалён');
    } catch (err) {
      showError(err);
    }
  };

  


  const switchEl = (on) => '<span class="switch' + (on ? ' is-on' : '') + '"><span class="switch__knob"></span></span>';

  const ICON = {
    chev: '<svg width="11" height="7" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevSm: '<svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pencil: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    check: '<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    eye: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5C7.5 5 3.8 8.1 2 12c1.8 3.9 5.5 7 10 7s8.2-3.1 10-7c-1.8-3.9-5.5-7-10-7z"/><circle cx="12" cy="12" r="3.2"/></svg>',
    eyeOff: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><circle cx="12" cy="12" r="3.2"/><line x1="1.5" y1="1.5" x2="22.5" y2="22.5"/></svg>',
  };

  


  function lockHint(u) {
    if (!u || u.isNew || !u.isLocked || !u.lockedUntil) return '';
    return '<div class="um-detail-row um-detail-row--warn" data-mk="dlock">' +
      '<span class="um-detail-label">Вход</span>' +
      '<span class="um-lock-status">заблокирован до ' + esc(OMSA.time.time(u.lockedUntil)) + '</span>' +
      '</div>';
  }

  function passwordDisabled(u) {
    return !!(u && !u.isNew && u.isLocked);
  }

  
  function detailHtml() {
    const s = state;
    const u = sel();
    const passwordLocked = passwordDisabled(u);
    const identityLocked = !!(u && u.fio === SYSTEM_ADMIN_FIO);
    const groupOptions = s.GROUPS
      .filter((g) => !g.isArchive)
      .map((g) => '<option value="' + g.id + '"' + (u && u.groupId === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>')
      .join('');

    const extra = !s.detailsOpen ? '' : (
      '<div class="um-detail-row um-expand" data-mk="dfio">' +
        '<span class="um-detail-label">ФИО</span>' +
        '<input class="um-detail-input" type="text" maxlength="150" data-input="onCredFioChange" placeholder="Фамилия Имя Отчество" value="' + esc(u ? u.fio : '') + '"' + (u && u.fio === SYSTEM_ADMIN_FIO ? ' disabled title="ФИО системной учётной записи изменить нельзя"' : '') + '>' +
      '</div>' +
      '<div class="um-detail-row um-expand" data-mk="dgroup">' +
        '<span class="um-detail-label">Группа</span>' +
        '<div class="select-wrap">' +
          '<select class="select-field" data-change="onCredGroupChange"' + (identityLocked ? ' disabled title="Группу системной учётной записи изменить нельзя"' : '') + '>' + groupOptions + '</select>' +
          '<span class="select-chev">' + ICON.chevSm + '</span>' +
        '</div>' +
      '</div>' +
      '<button class="fired-toggle um-expand" type="button" data-mk="dfired" data-click="onToggleFired"' + (u && u.isNew ? ' disabled title="Доступно после создания сотрудника"' : (identityLocked ? ' disabled title="Администратора системы нельзя уволить"' : '')) + '>' +
        '<span class="um-detail-label">Уволен</span>' +
        switchEl(!!(u && u.fired)) +
        '<span class="hint hint--sm">' + (u && u.fired ? 'запись не используется' : 'работает') + '</span>' +
      '</button>'
    );

    return '' +
      '<div class="um-detail um-expand" data-mk="detail">' +
        '<div class="um-detail-row" data-mk="dlogin">' +
          '<span class="um-detail-label">Логин</span>' +
          '<input class="um-detail-input" type="text" maxlength="100" autocomplete="off" data-input="onCredLoginChange" placeholder="Введите логин" value="' + esc(u ? u.login : '') + '"' + (identityLocked ? ' disabled title="Логин системной учётной записи изменить нельзя"' : '') + '>' +
          '<button class="um-icon um-icon--field" type="button" data-copy="login" data-click="onCopy" title="Скопировать логин">' + ICON.copy + '</button>' +
        '</div>' +

        '<div class="um-detail-row" data-mk="dpass">' +
          '<span class="um-detail-label">Пароль</span>' +
          '<input class="um-detail-input" type="' + (s.passVisible ? 'text' : 'password') + '" maxlength="256" autocomplete="new-password" data-input="onCredPasswordChange"' +
          (identityLocked ? ' disabled title="Пароль системной учётной записи изменить нельзя"' : (passwordLocked ? ' disabled title="Пароль можно изменить после окончания блокировки"' : '')) +
          ' placeholder="' + (identityLocked ? 'Изменение пароля запрещено' : (passwordLocked ? 'Доступно после окончания блокировки' : (u && u.isNew ? 'Введите пароль' : 'Введите новый пароль'))) + '" value="' + esc(u ? u.password : '') + '">' +
          '<button class="um-icon um-icon--field" type="button" data-click="onTogglePassVisible" title="Показать / скрыть"' + (passwordLocked || identityLocked ? ' disabled' : '') + '>' + (s.passVisible ? ICON.eyeOff : ICON.eye) + '</button>' +
          '<button class="um-icon um-icon--field" type="button" data-copy="password" data-click="onCopy" title="Скопировать пароль"' + (passwordLocked || identityLocked ? ' disabled' : '') + '>' + ICON.copy + '</button>' +
        '</div>' +

        lockHint(u) +
        extra +

        '<div class="detail-foot" data-mk="dfoot">' +
          '<button class="link-btn" type="button" data-click="onToggleDetails">' + (s.detailsOpen ? 'Свернуть' : 'Подробнее') + '</button>' +
          '<span class="hint">' + (s.detailsOpen ? 'ФИО, профиль, группа и признак увольнения' : 'Редактирование данных сотрудника') + '</span>' +
        '</div>' +
      '</div>';
  }

  
  function groupsHtml() {
    const s = state;
    const normalizeSearch = (value) => (value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
    const q = normalizeSearch(s.search);
    if (q.length === 1) return '<p class="group__empty">Введите минимум 2 символа для поиска</p>';
    const match = (u) => {
      if (!q) return true;
      const fio = normalizeSearch(u.fio);
      const fioMatch = q.includes(' ')
        ? fio.startsWith(q)
        : fio.split(/\s+/).includes(q);
      return fioMatch || normalizeSearch(u.login).startsWith(q);
    };

    const visibleGroups = s.showArchive ? s.GROUPS : s.GROUPS.filter((g) => !g.isArchive);

    const renderedGroups = visibleGroups.map((g) => {
      const users = s.USERS.filter((u) => match(u) && (g.isArchive
        ? placedFired(u)
        : !placedFired(u) && placedGroupId(u) === g.id));
      if (q && users.length === 0) return '';
      const open = q ? users.length > 0 : !g.collapsed;
      const countLabel = users.length + (q ? ' найдено' : users.length === 1 ? ' запись' : ' записей');

      const nameCell = s.renamingGroupId === g.id
        ? '<input class="group__name-input" type="text" maxlength="150" data-mk="gname" data-gid="' + g.id + '" data-input="onGroupNameChange" data-keydown="onGroupNameKeyDown" data-blur="onGroupNameBlur" value="' + esc(g.name) + '">'
        : '<span class="group__name" data-mk="gname">' + esc(g.name) + '</span>';

      let body = '';
      if (open) {
        body += '<div class="um-grid um-expand rows-head" data-mk="ghead2"><span class="um-indent">id</span><span>ФИО</span><span>Уволен</span></div>';

        body += users.map((u, idx) => {
          const rowCls = s.selId === u.id ? ' is-selected' : (idx % 2 === 1 ? ' is-alt' : '');
          let row =
            '<div class="um-row um-grid um-expand' + rowCls + '" data-mk="row" data-id="' + u.id + '" data-gid="' + g.id + '" data-click="onSelectUser">' +
              '<span class="um-indent cell-no">' + (u.isNew ? '—' : u.id) + '</span>' +
              '<span class="cell-fio' + (placedFired(u) ? ' is-fired' : '') + '">' + esc(u.fio || 'Новый сотрудник') + '</span>' +
              '<span class="cell-fired">' +
                '<button class="fired-box' + (placedFired(u) ? ' is-on' : '') + '" type="button" data-id="' + u.id + '" data-click="onRowToggleFired" title="' + (isSystemAdmin(u) ? 'Администратора системы нельзя уволить' : 'Переключить признак увольнения') + '"' + (isSystemAdmin(u) ? ' disabled' : '') + '>' +
                  (placedFired(u) ? ICON.check : '') +
                '</button>' +
              '</span>' +
            '</div>';
          if (s.expandedId === u.id) row += detailHtml();
          return '<div data-mk="u' + u.id + '">' + row + '</div>';
        }).join('');

        if (users.length === 0) body += '<p class="group__empty" data-mk="gempty">В группе нет записей</p>';
      }

      return '' +
        '<div class="group" data-mk="g' + g.id + '">' +
          '<div class="group__head" data-mk="ghead">' +
            '<button class="um-icon um-icon--chev" type="button" data-gid="' + g.id + '" data-click="onToggleGroup" title="Свернуть / развернуть">' +
              '<span class="um-chev' + (open ? '' : ' is-collapsed') + '">' + ICON.chev + '</span>' +
            '</button>' +
            nameCell +
            '<span class="group__count">' + countLabel + '</span>' +
            '<button class="um-icon" type="button" data-gid="' + g.id + '" data-click="onRenameGroup" title="Переименовать группу">' + ICON.pencil + '</button>' +
            (g.isArchive ? '' : '<button class="um-icon" type="button" data-gid="' + g.id + '" data-click="onDeleteGroup" title="Удалить группу">' + ICON.trash + '</button>') +
          '</div>' +
          body +
        '</div>';
    }).join('');
    return renderedGroups || (q ? '<p class="group__empty">Сотрудники не найдены</p>' : '');
  }

  
  function rightsHtml() {
    const g = activeGroup();
    const groupHasAdmin = !!g && groupHasSystemAdmin(g.id);
    const enabled = !!g && !g.isArchive;
    const allOn = enabled && allRightsOn(g);

    const groups = state.RIGHTS_TREE.map((section) =>
      '<div class="rights-group" data-mk="rg' + esc(section.title) + '">' +
        '<span class="rights-group__title">' + esc(section.title) + '</span>' +
        section.items.map((i) => {
          const on = !!(enabled && g.rights[i.key]);
          return '<button class="right-item" type="button" data-mk="ri' + i.key + '" data-key="' + i.key + '" data-click="onToggleRight"' + (enabled ? '' : ' disabled') + '>' +
            '<span class="right-item__text">' +
              '<span class="right-item__label">' + esc(i.label) + '</span>' +
              '<span class="right-item__desc">' + esc(i.desc) + '</span>' +
            '</span>' + switchEl(on) +
          '</button>';
        }).join('') +
      '</div>'
    ).join('');

    return '' +
      '<div class="rights-head" data-mk="rhead">' +
        '<span class="rights-head__title">Права пользователей</span>' +
        '<span class="rights-head__sub">' + esc(enabled ? g.name : 'Раскройте рабочую группу') + '</span>' +
      '</div>' +
      groups +
      '<button class="right-item right-item--all" type="button" data-mk="rall" data-click="onToggleAllRights"' + (enabled ? '' : ' disabled') + '>' +
        '<span class="right-item__text">' +
          '<span class="right-item__label">Полные права</span>' +
          '<span class="right-item__desc">Включает сразу все права выше и снимает ограничения журнала</span>' +
        '</span>' + switchEl(allOn) +
      '</button>' +
      '<p class="rights-note" data-mk="rnote">' + (enabled
        ? (groupHasAdmin
          ? 'Права сохраняются для группы и применяются ко всем её сотрудникам, кроме «Администратора системы».'
          : (g.configured ? 'Права применяются ко всем сотрудникам группы после нажатия «Сохранить».' : 'Права группы ещё не заданы. Измените нужные переключатели и сохраните общие права для всей группы.'))
        : 'Раскройте группу, чтобы назначить права всем её сотрудникам.') + '</p>';
  }

  


  const { patch, bindEvents } = OMSA.createRenderer(H);

  const elGroups = document.getElementById('groups');
  const elRights = document.getElementById('rights');
  const elSearch = document.getElementById('search');
  const elClear = document.getElementById('searchClear');
  const elDelete = document.getElementById('btnDelete');
  const elArchive = document.getElementById('btnArchive');
  const elToast = document.getElementById('toast');

  function render() {
    if (!state.loaded) return;
    if (window.OMSA_LOGIN_LOADING) window.OMSA_LOGIN_LOADING.hide();
    const u = sel();

    if (elSearch.value !== state.search) elSearch.value = state.search;
    elClear.classList.toggle('is-visible', state.search.length > 0);

    elDelete.classList.toggle('is-off', !u || u.fio === SYSTEM_ADMIN_FIO);
    elArchive.classList.toggle('is-on', state.showArchive);
    elArchive.title = state.showArchive ? 'Скрыть архив уволенных' : 'Показать архив уволенных';

    patch(elGroups, groupsHtml());
    patch(elRights, rightsHtml());

    elToast.textContent = state.toast || '';
    elToast.classList.toggle('is-visible', !!state.toast);
  }

  


  async function bootstrap() {
    try {
      await api.refresh();
    } catch (e) {
      api.redirectToLogin();
      return;
    }
    try {
      const [refs, groups, users] = await Promise.all([
        api.get('/api/references'), api.get('/api/user-groups'), api.get('/api/users'),
      ]);
      state.RIGHTS_TREE = refs.rights_tree;
      const list = users.map(toUser);
      setState({
        loaded: true,
        GROUPS: groups.map((g) => toGroup(g)),
        USERS: list.map(clone),
        SAVED: list.map(clone),
      });
      setInterval(refreshSelectedLock, 15000);
    } catch (err) {
      setState({ loaded: true });
      showError(err);
    }
  }

  bindEvents(document);
  bootstrap();
})();
