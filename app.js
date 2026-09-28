const $ = s => document.querySelector(s);
const view = $('#view'), msg = $('#msg');
// API Client
const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
};
// Toast Notifications
const say = (text, isGood = false) => {
  msg.textContent = text;
  msg.className = isGood ? 'good' : '';
  if (text) setTimeout(() => { msg.textContent = ''; msg.className = ''; }, 4000);
};
// Reusable Components
const tag = v => `<span class="tag ${v}">${v}</span>`;
const table = (heads, rows) => `
  <div style="overflow-x:auto;">
    <table>
      <thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('') || `<tr><td colspan="${heads.length}" style="text-align:center; color:#64748b; padding:2rem;">No records found.</td></tr>`}</tbody>
    </table>
  </div>
`;
const field = (n, l, t = 'text', extra = '') => `
  <label>${l}<input name="${n}" type="${t}" ${extra} required></label>
`;
const bind = (sel, fn) => $(sel).addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await fn(Object.fromEntries(new FormData(e.target)));
  } catch (err) {
    say(err.message, false);
  }
});
// App Views
const views = {
  async dashboard() {
    const s = await api('/api/summary');
    const st = (n, l, a) => `
      <div class="stat ${a && n ? 'alert' : ''}">
        <b>${n}</b>
        <span>${l}</span>
      </div>
    `;
    view.innerHTML = `
      <h2>
        <span>TinyDotFood Overview</span>
        <button onclick="views.dashboard()" style="font-size:0.75rem; padding:0.4rem 0.8rem; background:rgba(255,255,255,0.08); box-shadow:none;">↻ Refresh</button>
      </h2>
      <div class="grid">
        ${st(s.lots, 'Ingredient Lots Tracked')}
        ${st(s.quarantined, 'In Quarantine', 1)}
        ${st(s.expiringSoon, 'Expiring in 90 Days', 1)}
        ${st(s.batches, 'Production Batches')}
        ${st(s.qcPending, 'QC Pending Tests', 1)}
        ${st(s.qcFailed, 'QC Failed / Isolated', 1)}
        ${st(s.shipments, 'Dispatched Shipments')}
      </div>
      <div class="box">
        <h3>⚡ TinyDotFood Walkthrough</h3>
        <p style="color:var(--text-muted); font-size:0.9rem; line-height:1.6; margin-bottom:1rem;">
          Welcome to <b>TinyDotFood</b>. Raw ingredients are received and placed into quarantine. Once released, record your manufacturing batch recipes with automatic stock deduction, ship to verified customers, and run instant supply-chain recall simulations.
        </p>
        <div style="display:flex; gap:0.75rem; flex-wrap:wrap;">
          <button onclick="go('lots')">1. Inspect Lots</button>
          <button onclick="go('batches')" style="background:linear-gradient(135deg, #f59e0b, #d97706);">2. View Batches</button>
          <button onclick="go('trace')" style="background:linear-gradient(135deg, #10b981, #059669);">3. Instant Recall Drill 🔍</button>
        </div>
      </div>
    `;
  },
  async lots() {
    const lots = await api('/api/lots');
    view.innerHTML = `
      <h2>Ingredient Lots (Raw Intake)</h2>
      <div class="box">
        <h3>+ Receive Raw Material Lot</h3>
        <form id="f">
          ${field('ingredient', 'Ingredient', 'text', 'placeholder="e.g. Organic Rolled Oats"')}
          ${field('supplier', 'Supplier', 'text', 'placeholder="e.g. Nordic Grain Co."')}
          ${field('qty', 'Quantity', 'number', 'min="1" step="any" placeholder="100"')}
          <label>Unit
            <select name="unit">
              <option>kg</option>
              <option>L</option>
              <option>units</option>
            </select>
          </label>
          ${field('expiry', 'Expiry Date', 'date')}
          <button type="submit">Receive Lot</button>
        </form>
      </div>
      <div class="box">
        <h3>Active Lots Inventory</h3>
        ${table(['Lot ID', 'Ingredient', 'Supplier', 'Stock Left', 'Expiry', 'Status', 'QA Actions'], lots.map(l => `
          <tr>
            <td><code>${l.id}</code></td>
            <td><b>${l.ingredient}</b></td>
            <td style="color:var(--text-muted);">${l.supplier}</td>
            <td><b>${l.qty}</b> ${l.unit}</td>
            <td>${l.expiry}</td>
            <td>${tag(l.status)}</td>
            <td>${['Released', 'Quarantine', 'Rejected'].filter(x => x !== l.status).map(x => `
              <button class="mini" data-id="${l.id}" data-s="${x}">Set ${x}</button>
            `).join('')}</td>
          </tr>
        `))}
      </div>
    `;
    bind('#f', async d => {
      await api('/api/lots', 'POST', d);
      say('✓ Lot received into TinyDotFood storage under Quarantine.', true);
      views.lots();
    });
    view.querySelectorAll('.mini').forEach(b => b.onclick = async () => {
      await api(`/api/lots/${b.dataset.id}/status`, 'PATCH', { status: b.dataset.s });
      say(`✓ ${b.dataset.id} status updated to ${b.dataset.s}.`, true);
      views.lots();
    });
  },
  async batches() {
    const [batches, lots] = await Promise.all([api('/api/batches'), api('/api/lots')]);
    const ok = lots.filter(l => l.status === 'Released' && l.qty > 0);
    view.innerHTML = `
      <h2>Production Batches (Manufacturing)</h2>
      <div class="box">
        <h3>+ Record Manufacturing Batch</h3>
        <form id="f">
          ${field('product', 'Finished Product', 'text', 'placeholder="e.g. Honey Oat Granola"')}
          ${field('qty', 'Units Produced', 'number', 'min="1" placeholder="300"')}
          <label>Source Input Lot (Released Only)
            <select name="lotId">
              ${ok.length ? ok.map(l => `<option value="${l.id}">${l.id} · ${l.ingredient} (${l.qty} ${l.unit} available)</option>`).join('') : '<option disabled>No released lots available</option>'}
            </select>
          </label>
          ${field('lotQty', 'Quantity Used', 'number', 'min="1" step="any" placeholder="50"')}
          <button type="submit" ${!ok.length ? 'disabled style="opacity:0.5;"' : ''}>Produce Batch</button>
        </form>
      </div>
      <div class="box">
        <h3>Production History &amp; Quality Control</h3>
        ${table(['Batch ID', 'Product', 'Yield Units', 'Date', 'Input Lots Consumed', 'QC Status', 'QA Review'], batches.map(b => `
          <tr>
            <td><code style="color:var(--amber);">${b.id}</code></td>
            <td><b>${b.product}</b></td>
            <td>${b.qty} units</td>
            <td style="color:var(--text-muted);">${b.date}</td>
            <td>${b.inputs.map(i => `<span style="background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px; font-family:var(--font-mono); font-size:0.75rem;">${i.lotId} (${i.qty})</span>`).join(', ')}</td>
            <td>${tag(b.qc)}</td>
            <td>${['Pass', 'Fail'].filter(x => x !== b.qc).map(x => `
              <button class="mini" data-id="${b.id}" data-s="${x}">Set ${x}</button>
            `).join('')}</td>
          </tr>
        `))}
      </div>
    `;
    bind('#f', async d => {
      await api('/api/batches', 'POST', { product: d.product, qty: d.qty, inputs: [{ lotId: d.lotId, qty: d.lotQty }] });
      say('✓ Batch successfully logged. Raw material deducted.', true);
      views.batches();
    });
    view.querySelectorAll('.mini').forEach(b => b.onclick = async () => {
      await api(`/api/batches/${b.dataset.id}/qc`, 'PATCH', { qc: b.dataset.s });
      say(`✓ QC evaluation for ${b.dataset.id} set to ${b.dataset.s}.`, true);
      views.batches();
    });
  },
  async shipments() {
    const [ships, batches] = await Promise.all([api('/api/shipments'), api('/api/batches')]);
    const passed = batches.filter(b => b.qc === 'Pass');
    view.innerHTML = `
      <h2>Shipments &amp; Distribution</h2>
      <div class="box">
        <h3>+ Dispatch Shipment to Customer</h3>
        <form id="f">
          <label>Batch (Passed QC Only)
            <select name="batchId">
              ${passed.length ? passed.map(b => `<option value="${b.id}">${b.id} · ${b.product} (${b.qty} units)</option>`).join('') : '<option disabled>No passed batches ready to dispatch</option>'}
            </select>
          </label>
          ${field('customer', 'Customer / Store', 'text', 'placeholder="e.g. NatureMarket Store #104"')}
          ${field('qty', 'Quantity Shipped', 'number', 'min="1" placeholder="100"')}
          <button type="submit" ${!passed.length ? 'disabled style="opacity:0.5;"' : ''}>Dispatch Shipment</button>
        </form>
      </div>
      <div class="box">
        <h3>Distribution Log</h3>
        ${table(['Shipment ID', 'Batch ID', 'Customer Recipient', 'Units', 'Dispatch Date'], ships.map(s => `
          <tr>
            <td><code style="color:var(--blue);">${s.id}</code></td>
            <td><code>${s.batchId}</code></td>
            <td><b>${s.customer}</b></td>
            <td>${s.qty} units</td>
            <td style="color:var(--text-muted);">${s.date}</td>
          </tr>
        `))}
      </div>
    `;
    bind('#f', async d => {
      await api('/api/shipments', 'POST', d);
      say('✓ Shipment dispatched with live tracking ID.', true);
      views.shipments();
    });
  },
  trace() {
    view.innerHTML = `
      <h2>Trace &amp; Recall Engine</h2>
      <div class="box">
        <h3>Trace Supply-Chain Lineage</h3>
        <form id="f">
          ${field('id', 'Scan Barcode or Enter Lot/Batch ID', 'text', 'id="trace-input" placeholder="e.g. LOT-1001 or BAT-2001"')}
          <button type="submit">Run Instant Trace</button>
        </form>
        <div style="margin-top:1rem; font-size:0.82rem; color:var(--text-dim); display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <b>⚡ Quick Test Shortcuts:</b>
          <button type="button" class="mini" onclick="runDemo('LOT-1001')">Try LOT-1001</button>
          <button type="button" class="mini" onclick="runDemo('LOT-1002')">Try LOT-1002</button>
          <button type="button" class="mini" onclick="runDemo('BAT-2001')">Try BAT-2001</button>
        </div>
      </div>
      <div id="out"></div>
    `;
    window.runDemo = id => {
      $('#trace-input').value = id;
      $('#f').dispatchEvent(new Event('submit'));
    };
    bind('#f', async d => {
      const r = await api(`/api/trace/${encodeURIComponent(d.id.trim())}`);
      const node = (a, b) => `<div class="node"><b>${a}</b><div style="font-size:0.82rem; color:var(--text-muted);">${b}</div></div>`;
      const ships = r.shipments.map(s => node(s.customer, `<code style="color:var(--blue);">${s.id}</code> · ${s.qty} units`)).join('') 
        || '<span style="color:var(--text-dim);">No customer shipments found.</span>';
      $('#out').innerHTML = r.type === 'lot'
        ? `
          <div class="box">
            <h3>Origin Lot: ${r.lot.id} (${r.lot.ingredient})</h3>
            <p style="color:var(--text-muted); font-size:0.88rem; margin-bottom:1rem;">Supplier: <b>${r.lot.supplier}</b> · Status: ${tag(r.lot.status)}</p>
            <h4 style="font-size:0.85rem; color:var(--coral); text-transform:uppercase; letter-spacing:0.05em; margin-top:1rem;">Batches Produced from this Lot:</h4>
            <div class="chain">${r.batches.map(b => node(b.product, `<code>${b.id}</code> · QC: ${tag(b.qc)}`)).join('') || '<span>Not used in any batch yet.</span>'}</div>
            <h4 style="font-size:0.85rem; color:var(--rose); text-transform:uppercase; letter-spacing:0.05em; margin-top:1rem;">Commercial Recall Blast Radius (Notify Immediately):</h4>
            <div class="chain">${ships}</div>
          </div>
        `
        : `
          <div class="box">
            <h3>Batch Genealogy: ${r.batch.id} (${r.batch.product})</h3>
            <p style="color:var(--text-muted); font-size:0.88rem; margin-bottom:1rem;">Produced: <b>${r.batch.date}</b> · QC: ${tag(r.batch.qc)}</p>
            <h4 style="font-size:0.85rem; color:var(--coral); text-transform:uppercase; letter-spacing:0.05em; margin-top:1rem;">Ingredient Lots Consumed:</h4>
            <div class="chain">${r.lots.map(l => node(l.ingredient, `<code>${l.id}</code> from ${l.supplier}<br>${l.used} ${l.unit} used`)).join('')}</div>
            <h4 style="font-size:0.85rem; color:var(--blue); text-transform:uppercase; letter-spacing:0.05em; margin-top:1rem;">Customer Distribution:</h4>
            <div class="chain">${ships}</div>
          </div>
        `;
      msg.textContent = '';
    });
  }
};
// Navigation Router
const go = v => {
  msg.textContent = '';
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  views[v]();
};
$('#nav').addEventListener('click', e => {
  const btn = e.target.closest('button[data-v]');
  if (btn) go(btn.dataset.v);
});
// Initialize on Dashboard
go('dashboard');
