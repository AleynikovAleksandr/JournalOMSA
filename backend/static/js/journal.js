(function () {
  'use strict';

  const OMSA = window.OMSA;
  const esc = OMSA.esc;
  const api = new OMSA.ApiClient({ loginUrl: '/login' });

  const DATA_REFRESH_MS = 60 * 1000;
  const LOCK_HEARTBEAT_MS = 120 * 1000;

  


  


  function dateKey(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  function formatDateRu(key) {
    const parts = key.split('-').map(Number);
    return parts[2] + ' ' + MONTHS_RU[parts[1] - 1] + ' ' + parts[0];
  }
  function formatDateShort(key) {
    const parts = key.split('-');
    return parts[2] + '.' + parts[1];
  }
  const MONTH_NAMES_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const parseKey = (key) => { const p = key.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const monthOf = (key) => { const d = parseKey(key); return new Date(d.getFullYear(), d.getMonth(), 1); };

  
  const TYPE_CLASS = { 'ПФО': 'tag--pfo', 'Физо': 'tag--fizo', 'ЗУН': 'tag--zun' };
  const typeClass = (name) => TYPE_CLASS[name] || 'tag--zun';
  const statusClass = (final) => (final ? 'ready' : 'process');

  


  const toRow = (r) => ({
    id: r.id, blockId: r.group_id, date: r.date, time: r.time,
    typeId: r.type_check_id, type: r.type, number: r.number, fio: r.fio,
    categoryId: r.category_id, category: r.category, orgId: r.organization_id,
    executorId: r.executor_id, executor: r.executor,
    statusId: r.solution_id, status: r.status, statusFinal: r.status_final,
    note: r.note || '', version: r.version,
  });
  const toBlock = (g) => ({ id: g.id, date: g.date, time: g.time, typeId: g.type_check_id, type: g.type });
  const orgById = (list) => Object.fromEntries(list.map((o) => [o.id, o]));
  const nameById = (list, id) => { const x = list.find((i) => i.id === id); return x ? x.name : '—'; };

  function formatRussianPhone(value, cursor) {
    const text = String(value || '');
    const digits = text.replace(/\D/g, '').slice(0, 11);
    const digitsBeforeCursor = text.slice(0, cursor).replace(/\D/g, '').length;
    if (!digits) return { value: '', cursor: 0 };

    const local = digits.slice(1);
    let formatted = '+' + digits[0];
    if (local.length) formatted += ' (' + local.slice(0, 3);
    if (local.length >= 3) formatted += ')';
    if (local.length > 3) formatted += ' ' + local.slice(3, 6);
    if (local.length > 6) formatted += '-' + local.slice(6, 8);
    if (local.length > 8) formatted += '-' + local.slice(8, 10);
    let nextCursor = 1;
    if (digitsBeforeCursor > 0) {
      let seenDigits = 0;
      for (let i = 1; i < formatted.length; i += 1) {
        if (/\d/.test(formatted[i])) seenDigits += 1;
        nextCursor = i + 1;
        if (seenDigits >= digitsBeforeCursor) break;
      }
    }
    return { value: formatted, cursor: nextCursor };
  }

  


  const state = {
    dataLoaded: false,
    me: null, RIGHTS: {}, adminUrl: '',
    ORG_BY_ID: {}, ORGANIZATIONS: [], EXECUTORS: [], TYPES: [], CATEGORIES: [], STATUSES: [],
    BLOCKS: [], journal: [],
    calendarMonth: null, selectedDateKey: null, todayKey: null,
    selectedBlockId: null, selectedRowId: null, highlightRowId: null,
    searchFio: '', executorFilter: 'all', dateFrom: '', dateTo: '', noDateLimit: true, searchActive: false,
    myTasksOnly: false, completedOnly: false, execDropdownOpen: false,
    timeDropdownOpen: false, draftRecordId: null, mobileMenuOpen: false,
    openDD: null, categoryFilter: '', openTaskDD: null, taskDDPos: { top: 0, left: 0 },
    openCal: null, calMonth: new Date(), calPos: { top: 0, left: 0 },
    timePos: { top: 0, left: 0 }, ddPos: { top: 0, left: 0, width: 0 },
    orgSearch: '', orgQuery: '', selOrgId: null, orgIsNew: false,
    orgFName: '', orgFAddress: '', orgFPhone: '', orgFContact: '', orgFEmail: '', orgFNote: '',
    modal: null, saving: false, toasts: [],
  };

  function setState(patch) {
    Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
    render();
  }

  


  const isFired = () => !!(state.me && state.me.is_fired);
  const myId = () => (state.me ? state.me.id : null);
  const ownOnlyOk = (row) => !state.RIGHTS.jrnOwnOnly || row.executorId === myId();
  const canEditFields = (row) => !isFired() && !state.RIGHTS.jrnStatusOnly && ownOnlyOk(row);
  const canChangeStatus = (row) => !isFired() && ownOnlyOk(row);
  const canDelete = (row) => !isFired() && !!state.RIGHTS.jrnDel && ownOnlyOk(row);
  const canCreateRecords = () => !isFired() && !state.RIGHTS.jrnStatusOnly;

  function applyMe(user) {
    const rights = {};
    
    if (!user.is_fired) user.rights.forEach((k) => { rights[k] = true; });
    state.me = user;
    state.RIGHTS = rights;
    state.adminUrl = user.links && user.links.admin ? user.links.admin : '';
    if (state.dataLoaded) render();
  }
  api.onSession((data) => applyMe(data.user));

  


  function applyOrganizations(list) {
    setState({ ORGANIZATIONS: list, ORG_BY_ID: orgById(list) });
  }

  async function loadReferences() {
    const [refs, orgs] = await Promise.all([api.get('/api/references'), api.get('/api/organizations')]);
    state.TYPES = refs.type_checks;
    state.CATEGORIES = refs.categories;
    state.STATUSES = refs.solutions;
    state.EXECUTORS = refs.executors;
    applyOrganizations(orgs);
  }

  async function reloadData() {
    const [groups, rows] = await Promise.all([api.get('/api/groups'), api.get('/api/journal')]);
    setState({ BLOCKS: groups.map(toBlock), journal: rows.map(toRow) });
  }

  function replaceRow(row) {
    setState((s) => ({ journal: s.journal.map((r) => (r.id === row.id ? row : r)) }));
  }

  
  async function bootstrap() {
    try {
      const session = await api.refresh();
      applyMe(session.user);
    } catch (e) {
      api.redirectToLogin();
      return;
    }
    const todayKey = OMSA.time.appToday();
    try {
      await loadReferences();
      await reloadData();
    } catch (e) {
      showToast(e.message || 'Не удалось загрузить данные');
    }
    setState({
      dataLoaded: true,
      calendarMonth: monthOf(todayKey),
      selectedDateKey: todayKey, todayKey,
    });
    const recordId = Number(new URLSearchParams(window.location.search).get('record_id'));
    if (Number.isSafeInteger(recordId) && recordId > 0) {
      const notificationId = Number(new URLSearchParams(window.location.search).get('notification_id'));
      window.history.replaceState(null, '', '/journal');
      const opened = await openRecordById(recordId);
      if (opened && Number.isSafeInteger(notificationId) && notificationId > 0) {
        await notifications.ack({ id: notificationId });
      }
    }
    notifications.start();
    setInterval(() => {
      refreshToday();
      reloadData().catch(() => {});
    }, DATA_REFRESH_MS);
  }

  

  function refreshToday() {
    const key = OMSA.time.appToday();
    if (key === state.todayKey) return;
    setState((s) => (s.selectedDateKey === s.todayKey
      ? { todayKey: key, selectedDateKey: key, calendarMonth: monthOf(key) }
      : { todayKey: key }));
  }

  


  function computeCells() {
    const s = state;
    const year = s.calendarMonth.getFullYear(), mo = s.calendarMonth.getMonth();
    const first = new Date(year, mo, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const start = new Date(year, mo, 1 - startOffset);
    const blockDates = new Set(s.BLOCKS.map((b) => b.date));
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + i);
      const key = dateKey(dt);
      cells.push({
        key, day: dt.getDate(), hasBlocks: blockDates.has(key),
        selected: key === s.selectedDateKey,
        today: key === s.todayKey,
        inMonth: dt.getMonth() === mo,
      });
    }
    return cells;
  }

  function getFilteredJournal() {
    const s = state;
    let rows = s.journal;
    if (s.searchActive) {
      if (s.searchFio.trim()) {
        const q = s.searchFio.trim().toLowerCase();
        rows = rows.filter((r) => r.fio.toLowerCase().includes(q));
      }
      if (s.executorFilter !== 'all') rows = rows.filter((r) => r.executorId === Number(s.executorFilter));
      if (!s.noDateLimit) {
        if (s.dateFrom) rows = rows.filter((r) => r.date >= s.dateFrom);
        if (s.dateTo) rows = rows.filter((r) => r.date <= s.dateTo);
      }
    } else {
      rows = rows.filter((r) => r.date === s.selectedDateKey);
      if (s.selectedBlockId) rows = rows.filter((r) => r.blockId === s.selectedBlockId);
    }
    return rows;
  }

  function getTasks() {
    const s = state;
    return s.journal
      .filter((r) => (s.completedOnly ? r.statusFinal : !r.statusFinal))
      .filter((r) => (s.myTasksOnly ? r.executorId === myId() : true));
  }

  function findRow(id) { return state.journal.find((r) => r.id === id) || null; }
  function getSelectedRow() { return findRow(state.selectedRowId); }
  function getSelectedOrg() { const row = getSelectedRow(); return row ? state.ORG_BY_ID[row.orgId] : null; }

  let toastSeq = 0;
  function showToast(msg) {
    const id = ++toastSeq;
    setState((s) => ({ toasts: [...s.toasts, { id, msg }].slice(-3) }));
    setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3000);
  }

  function handleError(err) {
    if (err && err.status === 409) reloadData().catch(() => {});
    showToast((err && err.message) || 'Ошибка сервера');
  }

  


  let lockTimer = null;
  let lockedRecordId = null;

  function stopLockHeartbeat() {
    clearInterval(lockTimer);
    lockTimer = null;
    lockedRecordId = null;
  }
  function releaseLock() {
    if (lockedRecordId == null) return;
    const id = lockedRecordId;
    stopLockHeartbeat();
    api.del('/api/journal/' + id + '/lock').catch(() => {});
  }
  async function acquireLock(id) {
    try {
      await api.post('/api/journal/' + id + '/lock');
      stopLockHeartbeat();
      lockedRecordId = id;
      
      lockTimer = setInterval(() => { api.post('/api/journal/' + id + '/lock').catch(() => {}); }, LOCK_HEARTBEAT_MS);
    } catch (err) {
      if (err.status === 423) {
        setState((s) => (s.modal && s.modal.type === 'record' && s.modal.id === id
          ? { modal: { ...s.modal, readOnly: true, statusOnly: false, lockedBy: err.message } }
          : {}));
      }
    }
  }

  


  function openRecord(row) {
    const editable = canEditFields(row);
    const statusEditable = canChangeStatus(row);
    const modal = {
      type: 'record', isNew: false, id: row.id, groupId: row.blockId,
      date: row.date, time: row.time, typeId: row.typeId, fio: row.fio,
      typeName: nameById(state.TYPES, row.typeId),
      categoryId: row.categoryId, orgId: row.orgId, executorId: row.executorId, executorName: row.executor,
      categoryName: row.category || nameById(state.CATEGORIES, row.categoryId),
      statusId: row.statusId, statusName: nameById(state.STATUSES, row.statusId), note: row.note, version: row.version,
      readOnly: !editable && !statusEditable, statusOnly: !editable && statusEditable, lockedBy: null,
    };
    setState({ selectedRowId: row.id, modal, openDD: null, openCal: null, timeDropdownOpen: false });
    if (!modal.readOnly) acquireLock(row.id);
  }

  function openRecordDraft(block) {
    const s = state;
    const cat = s.CATEGORIES[0];
    const org = s.ORGANIZATIONS[0];
    const st = s.STATUSES.find((x) => !x.is_final) || s.STATUSES[0];
    setState({
      draftRecordId: 'new',
      modal: {
        type: 'record', isNew: true, id: null, groupId: block.id,
        date: block.date, time: block.time, typeId: block.typeId, typeName: nameById(s.TYPES, block.typeId), fio: '',
        categoryId: cat ? cat.id : null, categoryName: cat ? cat.name : '', orgId: org ? org.id : null,
        executorId: myId(), executorName: s.me ? s.me.short_name : '',
        statusId: st ? st.id : null, statusName: st ? st.name : '', note: '', version: null,
        readOnly: false, statusOnly: false, lockedBy: null,
      },
    });
  }

  
  async function openRecordById(id) {
    let row = findRow(id);
    if (!row) {
      try {
        row = toRow(await api.get('/api/journal/' + id));
        setState((s) => ({ journal: s.journal.some((item) => item.id === row.id) ? s.journal : [...s.journal, row] }));
      } catch (e) { handleError(e); return false; }
    }
    const day = parseKey(row.date);
    setState({
      selectedDateKey: row.date, selectedBlockId: null, selectedRowId: row.id,
      highlightRowId: row.id, searchActive: false,
      calendarMonth: new Date(day.getFullYear(), day.getMonth(), 1),
    });
    const target = document.querySelector('[data-mk="r' + row.id + '"]');
    if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }

  


  const H = {};

  
  H.onSelectDate = (e) => {
    const key = e.currentTarget.getAttribute('data-key');
    setState({ selectedDateKey: key, selectedBlockId: null, selectedRowId: null, searchActive: false });
  };
  H.onPrevMonth = () => setState((s) => { const m = new Date(s.calendarMonth); m.setMonth(m.getMonth() - 1); return { calendarMonth: m }; });
  H.onNextMonth = () => setState((s) => { const m = new Date(s.calendarMonth); m.setMonth(m.getMonth() + 1); return { calendarMonth: m }; });
  H.onToday = () => setState((s) => ({
    selectedDateKey: s.todayKey,
    calendarMonth: monthOf(s.todayKey),
    selectedBlockId: null, searchActive: false,
  }));

  
  H.onSearchChange = (e) => setState({ searchFio: e.target.value, searchActive: true });
  H.onClearSearchFio = () => setState({ searchFio: '', searchActive: false });
  H.onSearchKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); setState({ searchActive: true }); } };
  H.onToggleExecDropdown = () => setState((s) => ({ execDropdownOpen: !s.execDropdownOpen }));
  H.onCloseExecDropdown = () => setState({ execDropdownOpen: false });
  H.onPickExecutor = (e) => {
    const v = e.currentTarget.getAttribute('data-val');
    setState({ executorFilter: v, searchActive: true, execDropdownOpen: false });
  };
  H.onResetSearch = () => setState({ searchFio: '', executorFilter: 'all', dateFrom: '', dateTo: '', noDateLimit: true, searchActive: false });
  H.onToggleNoDateLimit = () => setState((s) => ({ noDateLimit: !s.noDateLimit, searchActive: true }));

  
  H.onOpenCal = (e) => {
    const cal = e.currentTarget.getAttribute('data-cal');
    if (e.currentTarget.disabled) return;
    const s = state;
    const cur = cal === 'from' ? s.dateFrom : cal === 'to' ? s.dateTo : (s.modal && s.modal.date);
    const base = parseKey(cur || s.todayKey);
    const rect = e.currentTarget.getBoundingClientRect();
    const w = 266;
    const top = rect.bottom + 6;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - w - 8);
    setState({
      openCal: s.openCal === cal ? null : cal,
      calMonth: new Date(base.getFullYear(), base.getMonth(), 1),
      calPos: { top, left }, openDD: null, timeDropdownOpen: false,
    });
  };
  H.onCloseCal = () => setState({ openCal: null });
  H.onCalPrevMonth = () => setState((s) => ({ calMonth: new Date(s.calMonth.getFullYear(), s.calMonth.getMonth() - 1, 1) }));
  H.onCalNextMonth = () => setState((s) => ({ calMonth: new Date(s.calMonth.getFullYear(), s.calMonth.getMonth() + 1, 1) }));
  H.onPickCal = (e) => {
    const key = e.currentTarget.getAttribute('data-key');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
    const cal = state.openCal;
    if (cal === 'from') setState({ dateFrom: key, searchActive: true, noDateLimit: false, openCal: null });
    else if (cal === 'to') setState({ dateTo: key, searchActive: true, noDateLimit: false, openCal: null });
    else setState((s) => ({ modal: { ...s.modal, date: key }, openCal: null }));
  };

  
  H.onOpenTaskDD = (e) => {
    e.stopPropagation();
    const id = Number(e.currentTarget.getAttribute('data-id'));
    const row = findRow(id);
    if (!row || !canChangeStatus(row)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setState((s) => ({
      openTaskDD: s.openTaskDD === id ? null : id,
      taskDDPos: { top: rect.bottom + 6, left: rect.left + rect.width / 2 },
    }));
  };
  H.onCloseTaskDD = () => setState({ openTaskDD: null });
  H.onPickTaskStatus = async (e) => {
    e.stopPropagation();
    const id = Number(e.currentTarget.getAttribute('data-id'));
    const statusId = Number(e.currentTarget.getAttribute('data-val'));
    setState({ openTaskDD: null });
    const row = findRow(id);
    if (!row || row.statusId === statusId) return;
    try {
      const saved = await api.patch('/api/journal/' + id + '/status', { solution_id: statusId, version: row.version });
      replaceRow(toRow(saved));
      showToast('Статус обновлён');
    } catch (err) {
      handleError(err);
    }
  };
  H.stopClickBubble = (e) => e.stopPropagation();

  let hlTimer = null;
  H.onTaskDoubleClick = (e) => {
    const id = Number(e.currentTarget.getAttribute('data-id'));
    const row = findRow(id);
    if (!row) return;
    const day = parseKey(row.date);
    setState({
      selectedDateKey: row.date, selectedBlockId: null, searchActive: false,
      highlightRowId: row.id, selectedRowId: row.id,
      calendarMonth: new Date(day.getFullYear(), day.getMonth(), 1),
    });
    clearTimeout(hlTimer);
    hlTimer = setTimeout(() => setState({ highlightRowId: null }), 1800);
  };
  H.onToggleMyTasks = () => setState((s) => ({ myTasksOnly: !s.myTasksOnly, completedOnly: s.myTasksOnly ? s.completedOnly : false }));
  H.onToggleCompleted = () => setState((s) => ({ completedOnly: !s.completedOnly, myTasksOnly: s.completedOnly ? s.myTasksOnly : false }));

  
  H.onOpenDD = (e) => {
    if (e.currentTarget.disabled) return;
    const dd = e.currentTarget.getAttribute('data-dd');
    const rect = e.currentTarget.getBoundingClientRect();
    setState((s) => ({
      openDD: s.openDD === dd ? null : dd,
      ddPos: { top: rect.bottom + 6, left: rect.left, width: rect.width },
      timeDropdownOpen: false, openCal: null,
    }));
  };
  H.onCloseDD = () => setState({ openDD: null });
  H.onPickDD = (e) => {
    const field = e.currentTarget.getAttribute('data-field');
    const val = Number(e.currentTarget.getAttribute('data-val'));
    const patch = { [field]: val };
    if (field === 'executorId') {
      const ex = state.EXECUTORS.find((x) => x.id === val);
      patch.executorName = ex ? ex.short_name : '';
    }
    if (field === 'categoryId') {
      patch.categoryName = nameById(state.CATEGORIES, val);
      patch.categoryFilter = '';
    }
    if (field === 'typeId') patch.typeName = nameById(state.TYPES, val);
    if (field === 'statusId') patch.statusName = nameById(state.STATUSES, val);
    setState((s) => ({ modal: { ...s.modal, ...patch }, openDD: null }));
  };

  H.onRecordCategoryClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setState({
      openDD: 'cat', categoryFilter: '',
      ddPos: { top: rect.bottom + 6, left: rect.left, width: rect.width },
    });
  };
  H.onRecordCategoryInput = (e) => {
    const value = e.target.value;
    const normalized = value.trim().toLocaleLowerCase();
    const match = state.CATEGORIES.find((item) => item.name.trim().toLocaleLowerCase() === normalized);
    const rect = e.target.getBoundingClientRect();
    setState((s) => ({
      modal: { ...s.modal, categoryId: match ? match.id : null, categoryName: match ? match.name : value },
      openDD: 'cat', categoryFilter: value,
      ddPos: { top: rect.bottom + 6, left: rect.left, width: rect.width },
    }));
  };

  H.onToggleTimeDropdown = (e) => {
    if (e.currentTarget.disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setState((s) => ({
      timeDropdownOpen: !s.timeDropdownOpen, openDD: null, openCal: null,
      timePos: { top: rect.bottom + 6, left: rect.left },
    }));
  };
  H.onCloseTimeDropdown = () => setState({ timeDropdownOpen: false });
  H.onPickHour = (e) => {
    const h = e.currentTarget.getAttribute('data-h');
    setState((s) => ({ modal: { ...s.modal, time: h + ':' + (s.modal.time || '00:00').split(':')[1] } }));
  };
  H.onPickMinute = (e) => {
    const m = e.currentTarget.getAttribute('data-m');
    setState((s) => ({ modal: { ...s.modal, time: (s.modal.time || '00:00').split(':')[0] + ':' + m }, timeDropdownOpen: false }));
  };

  
  H.onNewGroupMenu = () => {
    if (isFired() || !state.RIGHTS.grpAdd) return;
    const t0 = state.TYPES[0];
    setState({ modal: { type: 'newBlock', date: state.selectedDateKey, time: '09:00', typeId: t0 ? t0.id : null, typeName: t0 ? t0.name : '' } });
  };
  H.onSaveNewBlock = async () => {
    const m = state.modal;
    if (!m || state.saving) return;
    setState({ saving: true });
    try {
      const group = await api.post('/api/groups', { date: m.date, time: m.time, type_check_id: m.typeId, type_check_name: m.typeName });
      const block = toBlock(group);
      const day = parseKey(block.date);
      setState((s) => ({
        BLOCKS: [...s.BLOCKS, block], selectedDateKey: block.date, searchActive: false, saving: false,
        calendarMonth: new Date(day.getFullYear(), day.getMonth(), 1),
      }));
      if (canCreateRecords()) {
        openRecordDraft(block);
        showToast('Группа создана — заполните карточку записи');
      } else {
        setState({ modal: null });
        showToast('Группа создана');
      }
    } catch (err) {
      setState({ saving: false });
      handleError(err);
    }
  };

  
  H.onSelectRowClick = (e) => setState({ selectedRowId: Number(e.currentTarget.getAttribute('data-id')), highlightRowId: null });
  H.onRowClick = (e) => { if (e.detail >= 2) H.onRowDoubleClick(e); else H.onSelectRowClick(e); };
  H.onRowDoubleClick = (e) => {
    const row = findRow(Number(e.currentTarget.getAttribute('data-id')));
    if (row) openRecord(row);
  };
  H.onDeleteRowClick = async (e) => {
    e.stopPropagation();
    const id = Number(e.currentTarget.getAttribute('data-id'));
    const row = findRow(id);
    if (!row || !canDelete(row)) return;
    if (!window.confirm('Удалить запись «' + row.fio + '»?')) return;
    try {
      await api.del('/api/journal/' + id);
      setState((s) => ({
        journal: s.journal.filter((r) => r.id !== id),
        selectedRowId: s.selectedRowId === id ? null : s.selectedRowId,
      }));
      showToast('Запись удалена');
      reloadData().catch(() => {});
    } catch (err) {
      handleError(err);
    }
  };
  H.onNoteClick = (e) => {
    e.stopPropagation();
    const id = Number(e.currentTarget.getAttribute('data-id'));
    const row = findRow(id);
    if (row) {
      setState({
        selectedRowId: id,
        modal: { type: 'note', id, fio: row.fio, note: row.note || '', version: row.version, editable: canEditFields(row) },
      });
    }
  };
  H.onNoteChange = (e) => setState((s) => ({ modal: { ...s.modal, note: e.target.value } }));
  H.onSaveNote = async () => {
    const m = state.modal;
    if (!m || !m.editable || state.saving) return;
    setState({ saving: true });
    try {
      const saved = await api.patch('/api/journal/' + m.id + '/note', { note: m.note, version: m.version });
      replaceRow(toRow(saved));
      setState({ modal: null, saving: false });
      showToast('Примечание сохранено');
    } catch (err) {
      setState({ saving: false });
      handleError(err);
    }
  };

  
  H.onRecordFioChange = (e) => setState((s) => ({ modal: { ...s.modal, fio: e.target.value } }));
  H.onRecordNoteChange = (e) => setState((s) => ({ modal: { ...s.modal, note: e.target.value } }));
  H.onSaveRecord = async () => {
    const m = state.modal;
    if (!m || m.readOnly || state.saving) return;
    setState({ saving: true });
    try {
      let saved;
      if (m.statusOnly) {
        saved = await api.patch('/api/journal/' + m.id + '/status', { solution_id: m.statusId, solution_name: m.statusName, version: m.version });
      } else {
        const body = {
          group_id: m.groupId, date: m.date, time: m.time, type_check_id: m.typeId, type_check_name: m.typeName,
          fio: m.fio, category_id: m.categoryId, category_name: m.categoryName, organization_id: m.orgId,
          executor_id: m.executorId, solution_id: m.statusId, solution_name: m.statusName, note: m.note || '', version: m.version,
        };
        saved = m.isNew ? await api.post('/api/journal', body) : await api.put('/api/journal/' + m.id, body);
      }
      releaseLock();
      const row = toRow(saved);
      await reloadData();
      setState({ modal: null, draftRecordId: null, saving: false, selectedRowId: row.id, selectedDateKey: row.date, searchActive: false });
      showToast('Запись сохранена');
    } catch (err) {
      setState({ saving: false });
      handleError(err);
    }
  };

  
  function loadOrg(id) {
    const o = state.ORGANIZATIONS.find((x) => x.id === id);
    if (!o) {
      setState({ selOrgId: null, orgIsNew: false, orgFName: '', orgFAddress: '', orgFPhone: '', orgFContact: '', orgFEmail: '', orgFNote: '' });
      return;
    }
    setState({
      selOrgId: id, orgIsNew: false, orgFName: o.name, orgFAddress: o.address,
      orgFPhone: o.phone, orgFContact: o.contact, orgFEmail: o.email, orgFNote: o.note || '',
    });
  }
  async function reloadOrganizations() {
    applyOrganizations(await api.get('/api/organizations'));
  }
  H.onOrgSelect = (e) => loadOrg(Number(e.currentTarget.getAttribute('data-id')));
  H.onOrgSearchChange = (e) => setState({ orgSearch: e.target.value, orgQuery: e.target.value });
  H.onOrgSearchKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); setState((s) => ({ orgQuery: s.orgSearch.trim() })); } };
  H.onOrgFName = (e) => setState({ orgFName: e.target.value });
  H.onOrgFAddress = (e) => setState({ orgFAddress: e.target.value });
  H.onOrgFPhone = (e) => {
    const formatted = formatRussianPhone(e.target.value, e.target.selectionStart || 0);
    e.target.value = formatted.value;
    e.target.setSelectionRange(formatted.cursor, formatted.cursor);
    setState({ orgFPhone: formatted.value });
  };
  H.onOrgFContact = (e) => setState({ orgFContact: e.target.value });
  H.onOrgFEmail = (e) => setState({ orgFEmail: e.target.value });
  H.onOrgFNote = (e) => setState({ orgFNote: e.target.value });
  H.onOrgAdd = () => setState({ selOrgId: null, orgIsNew: true, orgFName: '', orgFAddress: '', orgFPhone: '', orgFContact: '', orgFEmail: '', orgFNote: '' });
  H.onOrgSave = async () => {
    const s = state;
    if (s.saving || (!s.orgIsNew && s.selOrgId == null)) return;
    const body = {
      name: s.orgFName, address: s.orgFAddress, phone: s.orgFPhone,
      contact: s.orgFContact, email: s.orgFEmail, note: s.orgFNote,
    };
    setState({ saving: true });
    try {
      const saved = s.orgIsNew
        ? await api.post('/api/organizations', body)
        : await api.put('/api/organizations/' + s.selOrgId, body);
      await reloadOrganizations();
      setState({ saving: false });
      loadOrg(saved.id);
      showToast('Организация сохранена');
    } catch (err) {
      setState({ saving: false });
      handleError(err);
    }
  };
  H.onOrgCancel = () => {
    const s = state;
    if (s.orgIsNew) { const back = s.ORGANIZATIONS[0]; loadOrg(back ? back.id : null); return; }
    loadOrg(s.selOrgId);
  };
  H.onOrgDelete = async () => {
    const s = state;
    const o = s.ORGANIZATIONS.find((x) => x.id === s.selOrgId);
    if (!o) { showToast('Выберите организацию в списке'); return; }
    if (!window.confirm('Удалить организацию «' + o.name + '»?')) return;
    try {
      await api.del('/api/organizations/' + o.id);
      await reloadOrganizations();
      const next = state.ORGANIZATIONS[0];
      loadOrg(next ? next.id : null);
      showToast('Организация удалена');
    } catch (err) {
      handleError(err);
    }
  };
  H.onOrgRefresh = async () => {
    try {
      await reloadOrganizations();
      setState({ orgSearch: '', orgQuery: '' });
      loadOrg(state.selOrgId != null && state.ORG_BY_ID[state.selOrgId] ? state.selOrgId : (state.ORGANIZATIONS[0] || {}).id);
      showToast('Список перечитан из базы');
    } catch (err) {
      handleError(err);
    }
  };

  
  H.onReferences = () => {
    if (isFired() || !state.RIGHTS.menuRefs) return;
    setState({ modal: { type: 'references' }, orgSearch: '', orgQuery: '' });
    const first = state.ORG_BY_ID[state.selOrgId] ? state.selOrgId : (state.ORGANIZATIONS[0] || {}).id;
    loadOrg(first);
  };
  H.onLogout = () => { releaseLock(); api.logout(); };
  H.onToggleMobileMenu = () => setState((s) => ({ mobileMenuOpen: !s.mobileMenuOpen }));
  H.onCloseMobileMenu = () => setState({ mobileMenuOpen: false });
  H.onMobileNewGroup = () => { setState({ mobileMenuOpen: false }); H.onNewGroupMenu(); };
  H.onMobileReferences = () => { setState({ mobileMenuOpen: false }); H.onReferences(); };
  H.onOrgDetails = () => {
    const org = getSelectedOrg();
    if (!org) { showToast('Сначала выберите запись в журнале'); return; }
    setState({ modal: { type: 'org', org } });
  };
  H.onCloseModal = () => {
    const m = state.modal;
    if (m && m.type === 'record' && !m.isNew) releaseLock();
    setState({ modal: null, draftRecordId: null, openDD: null, openCal: null, timeDropdownOpen: false });
  };

  


  const ICON = {
    check12: '<svg width="12" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5L4.5 8.5L11 1" stroke="#0a0a0a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    checkWhite: '<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevDown: '<svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="#6e6e73" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    calendar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6e6e73" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>',
    clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6e6e73" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    prev: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    next: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    note: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.4c-5.1 0-9.3 3.4-9.3 7.5 0 2.5 1.5 4.7 3.7 6-.2 1.3-.8 2.5-1.8 3.4-.3.3-.1.8.3.7 2.1-.1 3.9-.9 5.3-2 .6.1 1.2.1 1.8.1 5.1 0 9.3-3.3 9.3-7.4S17.1 3.4 12 3.4z"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    trash15: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    plus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    save: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    undo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M4 9h10a6 6 0 0 1 0 12h-4"/></svg>',
    refresh: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>',
    searchSm: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6e6e73" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  };

  
  function ddItemHtml(o, extraClass) {
    return '<button class="dd-item' + (extraClass ? ' ' + extraClass : '') + (o.selected ? ' is-selected' : '') + '"' +
      ' type="button" data-mk="dd' + esc(o.value) + '"' +
      (o.field ? ' data-field="' + esc(o.field) + '"' : '') +
      ' data-val="' + esc(o.value) + '" data-click="' + (o.handler || 'onPickDD') + '">' +
      '<span class="dd-item__text">' + esc(o.label) + '</span>' +
      (o.selected ? '<span class="dd-item__check">' + ICON.check12 + '</span>' : '') +
      '</button>';
  }
  const idOpts = (list, current, field) =>
    (list || []).map((x) => ({ value: x.id, label: x.name, field, selected: x.id === current }));

  
  function popCalHtml(activeKey, mkKey) {
    const s = state;
    const y = s.calMonth.getFullYear(), mth = s.calMonth.getMonth();
    const lead = (new Date(y, mth, 1).getDay() + 6) % 7;
    const days = new Date(y, mth + 1, 0).getDate();

    let cells = '';
    for (let i = 0; i < lead; i++) {
      cells += '<button class="pop-cal__day is-empty" type="button" data-mk="e' + i + '" disabled></button>';
    }
    for (let d = 1; d <= days; d++) {
      const key = dateKey(new Date(y, mth, d));
      cells += '<button class="pop-cal__day' + (activeKey === key ? ' is-selected' : '') + '" type="button"' +
        ' data-mk="d' + key + '" data-key="' + key + '" data-click="onPickCal">' + d + '</button>';
    }

    return '<div class="scrim" data-mk="scrim" data-click="onCloseCal"></div>' +
      '<div class="pop-cal" data-mk="' + mkKey + '" style="top:' + s.calPos.top + 'px;left:' + s.calPos.left + 'px;">' +
        '<div class="pop-cal__head" data-mk="head">' +
          '<button class="pop-cal__nav" type="button" data-mk="prev" data-click="onCalPrevMonth">' + ICON.prev + '</button>' +
          '<span class="pop-cal__month" data-mk="label">' + MONTH_NAMES_RU[mth] + ' ' + y + '</span>' +
          '<button class="pop-cal__nav" type="button" data-mk="next" data-click="onCalNextMonth">' + ICON.next + '</button>' +
        '</div>' +
        '<div class="cal-grid" data-mk="grid">' +
          WEEKDAYS_RU.map((w) => '<span class="pop-cal__wd" data-mk="w' + w + '">' + w + '</span>').join('') +
          cells +
        '</div>' +
      '</div>';
  }

  
  function popTimeHtml() {
    const s = state;
    const m = s.modal;
    const activeTime = m && (m.type === 'newBlock' || m.type === 'record') ? m.time : '00:00';
    const parts = (activeTime || '00:00').split(':');
    const curH = parts[0], curM = parts[1];

    const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    const minutes = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

    return '<div class="scrim" data-mk="scrim" data-click="onCloseTimeDropdown"></div>' +
      '<div class="pop-time" data-mk="time" style="top:' + s.timePos.top + 'px;left:' + s.timePos.left + 'px;">' +
        '<div class="pop-time__col" data-mk="hcol">' +
          hours.map((h) => '<button class="pop-time__item' + (h === curH ? ' is-current' : '') + '" type="button" data-mk="h' + h + '" data-h="' + h + '" data-click="onPickHour">' + h + '</button>').join('') +
        '</div>' +
        '<div class="pop-time__col" data-mk="mcol">' +
          minutes.map((mm) => '<button class="pop-time__item' + (mm === curM ? ' is-current' : '') + '" type="button" data-mk="m' + mm + '" data-m="' + mm + '" data-click="onPickMinute">' + mm + '</button>').join('') +
        '</div>' +
      '</div>';
  }

  
  function popoversHtml() {
    const s = state;
    let out = '';

    if (s.openCal) {
      const active = s.openCal === 'from' ? s.dateFrom : s.openCal === 'to' ? s.dateTo : (s.modal && s.modal.date);
      out += popCalHtml(active, 'cal-' + s.openCal);
    }

    if (s.timeDropdownOpen) out += popTimeHtml();

    if (s.openDD) {
      const m = s.modal || {};
      let opts = [];
      if (s.openDD === 'vtype' || s.openDD === 'type') opts = idOpts(s.TYPES, m.typeId, 'typeId');
      else if (s.openDD === 'cat') {
        const categories = s.categoryFilter
          ? s.CATEGORIES.filter((item) => item.name.toLocaleLowerCase().includes(s.categoryFilter.trim().toLocaleLowerCase()))
          : s.CATEGORIES;
        opts = idOpts(categories, m.categoryId, 'categoryId');
      }
      else if (s.openDD === 'status') opts = idOpts(s.STATUSES, m.statusId, 'statusId');
      else if (s.openDD === 'exec') opts = s.EXECUTORS.map((x) => ({ value: x.id, label: x.short_name, field: 'executorId', selected: m.executorId === x.id }));
      else if (s.openDD === 'org') opts = s.ORGANIZATIONS.map((o) => ({ value: o.id, label: o.name, field: 'orgId', selected: m.orgId === o.id }));

      if (opts.length) {
        out += '<div class="scrim" data-mk="ddscrim" data-click="onCloseDD"></div>' +
          '<div class="dd-menu dd-menu--fixed" data-mk="dd-' + s.openDD + '"' +
          ' style="top:' + s.ddPos.top + 'px;left:' + s.ddPos.left + 'px;width:' + s.ddPos.width + 'px;">' +
          opts.map((o) => ddItemHtml(o, 'dd-item--tall')).join('') +
          '</div>';
      }
    }

    if (s.openTaskDD != null) {
      const row = findRow(s.openTaskDD);
      if (row) {
        out += '<div class="scrim" data-mk="tscrim" data-click="onCloseTaskDD"></div>' +
          '<div class="status-menu" data-mk="taskdd" style="top:' + s.taskDDPos.top + 'px;left:' + s.taskDDPos.left + 'px;">' +
          s.STATUSES.map((st) =>
            '<button class="status-menu__item' + (st.id === row.statusId ? ' is-current' : '') + '" type="button"' +
            ' data-mk="st' + st.id + '" data-id="' + row.id + '" data-val="' + st.id + '" data-click="onPickTaskStatus">' + esc(st.name) + '</button>'
          ).join('') +
          '</div>';
      }
    }

    return out;
  }

  
  function calCellsHtml() {
    return computeCells().map((c) => {
      const cls = ['cal-day'];
      if (c.selected) cls.push('is-selected');
      else if (c.today) cls.push('is-today');
      if (!c.inMonth) cls.push('is-out');
      return '<button class="' + cls.join(' ') + '" type="button" data-mk="c' + c.key + '"' +
        ' data-key="' + c.key + '" data-click="onSelectDate">' + c.day +
        (c.hasBlocks ? '<span class="cal-dot"></span>' : '') +
        '</button>';
    }).join('');
  }

  
  function tasksHtml() {
    return getTasks().map((r, idx) => {
      const locked = !canChangeStatus(r);
      return '<tr class="jr-row' + (idx % 2 === 1 ? ' is-alt' : '') + '" data-mk="t' + r.id + '"' +
          ' data-id="' + r.id + '" data-dblclick="onTaskDoubleClick">' +
          '<td>' + formatDateShort(r.date) + '</td>' +
          '<td>' + esc(r.fio) + '</td>' +
          '<td class="col-exec">' + esc(r.executor) + '</td>' +
          '<td data-click="stopClickBubble">' +
            '<button class="status-btn status-btn--' + statusClass(r.statusFinal) + (locked ? ' is-locked' : '') + '"' +
            ' type="button" data-id="' + r.id + '" data-click="onOpenTaskDD">' + esc(r.status) + '</button>' +
          '</td>' +
        '</tr>';
    }).join('');
  }

  
  function journalHtml(rows) {
    const s = state;
    const showDelete = !isFired() && !!s.RIGHTS.jrnDel;
    return rows.map((r, idx) => {
      const org = s.ORG_BY_ID[r.orgId];
      const cls = ['jr-row'];
      if (s.highlightRowId === r.id) cls.push('is-highlight');
      else if (s.selectedRowId === r.id) cls.push('is-selected');
      else if (idx % 2 === 1) cls.push('is-alt');
      const hasNote = (r.note || '').trim();
      const delCell = canDelete(r)
        ? '<td><button class="row-icon row-icon--del" type="button" title="Удалить запись" data-id="' + r.id + '" data-click="onDeleteRowClick">' + ICON.trash + '</button></td>'
        : '<td></td>';

      return '<tr class="' + cls.join(' ') + '" data-mk="r' + r.id + '" data-id="' + r.id + '" data-click="onRowClick">' +
          '<td class="col-id">' + r.id + '</td>' +
          '<td><span class="tag ' + typeClass(r.type) + '">' + esc(r.type) + '</span></td>' +
          '<td>' + formatDateShort(r.date) + '</td>' +
          '<td>' + esc(r.time) + '</td>' +
          '<td>' + r.number + '</td>' +
          '<td>' + esc(r.fio) + '</td>' +
          '<td>' + esc(r.category) + '</td>' +
          '<td>' + esc(org ? org.name : '—') + '</td>' +
          '<td>' + esc(r.executor) + '</td>' +
          '<td><span class="status status--' + statusClass(r.statusFinal) + '">' + esc(r.status) + '</span></td>' +
          '<td>' +
            '<button class="row-icon' + (hasNote ? '' : ' row-icon--off') + '" type="button" title="Примечание"' +
            ' data-id="' + r.id + '" data-click="onNoteClick">' + ICON.note + '</button>' +
          '</td>' +
          (showDelete ? delCell : '') +
        '</tr>';
    }).join('');
  }

  
  function modalNewBlockHtml(m) {
    return '<p class="modal-title">Новая проверочная группа</p>' +
      '<div class="field field--rel">' +
        '<span class="field__label">Дата</span>' +
        '<button class="select-btn select-btn--modal" type="button" data-cal="record" data-click="onOpenCal">' +
          '<span>' + (m.date ? formatDateRu(m.date) : 'Выберите дату') + '</span>' + ICON.calendar +
        '</button>' +
      '</div>' +
      '<div class="field field--rel">' +
        '<span class="field__label">Время</span>' +
        '<button class="select-btn select-btn--modal" type="button" data-click="onToggleTimeDropdown">' +
          '<span>' + esc(m.time) + '</span>' + ICON.clock +
        '</button>' +
      '</div>' +
      '<div class="field">' +
        '<span class="field__label">Вид проверки</span>' +
        '<div style="position:relative;">' +
          '<button class="select-btn select-btn--modal" type="button" data-dd="vtype" data-click="onOpenDD">' +
            '<span>' + esc(nameById(state.TYPES, m.typeId)) + '</span>' + ICON.chevDown +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="modal-foot">' +
        '<button class="btn" type="button" data-click="onCloseModal">Отмена</button>' +
        '<button class="btn btn--primary" type="button" data-click="onSaveNewBlock"' + (state.saving ? ' disabled' : '') + '>Создать</button>' +
      '</div>';
  }

  function modalRecordHtml(m) {
    const s = state;
    const fieldsLocked = m.readOnly || m.statusOnly;
    const dis = fieldsLocked ? ' disabled' : '';
    const statusDis = m.readOnly ? ' disabled' : '';
    const orgLabel = m.orgId && s.ORG_BY_ID[m.orgId] ? s.ORG_BY_ID[m.orgId].name : '—';

    let sub = '';
    if (m.lockedBy) sub = '<p class="modal-sub modal-sub--warn">' + esc(m.lockedBy) + ' — карточка открыта только для просмотра.</p>';
    else if (m.readOnly) sub = '<p class="modal-sub">Карточка открыта только для просмотра.</p>';
    else if (m.statusOnly) sub = '<p class="modal-sub">Доступно только изменение статуса — остальные поля заблокированы правами.</p>';

    return '<p class="modal-title">Карточка записи</p>' + sub +

      '<div class="field">' +
        '<span class="field__label">ФИО</span>' +
        '<input class="input" type="text" maxlength="150" placeholder="' + (m.isNew ? 'Новый аттестуемый' : 'Фамилия Имя Отчество') + '" value="' + esc(m.fio) + '" data-input="onRecordFioChange"' + dis + '>' +
      '</div>' +

      '<div class="jr-grid2">' +
        '<div class="field">' +
          '<span class="field__label">Организация</span>' +
          '<div style="position:relative;">' +
            '<button class="select-btn select-btn--modal" type="button" data-dd="org" data-click="onOpenDD"' + dis + '>' +
              '<span class="select-btn__text">' + esc(orgLabel) + '</span>' + ICON.chevDown +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="field">' +
          '<span class="field__label">Категория</span>' +
          '<div class="category-combo">' +
            '<input class="select-btn select-btn--modal category-combo__input" type="text" maxlength="100"' +
              ' value="' + esc(m.categoryName || nameById(s.CATEGORIES, m.categoryId)) + '" data-input="onRecordCategoryInput"' +
              ' data-click="onRecordCategoryClick"' + dis + '>' +
            '<span class="category-combo__chev" aria-hidden="true">' + ICON.chevDown + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="jr-grid3">' +
        '<div class="field">' +
          '<span class="field__label">Вид проверки</span>' +
          '<div style="position:relative;">' +
            '<button class="select-btn select-btn--modal" type="button" data-dd="type" data-click="onOpenDD"' + dis + '>' +
              '<span>' + esc(nameById(s.TYPES, m.typeId)) + '</span>' + ICON.chevDown +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="field">' +
          '<span class="field__label">Дата</span>' +
          '<div style="position:relative;">' +
            '<button class="select-btn select-btn--modal" type="button" data-cal="record" data-click="onOpenCal"' + dis + '>' +
              '<span class="select-btn__text">' + (m.date ? formatDateRu(m.date) : 'Выберите дату') + '</span>' + ICON.calendar +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="field field--rel">' +
          '<span class="field__label">Время</span>' +
          '<button class="select-btn select-btn--modal" type="button" data-click="onToggleTimeDropdown"' + dis + '>' +
            '<span>' + esc(m.time) + '</span>' + ICON.clock +
          '</button>' +
        '</div>' +
      '</div>' +

      '<div class="field">' +
        '<span class="field__label">Исполнитель</span>' +
        '<div style="position:relative;">' +
          '<button class="select-btn select-btn--modal" type="button" data-dd="exec" data-click="onOpenDD"' + dis + '>' +
            '<span class="select-btn__text">' + esc(m.executorName || '—') + '</span>' + ICON.chevDown +
          '</button>' +
        '</div>' +
      '</div>' +

      '<div class="field">' +
        '<span class="field__label">Примечание</span>' +
        '<textarea class="input" rows="3" maxlength="250" placeholder="Описание задачи, комментарий к записи" data-input="onRecordNoteChange"' + dis + '>' + esc(m.note || '') + '</textarea>' +
      '</div>' +

      '<div class="field">' +
        '<span class="field__label">Статус</span>' +
        '<div style="position:relative;">' +
          '<button class="select-btn select-btn--modal" type="button" data-dd="status" data-click="onOpenDD"' + statusDis + '>' +
            '<span>' + esc(nameById(s.STATUSES, m.statusId)) + '</span>' + ICON.chevDown +
          '</button>' +
        '</div>' +
      '</div>' +

      '<div class="modal-foot">' +
        (m.readOnly
          ? '<button class="btn btn--primary" type="button" data-click="onCloseModal">Закрыть</button>'
          : '<button class="btn" type="button" data-click="onCloseModal">Отмена</button>' +
            '<button class="btn btn--primary" type="button" data-click="onSaveRecord"' + (s.saving ? ' disabled' : '') + '>Сохранить</button>') +
      '</div>';
  }

  function modalNoteHtml(m) {
    const head = '<div class="modal-head">' +
        '<p class="modal-title">Примечание</p>' +
        '<p class="modal-sub">' + esc(m.fio) + '</p>' +
      '</div>';
    if (!m.editable) {
      return head +
        '<div class="note-view">' + esc((m.note || '').trim() || 'Примечание не заполнено') + '</div>' +
        '<div class="modal-foot">' +
          '<button class="btn btn--primary" type="button" data-click="onCloseModal">Готово</button>' +
        '</div>';
    }
    return head +
      '<textarea class="input" rows="6" maxlength="250" placeholder="Описание задачи, комментарий к записи" data-input="onNoteChange">' + esc(m.note || '') + '</textarea>' +
      '<div class="modal-foot">' +
        '<button class="btn" type="button" data-click="onCloseModal">Отмена</button>' +
        '<button class="btn btn--primary" type="button" data-click="onSaveNote"' + (state.saving ? ' disabled' : '') + '>Сохранить</button>' +
      '</div>';
  }

  function modalOrgHtml(m) {
    const o = m.org || {};
    const row = (label, value) => '<div class="kv-row"><span class="muted">' + label + '</span><span>' + esc(value || '—') + '</span></div>';
    return '<p class="modal-title">Организация — подробнее</p>' +
      '<div class="kv-list">' +
        row('Наименование', o.name) +
        row('Адрес', o.address) +
        row('Телефон', o.phone) +
        row('Контактное лицо', o.contact) +
        row('E-Mail', o.email) +
        row('Примечание', o.note) +
      '</div>' +
      '<div class="modal-foot">' +
        '<button class="btn btn--primary" type="button" data-click="onCloseModal">Закрыть</button>' +
      '</div>';
  }

  function modalReferencesHtml() {
    const s = state;
    const q = s.orgQuery.trim().toLowerCase();
    const rows = s.ORGANIZATIONS
      .filter((o) => !q || [o.id, o.name, o.address, o.phone, o.contact, o.email, o.note]
        .some((value) => String(value || '').toLowerCase().includes(q)))
      .map((o, idx) => ({ ...o, no: idx + 1, alt: idx % 2 === 1 }));
    const selOrg = s.ORGANIZATIONS.find((o) => o.id === s.selOrgId) || null;
    const formLocked = !selOrg && !s.orgIsNew;
    const dis = formLocked ? ' disabled' : '';

    const tbody = rows.map((o) =>
      '<tr class="jr-row' + (s.selOrgId === o.id ? ' is-selected' : (o.alt ? ' is-alt' : '')) + '"' +
      ' data-mk="o' + o.id + '" data-id="' + o.id + '" data-click="onOrgSelect">' +
        '<td class="col-no">' + o.no + '</td>' +
        '<td class="col-name">' + esc(o.name) + '</td>' +
        '<td>' + esc(o.address) + '</td>' +
        '<td>' + esc(o.phone) + '</td>' +
        '<td>' + esc(o.contact) + '</td>' +
        '<td>' + esc(o.email) + '</td>' +
      '</tr>').join('');

    const formField = (label, value, handler, mk, maxlength, type, attrs) =>
      '<div class="field" data-mk="' + mk + '">' +
        (label ? '<span class="field__label">' + label + '</span>' : '') +
        '<input class="input input--sm" type="' + (type || 'text') + '" maxlength="' + maxlength + '" value="' + esc(value) + '" data-input="' + handler + '" ' + (attrs || '') + dis + '>' +
      '</div>';
    return '<div class="modal-head">' +
        '<p class="modal-title">Справочники</p>' +
        '<p class="modal-sub">Открывается через меню «Справочники». Изменения сохраняются в базу по кнопке сохранения.</p>' +
      '</div>' +

      '<span class="section-title">Организации</span>' +

      '<div class="jr-grid-side">' +
        '<div class="col" style="gap:12px;">' +
          '<div class="ref-toolbar">' +
            '<div class="ref-search">' +
              '<span class="ref-search__icon">' + ICON.searchSm + '</span>' +
              '<input class="ref-search__input" type="text" placeholder="Поиск по организациям"' +
              ' value="' + esc(s.orgSearch) + '" data-input="onOrgSearchChange" data-keydown="onOrgSearchKeyDown">' +
            '</div>' +
            '<button class="tool-btn" type="button" title="Добавить организацию" data-click="onOrgAdd">' + ICON.plus + '</button>' +
            '<button class="tool-btn" type="button" title="Сохранить" data-click="onOrgSave">' + ICON.save + '</button>' +
            '<button class="tool-btn" type="button" title="Отмена" data-click="onOrgCancel">' + ICON.undo + '</button>' +
            '<button class="tool-btn" type="button" title="Обновить список" data-click="onOrgRefresh">' + ICON.refresh + '</button>' +
            '<button class="tool-btn ' + (selOrg ? 'tool-btn--del' : 'tool-btn--off') + '"' +
            ' type="button" title="Удалить организацию" data-click="onOrgDelete">' + ICON.trash15 + '</button>' +
          '</div>' +

          '<div class="ref-table-box">' +
            '<table class="jr-table jr-table--ref">' +
              '<thead><tr>' +
                '<th class="col-no">id</th><th>Наименование</th><th>Адрес</th>' +
                '<th>Телефон</th><th>Контактное лицо</th><th>e-mail</th>' +
              '</tr></thead>' +
              '<tbody data-mk="orgbody">' + tbody + '</tbody>' +
            '</table>' +
            (rows.length === 0 ? '<p class="empty-note">Ничего не найдено</p>' : '') +
          '</div>' +
        '</div>' +

        '<div class="org-form">' +
          '<div class="field">' +
            '<span class="section-title">' + (s.orgIsNew ? 'Новая организация' : 'Карточка организации') + '</span>' +
            '<span class="card-hint">' + (formLocked
              ? 'Выберите организацию в списке или добавьте новую.'
              : 'Все поля редактируемые. «Отмена» откатывает несохранённое.') + '</span>' +
          '</div>' +
          '<div class="org-form__fields' + (formLocked ? ' is-dim' : '') + '">' +
            formField('Наименование:', s.orgFName, 'onOrgFName', 'fname', 150) +
            formField('Адрес:', s.orgFAddress, 'onOrgFAddress', 'faddr', 150) +
            formField('Номер:', s.orgFPhone, 'onOrgFPhone', 'fphone', 18, 'tel', 'inputmode="tel" autocomplete="tel" aria-label="Номер телефона"') +
            formField('Контактное лицо:', s.orgFContact, 'onOrgFContact', 'fcontact', 150) +
            formField('e-mail:', s.orgFEmail, 'onOrgFEmail', 'fmail', 100) +
            '<div class="field" data-mk="fnote">' +
              '<span class="field__label">Примечание:</span>' +
              '<textarea class="input input--sm" rows="4" maxlength="150" data-input="onOrgFNote"' + dis + '>' + esc(s.orgFNote) + '</textarea>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="modal-foot">' +
        '<button class="btn btn--primary" type="button" data-click="onCloseModal">Закрыть</button>' +
      '</div>';
  }

  function modalHtml() {
    const m = state.modal;
    if (!m) return '';

    let inner = '', extraClass = '';
    if (m.type === 'newBlock') inner = modalNewBlockHtml(m);
    else if (m.type === 'record') { inner = modalRecordHtml(m); extraClass = ' jr-modal-card--record'; }
    else if (m.type === 'note') inner = modalNoteHtml(m);
    else if (m.type === 'org') inner = modalOrgHtml(m);
    else if (m.type === 'references') { inner = modalReferencesHtml(); extraClass = ' jr-modal-card--wide'; }

    return '<div class="modal-overlay" data-mk="overlay">' +
        '<div class="jr-modal-card' + extraClass + '" data-mk="card-' + m.type + '">' + inner + '</div>' +
      '</div>';
  }

  
  function toastsHtml() {
    const list = state.toasts;
    if (!list.length) return '';
    return '<div class="toast-stack" data-mk="stack">' +
      list.map((t, idx) => {
        const dist = list.length - 1 - idx;
        const cls = dist === 0 ? '' : dist === 1 ? ' toast--dim1' : ' toast--dim2';
        return '<div class="toast' + cls + '" data-mk="tst' + t.id + '"><span class="toast__text">' + esc(t.msg) + '</span></div>';
      }).join('') +
      '</div>';
  }

  
  function mobileMenuHtml() {
    if (!state.mobileMenuOpen) return '';
    const r = state.RIGHTS;
    return '<div class="scrim" data-mk="mscrim" data-click="onCloseMobileMenu"></div>' +
      '<div class="menu-pop" data-mk="mpop">' +
        (r.grpAdd ? '<button class="menu-item" type="button" data-mk="mnew" data-click="onMobileNewGroup">Новая группа</button>' : '') +
        (r.menuRefs ? '<button class="menu-item" type="button" data-mk="mref" data-click="onMobileReferences">Справочники</button>' : '') +
        (r.menuSettings && state.adminUrl ? '<a class="menu-item menu-item--link" data-mk="musers" href="' + esc(state.adminUrl) + '">Управление пользователями</a>' : '') +
      '</div>';
  }

  


  const { patch, patchRows, bindEvents } = OMSA.createRenderer(H);

  const el = (id) => document.getElementById(id);
  const elLoading = el('loading'), elApp = el('app');
  const elMonthLabel = el('monthLabel'), elCalWeekdays = el('calWeekdays'), elCalCells = el('calCells');
  const elSelectedDate = el('selectedDate');
  const elTasksBody = el('tasksBody'), elTasksEmpty = el('tasksEmpty');
  const elJournalBody = el('journalBody'), elJournalEmpty = el('journalEmpty'), elThDelete = el('thDelete');
  const elSearchFio = el('searchFio'), elSearchClear = el('searchClear');
  const elExecLabel = el('execLabel'), elExecChev = el('execChev'), elExecMenu = el('execMenu');
  const elDateFromLabel = el('dateFromLabel'), elDateToLabel = el('dateToLabel');
  const elDatesPair = el('datesPair'), elCalFromBtn = el('calFromBtn'), elCalToBtn = el('calToBtn');
  const elChkMyTasks = el('chkMyTasks'), elChkCompleted = el('chkCompleted'), elChkNoLimit = el('chkNoLimit');
  const elOrgName = el('orgName'), elOrgPhone = el('orgPhone'), elOrgContact = el('orgContact'), elOrgEmail = el('orgEmail');
  const elNavNewGroup = el('navNewGroup'), elNavRefs = el('navRefs'), elNavUsers = el('navUsers');
  const elMobileMenu = el('mobileMenu'), elPopovers = el('popovers');
  const elModalRoot = el('modalRoot'), elToastRoot = el('toastRoot');

  function setRadio(node, on) {
    node.classList.toggle('is-on', on);
    const dot = node.firstElementChild;
    if (on && !dot) node.innerHTML = '<span class="radio-box__dot"></span>';
    else if (!on && dot) node.innerHTML = '';
  }
  function setCheck(node, on) {
    node.classList.toggle('is-on', on);
    const mark = node.firstElementChild;
    if (on && !mark) node.innerHTML = ICON.checkWhite;
    else if (!on && mark) node.innerHTML = '';
  }

  let weekdaysDrawn = false;

  function render() {
    const s = state;

    if (!s.dataLoaded) { elLoading.hidden = false; elApp.hidden = true; return; }
    elLoading.hidden = true;
    elApp.hidden = false;

    const r = s.RIGHTS;
    elNavNewGroup.hidden = !r.grpAdd;
    elNavRefs.hidden = !r.menuRefs;
    elNavUsers.hidden = !(r.menuSettings && s.adminUrl);
    if (s.adminUrl && elNavUsers.getAttribute('href') !== s.adminUrl) elNavUsers.setAttribute('href', s.adminUrl);

    
    if (!weekdaysDrawn) {
      elCalWeekdays.innerHTML = WEEKDAYS_RU.map((w) => '<div class="cal-wd">' + w + '</div>').join('');
      weekdaysDrawn = true;
    }
    elMonthLabel.textContent = MONTH_NAMES_RU[s.calendarMonth.getMonth()] + ' ' + s.calendarMonth.getFullYear();
    elSelectedDate.textContent = formatDateRu(s.selectedDateKey);
    patch(elCalCells, calCellsHtml());

    
    if (elSearchFio.value !== s.searchFio) elSearchFio.value = s.searchFio;
    elSearchClear.classList.toggle('is-visible', s.searchFio.length > 0);

    const execOpts = [{ value: 'all', label: 'Исполнитель: все' }]
      .concat(s.EXECUTORS.map((x) => ({ value: String(x.id), label: x.short_name })));
    const execCurrent = execOpts.find((o) => o.value === String(s.executorFilter));
    elExecLabel.textContent = execCurrent ? execCurrent.label : 'Исполнитель: все';
    elExecChev.classList.toggle('is-open', s.execDropdownOpen);
    patch(elExecMenu, s.execDropdownOpen
      ? '<div class="scrim" data-mk="escrim" data-click="onCloseExecDropdown"></div>' +
        '<div class="dd-menu dd-menu--abs" data-mk="emenu">' +
          execOpts.map((o) => ddItemHtml({ ...o, selected: String(s.executorFilter) === o.value, handler: 'onPickExecutor' })).join('') +
        '</div>'
      : '');

    elDateFromLabel.textContent = s.dateFrom ? formatDateRu(s.dateFrom) : 'Выберите дату';
    elDateToLabel.textContent = s.dateTo ? formatDateRu(s.dateTo) : 'Выберите дату';
    elDatesPair.classList.toggle('is-dim', s.noDateLimit);
    elCalFromBtn.disabled = s.noDateLimit;
    elCalToBtn.disabled = s.noDateLimit;

    setRadio(elChkMyTasks, s.myTasksOnly);
    setRadio(elChkCompleted, s.completedOnly);
    setCheck(elChkNoLimit, s.noDateLimit);

    
    const org = getSelectedOrg();
    elOrgName.textContent = org ? org.name : '—';
    elOrgPhone.textContent = org && org.phone ? org.phone : '—';
    elOrgContact.textContent = org && org.contact ? org.contact : '—';
    elOrgEmail.textContent = org && org.email ? org.email : '—';

    
    const tasks = getTasks();
    patchRows(elTasksBody, tasksHtml());
    elTasksEmpty.hidden = tasks.length > 0;

    const journalRows = getFilteredJournal();
    elThDelete.hidden = isFired() || !r.jrnDel;
    patchRows(elJournalBody, journalHtml(journalRows));
    elJournalEmpty.hidden = journalRows.length > 0;

    
    patch(elMobileMenu, mobileMenuHtml());
    patch(elPopovers, popoversHtml());
    patch(elModalRoot, modalHtml());
    patch(elToastRoot, toastsHtml());

    document.body.classList.toggle('is-locked', !!s.modal);
  }

  


  const notifications = new OMSA.NotificationCenter(api, {
    root: el('notifyRoot'),
    onOpen: (journalId) => openRecordById(journalId),
  });

  bindEvents(document);
  bootstrap();
})();
