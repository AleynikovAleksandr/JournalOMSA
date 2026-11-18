(function () {
  'use strict';

  class UserManagementApp {

    OMSA = window.OMSA;
    esc = this.OMSA.esc;
    api = new this.OMSA.ApiClient({ loginUrl: '/login' });
    SYSTEM_ADMIN_FIO = 'Администратор системы';

    rightsMap(list) {
      const map = {};
      this.state.RIGHTS_TREE.forEach((g) => g.items.forEach((i) => { map[i.key] = false; }));
      (list || []).forEach((k) => { map[k] = true; });
      return map;
    }
    toUser = (u) => ({
      id: u.id, groupId: u.group_id, fio: u.fio, profile: u.profile || '', login: u.login,
      password: '', fired: u.is_fired, rights: this.rightsMap(u.rights), rightsOverridden: !!u.rights_overridden,
      rightsEdited: false,
      lockedUntilLabel: u.locked_until_label, isLocked: u.is_locked, isNew: false,
    });
    toGroup = (g, prev) => ({
      id: g.id, name: g.name, isArchive: g.is_archive, members: g.members,
      rights: this.rightsMap(g.rights), savedRights: this.rightsMap(g.rights), configured: g.rights_configured,
      collapsed: prev ? prev.collapsed : true,
    });
    clone = (u) => ({ ...u, rights: { ...u.rights } });
    rightsGroupName() {
      const user = this.sel();
      const group = user
        ? this.state.GROUPS.find((item) => item.id === user.groupId)
        : this.activeGroup();
      return group ? group.name : '';
    }
    rightKeys = () => this.state.RIGHTS_TREE.flatMap((g) => g.items
      .filter((i) => !i.admin_only || this.rightsGroupName() === 'Администраторы')
      .map((i) => i.key));
    restrictiveKeys = () => this.state.RIGHTS_TREE.flatMap((g) => g.items.filter((i) => i.restrictive).map((i) => i.key));

    state = {
      loaded: false,
      GROUPS: [], USERS: [], SAVED: [], RIGHTS_TREE: [],
      activeGroupId: null,
      search: '', selId: null, expandedId: null, detailsOpen: false,
      passVisible: false, groupPickerOpen: false, groupPickerAbove: false,
      renamingGroupId: null, renameOriginal: '', toast: null, showArchive: false,
      saving: false,
    };

    setState(patch, cb) {
      Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch);
      this.render();
      if (cb) cb();
    }

    toastTimer = null;
    showToast(msg) {
      clearTimeout(this.toastTimer);
      this.setState({ toast: msg });
      this.toastTimer = setTimeout(() => this.setState({ toast: null }), 2200);
    }
    showError = (err) => this.showToast((err && err.message) || 'Ошибка сервера');

    sel() { return this.state.USERS.find((u) => u.id === this.state.selId) || null; }
    activeGroup() { return this.state.GROUPS.find((g) => g.id === this.state.activeGroupId) || null; }
    isSystemAdmin(u) { return !!u && u.fio === this.SYSTEM_ADMIN_FIO; }
    groupHasSystemAdmin(groupId) {
      return this.state.USERS.some((u) => !u.isNew && u.groupId === groupId && this.isSystemAdmin(u));
    }
    patchGroup(patch) {
      this.setState((s) => ({ GROUPS: s.GROUPS.map((g) => g.id === s.activeGroupId ? { ...g, ...patch } : g) }));
    }
    savedOf(id) { return this.state.SAVED.find((u) => u.id === id) || null; }
    patchSel(patch) {
      this.setState((s) => ({ USERS: s.USERS.map((u) => (u.id === s.selId ? { ...u, ...patch } : u)) }));
    }

    async refreshSelectedLock() {
      const selected = this.sel();
      if (!selected || selected.isNew || !selected.isLocked) return;
      try {
        const latest = this.toUser(await this.api.get('/api/users/' + selected.id));
        this.setState((s) => ({
          USERS: s.USERS.map((u) => u.id === selected.id
            ? { ...u, isLocked: latest.isLocked, lockedUntilLabel: latest.lockedUntilLabel }
            : u),
          SAVED: s.SAVED.map((u) => u.id === selected.id
            ? { ...u, isLocked: latest.isLocked, lockedUntilLabel: latest.lockedUntilLabel }
            : u),
        }));
      } catch (error) {
        // Временная ошибка обновления не меняет текущий статус поля пароля.
      }
    }

    commitUser(user, replaceId) {
      const id = replaceId == null ? user.id : replaceId;
      this.setState((s) => {
        const has = s.USERS.some((u) => u.id === id);
        return {
          USERS: has ? s.USERS.map((u) => (u.id === id ? this.clone(user) : u)) : [...s.USERS, this.clone(user)],
          SAVED: s.SAVED.some((u) => u.id === user.id)
            ? s.SAVED.map((u) => (u.id === user.id ? this.clone(user) : u))
            : [...s.SAVED, this.clone(user)],
          selId: s.selId === id ? user.id : s.selId,
          expandedId: s.expandedId === id ? user.id : s.expandedId,
        };
      });
    }
    async reloadGroups() {
      const list = await this.api.get('/api/user-groups');
      this.setState((s) => ({ GROUPS: list.map((g) => this.toGroup(g, s.GROUPS.find((x) => x.id === g.id))) }));
    }

    placedFired(u) {
      const base = this.savedOf(u.id);
      return base ? base.fired : u.fired;
    }
    placedGroupId(u) {
      const base = this.savedOf(u.id);
      return base ? base.groupId : u.groupId;
    }

    async saveFired(id, next) {
      const saved = this.toUser(await this.api.patch('/api/users/' + id + '/fired', { is_fired: next }));
      // Update only this field so an unrelated, unsaved edit in the open card survives.
      this.setState((s) => ({
        USERS: s.USERS.map((u) => u.id === id ? { ...u, fired: saved.fired } : u),
        SAVED: s.SAVED.map((u) => u.id === id ? { ...u, fired: saved.fired } : u),
      }));
      this.reloadGroups().catch(() => {});
      this.showToast(next ? 'Пользователь отмечен как уволенный' : 'Признак увольнения снят');
    }

    onToggleArchive = () => {
      const next = !this.state.showArchive;
      this.setState({ showArchive: next });
      this.showToast(next ? 'Архив уволенных показан' : 'Архив уволенных скрыт');
    };
    onSearchChange = (e) => this.setState({ search: e.target.value });
    onClearSearch = () => this.setState({ search: '' });
    onLogout = () => this.api.logout();

    onToggleGroup = (e) => {
      e.stopPropagation();
      const gid = Number(e.currentTarget.getAttribute('data-gid'));
      this.setState((s) => {
        const opening = (s.GROUPS.find((g) => g.id === gid) || {}).collapsed;
        return {
          GROUPS: s.GROUPS.map((g) => ({ ...g, collapsed: opening ? g.id !== gid : true })),
          activeGroupId: opening ? gid : null,
          groupPickerOpen: false,
          ...this.clearSelection(s),
        };
      });
    };
    onRenameGroup = (e) => {
      e.stopPropagation();
      const gid = Number(e.currentTarget.getAttribute('data-gid'));
      const g = this.state.GROUPS.find((x) => x.id === gid);
      if (g && g.name !== 'Администраторы') {
        this.setState({ renamingGroupId: gid, renameOriginal: g.name }, () => {
          const input = this.elGroups.querySelector('.group__name-input[data-gid="' + gid + '"]');
          if (input) {
            input.focus();
            input.select();
          }
        });
      }
    };
    onGroupNameChange = (e) => {
      const gid = Number(e.currentTarget.getAttribute('data-gid'));
      const name = e.target.value;
      this.setState((s) => ({ GROUPS: s.GROUPS.map((g) => (g.id === gid ? { ...g, name } : g)) }));
    };
    async finishRename(cancel) {
      const gid = this.state.renamingGroupId;
      if (gid == null) return;
      const original = this.state.renameOriginal;
      const g = this.state.GROUPS.find((x) => x.id === gid);
      this.setState({ renamingGroupId: null });
      if (!g) return;
      const name = g.name.trim();
      const revert = () => this.setState((s) => ({ GROUPS: s.GROUPS.map((x) => (x.id === gid ? { ...x, name: original } : x)) }));
      if (cancel || !name) { revert(); return; }
      if (name === original) return;
      try {
        const saved = await this.api.put('/api/user-groups/' + gid, { name });
        this.setState((s) => ({ GROUPS: s.GROUPS.map((x) => (x.id === gid ? this.toGroup(saved, x) : x)) }));
        this.showToast('Группа переименована');
      } catch (err) {
        revert();
        this.showError(err);
      }
    }
    onGroupNameKeyDown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.finishRename(false); }
      if (e.key === 'Escape') this.finishRename(true);
    };
    onGroupNameBlur = () => this.finishRename(false);
    onAddGroup = async () => {
      const names = new Set(this.state.GROUPS.map((g) => g.name.toLowerCase()));
      let name = 'Новая группа';
      for (let i = 2; names.has(name.toLowerCase()); i++) name = 'Новая группа ' + i;
      try {
        const created = await this.api.post('/api/user-groups', { name });
        const g = { ...this.toGroup(created), collapsed: false };
        this.setState((s) => ({
          GROUPS: [...s.GROUPS, g], renamingGroupId: g.id, renameOriginal: g.name,
          activeGroupId: g.id, ...this.clearSelection(s),
        }), () => {
          const input = document.querySelector('.group__name-input');
          if (input) {
            input.scrollIntoView({ block: 'center', behavior: 'smooth' });
            input.focus();
            input.select();
          }
        });
        this.showToast('Группа создана');
      } catch (err) {
        this.showError(err);
      }
    };
    onDeleteGroup = async (e) => {
      e.stopPropagation();
      const gid = Number(e.currentTarget.getAttribute('data-gid'));
      const g = this.state.GROUPS.find((x) => x.id === gid);
      if (!g) return;
      if (!window.confirm('Удалить группу «' + g.name + '»?')) return;
      try {
        await this.api.del('/api/user-groups/' + gid);
        this.setState((s) => ({ GROUPS: s.GROUPS.filter((x) => x.id !== gid) }));
        this.showToast('Группа удалена');
      } catch (err) {
        this.showError(err);
      }
    };

    clearSelection(s) {
      return { USERS: this.revertUnsaved(s.USERS, s.SAVED, s.selId), selId: null, expandedId: null, detailsOpen: false, passVisible: false };
    }

    revertUnsaved(users, saved, id) {
      if (id == null) return users;
      const base = saved.find((x) => x.id === id);
      if (!base) return users;
      const cur = users.find((x) => x.id === id);
      if (cur && JSON.stringify(cur) === JSON.stringify(base)) return users;
      return users.map((u) => (u.id === id ? this.clone(base) : u));
    }

    onSelectUser = (e) => {
      const id = Number(e.currentTarget.getAttribute('data-id'));
      const gid = Number(e.currentTarget.getAttribute('data-gid'));
      this.setState((s) => {
        const users = s.selId !== id ? this.revertUnsaved(s.USERS, s.SAVED, s.selId) : s.USERS;
        const picked = users.find((x) => x.id === id);
        return {
          USERS: users,
          activeGroupId: picked ? gid : s.activeGroupId,
          selId: id,
          expandedId: s.expandedId === id ? null : id,
          detailsOpen: s.expandedId === id ? s.detailsOpen : false,
          passVisible: false, groupPickerOpen: false,
        };
      });
    };
    onToggleDetails = () => this.setState((s) => ({ detailsOpen: !s.detailsOpen, groupPickerOpen: false }));
    onTogglePassVisible = () => this.setState((s) => ({ passVisible: !s.passVisible }));

    onCredLoginChange = (e) => this.patchSel({ login: e.target.value });
    onCredPasswordChange = (e) => this.patchSel({ password: e.target.value });
    onCredFioChange = (e) => this.patchSel({ fio: e.target.value });
    onToggleGroupPicker = (e) => {
      e.stopPropagation();
      if (this.state.groupPickerOpen) { this.setState({ groupPickerOpen: false }); return; }
      const rect = e.currentTarget.getBoundingClientRect();
      this.setState({ groupPickerOpen: true, groupPickerAbove: window.innerHeight - rect.bottom < 230 && rect.top > 230 }, () => {
        const selected = document.querySelector('.group-select__item.is-selected');
        (selected || document.querySelector('.group-select__item'))?.focus();
      });
    };
    onGroupPickerKeyDown = (e) => {
      if (e.key === 'Escape' && this.state.groupPickerOpen) {
        e.preventDefault();
        this.setState({ groupPickerOpen: false }, () => document.querySelector('.group-select__trigger')?.focus());
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      if (!this.state.groupPickerOpen) { this.onToggleGroupPicker(e); return; }
      const items = [...document.querySelectorAll('.group-select__item')];
      if (!items.length) return;
      const current = items.indexOf(document.activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
        : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    };
    onPickGroup = (e) => {
      e.stopPropagation();
      const groupId = Number(e.currentTarget.getAttribute('data-gid'));
      const group = this.state.GROUPS.find((g) => g.id === groupId);
      if (!group || group.isArchive) return;
      if (this.sel()?.groupId === groupId) {
        this.setState({ groupPickerOpen: false }, () => document.querySelector('.group-select__trigger')?.focus());
        return;
      }
      this.setState((s) => ({
        USERS: s.USERS.map((u) => u.id === s.selId
          ? { ...u, groupId, rights: { ...group.rights }, rightsOverridden: false, rightsEdited: false }
          : u),
        groupPickerOpen: false,
      }), () => document.querySelector('.group-select__trigger')?.focus());
    };
    onToggleFired = async (e) => {
      if (e) e.stopPropagation();
      const u = this.sel();
      if (!u || u.isNew || this.isSystemAdmin(u)) return;
      try {
        await this.saveFired(u.id, !u.fired);
      } catch (err) {
        this.showError(err);
      }
    };

    onRowToggleFired = async (e) => {
      e.stopPropagation();
      const id = Number(e.currentTarget.getAttribute('data-id'));
      const u = this.state.USERS.find((x) => x.id === id);
      if (!u || u.isNew || this.isSystemAdmin(u)) return;
      try {
        await this.saveFired(id, !this.placedFired(u));
      } catch (err) {
        this.showError(err);
      }
    };

    onCopy = (e) => {
      e.stopPropagation();
      const which = e.currentTarget.getAttribute('data-copy');
      const u = this.sel();
      if (!u) return;
      const val = which === 'login' ? u.login : u.password;
      if (which === 'password' && !val) {
        this.showToast('Пароль хранится только в виде хеша — введите новый пароль');
        return;
      }
      if (navigator.clipboard) navigator.clipboard.writeText(val).catch(() => {});
      this.showToast(which === 'login' ? 'Логин скопирован' : 'Пароль скопирован');
    };

    onToggleRight = (e) => {
      const u = this.sel();
      const k = e.currentTarget.getAttribute('data-key');
      if (!this.rightKeys().includes(k)) return;
      if (u) {
        if (u.isNew || this.isSystemAdmin(u)) return;
        this.patchSel({ rights: { ...u.rights, [k]: !u.rights[k] }, rightsEdited: true });
        return;
      }
      const g = this.activeGroup();
      if (!g || g.isArchive) { this.showToast('Раскройте рабочую группу'); return; }
      this.patchGroup({ rights: { ...g.rights, [k]: !g.rights[k] } });
    };
    onRightInfo = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    allRightsOn(rights) {
      const restrictive = new Set(this.restrictiveKeys());
      return !!rights && this.rightKeys().every((k) => (restrictive.has(k) ? !rights[k] : rights[k]));
    }
    onToggleAllRights = () => {
      const u = this.sel();
      const g = this.activeGroup();
      if (this.rightsGroupName() !== 'Администраторы') return;
      if (u ? (u.isNew || this.isSystemAdmin(u)) : (!g || g.isArchive)) return;
      const restrictive = new Set(this.restrictiveKeys());
      const turnOn = !this.allRightsOn(u ? u.rights : g.rights);
      const next = {};
      this.rightKeys().forEach((k) => { next[k] = restrictive.has(k) ? !turnOn : turnOn; });
      if (u) this.patchSel({ rights: next, rightsEdited: true });
      else this.patchGroup({ rights: next });
    };
    onResetUserRights = async () => {
      const u = this.sel();
      if (!u || u.isNew || this.isSystemAdmin(u) || !u.rightsOverridden) return;
      try {
        const restored = this.toUser(await this.api.del('/api/users/' + u.id + '/rights'));
        this.setState((s) => ({
          USERS: s.USERS.map((item) => item.id === u.id
            ? { ...item, rights: { ...restored.rights }, rightsOverridden: false, rightsEdited: false } : item),
          SAVED: s.SAVED.map((item) => item.id === u.id
            ? { ...item, rights: { ...restored.rights }, rightsOverridden: false, rightsEdited: false } : item),
        }));
        this.showToast('Права группы восстановлены');
      } catch (err) { this.showError(err); }
    };

    tempId = 0;
    onAddUser = () => {
      const s = this.state;
      const cur = this.sel();
      const active = s.GROUPS.find((g) => g.id === s.activeGroupId);
      if (active && active.isArchive) {
        this.showToast('В архив нельзя добавлять — отметьте сотрудника как уволенного');
        return;
      }
      const firstWorking = s.GROUPS.find((g) => !g.isArchive);
      const gid = (cur && !cur.isNew && cur.groupId) || (active && active.id) || (firstWorking && firstWorking.id);
      if (!gid) { this.showToast('Сначала создайте группу'); return; }
      const rights = { ...(s.GROUPS.find((g) => g.id === gid) || {}).rights };
      const id = --this.tempId;
      const gname = (s.GROUPS.find((g) => g.id === gid) || {}).name || '';
      this.setState({
        GROUPS: s.GROUPS.map((g) => (g.id === gid ? { ...g, collapsed: false } : g)),
        USERS: [...this.revertUnsaved(s.USERS, s.SAVED, s.selId),
          { id, groupId: gid, fio: '', profile: '', login: '', password: '', fired: false, rights, rightsOverridden: false, rightsEdited: false, lockedUntilLabel: null, isLocked: false, isNew: true }],
        selId: id, expandedId: id, detailsOpen: true, passVisible: false,
        groupPickerOpen: false, activeGroupId: gid,
      });
      this.showToast('Новый сотрудник в группе «' + gname + '»');
    };

    onSave = async () => {
      const u = this.sel();
      const group = this.activeGroup();
      if (!u && (!group || group.isArchive)) { this.showToast('Раскройте рабочую группу'); return; }
      if (this.state.saving) return;
      this.setState({ saving: true, groupPickerOpen: false });
      try {
        if (!u && group && !group.isArchive && (!group.configured || JSON.stringify(group.rights) !== JSON.stringify(group.savedRights))) {
          const allowed = new Set(this.rightKeys());
          const rights = Object.keys(group.rights).filter((k) => allowed.has(k) && group.rights[k]);
          await this.api.put('/api/user-groups/' + group.id + '/rights', { rights });
          this.setState((s) => ({ GROUPS: s.GROUPS.map((g) => g.id === group.id
            ? { ...g, savedRights: { ...g.rights }, configured: true } : g) }));
          const users = (await this.api.get('/api/users')).map(this.toUser);
          this.setState({ USERS: users.map(this.clone), SAVED: users.map(this.clone) });
        }
        let saved = null;
        if (u && u.isNew) {
          saved = await this.api.post('/api/users', {
            fio: u.fio, login: u.login, password: u.password, profile: u.profile,
            group_id: u.groupId,
          });
        } else if (u) {
          const base = this.savedOf(u.id);
          const cardChanged = !base || u.fio !== base.fio || u.login !== base.login || u.profile !== base.profile ||
            u.groupId !== base.groupId || u.fired !== base.fired || !!u.password;
          if (cardChanged) {
            saved = await this.api.put('/api/users/' + u.id, {
              fio: u.fio, login: u.login, profile: u.profile, group_id: u.groupId,
              is_fired: u.fired, password: u.password || null,
            });
          }
          if (u.rightsEdited) {
            const allowed = new Set(this.rightKeys());
            const rights = Object.keys(u.rights).filter((k) => allowed.has(k) && u.rights[k]);
            saved = await this.api.put('/api/users/' + u.id + '/rights', { rights });
          }
        }
        this.setState({ saving: false });
        if (saved) this.commitUser(this.toUser(saved), u.id);
        this.reloadGroups().catch(() => {});
        this.showToast(u ? (u.rightsEdited ? 'Личные права сотрудника сохранены' : 'Сотрудник сохранён') : 'Права группы сохранены');
      } catch (err) {
        this.setState({ saving: false });
        this.showError(err);
      }
    };

    onDelete = async () => {
      const u = this.sel();
      if (!u) { this.showToast('Выберите сотрудника'); return; }
      if (!window.confirm('Удалить сотрудника «' + (u.fio || 'без имени') + '»?')) return;
      try {
        if (!u.isNew) await this.api.del('/api/users/' + u.id);
        this.setState((s) => ({
          USERS: s.USERS.filter((x) => x.id !== u.id),
          SAVED: s.SAVED.filter((x) => x.id !== u.id),
          selId: null, expandedId: null, detailsOpen: false, groupPickerOpen: false,
        }));
        this.reloadGroups().catch(() => {});
        this.showToast('Сотрудник удалён');
      } catch (err) {
        this.showError(err);
      }
    };

    switchEl = (on) => '<span class="switch' + (on ? ' is-on' : '') + '"><span class="switch__knob"></span></span>';

    ICON = {
      chev: '<svg width="11" height="7" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      chevSm: '<svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      pencil: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
      check: '<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      checkList: '<svg width="13" height="10" viewBox="0 0 13 10" fill="none" aria-hidden="true"><path d="M1 5L4.5 8.5L12 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      eye: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5C7.5 5 3.8 8.1 2 12c1.8 3.9 5.5 7 10 7s8.2-3.1 10-7c-1.8-3.9-5.5-7-10-7z"/><circle cx="12" cy="12" r="3.2"/></svg>',
      eyeOff: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><circle cx="12" cy="12" r="3.2"/><line x1="1.5" y1="1.5" x2="22.5" y2="22.5"/></svg>',
    };

    lockHint(u) {
      if (!u || u.isNew || !u.isLocked || !u.lockedUntilLabel) return '';
      return '<div class="um-detail-row um-detail-row--warn" data-mk="dlock">' +
        '<span class="um-detail-label">Вход</span>' +
        '<span class="um-lock-status">заблокирован до ' + this.esc(u.lockedUntilLabel) + '</span>' +
        '</div>';
    }

    passwordDisabled(u) {
      return !!(u && !u.isNew && u.isLocked);
    }

    detailHtml() {
      const s = this.state;
      const u = this.sel();
      const passwordLocked = this.passwordDisabled(u);
      const identityLocked = !!(u && u.fio === this.SYSTEM_ADMIN_FIO);
      const selectedGroup = s.GROUPS.find((g) => u && g.id === u.groupId);
      const groupOptions = s.GROUPS.filter((g) => !g.isArchive)
        .map((g) => {
          const selected = !!u && u.groupId === g.id;
          return '<button class="group-select__item' + (selected ? ' is-selected' : '') + '" type="button" role="option" aria-selected="' + selected + '" data-gid="' + g.id + '" data-click="onPickGroup" data-keydown="onGroupPickerKeyDown">' +
            '<span class="group-select__item-text">' + this.esc(g.name) + '</span>' + (selected ? this.ICON.checkList : '') + '</button>';
        }).join('');

      const extra = !s.detailsOpen ? '' : (
        '<div class="um-detail-row um-expand" data-mk="dfio">' +
          '<span class="um-detail-label">ФИО</span>' +
          '<input class="um-detail-input" type="text" maxlength="150" data-input="onCredFioChange" placeholder="Фамилия Имя Отчество" value="' + this.esc(u ? u.fio : '') + '"' + (u && u.fio === this.SYSTEM_ADMIN_FIO ? ' disabled title="ФИО системной учётной записи изменить нельзя"' : '') + '>' +
        '</div>' +
        '<div class="um-detail-row um-expand" data-mk="dgroup">' +
          '<span class="um-detail-label">Группа</span>' +
          '<div class="group-select' + (s.groupPickerOpen ? ' is-open' : '') + '">' +
            '<button class="group-select__trigger" type="button" aria-label="Группа сотрудника: ' + this.esc(selectedGroup ? selectedGroup.name : 'не выбрана') + '" aria-haspopup="listbox" aria-expanded="' + s.groupPickerOpen + '" aria-controls="um-group-options" data-click="onToggleGroupPicker" data-keydown="onGroupPickerKeyDown"' + (identityLocked ? ' disabled title="Группу системной учётной записи изменить нельзя"' : '') + '>' +
              '<span class="group-select__value">' + this.esc(selectedGroup ? selectedGroup.name : 'Выберите группу') + '</span>' +
              '<span class="group-select__chev">' + this.ICON.chevSm + '</span>' +
            '</button>' +
            (s.groupPickerOpen && !identityLocked
              ? '<div class="group-select__menu' + (s.groupPickerAbove ? ' is-above' : '') + '" id="um-group-options" role="listbox" aria-label="Выбор группы">' +
                  (groupOptions || '<span class="group-select__empty">Нет доступных групп</span>') + '</div>'
              : '') +
          '</div>' +
        '</div>' +
        '<button class="fired-toggle um-expand" type="button" data-mk="dfired" data-click="onToggleFired"' + (u && u.isNew ? ' disabled title="Доступно после создания сотрудника"' : (identityLocked ? ' disabled title="Администратора системы нельзя уволить"' : '')) + '>' +
          '<span class="um-detail-label">Уволен</span>' +
          this.switchEl(!!(u && u.fired)) +
          '<span class="hint hint--sm">' + (u && u.fired ? 'запись не используется' : 'работает') + '</span>' +
        '</button>'
      );

      return '' +
        '<div class="um-detail um-expand" data-mk="detail">' +
          '<div class="um-detail-row" data-mk="dlogin">' +
            '<span class="um-detail-label">Логин</span>' +
            '<input class="um-detail-input" type="text" maxlength="100" autocomplete="off" data-input="onCredLoginChange" placeholder="Введите логин" value="' + this.esc(u ? u.login : '') + '"' + (identityLocked ? ' disabled title="Логин системной учётной записи изменить нельзя"' : '') + '>' +
            '<button class="um-icon um-icon--field" type="button" data-copy="login" data-click="onCopy" title="Скопировать логин">' + this.ICON.copy + '</button>' +
          '</div>' +

          '<div class="um-detail-row" data-mk="dpass">' +
            '<span class="um-detail-label">Пароль</span>' +
            '<input class="um-detail-input" type="' + (s.passVisible ? 'text' : 'password') + '" maxlength="256" autocomplete="new-password" data-input="onCredPasswordChange"' +
            (identityLocked ? ' disabled title="Пароль системной учётной записи изменить нельзя"' : (passwordLocked ? ' disabled title="Пароль можно изменить после окончания блокировки"' : '')) +
            ' placeholder="' + (identityLocked ? 'Изменение пароля запрещено' : (passwordLocked ? 'Доступно после окончания блокировки' : (u && u.isNew ? 'Введите пароль' : 'Введите новый пароль'))) + '" value="' + this.esc(u ? u.password : '') + '">' +
            '<button class="um-icon um-icon--field" type="button" data-click="onTogglePassVisible" title="Показать / скрыть"' + (passwordLocked || identityLocked ? ' disabled' : '') + '>' + (s.passVisible ? this.ICON.eyeOff : this.ICON.eye) + '</button>' +
            '<button class="um-icon um-icon--field" type="button" data-copy="password" data-click="onCopy" title="Скопировать пароль"' + (passwordLocked || identityLocked ? ' disabled' : '') + '>' + this.ICON.copy + '</button>' +
          '</div>' +

          this.lockHint(u) +
          extra +

          '<div class="detail-foot" data-mk="dfoot">' +
            '<button class="link-btn" type="button" data-click="onToggleDetails">' + (s.detailsOpen ? 'Свернуть' : 'Подробнее') + '</button>' +
            '<span class="hint">' + (s.detailsOpen ? 'ФИО, профиль, группа и признак увольнения' : 'Редактирование данных сотрудника') + '</span>' +
          '</div>' +
        '</div>';
    }

    groupsHtml() {
      const s = this.state;
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
          ? this.placedFired(u)
          : !this.placedFired(u) && this.placedGroupId(u) === g.id));
        if (q && users.length === 0) return '';
        const open = q ? users.length > 0 : !g.collapsed;
        const countLabel = users.length + (q ? ' найдено' : users.length === 1 ? ' запись' : ' записей');

        const nameCell = s.renamingGroupId === g.id
          ? '<input class="group__name-input" type="text" maxlength="150" data-mk="gname" data-gid="' + g.id + '" data-input="onGroupNameChange" data-keydown="onGroupNameKeyDown" data-blur="onGroupNameBlur" value="' + this.esc(g.name) + '">'
          : '<span class="group__name" data-mk="gname">' + this.esc(g.name) + '</span>';

        let body = '';
        if (open) {
          body += '<div class="um-grid um-expand rows-head" data-mk="ghead2"><span>ФИО</span><span>Уволен</span></div>';

          body += users.map((u, idx) => {
            const rowCls = s.selId === u.id ? ' is-selected' : (idx % 2 === 1 ? ' is-alt' : '');
            let row =
              '<div class="um-row um-grid um-expand' + rowCls + '" data-mk="row" data-id="' + u.id + '" data-gid="' + g.id + '" data-click="onSelectUser">' +
                '<span class="cell-fio' + (this.placedFired(u) ? ' is-fired' : '') + '">' + this.esc(u.fio || 'Новый сотрудник') + '</span>' +
                '<span class="cell-fired">' +
                  '<button class="fired-box' + (this.placedFired(u) ? ' is-on' : '') + '" type="button" data-id="' + u.id + '" data-click="onRowToggleFired" title="' + (this.isSystemAdmin(u) ? 'Администратора системы нельзя уволить' : 'Переключить признак увольнения') + '"' + (this.isSystemAdmin(u) ? ' disabled' : '') + '>' +
                    (this.placedFired(u) ? this.ICON.check : '') +
                  '</button>' +
                '</span>' +
              '</div>';
            if (s.expandedId === u.id) row += this.detailHtml();
            return '<div data-mk="u' + u.id + '">' + row + '</div>';
          }).join('');

          if (users.length === 0) body += '<p class="group__empty" data-mk="gempty">В группе нет записей</p>';
        }

        return '' +
          '<div class="group' + (s.groupPickerOpen && s.detailsOpen && s.expandedId === s.selId && s.activeGroupId === g.id ? ' group--picker-open' : '') + '" data-mk="g' + g.id + '">' +
            '<div class="group__head" data-mk="ghead">' +
              '<button class="um-icon um-icon--chev" type="button" data-gid="' + g.id + '" data-click="onToggleGroup" title="Свернуть / развернуть">' +
                '<span class="um-chev' + (open ? '' : ' is-collapsed') + '">' + this.ICON.chev + '</span>' +
              '</button>' +
              nameCell +
              '<span class="group__count">' + countLabel + '</span>' +
              (g.name === 'Администраторы' ? '' : '<button class="um-icon" type="button" data-gid="' + g.id + '" data-click="onRenameGroup" title="Переименовать группу">' + this.ICON.pencil + '</button>') +
              (g.isArchive ? '' : '<button class="um-icon" type="button" data-gid="' + g.id + '" data-click="onDeleteGroup" title="Удалить группу">' + this.ICON.trash + '</button>') +
            '</div>' +
            body +
          '</div>';
      }).join('');
      return renderedGroups || (q ? '<p class="group__empty">Сотрудники не найдены</p>' : '');
    }

    rightsHtml() {
      const g = this.activeGroup();
      const u = this.sel();
      const groupHasAdmin = !!g && this.groupHasSystemAdmin(g.id);
      const enabled = u ? !u.isNew && !this.isSystemAdmin(u) : !!g && !g.isArchive;
      const shownRights = u ? u.rights : (g && g.rights);
      const allOn = enabled && this.allRightsOn(shownRights);

      const infoIcon = (details) => {
        const text = typeof details === 'string' && details.trim()
          ? details.trim()
          : 'Подробное описание этого права не загружено. Обновите страницу.';
        return '<span class="right-info" tabindex="0" role="img" aria-label="Как работает это право: ' + this.esc(text) + '" data-click="onRightInfo">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9.2" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="8" r="1.3" fill="currentColor"/><path d="M12 11.5V16.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
          '<span class="right-info__tooltip" role="tooltip"><span class="right-info__tooltip-title">Как работает это право</span><span class="right-info__tooltip-text">' + this.esc(text) + '</span></span>' +
        '</span>';
      };

      const visibleKeys = new Set(this.rightKeys());
      const groups = this.state.RIGHTS_TREE.map((section) =>
        '<div class="rights-group" data-mk="rg' + this.esc(section.title) + '">' +
          '<span class="rights-group__title">' + this.esc(section.title) + '</span>' +
          section.items.filter((i) => visibleKeys.has(i.key)).map((i) => {
            const on = !!(enabled && shownRights[i.key]);
            return '<button class="right-item" type="button" data-mk="ri' + i.key + '" data-key="' + i.key + '" data-click="onToggleRight"' + (enabled ? '' : ' disabled') + '>' +
              '<span class="right-item__text">' +
                '<span class="right-item__label-row">' + infoIcon(i.details) + '<span class="right-item__label">' + this.esc(i.label) + '</span></span>' +
                '<span class="right-item__desc">' + this.esc(i.desc) + '</span>' +
              '</span>' + this.switchEl(on) +
            '</button>';
          }).join('') +
        '</div>'
      ).join('');
      const note = u
        ? (u.isNew ? 'Сначала сохраните сотрудника, затем настройте его личные права.'
          : (this.isSystemAdmin(u) ? 'Права системного администратора здесь не изменяются.'
            : (u.rightsOverridden ? '' : 'Сейчас действуют права группы. Измените переключатели и сохраните, чтобы закрепить личные права.')))
        : (enabled
          ? (groupHasAdmin
            ? 'Права группы применяются к сотрудникам без личных прав. Системный администратор сохраняет свои права.'
            : (g.configured ? 'Права группы применяются к сотрудникам без личных прав.' : 'Права группы ещё не заданы. Измените переключатели и сохраните.'))
          : 'Раскройте группу для общих прав; выберите сотрудника для личных прав.');

      return '' +
        '<div class="rights-head" data-mk="rhead">' +
          '<span class="rights-head__title">' + (u ? 'Личные права сотрудника' : 'Права пользователей') + '</span>' +
          '<span class="rights-head__sub">' + this.esc(u ? (u.fio || 'Новый сотрудник') : (g ? g.name : 'Раскройте рабочую группу')) + '</span>' +
        '</div>' +
        groups +
        (this.rightsGroupName() === 'Администраторы'
          ? '<button class="right-item right-item--all" type="button" data-mk="rall" data-click="onToggleAllRights"' + (enabled ? '' : ' disabled') + '>' +
              '<span class="right-item__text">' +
                '<span class="right-item__label-row"><span class="right-item__label">Полные права</span></span>' +
                '<span class="right-item__desc">Включает сразу все права выше и снимает ограничения журнала</span>' +
              '</span>' + this.switchEl(allOn) +
            '</button>'
          : '') +
        (u && u.rightsOverridden && !this.isSystemAdmin(u)
          ? '<button class="rights-reset" type="button" data-click="onResetUserRights">Вернуть права группы</button>' : '') +
        (note ? '<p class="rights-note" data-mk="rnote">' + note + '</p>' : '');
    }

    elGroups = document.getElementById('groups');
    elRights = document.getElementById('rights');
    elSearch = document.getElementById('search');
    elClear = document.getElementById('searchClear');
    elDelete = document.getElementById('btnDelete');
    elArchive = document.getElementById('btnArchive');
    elToast = document.getElementById('toast');

    render() {
      if (!this.state.loaded) return;
      if (window.OMSA_LOGIN_LOADING) window.OMSA_LOGIN_LOADING.hide();
      const u = this.sel();

      if (this.elSearch.value !== this.state.search) this.elSearch.value = this.state.search;
      this.elClear.classList.toggle('is-visible', this.state.search.length > 0);

      this.elDelete.classList.toggle('is-off', !u || u.fio === this.SYSTEM_ADMIN_FIO);
      this.elArchive.classList.toggle('is-on', this.state.showArchive);
      this.elArchive.title = this.state.showArchive ? 'Скрыть архив уволенных' : 'Показать архив уволенных';

      this.patch(this.elGroups, this.groupsHtml());
      this.elRights.classList.toggle('um-rights--compact', this.rightsGroupName() !== 'Администраторы');
      this.patch(this.elRights, this.rightsHtml());

      this.elToast.textContent = this.state.toast || '';
      this.elToast.classList.toggle('is-visible', !!this.state.toast);
    }

    async bootstrap() {
      try {
        await this.api.refresh();
      } catch (e) {
        this.api.redirectToLogin();
        return;
      }
      try {
        const [refs, groups, users] = await Promise.all([
          this.api.get('/api/references'), this.api.get('/api/user-groups'), this.api.get('/api/users'),
        ]);
        this.state.RIGHTS_TREE = refs.rights_tree;
        const list = users.map(this.toUser);
        this.setState({
          loaded: true,
          GROUPS: groups.map((g) => this.toGroup(g)),
          USERS: list.map(this.clone),
          SAVED: list.map(this.clone),
        });
        setInterval(() => this.refreshSelectedLock(), 15000);
      } catch (err) {
        this.setState({ loaded: true });
        this.showError(err);
      }
    }

    constructor() {
      const H = {};
      H.onToggleArchive = this.onToggleArchive;
      H.onSearchChange = this.onSearchChange;
      H.onClearSearch = this.onClearSearch;
      H.onLogout = this.onLogout;
      H.onToggleGroup = this.onToggleGroup;
      H.onRenameGroup = this.onRenameGroup;
      H.onGroupNameChange = this.onGroupNameChange;
      H.onGroupNameKeyDown = this.onGroupNameKeyDown;
      H.onGroupNameBlur = this.onGroupNameBlur;
      H.onAddGroup = this.onAddGroup;
      H.onDeleteGroup = this.onDeleteGroup;
      H.onSelectUser = this.onSelectUser;
      H.onToggleDetails = this.onToggleDetails;
      H.onTogglePassVisible = this.onTogglePassVisible;
      H.onCredLoginChange = this.onCredLoginChange;
      H.onCredPasswordChange = this.onCredPasswordChange;
      H.onCredFioChange = this.onCredFioChange;
      H.onToggleGroupPicker = this.onToggleGroupPicker;
      H.onGroupPickerKeyDown = this.onGroupPickerKeyDown;
      H.onPickGroup = this.onPickGroup;
      H.onToggleFired = this.onToggleFired;
      H.onRowToggleFired = this.onRowToggleFired;
      H.onCopy = this.onCopy;
      H.onToggleRight = this.onToggleRight;
      H.onRightInfo = this.onRightInfo;
      H.onToggleAllRights = this.onToggleAllRights;
      H.onResetUserRights = this.onResetUserRights;
      H.onAddUser = this.onAddUser;
      H.onSave = this.onSave;
      H.onDelete = this.onDelete;
      const { patch, bindEvents } = this.OMSA.createRenderer(H);
      this.patch = patch;
      bindEvents(document);
      document.addEventListener('click', (e) => {
        if (this.state.groupPickerOpen && !e.target.closest('.group-select')) this.setState({ groupPickerOpen: false });
      });
      document.addEventListener('focusin', (e) => {
        if (this.state.groupPickerOpen && !e.target.closest('.group-select')) this.setState({ groupPickerOpen: false });
      });
      this.bootstrap();
    }
  }

  new UserManagementApp();
})();
