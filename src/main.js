import ExtensionsAPI from 'sn-extension-api';
import './style.css';

// --- Markdown parsing/serialization ---

function parseTransactions(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const rows = [];
  for (const line of lines) {
    const match = line.match(
      /^\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([0-9.,]+)\s*\|\s*(\S+)\s*\|\s*([0-9.,]+)\s*\|\s*([0-9.,]+)\s*\|/
    );
    if (match) {
      rows.push({
        date: match[1],
        source: match[2].trim(),
        description: match[3].trim(),
        amount: parseFloat(match[4].replace(/,/g, '')),
        currency: match[5].trim(),
        rate: parseFloat(match[6].replace(/,/g, '')),
        amountLei: parseFloat(match[7].replace(/,/g, '')),
      });
    }
  }
  return rows;
}

function pad(str, len) {
  const s = String(str);
  return s + ' '.repeat(Math.max(0, len - s.length));
}

function fmtNum(n) {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function serializeMarkdown(transactions) {
  let md = '# Income & Taxes\n\n## Transactions\n\n';

  if (transactions.length === 0) {
    md += '| Date       | Source   | Description | Amount  | Currency | Rate   | Amount LEI |\n';
    md += '| ---------- | -------- | ----------- | ------- | -------- | ------ | ---------- |\n';
    return md;
  }

  const dateW = 10;
  const srcW = Math.max(6, ...transactions.map(t => t.source.length));
  const descW = Math.max(11, ...transactions.map(t => t.description.length));
  const amtW = Math.max(6, ...transactions.map(t => fmtNum(t.amount).length));
  const curW = Math.max(8, ...transactions.map(t => t.currency.length));
  const rateW = Math.max(6, ...transactions.map(t => fmtNum(t.rate).length));
  const leiW = Math.max(10, ...transactions.map(t => fmtNum(t.amountLei).length));

  md += `| ${pad('Date', dateW)} | ${pad('Source', srcW)} | ${pad('Description', descW)} | ${pad('Amount', amtW)} | ${pad('Currency', curW)} | ${pad('Rate', rateW)} | ${pad('Amount LEI', leiW)} |\n`;
  md += `| ${'-'.repeat(dateW)} | ${'-'.repeat(srcW)} | ${'-'.repeat(descW)} | ${'-'.repeat(amtW)} | ${'-'.repeat(curW)} | ${'-'.repeat(rateW)} | ${'-'.repeat(leiW)} |\n`;

  for (const t of transactions) {
    md += `| ${pad(t.date, dateW)} | ${pad(t.source, srcW)} | ${pad(t.description, descW)} | ${pad(fmtNum(t.amount), amtW)} | ${pad(t.currency, curW)} | ${pad(fmtNum(t.rate), rateW)} | ${pad(fmtNum(t.amountLei), leiW)} |\n`;
  }

  return md;
}

// --- State ---

let transactions = [];
let editorKit = null;
let editingIndex = null;
let selectedYear = null;

// --- Helpers ---

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatLei(n) {
  return n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getYears() {
  const years = new Set(transactions.map(t => t.date.slice(0, 4)));
  return [...years].sort().reverse();
}

function getFiltered() {
  if (!selectedYear) return transactions;
  return transactions.filter(t => t.date.startsWith(selectedYear));
}

function getUnique(field) {
  const vals = new Set(transactions.map(t => t[field]));
  return [...vals].sort();
}

// --- Tax computation ---

function computeCASS(totalLei) {
  if (totalLei < 24300) return 0;
  if (totalLei < 48600) return 2430;
  if (totalLei < 97200) return 4860;
  return 9720;
}

function computeTax(totalLei) {
  const incomeTax = Math.round(totalLei * 0.10 * 100) / 100;
  const cass = computeCASS(totalLei);
  return { incomeTax, cass, total: incomeTax + cass };
}

// --- Default exchange rates ---

function defaultRate(currency) {
  const c = currency.toUpperCase();
  if (c === 'LEI') return 1;
  if (c === 'EUR') return 5.0;
  if (c === 'USD') return 4.4;
  return 1;
}

// --- Rendering ---

function renderYearSelector() {
  const select = document.getElementById('year-select');
  const years = getYears();
  if (years.length === 0) {
    const currentYear = new Date().getFullYear().toString();
    years.push(currentYear);
  }
  if (!selectedYear || !years.includes(selectedYear)) {
    selectedYear = years[0];
  }
  select.innerHTML = years.map(y => `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}</option>`).join('');
}

function renderSelectOptions() {
  const sourceSel = document.getElementById('income-source');
  const currencySel = document.getElementById('income-currency');
  sourceSel.innerHTML = getUnique('source').map(v => `<option value="${v}">${v}</option>`).join('');
  currencySel.innerHTML = getUnique('currency').map(v => `<option value="${v}">${v}</option>`).join('');
}

function renderSummary() {
  const filtered = getFiltered();
  const totalLei = filtered.reduce((s, t) => s + t.amountLei, 0);
  const sources = new Set(filtered.map(t => t.source));

  const statsEl = document.getElementById('summary-stats');
  if (filtered.length === 0) {
    statsEl.innerHTML = '<div class="summary-stats"><span class="stat-pill">No income recorded</span></div>';
  } else {
    statsEl.innerHTML = '<div class="summary-stats">' +
      `<span class="stat-pill">Total: <strong>${formatLei(totalLei)} LEI</strong></span>` +
      `<span class="stat-pill">${filtered.length} transaction${filtered.length !== 1 ? 's' : ''}</span>` +
      `<span class="stat-pill">${sources.size} source${sources.size !== 1 ? 's' : ''}</span>` +
      '</div>';
  }

  document.getElementById('summary-title').textContent = `Summary ${selectedYear}`;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function renderMonthlyStats() {
  const filtered = getFiltered();
  const monthly = {};
  for (const t of filtered) {
    const m = parseInt(t.date.slice(5, 7)) - 1;
    monthly[m] = (monthly[m] || 0) + t.amountLei;
  }

  const el = document.getElementById('monthly-stats');
  el.innerHTML = '<div class="monthly-stats">' +
    MONTHS.map((name, i) => {
      const val = monthly[i] || 0;
      const cls = val > 0 ? 'month-pill has-value' : 'month-pill';
      return `<span class="${cls}">${name}: <strong>${val > 0 ? formatLei(val) : '0'}</strong></span>`;
    }).join('') +
    '</div>';
}

function renderSourceStats() {
  const filtered = getFiltered();
  const bySource = {};
  for (const t of filtered) {
    bySource[t.source] = (bySource[t.source] || 0) + t.amountLei;
  }

  const el = document.getElementById('source-stats');
  const entries = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = '<div class="source-stats">' +
    entries.map(([source, total]) =>
      `<span class="source-pill">${escapeHtml(source)}: <strong>${formatLei(total)} LEI</strong></span>`
    ).join('') +
    '</div>';
}

function renderTax() {
  const filtered = getFiltered();
  const totalLei = filtered.reduce((s, t) => s + t.amountLei, 0);
  const { incomeTax, cass, total } = computeTax(totalLei);

  document.getElementById('tax-title').textContent = `Tax Calculation ${selectedYear}`;

  const el = document.getElementById('tax-details');
  el.innerHTML = `<div class="tax-card">
    <div class="tax-row"><span class="tax-label">Income</span><span class="tax-value">${formatLei(totalLei)} LEI</span></div>
    <div class="tax-row"><span class="tax-label">Tax (10%)</span><span class="tax-value">${formatLei(incomeTax)} LEI</span></div>
    <div class="tax-row"><span class="tax-label">CASS</span><span class="tax-value">${formatLei(cass)} LEI</span></div>
    <div class="tax-row tax-total"><span class="tax-label">Total to pay</span><span class="tax-value">${formatLei(total)} LEI</span></div>
  </div>`;
}

function renderTransactions() {
  const filtered = getFiltered();
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

  const tbody = document.querySelector('#transactions-table tbody');
  tbody.innerHTML = sorted.map((t) => {
    const globalIdx = transactions.indexOf(t);
    return `<tr>
      <td>${t.date}</td>
      <td>${escapeHtml(t.source)}</td>
      <td>${escapeHtml(t.description)}</td>
      <td class="amount-cell">${t.amount.toLocaleString()}</td>
      <td>${escapeHtml(t.currency)}</td>
      <td>${fmtNum(t.rate)}</td>
      <td class="amount-cell">${formatLei(t.amountLei)}</td>
      <td><button class="btn btn-small btn-edit" data-action="edit" data-index="${globalIdx}">edit</button> <button class="btn btn-small btn-danger" data-action="delete" data-index="${globalIdx}">x</button></td>
    </tr>`;
  }).join('');
}

function render() {
  renderYearSelector();
  renderSummary();
  renderMonthlyStats();
  renderSourceStats();
  renderTax();
  renderTransactions();
  renderSelectOptions();
}

// --- Save ---

function save() {
  const text = serializeMarkdown(transactions);
  if (editorKit) {
    editorKit.text = text;
  }
}

// --- Form helpers ---

function updateComputedLei() {
  const amount = parseFloat(document.getElementById('income-amount').value) || 0;
  const rate = parseFloat(document.getElementById('income-rate').value) || 0;
  const lei = Math.round(amount * rate * 100) / 100;
  document.getElementById('computed-lei').textContent = formatLei(lei) + ' LEI';
}

function updateRateVisibility() {
  const newCur = document.getElementById('new-currency').value.trim();
  const selCur = document.getElementById('income-currency').value;
  const currency = (newCur || selCur || '').toUpperCase();
  const rateRow = document.getElementById('rate-row');

  if (currency === 'LEI') {
    rateRow.style.display = 'none';
    document.getElementById('income-rate').value = '1';
  } else {
    rateRow.style.display = 'block';
    const currentRate = parseFloat(document.getElementById('income-rate').value);
    if (!currentRate || currentRate === 1) {
      document.getElementById('income-rate').value = defaultRate(currency);
    }
  }
  updateComputedLei();
}

// --- Event handlers ---

function setupEvents() {
  const addBtn = document.getElementById('add-income-btn');
  const form = document.getElementById('add-income-form');

  addBtn.addEventListener('click', () => {
    editingIndex = null;
    document.getElementById('save-income').textContent = 'Save';
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    document.getElementById('income-date').value = todayStr();
    document.getElementById('new-source').value = '';
    document.getElementById('income-description').value = '';
    document.getElementById('new-currency').value = '';
    document.getElementById('income-amount').value = '';
    document.getElementById('income-rate').value = '';
    renderSelectOptions();
    updateRateVisibility();
  });

  document.getElementById('cancel-income').addEventListener('click', () => {
    editingIndex = null;
    document.getElementById('save-income').textContent = 'Save';
    form.style.display = 'none';
  });

  document.getElementById('save-income').addEventListener('click', () => {
    const date = document.getElementById('income-date').value;
    const newSource = document.getElementById('new-source').value.trim();
    const source = newSource || document.getElementById('income-source').value;
    const description = document.getElementById('income-description').value.trim();
    const newCurrency = document.getElementById('new-currency').value.trim();
    const currency = (newCurrency || document.getElementById('income-currency').value).toUpperCase();
    const amount = parseFloat(document.getElementById('income-amount').value);
    const rate = currency === 'LEI' ? 1 : parseFloat(document.getElementById('income-rate').value);
    const amountLei = Math.round(amount * rate * 100) / 100;

    if (!date || !source || !description || !amount || !rate) return;

    const entry = { date, source, description, amount, currency, rate, amountLei };

    if (editingIndex !== null) {
      transactions[editingIndex] = entry;
      editingIndex = null;
      document.getElementById('save-income').textContent = 'Save';
    } else {
      transactions.unshift(entry);
    }

    document.getElementById('new-source').value = '';
    document.getElementById('income-description').value = '';
    document.getElementById('income-amount').value = '';
    document.getElementById('new-currency').value = '';
    document.getElementById('income-rate').value = '';
    form.style.display = 'none';
    render();
    save();
  });

  // Year selector
  document.getElementById('year-select').addEventListener('change', (e) => {
    selectedYear = e.target.value;
    render();
  });

  // Currency changes → update rate visibility
  document.getElementById('income-currency').addEventListener('change', updateRateVisibility);
  document.getElementById('new-currency').addEventListener('input', updateRateVisibility);

  // Amount/rate changes → update computed LEI
  document.getElementById('income-amount').addEventListener('input', updateComputedLei);
  document.getElementById('income-rate').addEventListener('input', updateComputedLei);

  // Table action buttons (event delegation)
  document.getElementById('transactions-table').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index);

    if (btn.dataset.action === 'edit') {
      editingIndex = idx;
      const t = transactions[idx];
      document.getElementById('income-date').value = t.date;
      renderSelectOptions();
      document.getElementById('income-source').value = t.source;
      document.getElementById('new-source').value = '';
      document.getElementById('income-description').value = t.description;
      document.getElementById('income-currency').value = t.currency;
      document.getElementById('new-currency').value = '';
      document.getElementById('income-amount').value = t.amount;
      document.getElementById('income-rate').value = t.rate;
      updateRateVisibility();
      updateComputedLei();
      document.getElementById('save-income').textContent = 'Update';
      form.style.display = 'block';
    } else if (btn.dataset.action === 'delete') {
      transactions.splice(idx, 1);
      render();
      save();
    }
  });
}

// --- Init ---

function initExtension() {
  editorKit = ExtensionsAPI;
  editorKit.initialize();

  editorKit.subscribe((text) => {
    transactions = parseTransactions(text || '');
    render();
  });
}

function initDemo() {
  const demoText = `# Income & Taxes

## Transactions

| Date       | Source     | Description              | Amount   | Currency | Rate   | Amount LEI |
| ---------- | --------- | ------------------------ | -------- | -------- | ------ | ---------- |
| 2025-03-15 | Freelance    | Web development project  | 2000.00  | EUR      | 1.08   | 2160.00    |
| 2025-06-01 | Dividends    | Q2 dividend payment      | 500.00   | USD      | 1.0    | 500.00     |
| 2025-07-20 | Freelance    | Mobile app consulting    | 3500.00  | EUR      | 1.07   | 3745.00    |
| 2025-09-10 | Other income | Sold equipment           | 1500.00  | GBP      | 1.26   | 1890.00    |
| 2025-11-05 | Dividends    | Q4 dividend payment      | 750.00   | USD      | 1.0    | 750.00     |
`;

  transactions = parseTransactions(demoText);
  render();
}

setupEvents();

if (window.parent !== window) {
  initExtension();
} else {
  initDemo();
}
