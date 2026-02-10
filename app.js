/*
 * app.js
 * ------
 * Expense Guard (Offline-first PWA)
 *
 * What this app does:
 *  - Track expenses (works offline)
 *  - Optionally mark an expense as a subscription (renews every N days)
 *  - Monthly budget warnings
 *  - Premium (one-time purchase) removes ads only
 *
 * Payments:
 *  - When distributed on Google Play as a Trusted Web Activity (TWA), we use
 *    Google Play Billing via the Digital Goods API + Payment Request API.
 *  - Outside Play/TWA, the premium button will show a helpful message.
 */

(async () => {
  // ------------------- Configuration -------------------

  // Change this to match your Google Play Console Product ID (Managed Product).
  const PREMIUM_SKU = 'premium_unlock';

  // How many days before renewal to show a warning.
  const RENEW_WARNING_DAYS = 3;

  const DEFAULT_SETTINGS = {
    currency: 'USD',
    monthlyBudget: 0,
    warnAtPercent: 80,
    budgetNotice: null,
    lastNudgeDate: null,
  };

  // ------------------- DOM helpers -------------------

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const toastEl = $('toast');

  function toast(msg, tone = 'info') {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-show');
    toastEl.dataset.tone = tone;
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('is-show'), 2200);
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function safeDb(promise, msg) {
    try {
      await promise;
      return true;
    } catch (e) {
      console.error(e);
      toast(msg, 'bad');
      return false;
    }
  }

  async function safeDbValue(promise, fallback, msg) {
    try {
      const value = await promise;
      return value ?? fallback;
    } catch (e) {
      console.error(e);
      toast(msg, 'bad');
      return fallback;
    }
  }

  // ------------------- Date / money helpers -------------------

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function monthKey(dateISO) {
    return String(dateISO).slice(0, 7);
  }

  function prevMonthKey(mKey) {
    const [y, m] = String(mKey).split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    d.setUTCMonth(d.getUTCMonth() - 1);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
  }

  function daysInMonthUTC(year, monthIndex) {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  }

  function dayOfMonthFromISO(dateISO) {
    const parts = String(dateISO).split('-').map(Number);
    return parts[2] || 1;
  }

  function utcTimeFromISO(dateISO) {
    const [y, m, d] = String(dateISO).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function addDays(dateISO, days) {
    const t = utcTimeFromISO(dateISO) + Number(days || 0) * 86400000;
    const d = new Date(t);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  function daysBetween(aISO, bISO) {
    const a = utcTimeFromISO(aISO);
    const b = utcTimeFromISO(bISO);
    return Math.round((b - a) / 86400000);
  }

  function money(settings, amount) {
    const cur = settings.currency || 'USD';
    const n = Number(amount || 0);
    return `${cur} ${Math.round(n)}`;
  }

  // ------------------- State -------------------

  /** @type {Array<any>} */
  let expenses = [];
  let settings = { ...DEFAULT_SETTINGS };
  let isPremium = false;
  let currentMonth = monthKey(todayKey());
  let currentCategory = 'all';
  const subNoticeCache = new Set();

  // ------------------- DOM elements -------------------

  // Stats
  const statToday = $('stat-today');
  const statMonth = $('stat-month');
  const statBudget = $('stat-budget');
  const adFreeStatus = $('adfree-status');
  const adSlot = $('ad-slot');

  // Tabs
  const tabs = $$('.tab');
  const panels = {
    expenses: $('tab-expenses'),
    subscriptions: $('tab-subscriptions'),
    reports: $('tab-reports'),
    settings: $('tab-settings'),
  };

  // Expenses
  const monthPicker = $('month-picker');
  const categoryFilter = $('category-filter');
  const expenseList = $('expense-list');
  const expenseEmpty = $('expense-empty');
  const btnOpenAdd = $('btn-open-add');

  // Subscriptions
  const subList = $('sub-list');
  const subEmpty = $('sub-empty');
  const btnOpenAddSub = $('btn-open-add-sub');

  // Reports
  const breakdown = $('category-breakdown');
  const leakHints = $('leak-hints');
  const btnExport = $('btn-export');

  // Settings
  const budgetInput = $('budget-input');
  const btnSaveBudget = $('btn-save-budget');
  const btnExportJson = $('btn-export-json');
  const btnImportJson = $('btn-import-json');
  const importFile = $('import-file');

  // Monetization / billing buttons
  const btnUpgrade = $('btn-upgrade');
  const btnRestore = $('btn-restore');

  // Modal
  const modal = $('modal');
  const modalForm = $('modal-form');
  const modalTitle = $('modal-title');
  const fieldType = $('field-type');
  const fieldAmount = $('field-amount');
  const fieldCategory = $('field-category');
  const fieldNote = $('field-note');
  const fieldDate = $('field-date');
  const renewalField = $('renewal-field');
  const fieldRenewalDays = $('field-renewal-days');
  const btnDelete = $('btn-delete');

  let editingId = null;

  // ------------------- Rendering -------------------

  function computeTotalsForMonth(mKey) {
    const monthItems = expenses.filter((e) => e.monthKey === mKey);
    const total = monthItems.reduce((s, e) => s + e.amount, 0);
    return { monthItems, total };
  }

  async function refreshExpenses() {
    expenses = await safeDbValue(window.ExpenseDB.getAllExpenses(), [], 'Could not load expenses.');
  }

  function renderStats() {
    const t = todayKey();
    const todayTotal = expenses.filter((e) => e.date === t).reduce((s, e) => s + e.amount, 0);
    const { total: monthTotal } = computeTotalsForMonth(currentMonth);

    statToday.textContent = money(settings, todayTotal);
    statMonth.textContent = money(settings, monthTotal);

    if (settings.monthlyBudget > 0) {
      statBudget.textContent = money(settings, settings.monthlyBudget);
      const pct = Math.round((monthTotal / settings.monthlyBudget) * 100);
      const level = pct >= 100 ? 100 : pct >= settings.warnAtPercent ? settings.warnAtPercent : 0;
      if (level > 0) {
        const notice = settings.budgetNotice || { month: '', level: 0 };
        if (notice.month !== currentMonth || Number(notice.level || 0) < level) {
          if (level >= 100) toast(`Budget exceeded: ${pct}% used.`, 'bad');
          else toast(`Budget warning: ${pct}% used.`, 'warn');
          settings.budgetNotice = { month: currentMonth, level };
          void safeDb(window.ExpenseDB.saveSettings(settings), 'Could not save budget notice.');
        }
      }
    } else {
      statBudget.textContent = 'Not set';
    }
  }

  function renderExpenseList() {
    const items = expenses
      .filter((e) => e.monthKey === currentMonth)
      .filter((e) => (currentCategory === 'all' ? true : e.category === currentCategory))
      .sort((a, b) => {
        const at = a.createdAt ?? a.updatedAt ?? Date.parse(a.date);
        const bt = b.createdAt ?? b.updatedAt ?? Date.parse(b.date);
        return bt - at;
      });

    expenseList.innerHTML = '';
    expenseEmpty.style.display = items.length ? 'none' : 'block';

    for (const e of items) {
      const li = document.createElement('li');
      li.className = 'item';
      li.innerHTML = `
        <div>
          <h3>${escapeHtml(e.note || e.category)}</h3>
          <p>${escapeHtml(e.category)} - ${escapeHtml(e.date)}${e.isSubscription ? ' - Subscription' : ''}</p>
        </div>
        <div>
          <div class="amount">${money(settings, e.amount)}</div>
          <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:6px;">
            <button class="btn btn-ghost" data-action="edit" data-id="${e.id}">Edit</button>
          </div>
        </div>
      `;
      expenseList.appendChild(li);
    }
  }

  function nextRenewalDate(sub) {
    // Compute next renewal date by stepping from sub.date in increments of renewalDays.
    const start = sub.date;
    const every = Number(sub.renewalDays || 30);
    if (!start || !every) return '';
    let d = start;
    const today = todayKey();
    while (d < today) d = addDays(d, every);
    return d;
  }

  function renderSubscriptions() {
    subList.innerHTML = '';
    const subs = expenses
      .filter((e) => e.isSubscription)
      .map((s) => ({ ...s, next: nextRenewalDate(s) }))
      .sort((a, b) => (a.next || '').localeCompare(b.next || ''));

    if (!subs.length) {
      subEmpty.style.display = 'block';
      subEmpty.textContent = 'No subscriptions yet.';
      return;
    }

    subEmpty.style.display = 'none';
    for (const s of subs) {
      const days = s.next ? daysBetween(todayKey(), s.next) : null;
      const soon = typeof days === 'number' && days >= 0 && days <= RENEW_WARNING_DAYS;
      const overdue = typeof days === 'number' && days < 0;
      const pillClass = overdue ? 'bad' : soon ? 'warn' : 'good';
      const pillText = overdue ? `Overdue ${Math.abs(days)}d` : soon ? `Renews in ${days}d` : `Renews ${s.next}`;

      const li = document.createElement('li');
      li.className = 'item';
      li.innerHTML = `
        <div>
          <h3>${escapeHtml(s.note || s.category)}</h3>
          <p>${escapeHtml(s.category)} - every ${escapeHtml(String(s.renewalDays || 30))} days</p>
        </div>
        <div>
          <div class="amount">${money(settings, s.amount)}</div>
          <div class="pill ${pillClass}" style="margin-top:6px; justify-content:flex-end;">${pillText}</div>
        </div>
      `;
      subList.appendChild(li);

      if (soon || overdue) {
        const noticeKey = `${s.id}:${s.next}:${overdue ? 'overdue' : 'soon'}`;
        if (!subNoticeCache.has(noticeKey)) {
          if (soon) toast(`Subscription: ${s.note || s.category} renews soon.`, 'warn');
          if (overdue) toast(`Subscription overdue: ${s.note || s.category}.`, 'bad');
          subNoticeCache.add(noticeKey);
        }
      }
    }
  }

  function renderReports() {
    const { monthItems, total } = computeTotalsForMonth(currentMonth);

    // Category breakdown
    const byCat = new Map();
    for (const e of monthItems) byCat.set(e.category, (byCat.get(e.category) || 0) + e.amount);
    const rows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);

    breakdown.innerHTML = rows.length
      ? rows
          .map(
            ([cat, amt]) => `
              <div class="cardline" style="display:flex; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid rgba(233,238,252,0.08);">
                <div>${escapeHtml(cat)}</div>
                <div style="font-weight:800">${money(settings, amt)}</div>
              </div>`
          )
          .join('')
      : '<p class="muted">No data yet.</p>';

    // Leak hints (simple heuristics)
    leakHints.innerHTML = '';
    const hints = [];
    if (total > 0 && settings.monthlyBudget > 0) {
      const pct = Math.round((total / settings.monthlyBudget) * 100);
      hints.push(`You used ${pct}% of your budget this month.`);
    }
    if (total > 0) {
      const today = todayKey();
      const [y, m] = currentMonth.split('-').map(Number);
      const daysSoFar = currentMonth === monthKey(today) ? dayOfMonthFromISO(today) : daysInMonthUTC(y, m - 1);
      const avg = Math.round(total / Math.max(1, daysSoFar));
      hints.push(`Average spend per day: ${money(settings, avg)}.`);
    }
    const prevKey = prevMonthKey(currentMonth);
    const prevTotal = computeTotalsForMonth(prevKey).total;
    if (prevTotal > 0 && total > 0) {
      const deltaPct = Math.round(((total - prevTotal) / prevTotal) * 100);
      if (deltaPct === 0) {
        hints.push('Spending is flat vs last month.');
      } else {
        const trend = deltaPct > 0 ? `up ${Math.abs(deltaPct)}%` : `down ${Math.abs(deltaPct)}%`;
        hints.push(`Spending is ${trend} vs last month.`);
      }
    }
    if (rows[0]) hints.push(`Top spend category: ${rows[0][0]} (${money(settings, rows[0][1])}).`);
    if (rows[1]) hints.push(`Second category: ${rows[1][0]} (${money(settings, rows[1][1])}).`);
    const subCount = expenses.filter((e) => e.isSubscription).length;
    if (subCount) hints.push(`You have ${subCount} subscription(s). Check if you still need them.`);
    if (!subCount) hints.push('Tip: mark repeating bills as subscriptions to get renewal alerts.');

    const recentCutoff = utcTimeFromISO(todayKey()) - 60 * 86400000;
    const freq = new Map();
    for (const e of expenses) {
      const t = utcTimeFromISO(e.date);
      if (t < recentCutoff || e.isSubscription) continue;
      const key = (e.note || e.category || 'Other').trim().toLowerCase();
      if (!key) continue;
      freq.set(key, (freq.get(key) || 0) + 1);
    }
    const recurring = [...freq.entries()].find(([, count]) => count >= 3);
    if (recurring) {
      const label = recurring[0].length > 40 ? recurring[0].slice(0, 40) + '...' : recurring[0];
      hints.push(`Possible recurring expense: "${label}" appears ${recurring[1]} times in 60 days.`);
    }

    for (const h of hints) {
      const li = document.createElement('li');
      li.textContent = h;
      leakHints.appendChild(li);
    }

    // Export gating
    btnExport.disabled = false;
    btnExport.title = 'Export this month as CSV';
  }

  function renderAdsAndPremium() {
    adFreeStatus.textContent = isPremium ? 'Ad-Free' : 'Free';
    if (isPremium) {
      adSlot.style.display = 'none';
      btnUpgrade.textContent = 'Ad-Free Active';
      btnUpgrade.disabled = true;
    } else {
      adSlot.style.display = 'block';
      btnUpgrade.textContent = 'Go Ad-Free';
      btnUpgrade.disabled = false;
    }
  }

  function renderAll() {
    renderStats();
    renderExpenseList();
    renderSubscriptions();
    renderReports();
    renderAdsAndPremium();
  }

  // ------------------- Modal (Add/Edit) -------------------

  function openModal(mode, existing) {
    editingId = existing ? existing.id : null;

    modalTitle.textContent = mode === 'edit' ? 'Edit item' : existing?.isSubscription ? 'Add subscription' : 'Add expense';

    fieldType.value = existing?.isSubscription ? 'subscription' : 'expense';
    fieldAmount.value = existing ? String(existing.amount) : '';
    fieldCategory.value = existing?.category || 'Other';
    fieldNote.value = existing?.note || '';
    fieldDate.value = existing?.date || todayKey();
    fieldRenewalDays.value = existing?.renewalDays ? String(existing.renewalDays) : '30';

    const isSub = fieldType.value === 'subscription';
    renewalField.hidden = !isSub;
    btnDelete.hidden = !existing;

    modal.showModal();
  }

  async function onSaveModal() {
    const isSub = fieldType.value === 'subscription';
    const amount = Number(fieldAmount.value || 0);
    if (!amount || amount <= 0) {
      toast('Amount must be > 0.', 'bad');
      return false;
    }

    const date = fieldDate.value || todayKey();
    const obj = {
      id: editingId || Date.now(),
      amount: Math.round(amount),
      category: fieldCategory.value || 'Other',
      note: fieldNote.value.trim(),
      date,
      monthKey: monthKey(date),
      isSubscription: isSub,
      renewalDays: isSub ? Math.max(1, Number(fieldRenewalDays.value || 30)) : null,
      createdAt: editingId ? undefined : Date.now(),
      updatedAt: Date.now(),
    };

    // Keep createdAt for edits
    if (editingId) {
      const existing = expenses.find((e) => e.id === editingId);
      obj.createdAt = existing?.createdAt || Date.now();
    }

    const saved = await safeDb(window.ExpenseDB.saveExpense(obj), 'Save failed. Please try again.');
    if (!saved) return false;
    await refreshExpenses();
    toast('Saved.', 'good');
    return true;
  }

  async function onDeleteModal() {
    if (!editingId) return;
    const ok = confirm('Delete this item?');
    if (!ok) return;
    const deleted = await safeDb(window.ExpenseDB.deleteExpense(editingId), 'Delete failed. Please try again.');
    if (!deleted) return;
    await refreshExpenses();
    toast('Deleted.', 'info');
    modal.close();
    renderAll();
  }

  // ------------------- CSV Export -------------------

  function toCSV(items) {
    const headers = ['date', 'category', 'note', 'amount', 'isSubscription', 'renewalDays'];
    const lines = [headers.join(',')];
    for (const e of items) {
      const row = [
        e.date,
        csvCell(e.category),
        csvCell(e.note),
        String(e.amount),
        e.isSubscription ? 'true' : 'false',
        e.renewalDays ? String(e.renewalDays) : '',
      ];
      lines.push(row.join(','));
    }
    return lines.join('\n');
  }

  function csvCell(v) {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replaceAll('"', '""') + '"';
    return s;
  }

  function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadJSON(obj, filename) {
    const json = JSON.stringify(obj, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportCurrentMonth() {
    const items = expenses.filter((e) => e.monthKey === currentMonth);
    const csv = toCSV(items);
    downloadCSV(csv, `expense-guard-${currentMonth}.csv`);
  }

  function normalizeExpenses(list) {
    const idBase = Date.now();
    const out = [];
    for (let i = 0; i < (list || []).length; i += 1) {
      const raw = list[i] || {};
      const amount = Math.round(Number(raw.amount || 0));
      const date = raw.date || todayKey();
      if (!amount || !date) continue;
      const isSub = Boolean(raw.isSubscription);
      out.push({
        id: Number(raw.id) || idBase + i,
        amount,
        category: String(raw.category || 'Other'),
        note: String(raw.note || '').trim(),
        date,
        monthKey: monthKey(date),
        isSubscription: isSub,
        renewalDays: isSub ? Math.max(1, Number(raw.renewalDays || 30)) : null,
        createdAt: Number(raw.createdAt) || Date.now(),
        updatedAt: Date.now(),
      });
    }
    return out;
  }

  async function exportBackup() {
    const items = await safeDbValue(window.ExpenseDB.getAllExpenses(), [], 'Export failed.');
    const storedSettings = await safeDbValue(window.ExpenseDB.getSettings(), settings, 'Export failed.');
    const ent = await safeDbValue(window.ExpenseDB.getEntitlement(), { isPremium: false }, 'Export failed.');
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { ...storedSettings, currency: 'USD' },
      entitlement: { isPremium: Boolean(ent?.isPremium) },
      expenses: items,
    };
    downloadJSON(payload, `expense-guard-backup-${todayKey()}.json`);
    toast('Backup exported.', 'good');
  }

  async function importBackup(file) {
    if (!file) return;
    const ok = confirm('Importing will replace your current data. Continue?');
    if (!ok) return;
    let data = null;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch (e) {
      console.error(e);
      toast('Invalid backup file.', 'bad');
      return;
    }
    if (!data || !Array.isArray(data.expenses)) {
      toast('Invalid backup file.', 'bad');
      return;
    }

    const normalized = normalizeExpenses(data.expenses);
    const newSettings = {
      ...DEFAULT_SETTINGS,
      ...(data.settings || {}),
      currency: 'USD',
      monthlyBudget: Math.max(0, Number(data.settings?.monthlyBudget || 0)),
      warnAtPercent: Math.max(1, Math.min(100, Number(data.settings?.warnAtPercent || 80))),
      budgetNotice: null,
      lastNudgeDate: null,
    };
    const newPremium = Boolean(data.entitlement?.isPremium);

    const replaced = await safeDb(window.ExpenseDB.replaceAllExpenses(normalized), 'Import failed.');
    if (!replaced) return;
    await safeDb(window.ExpenseDB.saveSettings(newSettings), 'Import failed.');
    await safeDb(window.ExpenseDB.setEntitlement(newPremium), 'Import failed.');

    settings = { ...DEFAULT_SETTINGS, ...newSettings };
    isPremium = newPremium;
    budgetInput.value = settings.monthlyBudget || '';
    await refreshExpenses();
    renderAll();
    toast('Backup imported.', 'good');
  }

  // ------------------- Google Play Billing (One-time) -------------------

  async function isPlayBillingAvailable() {
    return 'getDigitalGoodsService' in window;
  }

  async function getPlayService() {
    return await window.getDigitalGoodsService('https://play.google.com/billing');
  }

  async function acknowledgePurchaseOnBackend(purchaseToken, sku) {
    // IMPORTANT: In production, DO NOT trust the client.
    // Implement a backend endpoint to verify + acknowledge purchases.
    // This demo accepts any non-empty token.
    return Boolean(purchaseToken && sku);
  }

  async function setPremium(value) {
    isPremium = Boolean(value);
    await safeDb(window.ExpenseDB.setEntitlement(isPremium), 'Could not save premium status.');
    renderAll();
  }

  async function restorePremium() {
    if (!(await isPlayBillingAvailable())) {
      toast('Restore works only in the Play Store app version.', 'warn');
      return;
    }
    try {
      const service = await getPlayService();
      const purchases = await service.listPurchases();
      const has = purchases.some((p) => p.itemId === PREMIUM_SKU);
      if (has) {
        await setPremium(true);
        toast('Premium restored.', 'good');
      } else {
        toast('No premium purchase found.', 'info');
      }
    } catch (e) {
      console.error(e);
      toast('Restore failed.', 'bad');
    }
  }

  async function buyPremium() {
    if (!(await isPlayBillingAvailable())) {
      toast('Google Billing requires the Play Store version (TWA).', 'warn');
      return;
    }
    try {
      // Payment Request API method for Play Billing.
      const paymentMethods = [
        {
          supportedMethods: 'https://play.google.com/billing',
          data: { sku: PREMIUM_SKU },
        },
      ];
      // Required by Payment Request API but ignored by Play Billing.
      const paymentDetails = {
        total: { label: 'Total', amount: { currency: 'USD', value: '0' } },
      };

      const request = new PaymentRequest(paymentMethods, paymentDetails);
      const response = await request.show();
      const token = response.details?.purchaseToken;

      const ok = await acknowledgePurchaseOnBackend(token, PREMIUM_SKU);
      if (ok) {
        await response.complete('success');
        await setPremium(true);
        toast('Premium unlocked. Thank you!', 'good');
      } else {
        await response.complete('fail');
        toast('Verification failed.', 'bad');
      }
    } catch (e) {
      console.error(e);
      toast('Purchase cancelled or failed.', 'warn');
    }
  }

  // ------------------- Events -------------------

  function setTab(name) {
    tabs.forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
    Object.entries(panels).forEach(([k, el]) => el.classList.toggle('is-active', k === name));
  }

  tabs.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  monthPicker.value = currentMonth;
  monthPicker.addEventListener('change', () => {
    currentMonth = monthPicker.value || currentMonth;
    renderAll();
  });
  categoryFilter.addEventListener('change', () => {
    currentCategory = categoryFilter.value;
    renderAll();
  });

  btnOpenAdd.addEventListener('click', () => openModal('add', { isSubscription: false }));
  btnOpenAddSub.addEventListener('click', () => openModal('add', { isSubscription: true }));

  fieldType.addEventListener('change', () => {
    renewalField.hidden = fieldType.value !== 'subscription';
  });

  modalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitter = e.submitter;
    if (submitter && submitter.value === 'cancel') {
      modal.close();
      return;
    }
    const ok = await onSaveModal();
    if (ok) {
      modal.close();
      renderAll();
    }
  });
  btnDelete.addEventListener('click', onDeleteModal);

  expenseList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;
    if (action === 'edit') {
      const existing = expenses.find((x) => x.id === id);
      if (existing) openModal('edit', existing);
    }
  });

  btnExport.addEventListener('click', exportCurrentMonth);
  if (btnExportJson) btnExportJson.addEventListener('click', exportBackup);
  if (btnImportJson && importFile) {
    btnImportJson.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
      const file = importFile.files && importFile.files[0];
      await importBackup(file);
      importFile.value = '';
    });
  }

  btnSaveBudget.addEventListener('click', async () => {
    settings.monthlyBudget = Number(budgetInput.value || 0);
    settings.budgetNotice = null;
    const ok = await safeDb(window.ExpenseDB.saveSettings(settings), 'Could not save budget.');
    if (ok) toast('Budget saved.', 'good');
    renderAll();
  });

  btnUpgrade.addEventListener('click', buyPremium);
  btnRestore.addEventListener('click', restorePremium);

  // Register SW for offline
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // ------------------- Boot -------------------

  // Load settings
  const storedSettings = await safeDbValue(window.ExpenseDB.getSettings(), null, 'Could not load settings.');
  if (storedSettings) settings = { ...DEFAULT_SETTINGS, ...storedSettings };
  if (settings.currency !== 'USD') {
    settings.currency = 'USD';
    void safeDb(window.ExpenseDB.saveSettings(settings), 'Could not update currency.');
  }
  budgetInput.value = settings.monthlyBudget || '';

  // Load premium entitlement
  const ent = await safeDbValue(window.ExpenseDB.getEntitlement(), null, 'Could not load premium status.');
  isPremium = Boolean(ent?.isPremium);

  // Load expenses
  await refreshExpenses();

  renderAll();

  // Gentle reminder while app is open (local-only)
  setTimeout(async () => {
    const today = todayKey();
    const hasToday = expenses.some((e) => e.date === today);
    if (hasToday) return;
    if (settings.lastNudgeDate === today) return;
    toast('No expense logged today. Add one to stay on track.', 'info');
    settings.lastNudgeDate = today;
    void safeDb(window.ExpenseDB.saveSettings(settings), 'Could not save reminder.');
  }, 15000);
})();
