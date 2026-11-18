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
  const TASK_VIEWS = ['my-active', 'completed', 'my-all', 'others'];
  const TASK_TAB_IDS = { 'my-active': 'taskTabMy', completed: 'taskTabCompleted', 'my-all': 'taskTabAll', others: 'taskTabOthers' };

  


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
    BLOCKS: [], journal: [], tasks: [],
    calendarMonth: null, selectedDateKey: null, todayKey: null,
    selectedBlockId: null, selectedRowId: null, highlightRowId: null,
    searchFio: '', executorFilter: 'all', dateFrom: '', dateTo: '', noDateLimit: true, searchActive: false,
    tasksView: 'my-active', tasksDropdownOpen: false, execDropdownOpen: false,
    timeDropdownOpen: false, draftRecordId: null, mobileMenuOpen: false,
    openDD: null, ddRowIndex: null, openTaskDD: null, taskDDPos: { top: 0, left: 0 },
    openCal: null, calRowIndex: null, calMonth: new Date(), calPos: { top: 0, left: 0 },
    timeRowIndex: null,
    timePos: { top: 0, left: 0 }, ddPos: { top: 0, left: 0, width: 0 },
    orgSearch: '', orgQuery: '', selOrgId: null, orgIsNew: false,
    orgFName: '', orgFAddress: '', orgFPhone: '', orgFContact: '', orgFEmail: '', orgFNote: '',
    modal: null, routeModal: null, saving: false, toasts: [],
  };

  function setState(patch) {
    const previousJournalQuery = journalQuery();
    const previousTasksQuery = tasksQuery();
    Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
    const newGroupRecordOpen = state.routeModal === 'newBlock' &&
      state.modal?.type === 'record' && state.modal.isNew;
    if (state.routeModal && state.modal?.type !== state.routeModal && !newGroupRecordOpen) {
      state.routeModal = null;
      window.history.replaceState(null, '', elApp.dataset.journalUrl);
    }
    render();
    if (state.dataLoaded && journalQuery() !== previousJournalQuery) queueJournalReload();
    if (state.dataLoaded && tasksQuery() !== previousTasksQuery) loadTasks().catch(handleError);
  }

  let nextAttesteeKey = 1;
  function newAttestee(m) {
    const s = state;
    const st = s.STATUSES.find((x) => !x.is_final) || s.STATUSES[0];
    return {
      key: nextAttesteeKey++, date: m.date, time: m.time, typeId: m.typeId,
      typeName: m.typeName, fio: '', categoryId: null,
      categoryName: '', orgId: null,
      executorId: null, executorName: '',
      statusId: st ? st.id : null, statusName: st ? st.name : '', note: '',
    };
  }
  function missingAttesteeFields(row) {
    return {
      fio: !(row.fio || '').trim(),
      org: !row.orgId,
      category: !row.categoryId && !(row.categoryName || '').trim(),
      exec: !row.executorId,
      status: !row.statusId,
    };
  }
  function updateAttestee(index, patch) {
    setState((s) => ({ modal: { ...s.modal, activeAttesteeIndex: index,
      attendees: s.modal.attendees.map((row, i) => i === index ? { ...row, ...patch } : row) } }));
  }
  function activeAttesteeIndex(target) {
    if (target.hasAttribute('data-row')) return Number(target.getAttribute('data-row'));
    return null;
  }

  


  const isFired = () => !!(state.me && state.me.is_fired);
  const canViewOtherTasks = () => !!(state.me && state.me.can_view_other_tasks);
  const availableTaskViews = () => canViewOtherTasks()
    ? TASK_VIEWS
    : TASK_VIEWS.filter((view) => view !== 'others');
  const myId = () => (state.me ? state.me.id : null);
  const ownOnlyOk = (row) => !state.RIGHTS.jrnOwnOnly || row.executorId === myId();
  const canEditCard = (row) => !!state.RIGHTS.grpEdit || (!!state.RIGHTS.jrnOwnOnly && row.executorId === myId());
  const canEditFields = (row) => !isFired() && canEditCard(row) && ownOnlyOk(row);
  const canChangeStatus = (row) => {
    const own = row.executorId === myId();
    return !isFired() &&
      (!!state.RIGHTS.jrnStatusOnly ||
        !!state.me?.is_system_admin ||
        (!!state.RIGHTS.jrnOwnOnly && own) ||
        (canViewOtherTasks() && !!state.RIGHTS.grpEdit)) &&
      (own || canViewOtherTasks());
  };
  const canDelete = (row) => !isFired() && !!state.RIGHTS.jrnDel && ownOnlyOk(row);
  const canCreateRecords = () => !isFired() && (!state.RIGHTS.jrnStatusOnly || !!state.RIGHTS.grpAdd);
  const canAddToGroup = () => canCreateRecords() && !!state.RIGHTS.grpAdd;

  function applyMe(user) {
    const previousTasksQuery = tasksQuery();
    const rights = {};
    
    if (!user.is_fired) user.rights.forEach((k) => { rights[k] = true; });
    state.me = user;
    state.RIGHTS = rights;
    state.adminUrl = user.links && user.links.admin ? user.links.admin : '';
    if (!canViewOtherTasks() && state.tasksView === 'others') {
      state.tasksView = 'my-active';
    }
    if (state.dataLoaded) {
      render();
      if (tasksQuery() !== previousTasksQuery) loadTasks().catch(handleError);
    }
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

  function journalQuery() {
    const params = new URLSearchParams();
    if (state.searchActive) {
      if (state.searchFio.trim()) params.set('fio', state.searchFio.trim());
      if (state.executorFilter !== 'all') params.set('executor_id', state.executorFilter);
      if (!state.noDateLimit) {
        if (state.dateFrom) params.set('date_from', state.dateFrom);
        if (state.dateTo) params.set('date_to', state.dateTo);
      }
    } else if (state.selectedDateKey) {
      params.set('date_from', state.selectedDateKey);
      params.set('date_to', state.selectedDateKey);
    }
    return '/api/journal?' + params.toString();
  }

  function tasksQuery() {
    if (state.tasksView === 'completed') return '/api/tasks/my?completed=true';
    if (state.tasksView === 'my-all') return '/api/journal?my=true';
    if (state.tasksView === 'others') return '/api/tasks/others';
    return '/api/tasks/my?completed=false';
  }

  let journalReloadTimer = null;
  let journalRequestVersion = 0;
  let tasksRequestVersion = 0;

  function queueJournalReload() {
    clearTimeout(journalReloadTimer);
    const version = ++journalRequestVersion;
    journalReloadTimer = setTimeout(() => loadJournal(version).catch(handleError), 180);
  }

  async function loadJournal(version = ++journalRequestVersion) {
    const query = journalQuery();
    const rows = await api.get(query);
    if (version === journalRequestVersion && query === journalQuery()) {
      setState({ journal: rows.map(toRow) });
    }
  }

  async function loadTasks(version = ++tasksRequestVersion) {
    const query = tasksQuery();
    const rows = await api.get(query);
    if (version === tasksRequestVersion && query === tasksQuery()) {
      setState({ tasks: rows.map(toRow) });
    }
  }

  async function reloadData() {
    clearTimeout(journalReloadTimer);
    const [groups] = await Promise.all([api.get('/api/groups'), loadJournal(), loadTasks()]);
    setState({ BLOCKS: groups.map(toBlock) });
  }

  function replaceRow(row) {
    setState((s) => ({
      journal: s.journal.map((r) => (r.id === row.id ? row : r)),
      tasks: s.tasks.map((r) => (r.id === row.id ? row : r)),
    }));
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
    setState({ calendarMonth: monthOf(todayKey), selectedDateKey: todayKey, todayKey });
    try {
      await loadReferences();
      await reloadData();
    } catch (e) {
      showToast(e.message || 'Не удалось загрузить данные');
    }
    setState({ dataLoaded: true });
    const urlParams = new URLSearchParams(window.location.search);
    const recordId = Number(urlParams.get('record_id'));
    if (Number.isSafeInteger(recordId) && recordId > 0) {
      const notificationId = Number(urlParams.get('notification_id'));
      window.history.replaceState(null, '', '/journal');
      await openNotificationRecord(recordId, notificationId);
    } else if (elApp.dataset.initialModal === 'newBlock') {
      const groupId = Number(urlParams.get('group_id'));
      if (Number.isSafeInteger(groupId) && groupId > 0) {
        const block = state.BLOCKS.find((item) => item.id === groupId);
        if (block && canAddToGroup()) openGroupEditor(block, groupId);
        else {
          window.history.replaceState(null, '', '/journal');
          showToast(block ? 'Недостаточно прав для добавления в группу' : 'Группа не найдена');
        }
      } else {
        H.onNewGroupMenu();
        if (state.modal?.type === 'newBlock') state.routeModal = 'newBlock';
      }
    } else if (elApp.dataset.initialModal === 'references') {
      H.onReferences();
      if (state.modal?.type === 'references') state.routeModal = 'references';
    }
    notifications.start();
    setInterval(() => {
      refreshToday();
      reloadData().catch(() => {});
      autoRefreshOrganizations().catch(() => {});
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

  function getVisibleJournal() {
    if (!state.searchActive && state.selectedBlockId) {
      return state.journal.filter((r) => r.blockId === state.selectedBlockId);
    }
    return state.journal;
  }

  function findRow(id) {
    return state.journal.find((r) => r.id === id) || state.tasks.find((r) => r.id === id) || null;
  }
  function getSelectedRow() { return findRow(state.selectedRowId); }
  function getSelectedOrg() { const row = getSelectedRow(); return row ? state.ORG_BY_ID[row.orgId] : null; }

  let toastSeq = 0;
  function showToast(msg, kind = '') {
    const id = ++toastSeq;
    setState((s) => ({ toasts: [...s.toasts, { id, msg, kind }].slice(-3) }));
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
      readOnly: !editable && !statusEditable, statusOnly: !editable && statusEditable,
      statusLocked: !statusEditable, lockedBy: null,
    };
    setState({ selectedRowId: row.id, modal, openDD: null, openCal: null, timeDropdownOpen: false });
    if (!modal.readOnly) acquireLock(row.id);
  }

  function openRecordDraft(block) {
    const s = state;
    const org = s.ORGANIZATIONS[0];
    const st = s.STATUSES.find((x) => !x.is_final) || s.STATUSES[0];
    setState({
      draftRecordId: 'new',
      modal: {
        type: 'record', isNew: true, id: null, groupId: block.id,
        date: block.date, time: block.time, typeId: block.typeId, typeName: nameById(s.TYPES, block.typeId), fio: '',
        categoryId: null, categoryName: '', orgId: org ? org.id : null,
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
      } catch (e) { handleError(e); return false; }
    }
    const day = parseKey(row.date);
    setState({
      selectedDateKey: row.date, selectedBlockId: null, selectedRowId: row.id,
      highlightRowId: row.id, searchActive: false,
      calendarMonth: new Date(day.getFullYear(), day.getMonth(), 1),
    });
    clearTimeout(journalReloadTimer);
    try {
      await loadJournal();
    } catch (e) { handleError(e); return false; }
    const target = document.querySelector('[data-mk="r' + row.id + '"]');
    if (!target) return false;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }

  async function openNotificationRecord(recordId, notificationId) {
    const opened = await openRecordById(recordId);
    if (opened && Number.isSafeInteger(notificationId) && notificationId > 0) {
      await notifications.ack({ id: notificationId });
    }
  }

  function onNotificationMessage(event) {
    const data = event.data;
    const recordId = Number(data?.recordId);
    if (data?.type !== 'open-journal-record' || !Number.isSafeInteger(recordId) || recordId <= 0) return;
    const target = new URL(data.url, window.location.origin);
    if (target.origin !== window.location.origin || target.pathname !== elApp.dataset.journalUrl) return;
    if (event.ports[0]) event.ports[0].postMessage('received');
    if (!state.dataLoaded) {
      window.history.replaceState(null, '', target.pathname + target.search);
      return;
    }
    if (state.modal) H.onCloseModal();
    window.history.replaceState(null, '', elApp.dataset.journalUrl);
    openNotificationRecord(recordId, Number(data.notificationId)).catch(handleError);
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
    const rowIndex = activeAttesteeIndex(e.currentTarget);
    const cur = cal === 'from' ? s.dateFrom : cal === 'to' ? s.dateTo :
      rowIndex != null ? s.modal.attendees[rowIndex].date : (s.modal && s.modal.date);
    const base = parseKey(cur || s.todayKey);
    const rect = e.currentTarget.getBoundingClientRect();
    const w = 266;
    const top = rect.bottom + 6;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - w - 8);
    setState({
      openCal: s.openCal === cal && s.calRowIndex === rowIndex ? null : cal,
      calRowIndex: rowIndex,
      calMonth: new Date(base.getFullYear(), base.getMonth(), 1),
      calPos: { top, left }, openDD: null, timeDropdownOpen: false,
      ...(s.modal?.type === 'newBlock' && rowIndex != null ? { modal: { ...s.modal, activeAttesteeIndex: rowIndex } } : {}),
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
    else if (state.calRowIndex != null && state.modal?.type === 'newBlock') {
      updateAttestee(state.calRowIndex, { date: key });
      setState({ openCal: null, calRowIndex: null });
    } else if (state.modal?.type === 'newBlock') {
      setState((s) => ({ modal: { ...s.modal, date: key } }));
      setState({ openCal: null, calRowIndex: null });
    } else setState((s) => ({ modal: { ...s.modal, date: key }, openCal: null, calRowIndex: null }));
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
      reloadData().catch(handleError);
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
  H.onTaskTabClick = (e) => {
    const view = e.currentTarget.getAttribute('data-task-view');
    if (!availableTaskViews().includes(view)) return;
    setState((s) => ({
      tasksView: view,
      tasksDropdownOpen: !(s.tasksDropdownOpen && s.tasksView === view),
    }));
  };
  H.onCloseTasksPanel = () => setState({ tasksDropdownOpen: false });
  H.onTaskTabKeydown = (e) => {
    const views = availableTaskViews();
    const index = views.indexOf(e.currentTarget.getAttribute('data-task-view'));
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % views.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + views.length) % views.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = views.length - 1;
    else return;
    e.preventDefault();
    const tab = el(TASK_TAB_IDS[views[next]]);
    tab.focus();
    H.onTaskTabClick({ currentTarget: tab });
  };

  
  H.onOpenDD = (e) => {
    if (e.currentTarget.disabled) return;
    const dd = e.currentTarget.getAttribute('data-dd');
    const rowIndex = activeAttesteeIndex(e.currentTarget);
    const rect = e.currentTarget.getBoundingClientRect();
    setState((s) => ({
      openDD: s.openDD === dd && s.ddRowIndex === rowIndex ? null : dd,
      ddRowIndex: rowIndex,
      ddPos: { top: rect.bottom + 6, left: rect.left, width: rect.width },
      timeDropdownOpen: false, openCal: null,
      ...(s.modal?.type === 'newBlock' && rowIndex != null ? { modal: { ...s.modal, activeAttesteeIndex: rowIndex } } : {}),
    }));
  };
  H.onCloseDD = () => setState({ openDD: null, ddRowIndex: null });
  H.onPickDD = (e) => {
    const field = e.currentTarget.getAttribute('data-field');
    const val = Number(e.currentTarget.getAttribute('data-val'));
    const patch = field === 'fixedCategoryNumber'
      ? { categoryId: null, categoryName: 'Категория ' + val }
      : { [field]: val };
    if (field === 'executorId') {
      const ex = state.EXECUTORS.find((x) => x.id === val);
      patch.executorName = ex ? ex.short_name : '';
    }
    if (field === 'categoryId') {
      patch.categoryName = nameById(state.CATEGORIES, val);
    }
    if (field === 'typeId') patch.typeName = nameById(state.TYPES, val);
    if (field === 'statusId') patch.statusName = nameById(state.STATUSES, val);
    if (state.modal?.type === 'newBlock' && state.ddRowIndex != null) {
      updateAttestee(state.ddRowIndex, patch);
      setState({ openDD: null, ddRowIndex: null });
    } else if (state.modal?.type === 'newBlock' && field === 'typeId') {
      setState((s) => ({ modal: { ...s.modal, typeId: val, typeName: patch.typeName }, openDD: null, ddRowIndex: null }));
    } else setState((s) => ({ modal: { ...s.modal, ...patch }, openDD: null, ddRowIndex: null }));
  };

  H.onToggleTimeDropdown = (e) => {
    if (e.currentTarget.disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rowIndex = activeAttesteeIndex(e.currentTarget);
    setState((s) => ({
      timeDropdownOpen: s.timeRowIndex === rowIndex ? !s.timeDropdownOpen : true,
      timeRowIndex: rowIndex, openDD: null, openCal: null,
      timePos: { top: rect.bottom + 6, left: rect.left },
      ...(s.modal?.type === 'newBlock' && rowIndex != null ? { modal: { ...s.modal, activeAttesteeIndex: rowIndex } } : {}),
    }));
  };
  H.onCloseTimeDropdown = () => setState({ timeDropdownOpen: false });
  H.onPickHour = (e) => {
    const h = e.currentTarget.getAttribute('data-h');
    if (state.modal?.type === 'newBlock' && state.timeRowIndex != null) {
      const row = state.modal.attendees[state.timeRowIndex];
      updateAttestee(state.timeRowIndex, { time: h + ':' + (row.time || '00:00').split(':')[1] });
    } else if (state.modal?.type === 'newBlock') {
      setState((s) => ({ modal: { ...s.modal, time: h + ':' + (s.modal.time || '00:00').split(':')[1] } }));
    } else setState((s) => ({ modal: { ...s.modal, time: h + ':' + (s.modal.time || '00:00').split(':')[1] } }));
  };
  H.onPickMinute = (e) => {
    const m = e.currentTarget.getAttribute('data-m');
    if (state.modal?.type === 'newBlock' && state.timeRowIndex != null) {
      const row = state.modal.attendees[state.timeRowIndex];
      updateAttestee(state.timeRowIndex, { time: (row.time || '00:00').split(':')[0] + ':' + m });
      setState({ timeDropdownOpen: false, timeRowIndex: null });
    } else if (state.modal?.type === 'newBlock') {
      setState((s) => ({ modal: { ...s.modal, time: (s.modal.time || '00:00').split(':')[0] + ':' + m }, timeDropdownOpen: false }));
    } else setState((s) => ({ modal: { ...s.modal, time: (s.modal.time || '00:00').split(':')[0] + ':' + m }, timeDropdownOpen: false }));
  };

  
  function openGroupEditor(block, existingGroupId) {
    const canAddAttendees = canCreateRecords();
    const t0 = state.TYPES[0];
    const initialDate = block ? block.date : OMSA.time.appToday();
    const modal = { type: 'newBlock', step: 'attendees', date: initialDate,
      time: block ? block.time : '09:00', typeId: block ? block.typeId : (t0 ? t0.id : null),
      typeName: block ? block.type : (t0 ? t0.name : ''), existingGroupId: existingGroupId || null,
      attendees: [], activeAttesteeIndex: canAddAttendees ? 0 : null,
      validationAttempted: false, groupValidationAttempted: false };
    if (canAddAttendees) modal.attendees = [newAttestee(modal)];
    const day = parseKey(modal.date);
    setState({ modal,
      ...(existingGroupId ? {} : {
        todayKey: initialDate, selectedDateKey: initialDate, selectedBlockId: null,
        calendarMonth: new Date(day.getFullYear(), day.getMonth(), 1),
      }),
      openCal: null, calRowIndex: null, openDD: null, ddRowIndex: null,
      timeDropdownOpen: false, timeRowIndex: null });
    if (existingGroupId) {
      const url = new URL(elNavNewGroup.getAttribute('href'), window.location.href);
      url.searchParams.set('group_id', String(existingGroupId));
      state.routeModal = 'newBlock';
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  }
  H.onNewGroupMenu = () => {
    if (isFired() || !state.RIGHTS.grpAdd) return;
    openGroupEditor(null, null);
  };
  H.onAddAttesteeToGroup = (e) => {
    e.preventDefault();
    if (!canAddToGroup()) return;
    const groupId = Number(e.currentTarget.getAttribute('data-group-id'));
    const block = state.BLOCKS.find((item) => item.id === groupId);
    if (!block) return;
    openGroupEditor(block, groupId);
  };
  H.onSaveNewBlock = async () => {
    const m = state.modal;
    if (!m || state.saving) return;
    if (!m.date || !m.time || !m.typeId) {
      setState((s) => ({ modal: { ...s.modal, groupValidationAttempted: true } }));
      showToast('Укажите дату, время и вид проверки', 'validation');
      return;
    }
    const rows = m.attendees || [];
    if (rows.some((row) => Object.values(missingAttesteeFields(row)).some(Boolean))) {
      setState((s) => ({ modal: { ...s.modal, validationAttempted: true } }));
      showToast('Заполните все обязательные поля ввода', 'validation');
      return;
    }
    setState({ saving: true });
    try {
      const recordPayload = rows.map((row) => ({ date: m.date, time: m.time, type_check_id: m.typeId,
        type_check_name: m.typeName, fio: row.fio, category_id: row.categoryId,
        category_name: row.categoryName, organization_id: row.orgId, executor_id: row.executorId,
        solution_id: row.statusId, solution_name: row.statusName, note: row.note || '' }));
      const result = m.existingGroupId
        ? await api.post('/api/groups/' + m.existingGroupId + '/records', { records: recordPayload })
        : await api.post('/api/groups/with-records', {
            group: { date: m.date, time: m.time,
              type_check_id: m.typeId, type_check_name: m.typeName },
            records: recordPayload,
          });
      const block = toBlock(result.group);
      const day = parseKey(block.date);
      setState((s) => ({
        BLOCKS: s.BLOCKS.some((item) => item.id === block.id) ? s.BLOCKS : [...s.BLOCKS, block],
        selectedDateKey: m.existingGroupId ? s.selectedDateKey : block.date,
        selectedBlockId: null, searchActive: m.existingGroupId ? s.searchActive : false,
        saving: false,
        calendarMonth: m.existingGroupId ? s.calendarMonth : new Date(day.getFullYear(), day.getMonth(), 1),
      }));
      await reloadData();
      setState({ modal: null, selectedRowId: result.records.length ? result.records[0].id : null });
      showToast(m.existingGroupId ? 'Аттестуемые добавлены в группу' : 'Группа и аттестуемые сохранены');
    } catch (err) {
      setState({ saving: false });
      handleError(err);
    }
  };
  H.onAddAttestee = () => setState((s) => {
    const previous = s.modal.attendees[s.modal.attendees.length - 1] || s.modal;
    return { modal: { ...s.modal, attendees: [...s.modal.attendees, newAttestee(previous)],
      activeAttesteeIndex: s.modal.attendees.length } };
  });
  function selectAttestee(index) {
    const m = state.modal;
    if (m?.type !== 'newBlock' || m.step !== 'attendees' || !m.attendees[index] || m.activeAttesteeIndex === index) return;
    const rows = elModalRoot.querySelectorAll('.attestee-table tbody tr');
    const previous = rows[m.activeAttesteeIndex];
    const current = rows[index];
    if (previous) { previous.classList.remove('is-selected'); previous.setAttribute('aria-selected', 'false'); }
    if (current) { current.classList.add('is-selected'); current.setAttribute('aria-selected', 'true'); }
    m.activeAttesteeIndex = index;
  }
  H.onSelectAttestee = (e) => {
    const index = Number(e.currentTarget.getAttribute('data-row'));
    selectAttestee(index);
  };
  H.onRemoveAttestee = (e) => {
    e.stopPropagation();
    const index = Number(e.currentTarget.getAttribute('data-row'));
    setState((s) => {
      const attendees = s.modal.attendees.filter((_, i) => i !== index);
      const selected = s.modal.activeAttesteeIndex;
      const activeAttesteeIndex = attendees.length === 0 ? null :
        selected === index ? Math.min(index, attendees.length - 1) : selected > index ? selected - 1 : selected;
      return { modal: { ...s.modal, attendees, activeAttesteeIndex },
        openDD: null, ddRowIndex: null, openCal: null, calRowIndex: null, timeDropdownOpen: false };
    });
  };
  H.onAttesteeFioChange = (e) => updateAttestee(Number(e.target.getAttribute('data-row')), { fio: e.target.value });
  H.onAttesteeNoteChange = (e) => updateAttestee(Number(e.target.getAttribute('data-row')), { note: e.target.value });

  
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
    try {
      await api.del('/api/journal/' + id);
      setState((s) => ({
        journal: s.journal.filter((r) => r.id !== id),
        tasks: s.tasks.filter((r) => r.id !== id),
        selectedRowId: s.selectedRowId === id ? null : s.selectedRowId,
      }));
      showToast('Запись удалена');
      reloadData().catch(() => {});
    } catch (err) {
      handleError(err);
    }
  };
  H.onDeleteGroupClick = async (e) => {
    e.stopPropagation();
    if (isFired() || !state.RIGHTS.grpDel) return;
    const groupId = Number(e.currentTarget.getAttribute('data-group-id'));
    if (!Number.isSafeInteger(groupId) || groupId <= 0) return;
    e.currentTarget.disabled = true;
    try {
      await api.del('/api/groups/' + groupId);
      setState((s) => ({
        BLOCKS: s.BLOCKS.filter((group) => group.id !== groupId),
        journal: s.journal.filter((row) => row.blockId !== groupId),
        tasks: s.tasks.filter((row) => row.blockId !== groupId),
        selectedBlockId: s.selectedBlockId === groupId ? null : s.selectedBlockId,
        selectedRowId: s.journal.some((row) => row.id === s.selectedRowId && row.blockId === groupId)
          ? null : s.selectedRowId,
      }));
      showToast('Группа и её записи удалены');
      reloadData().catch(handleError);
    } catch (err) {
      e.currentTarget.disabled = false;
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
      const day = parseKey(row.date);
      setState({ selectedDateKey: row.date, searchActive: false,
        calendarMonth: new Date(day.getFullYear(), day.getMonth(), 1) });
      await reloadData();
      setState({ modal: null, draftRecordId: null, saving: false, selectedRowId: row.id });
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
  let organizationsRevision = 0;
  let organizationRefreshRunning = false;
  async function reloadOrganizations() {
    organizationsRevision += 1;
    applyOrganizations(await api.get('/api/organizations'));
  }
  function organizationFormDirty() {
    if (state.orgIsNew) return true;
    const current = state.ORG_BY_ID[state.selOrgId];
    if (!current) return false;
    return state.orgFName !== current.name || state.orgFAddress !== current.address ||
      state.orgFPhone !== current.phone || state.orgFContact !== current.contact ||
      state.orgFEmail !== current.email || state.orgFNote !== (current.note || '');
  }
  async function autoRefreshOrganizations() {
    if (state.modal?.type !== 'references' || state.saving ||
        document.visibilityState === 'hidden' || organizationRefreshRunning) return;
    organizationRefreshRunning = true;
    const revision = organizationsRevision;
    try {
      const list = await api.get('/api/organizations');
      if (revision !== organizationsRevision || state.modal?.type !== 'references' || state.saving ||
          JSON.stringify(list) === JSON.stringify(state.ORGANIZATIONS)) return;
      const selectedId = state.selOrgId;
      const selectedBefore = state.ORG_BY_ID[selectedId];
      const selectedAfter = list.find((o) => o.id === selectedId);
      const preserveDraft = organizationFormDirty();
      applyOrganizations(list);
      if (!preserveDraft && (selectedId !== (selectedAfter || list[0])?.id ||
          JSON.stringify(selectedBefore) !== JSON.stringify(selectedAfter))) {
        loadOrg((selectedAfter || list[0])?.id ?? null);
      }
    } finally {
      organizationRefreshRunning = false;
    }
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
  
  H.onReferences = () => {
    if (isFired() || !state.RIGHTS.menuRefs) return;
    setState({ modal: { type: 'references' }, orgSearch: '', orgQuery: '' });
    const first = state.ORG_BY_ID[state.selOrgId] ? state.selOrgId : (state.ORGANIZATIONS[0] || {}).id;
    loadOrg(first);
    autoRefreshOrganizations().catch(() => {});
  };
  H.onOpenJournalAction = (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const kind = e.currentTarget.dataset.modal;
    if (kind !== 'newBlock' && kind !== 'references') return;
    e.preventDefault();
    if (state.mobileMenuOpen) setState({ mobileMenuOpen: false });
    if (kind === 'newBlock') H.onNewGroupMenu();
    else H.onReferences();
    if (state.modal?.type === kind) {
      state.routeModal = kind;
      window.history.replaceState(null, '', e.currentTarget.href);
    }
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
    note: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4.5" width="14" height="18" rx="2.4"/><rect x="9" y="3" width="6" height="3" rx="1" fill="white"/><path d="M10 10.5h4.5M10 14h4.5M10 17.5h4.5"/><circle cx="8" cy="10.5" r=".7" fill="currentColor" stroke="none"/><circle cx="8" cy="14" r=".7" fill="currentColor" stroke="none"/><circle cx="8" cy="17.5" r=".7" fill="currentColor" stroke="none"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    trashTable: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    trashGroup: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16"/><path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6"/><path d="M6 6l.8 13.1A2 2 0 0 0 8.8 21h6.4a2 2 0 0 0 2-1.9L18 6"/><path d="M9 10.5v6.5M12 10.5v6.5M15 10.5v6.5"/></svg>',
    trash15: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    plus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    save: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    undo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M4 9h10a6 6 0 0 1 0 12h-4"/></svg>',
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
  const fixedCategoryOpts = (currentName) => Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    const name = 'Категория ' + number;
    return { value: number, label: name, field: 'fixedCategoryNumber', selected: name === currentName };
  });

  
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
    const activeTime = m && m.type === 'newBlock' && s.timeRowIndex != null
      ? m.attendees[s.timeRowIndex].time : m && (m.type === 'newBlock' || m.type === 'record') ? m.time : '00:00';
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
      const active = s.openCal === 'from' ? s.dateFrom : s.openCal === 'to' ? s.dateTo :
        s.modal?.type === 'newBlock' && s.calRowIndex != null ? s.modal.attendees[s.calRowIndex].date : (s.modal && s.modal.date);
      out += popCalHtml(active, 'cal-' + s.openCal);
    }

    if (s.timeDropdownOpen) out += popTimeHtml();

    if (s.openDD) {
      const m = s.modal?.type === 'newBlock' && s.ddRowIndex != null
        ? s.modal.attendees[s.ddRowIndex] : s.modal || {};
      let opts = [];
      if (s.openDD === 'vtype' || s.openDD === 'type') opts = idOpts(s.TYPES, m.typeId, 'typeId');
      else if (s.openDD === 'categoryFixed') opts = fixedCategoryOpts(m.categoryName || (m.categoryId ? nameById(state.CATEGORIES, m.categoryId) : ''));
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
    return state.tasks.map((r, idx) => {
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
    const showGroupDelete = !isFired() && !!s.RIGHTS.grpDel;
    const canAdd = canAddToGroup();
    const columnCount = showDelete ? 11 : 10;
    return rows.map((r, idx) => {
      const org = s.ORG_BY_ID[r.orgId];
      const cls = ['jr-row'];
      if (s.highlightRowId === r.id) cls.push('is-highlight');
      else if (s.selectedRowId === r.id) cls.push('is-selected');
      else if (idx % 2 === 1) cls.push('is-alt');
      const hasNote = (r.note || '').trim();
      const groupHeader = showGroupDelete && (idx === 0 || rows[idx - 1].blockId !== r.blockId)
        ? '<tr class="jr-group-head" data-mk="group-' + r.blockId + '"><td colspan="' + columnCount + '">' +
            '<div class="jr-group-head__inner"><span class="jr-group-head__label">Группа · ' +
              esc(formatDateRu(r.date)) + ' · ' + esc(r.time) + ' · ' + esc(r.type) + '</span>' +
              '<button class="jr-group-delete" type="button" title="Удалить всю группу и все её записи" aria-label="Удалить всю группу и все её записи" data-group-id="' + r.blockId + '" data-click="onDeleteGroupClick">' +
                ICON.trashGroup + '<span>Удалить группу</span></button>' +
            '</div></td></tr>'
        : '';
      const delCell = canDelete(r)
        ? '<td><button class="row-icon row-icon--del" type="button" title="Удалить запись" aria-label="Удалить запись" data-id="' + r.id + '" data-click="onDeleteRowClick">' + ICON.trashTable + '</button></td>'
        : '<td></td>';

      const rowHtml = '<tr class="' + cls.join(' ') + '" data-mk="r' + r.id + '" data-id="' + r.id + '" data-click="onRowClick">' +
          '<td class="col-type"><span class="tag ' + typeClass(r.type) + '">' + esc(r.type) + '</span></td>' +
          '<td>' + formatDateShort(r.date) + '</td>' +
          '<td>' + esc(r.time) + '</td>' +
          '<td>' + r.number + '</td>' +
          '<td>' + esc(r.fio) + '</td>' +
          '<td>' + esc(r.category) + '</td>' +
          '<td>' + esc(org ? org.name : '—') + '</td>' +
          '<td>' + esc(r.executor) + '</td>' +
          '<td><span class="status status--' + statusClass(r.statusFinal) + '">' + esc(r.status) + '</span></td>' +
          '<td>' +
            '<button class="row-icon row-icon--note' + (hasNote ? '' : ' row-icon--off') + '" type="button" title="Примечание" aria-label="Открыть примечание"' +
            ' data-id="' + r.id + '" data-click="onNoteClick">' + ICON.note + '</button>' +
          '</td>' +
          (showDelete ? delCell : '') +
        '</tr>';
      const next = rows[idx + 1];
      if (next && next.blockId === r.blockId) return groupHeader + rowHtml;
      const addButton = canAdd
        ? '<a class="jr-group-add" href="' + esc(elNavNewGroup.getAttribute('href') + '?group_id=' + encodeURIComponent(r.blockId)) + '" title="Добавить аттестуемых в эту группу" aria-label="Добавить аттестуемых в эту группу" data-group-id="' + r.blockId + '" data-click="onAddAttesteeToGroup">' +
            '<span class="jr-group-add__icon" aria-hidden="true">' + ICON.plus + '</span>' +
            '<span>Добавить в группу выше</span>' +
          '</a>'
        : '';
      return groupHeader + rowHtml + '<tr class="jr-group-gap" data-mk="gap-' + r.blockId + '-' + idx + '"><td colspan="' + columnCount + '"><div class="jr-group-gap__inner">' + addButton + '</div></td></tr>';
    }).join('');
  }

  
  function modalNewBlockHtml(m) {
    const appendingToGroup = !!m.existingGroupId;
    const groupFieldsDisabled = appendingToGroup ? ' disabled' : '';
    const fields = '<div class="new-group-defaults">' +
      '<div class="field field--rel">' +
        '<span class="field__label">Дата</span>' +
        '<button class="select-btn select-btn--modal' + (m.groupValidationAttempted && !m.date ? ' attestee-invalid' : '') + '" type="button" data-cal="record" data-click="onOpenCal"' + groupFieldsDisabled + '>' +
          '<span>' + (m.date ? formatDateRu(m.date) : 'Выберите дату') + '</span>' + ICON.calendar +
        '</button>' +
      '</div>' +
      '<div class="field field--rel">' +
        '<span class="field__label">Время</span>' +
        '<button class="select-btn select-btn--modal' + (m.groupValidationAttempted && !m.time ? ' attestee-invalid' : '') + '" type="button" data-click="onToggleTimeDropdown"' + groupFieldsDisabled + '>' +
          '<span>' + esc(m.time || '00:00') + '</span>' + ICON.clock +
        '</button>' +
      '</div>' +
      '<div class="field">' +
        '<span class="field__label">Вид проверки</span>' +
        '<div style="position:relative;">' +
          '<button class="select-btn select-btn--modal' + (m.groupValidationAttempted && !m.typeId ? ' attestee-invalid' : '') + '" type="button" data-dd="vtype" data-click="onOpenDD"' + groupFieldsDisabled + '>' +
            '<span>' + esc(nameById(state.TYPES, m.typeId)) + '</span>' + ICON.chevDown +
          '</button>' +
        '</div>' +
      '</div>' +
      '</div>';
    const groupFields = appendingToGroup ? '' : fields;
    if (!canCreateRecords()) {
      return '<p class="modal-title">' + (appendingToGroup ? 'Добавление в группу' : 'Новая проверочная группа') + '</p>' + groupFields +
        '<div class="modal-foot">' +
          '<button class="btn" type="button" data-click="onCloseModal">Отмена</button>' +
          (!appendingToGroup ? '<button class="btn btn--primary" type="button" data-click="onSaveNewBlock"' + (state.saving ? ' disabled' : '') + '>Создать</button>' : '') +
        '</div>';
    }
    return '<p class="modal-title">' + (appendingToGroup ? 'Добавить аттестуемых в группу' : 'Новая проверочная группа') + '</p>' +
      '<p class="modal-sub">' + (appendingToGroup
        ? 'Новые аттестуемые будут добавлены в эту группу.'
        : 'Дата, время и вид проверки задаются здесь сразу для всех аттестуемых.') + '</p>' +
      groupFields +
      '<div class="attestee-table-wrap"><table class="attestee-table"><thead><tr>' +
        '<th>№</th><th>ФИО</th><th>Организация</th><th>Категория</th><th>Вид проверки</th>' +
        '<th>Дата</th><th>Время</th><th>Исполнитель</th><th>Примечание</th><th>Статус</th><th></th>' +
      '</tr></thead><tbody>' + m.attendees.map(attesteeRowHtml).join('') + '</tbody></table></div>' +
      '<button class="attestee-add" type="button" data-click="onAddAttestee">' + ICON.plus + ' Добавить аттестуемого</button>' +
      '<div class="modal-foot">' +
        '<button class="btn" type="button" data-click="onCloseModal">Отмена</button>' +
        '<button class="btn btn--primary" type="button" data-click="onSaveNewBlock"' + (state.saving ? ' disabled' : '') + '>' +
          (appendingToGroup ? 'Добавить в группу' : 'Сохранить группу') + '</button>' +
      '</div>';
  }

  function attesteeRowHtml(row, index) {
    const attr = ' data-row="' + index + '"';
    const org = state.ORG_BY_ID[row.orgId];
    const missing = state.modal.validationAttempted ? missingAttesteeFields(row) : {};
    const invalid = (field) => missing[field] ? ' attestee-invalid' : '';
    const select = (dd, label) => '<button class="select-btn select-btn--modal attestee-select' + invalid(dd) + '" type="button"' +
      ' data-dd="' + dd + '"' + attr + ' data-click="onOpenDD"><span class="select-btn__text">' + esc(label || '—') + '</span>' + ICON.chevDown + '</button>';
    const active = state.modal.activeAttesteeIndex === index;
    return '<tr class="' + (active ? 'is-selected' : '') + '" aria-selected="' + active + '" data-mk="attestee-' + row.key + '"' +
      attr + ' data-click="onSelectAttestee">' +
      '<td class="attestee-table__number">' + (index + 1) + '</td>' +
      '<td><input class="input attestee-input' + invalid('fio') + '" type="text" maxlength="150" placeholder="Новый аттестуемый" value="' + esc(row.fio) + '"' + attr + ' data-input="onAttesteeFioChange"></td>' +
      '<td>' + select('org', org ? org.name : 'Выберите') + '</td>' +
      '<td><button class="select-btn select-btn--modal attestee-select' + invalid('category') + '" type="button" data-dd="categoryFixed"' + attr +
        ' data-click="onOpenDD"><span class="select-btn__text">' + esc(row.categoryName || (row.categoryId ? nameById(state.CATEGORIES, row.categoryId) : 'Выберите')) + '</span>' + ICON.chevDown + '</button></td>' +
      '<td><span class="attestee-value">' + esc(nameById(state.TYPES, state.modal.typeId) || '—') + '</span></td>' +
      '<td><span class="attestee-value">' + (state.modal.date ? esc(state.modal.date.split('-').reverse().join('.')) : '—') + '</span></td>' +
      '<td><span class="attestee-value">' + esc(state.modal.time || '—') + '</span></td>' +
      '<td>' + select('exec', row.executorName || 'Выберите') + '</td>' +
      '<td><textarea class="input attestee-note" rows="2" maxlength="250" placeholder="Примечание"' + attr +
        ' data-input="onAttesteeNoteChange">' + esc(row.note || '') + '</textarea></td>' +
      '<td>' + select('status', nameById(state.STATUSES, row.statusId)) + '</td>' +
      '<td><button class="attestee-remove" type="button" title="Убрать аттестуемого" aria-label="Убрать аттестуемого"' +
        attr + ' data-click="onRemoveAttestee">' + ICON.trash + '</button></td>' +
    '</tr>';
  }

  function modalRecordHtml(m) {
    const s = state;
    const fieldsLocked = m.readOnly || m.statusOnly;
    const dis = fieldsLocked ? ' disabled' : '';
    const statusDis = m.readOnly || m.statusLocked ? ' disabled' : '';
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
          '<button class="select-btn select-btn--modal" type="button" data-dd="categoryFixed" data-click="onOpenDD"' + dis + '>' +
            '<span class="select-btn__text">' + esc(m.categoryName || (m.categoryId ? nameById(s.CATEGORIES, m.categoryId) : 'Выберите')) + '</span>' + ICON.chevDown +
          '</button>' +
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
        '<td class="col-name"><span class="ref-mobile-fade">' + esc(o.name) + '</span></td>' +
        '<td class="col-address"><span class="ref-mobile-fade">' + esc(o.address) + '</span></td>' +
        '<td class="col-phone"><span class="ref-mobile-fade">' + esc(o.phone) + '</span></td>' +
        '<td class="col-contact"><span class="ref-mobile-fade">' + esc(o.contact) + '</span></td>' +
        '<td class="col-email"><span class="ref-mobile-fade">' + esc(o.email) + '</span></td>' +
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
            '<div class="ref-toolbar__actions" role="group" aria-label="Действия со справочником организаций">' +
              '<button class="tool-btn tool-btn--action" type="button" title="Добавить организацию" data-click="onOrgAdd">' + ICON.plus + '<span>Добавить</span></button>' +
              '<button class="tool-btn tool-btn--action tool-btn--primary" type="button" title="Сохранить" data-click="onOrgSave">' + ICON.save + '<span>Сохранить</span></button>' +
              '<button class="tool-btn tool-btn--action" type="button" title="Отмена" data-click="onOrgCancel">' + ICON.undo + '<span>Отмена</span></button>' +
              '<span class="ref-toolbar__spacer"></span>' +
              '<button class="tool-btn tool-btn--action ' + (selOrg ? 'tool-btn--del' : 'tool-btn--off') + '"' +
              ' type="button" title="Удалить организацию" data-click="onOrgDelete">' + ICON.trash15 + '<span>Удалить</span></button>' +
            '</div>' +
          '</div>' +

          '<div class="ref-table-box">' +
            '<table class="jr-table jr-table--ref">' +
              '<thead><tr>' +
                '<th class="col-no">id</th><th class="col-name">Наименование</th><th class="col-address">Адрес</th>' +
                '<th class="col-phone">Телефон</th><th class="col-contact">Контактное лицо</th><th class="col-email">e-mail</th>' +
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
              '<textarea class="input input--sm" rows="4" data-input="onOrgFNote"' + dis + '>' + esc(s.orgFNote) + '</textarea>' +
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
    if (m.type === 'newBlock') { inner = modalNewBlockHtml(m); if (m.step === 'attendees') extraClass = ' jr-modal-card--new-group'; }
    else if (m.type === 'record') { inner = modalRecordHtml(m); extraClass = ' jr-modal-card--record'; }
    else if (m.type === 'note') inner = modalNoteHtml(m);
    else if (m.type === 'org') inner = modalOrgHtml(m);
    else if (m.type === 'references') { inner = modalReferencesHtml(); extraClass = ' jr-modal-card--wide jr-modal-card--references'; }

    const overlayClass = m.type === 'references' ? ' modal-overlay--references' : '';
    return '<div class="modal-overlay' + overlayClass + '" data-mk="overlay">' +
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
        return '<div class="toast' + cls + (t.kind === 'validation' ? ' toast--validation' : '') + '" data-mk="tst' + t.id + '"><span class="toast__text">' + esc(t.msg) + '</span></div>';
      }).join('') +
      '</div>';
  }

  
  function mobileMenuHtml() {
    if (!state.mobileMenuOpen) return '';
    const r = state.RIGHTS;
    return '<div class="scrim" data-mk="mscrim" data-click="onCloseMobileMenu"></div>' +
      '<div class="menu-pop" data-mk="mpop">' +
        (r.grpAdd ? '<a class="menu-item menu-item--link" data-mk="mnew" data-modal="newBlock" data-click="onOpenJournalAction" href="' + esc(elNavNewGroup.getAttribute('href')) + '">Новая группа</a>' : '') +
        (r.menuRefs ? '<a class="menu-item menu-item--link" data-mk="mref" data-modal="references" data-click="onOpenJournalAction" href="' + esc(elNavRefs.getAttribute('href')) + '">Справочники</a>' : '') +
        (r.menuSettings && state.adminUrl ? '<a class="menu-item menu-item--link" data-mk="musers" href="' + esc(state.adminUrl) + '">Управление пользователями</a>' : '') +
      '</div>';
  }

  


  const { patch, patchRows, bindEvents } = OMSA.createRenderer(H);

  const el = (id) => document.getElementById(id);
  const elApp = el('app');
  const elMonthLabel = el('monthLabel'), elCalWeekdays = el('calWeekdays'), elCalCells = el('calCells');
  const elSelectedDate = el('selectedDate');
  const elTasksBody = el('tasksBody'), elTasksEmpty = el('tasksEmpty');
  const elTaskViewPicker = document.querySelector('.task-view-picker');
  const elTaskTabsList = document.querySelector('.task-tabs');
  const elTasksPanel = el('tasksPanel');
  const elTaskPanelScrim = el('taskPanelScrim');
  const elTaskTabs = TASK_VIEWS.map((view) => el(TASK_TAB_IDS[view]));
  const elJournalBody = el('journalBody'), elJournalEmpty = el('journalEmpty'), elThDelete = el('thDelete');
  const elSearchFio = el('searchFio'), elSearchClear = el('searchClear');
  const elExecLabel = el('execLabel'), elExecChev = el('execChev'), elExecMenu = el('execMenu');
  const elDateFromLabel = el('dateFromLabel'), elDateToLabel = el('dateToLabel');
  const elDatesPair = el('datesPair'), elCalFromBtn = el('calFromBtn'), elCalToBtn = el('calToBtn');
  const elChkNoLimit = el('chkNoLimit');
  const elOrgName = el('orgName'), elOrgPhone = el('orgPhone'), elOrgContact = el('orgContact'), elOrgEmail = el('orgEmail');
  const elNavNewGroup = el('navNewGroup'), elNavRefs = el('navRefs'), elNavUsers = el('navUsers');
  const elMobileMenu = el('mobileMenu'), elPopovers = el('popovers');
  const elModalRoot = el('modalRoot'), elToastRoot = el('toastRoot');

  elModalRoot.addEventListener('pointerdown', (event) => {
    const target = event.target;
    const row = target.closest?.('.attestee-table tbody tr[data-row]');
    if (row && !target.closest('.attestee-remove')) selectAttestee(Number(row.getAttribute('data-row')));
  }, true);

  function setCheck(node, on) {
    node.classList.toggle('is-on', on);
    const mark = node.firstElementChild;
    if (on && !mark) node.innerHTML = ICON.checkWhite;
    else if (!on && mark) node.innerHTML = '';
  }

  let weekdaysDrawn = false;
  let renderedTasksView = null;
  let renderedTasksDropdownOpen = false;

  function render() {
    const s = state;

    if (!s.dataLoaded) {
      elApp.hidden = !!(window.OMSA_LOGIN_LOADING && window.OMSA_LOGIN_LOADING.active);
      return;
    }
    if (window.OMSA_LOGIN_LOADING) window.OMSA_LOGIN_LOADING.hide();
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

    const taskViews = availableTaskViews();
    elTaskViewPicker.classList.toggle('is-open', s.tasksDropdownOpen);
    elTaskTabsList.classList.toggle('task-tabs--centered', !taskViews.includes('others'));
    elTasksPanel.hidden = !s.tasksDropdownOpen;
    elTaskPanelScrim.hidden = !s.tasksDropdownOpen;
    if (s.tasksDropdownOpen && !renderedTasksDropdownOpen) {
      elTasksPanel.classList.remove('task-panel--rising');
      void elTasksPanel.offsetWidth;
      elTasksPanel.classList.add('task-panel--rising');
    }
    renderedTasksDropdownOpen = s.tasksDropdownOpen;
    elTaskTabs.forEach((tab) => {
      const view = tab.getAttribute('data-task-view');
      const visible = taskViews.includes(view);
      const selected = view === s.tasksView;
      tab.hidden = !visible;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected && visible ? 0 : -1;
    });
    elTasksPanel.setAttribute('aria-labelledby', TASK_TAB_IDS[s.tasksView]);
    elTasksPanel.dataset.view = s.tasksView;
    if (renderedTasksView !== s.tasksView) {
      elTasksPanel.classList.remove('task-panel--rising');
      void elTasksPanel.offsetWidth;
      elTasksPanel.classList.add('task-panel--rising');
      renderedTasksView = s.tasksView;
    }
    setCheck(elChkNoLimit, s.noDateLimit);

    
    const org = getSelectedOrg();
    elOrgName.textContent = org ? org.name : '—';
    elOrgPhone.textContent = org && org.phone ? org.phone : '—';
    elOrgContact.textContent = org && org.contact ? org.contact : '—';
    elOrgEmail.textContent = org && org.email ? org.email : '—';

    
    const tasks = s.tasks;
    patchRows(elTasksBody, tasksHtml());
    elTasksEmpty.hidden = tasks.length > 0;

    const journalRows = getVisibleJournal();
    elThDelete.hidden = isFired() || !r.jrnDel;
    patchRows(elJournalBody, journalHtml(journalRows));
    elJournalEmpty.hidden = journalRows.length > 0;

    
    patch(elMobileMenu, mobileMenuHtml());
    patch(elPopovers, popoversHtml());
    patch(elModalRoot, modalHtml());
    patch(elToastRoot, toastsHtml());

    document.body.classList.toggle('is-locked', !!s.modal);
  }

  


  const notifications = new OMSA.NotificationCenter(api);

  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', onNotificationMessage);
  bindEvents(document);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') autoRefreshOrganizations().catch(() => {});
  });
  bootstrap();
})();
