const $ = s => document.querySelector(s);
const view = $('#view'), msg = $('#msg');
const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
};
const say = (t, good) => { msg.textContent = t; msg.className = good ? 'good' : ''; };
const tag = v => `<span class="tag ${v}">${v}</span>`;
const table = (heads, rows) => `<table><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr>${rows.join('') || `<tr><td colspan="${heads.length}">Nothing here yet.</td></tr>`}</table>`;
const field = (n, l, t = 'text', extra = '') => `<label>${l}<input name="${n}" type="${t}" ${extra} required></label>`;
const bind = (sel, fn) => $(sel).addEventListener('submit', async e => {
  e.preventDefault();
  try { await fn(Object.fromEntries(new FormData(e.target))); } catch (err) { say(err.message); }
});

const views = {
  async dashboard() {
    const s = await api('/api/summary');
    const st = (n, l, a) => `<div class="stat ${a && n ? 'alert' : ''}"><b>${n}</b><span>${l}</span></div>`;
    view.innerHTML = `<h2>Dashboard</h2><div class="grid">${st(s.lots, 'Ingredient lots')}${st(s.quarantined, 'In quarantine', 1)}${st(s.expiringSoon, 'Expiring in 90 days', 1)}${st(s.batches, 'Production batches')}${st(s.qcPending, 'QC pending', 1)}${st(s.qcFailed, 'QC failed', 1)}${st(s.shipments, 'Shipments')}</div>
    <div class="box">Receive ingredients under <b>Ingredient lots</b>, release them after inspection, record a batch, then trace any lot or batch under <b>Trace &amp; recall</b>.</div>`;
  },
  async lots() {
    const lots = await api('/api/lots');
    view.innerHTML = `<h2>Ingredient lots</h2><div class="box"><form id="f">${field('ingredient', 'Ingredient')}${field('supplier', 'Supplier')}${field('qty', 'Quantity', 'number', 'min="1" step="any"')}<label>Unit<select name="unit"><option>kg</option><option>L</option><option>units</option></select></label>${field('expiry', 'Expiry date', 'date')}<button>Receive lot</button></form></div>
    <div class="box">${table(['Lot', 'Ingredient', 'Supplier', 'Left', 'Expiry', 'Status', ''], lots.map(l => `<tr><td>${l.id}</td><td>${l.ingredient}</td><td>${l.supplier}</td><td>${l.qty} ${l.unit}</td><td>${l.expiry}</td><td>${tag(l.status)}</td><td>${['Released', 'Quarantine', 'Rejected'].filter(x => x !== l.status).map(x => `<button class="mini" data-id="${l.id}" data-s="${x}">${x}</button>`).join('')}</td></tr>`))}</div>`;
    bind('#f', async d => { await api('/api/lots', 'POST', d); say('Lot received. It stays in quarantine until released.', 1); views.lots(); });
    view.querySelectorAll('.mini').forEach(b => b.onclick = async () => { await api(`/api/lots/${b.dataset.id}/status`, 'PATCH', { status: b.dataset.s }); views.lots(); });
  },
  async batches() {
    const [batches, lots] = await Promise.all([api('/api/batches'), api('/api/lots')]);
    const ok = lots.filter(l => l.status === 'Released' && l.qty > 0);
    view.innerHTML = `<h2>Production batches</h2><div class="box"><form id="f">${field('product', 'Product')}${field('qty', 'Units produced', 'number', 'min="1"')}<label>Input lot<select name="lotId">${ok.map(l => `<option value="${l.id}">${l.id} · ${l.ingredient} (${l.qty} ${l.unit})</option>`).join('')}</select></label>${field('lotQty', 'Quantity used', 'number', 'min="1" step="any"')}<button>Record batch</button></form></div>
    <div class="box">${table(['Batch', 'Product', 'Units', 'Date', 'Input lots', 'QC', ''], batches.map(b => `<tr><td>${b.id}</td><td>${b.product}</td><td>${b.qty}</td><td>${b.date}</td><td>${b.inputs.map(i => i.lotId).join(', ')}</td><td>${tag(b.qc)}</td><td>${['Pass', 'Fail'].filter(x => x !== b.qc).map(x => `<button class="mini" data-id="${b.id}" data-s="${x}">${x}</button>`).join('')}</td></tr>`))}</div>`;
    bind('#f', async d => { await api('/api/batches', 'POST', { product: d.product, qty: d.qty, inputs: [{ lotId: d.lotId, qty: d.lotQty }] }); say('Batch recorded. Set the QC result when testing is done.', 1); views.batches(); });
    view.querySelectorAll('.mini').forEach(b => b.onclick = async () => { await api(`/api/batches/${b.dataset.id}/qc`, 'PATCH', { qc: b.dataset.s }); views.batches(); });
  },
  async shipments() {
    const [ships, batches] = await Promise.all([api('/api/shipments'), api('/api/batches')]);
    view.innerHTML = `<h2>Shipments</h2><div class="box"><form id="f"><label>Batch<select name="batchId">${batches.filter(b => b.qc === 'Pass').map(b => `<option value="${b.id}">${b.id} · ${b.product}</option>`).join('')}</select></label>${field('customer', 'Customer')}${field('qty', 'Units', 'number', 'min="1"')}<button>Ship batch</button></form></div>
    <div class="box">${table(['Shipment', 'Batch', 'Customer', 'Units', 'Date'], ships.map(s => `<tr><td>${s.id}</td><td>${s.batchId}</td><td>${s.customer}</td><td>${s.qty}</td><td>${s.date}</td></tr>`))}</div>`;
    bind('#f', async d => { await api('/api/shipments', 'POST', d); say('Shipment recorded.', 1); views.shipments(); });
  },
  trace() {
    view.innerHTML = `<h2>Trace &amp; recall</h2><div class="box"><form id="f">${field('id', 'Lot or batch ID', 'text', 'placeholder="LOT-1001 or BAT-2001"')}<button>Trace</button></form></div><div id="out"></div>`;
    bind('#f', async d => {
      const r = await api(`/api/trace/${encodeURIComponent(d.id)}`);
      const node = (a, b) => `<div class="node"><b>${a}</b><br>${b}</div>`;
      const ships = r.shipments.map(s => node(s.customer, `${s.id} · ${s.qty} units from ${s.batchId}`)).join('') || '<span>No shipments yet.</span>';
      $('#out').innerHTML = r.type === 'lot'
        ? `<div class="box"><h3>Lot ${r.lot.id}: ${r.lot.ingredient} from ${r.lot.supplier}</h3><p>Used in these batches:</p><div class="chain">${r.batches.map(b => node(b.id, `${b.product} · QC ${b.qc}`)).join('') || '<span>Not used yet.</span>'}</div><p>Customers to notify:</p><div class="chain">${ships}</div></div>`
        : `<div class="box"><h3>Batch ${r.batch.id}: ${r.batch.product} · QC ${r.batch.qc}</h3><p>Made from these ingredient lots:</p><div class="chain">${r.lots.map(l => node(l.id, `${l.ingredient} · ${l.supplier}<br>${l.used} ${l.unit} used`)).join('')}</div><p>Shipped to:</p><div class="chain">${ships}</div></div>`;
      msg.textContent = '';
    });
  }
};
const go = v => { msg.textContent = ''; document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); views[v](); };
$('#nav').addEventListener('click', e => e.target.dataset.v && go(e.target.dataset.v));
go('dashboard');
