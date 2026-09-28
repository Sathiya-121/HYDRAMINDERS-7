const express = require('express');
const path = require('path');
const app = express();
app.use(express.json());
// All files sit in the repo root; serve only the three frontend files.
['index.html', 'style.css', 'app.js'].forEach(f =>
  app.get(f === 'index.html' ? ['/', '/index.html'] : '/' + f, (_, res) => res.sendFile(path.join(__dirname, f))));

// In-memory store with seed data (resets on restart; swap for Postgres later).
const db = {
  lots: [
    { id: 'LOT-1001', ingredient: 'Wheat Flour', supplier: 'Sri Mills', qty: 380, unit: 'kg', received: '2026-09-20', expiry: '2027-03-20', status: 'Released' },
    { id: 'LOT-1002', ingredient: 'Sugar', supplier: 'Annapoorna Traders', qty: 260, unit: 'kg', received: '2026-09-21', expiry: '2027-06-01', status: 'Released' },
    { id: 'LOT-1003', ingredient: 'Palm Oil', supplier: 'Coastal Agro', qty: 200, unit: 'L', received: '2026-09-24', expiry: '2027-01-15', status: 'Quarantine' }
  ],
  batches: [
    { id: 'BAT-2001', product: 'Butter Biscuits', qty: 400, date: '2026-09-25', qc: 'Pass',
      inputs: [{ lotId: 'LOT-1001', qty: 120 }, { lotId: 'LOT-1002', qty: 40 }] }
  ],
  shipments: [
    { id: 'SHP-3001', batchId: 'BAT-2001', customer: 'FreshMart Chennai', qty: 200, date: '2026-09-27' }
  ]
};
const nextId = (prefix, arr, start) => `${prefix}-${start + arr.length}`;
const today = () => new Date().toISOString().slice(0, 10);

app.get('/healthz', (_, res) => res.send('ok'));

app.get('/api/summary', (_, res) => {
  const soon = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  res.json({
    lots: db.lots.length,
    quarantined: db.lots.filter(l => l.status === 'Quarantine').length,
    expiringSoon: db.lots.filter(l => l.expiry <= soon).length,
    batches: db.batches.length,
    qcPending: db.batches.filter(b => b.qc === 'Pending').length,
    qcFailed: db.batches.filter(b => b.qc === 'Fail').length,
    shipments: db.shipments.length
  });
});

app.get('/api/lots', (_, res) => res.json(db.lots));
app.post('/api/lots', (req, res) => {
  const { ingredient, supplier, qty, unit, expiry } = req.body;
  if (!ingredient || !supplier || !(qty > 0) || !expiry) return res.status(400).json({ error: 'ingredient, supplier, qty and expiry are required' });
  const lot = { id: nextId('LOT', db.lots, 1001), ingredient, supplier, qty: +qty, unit: unit || 'kg', received: today(), expiry, status: 'Quarantine' };
  db.lots.push(lot); res.status(201).json(lot);
});
app.patch('/api/lots/:id/status', (req, res) => {
  const lot = db.lots.find(l => l.id === req.params.id);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });
  if (!['Released', 'Quarantine', 'Rejected'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  lot.status = req.body.status; res.json(lot);
});

app.get('/api/batches', (_, res) => res.json(db.batches));
app.post('/api/batches', (req, res) => {
  const { product, qty, inputs } = req.body;
  if (!product || !(qty > 0) || !Array.isArray(inputs) || !inputs.length) return res.status(400).json({ error: 'product, qty and at least one input lot are required' });
  for (const i of inputs) {
    const lot = db.lots.find(l => l.id === i.lotId);
    if (!lot) return res.status(400).json({ error: `Lot ${i.lotId} not found` });
    if (lot.status !== 'Released') return res.status(400).json({ error: `${lot.id} is ${lot.status}; only Released lots can be used` });
    if (+i.qty > lot.qty) return res.status(400).json({ error: `${lot.id} has only ${lot.qty} ${lot.unit} left` });
  }
  inputs.forEach(i => { db.lots.find(l => l.id === i.lotId).qty -= +i.qty; });
  const batch = { id: nextId('BAT', db.batches, 2001), product, qty: +qty, date: today(), qc: 'Pending', inputs: inputs.map(i => ({ lotId: i.lotId, qty: +i.qty })) };
  db.batches.push(batch); res.status(201).json(batch);
});
app.patch('/api/batches/:id/qc', (req, res) => {
  const b = db.batches.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Batch not found' });
  if (!['Pass', 'Fail', 'Pending'].includes(req.body.qc)) return res.status(400).json({ error: 'Invalid QC result' });
  b.qc = req.body.qc; res.json(b);
});

app.get('/api/shipments', (_, res) => res.json(db.shipments));
app.post('/api/shipments', (req, res) => {
  const { batchId, customer, qty } = req.body;
  const b = db.batches.find(x => x.id === batchId);
  if (!b || !customer || !(qty > 0)) return res.status(400).json({ error: 'Valid batchId, customer and qty are required' });
  if (b.qc !== 'Pass') return res.status(400).json({ error: `${b.id} QC is ${b.qc}; only passed batches can ship` });
  const shipped = db.shipments.filter(s => s.batchId === b.id).reduce((a, s) => a + s.qty, 0);
  if (shipped + +qty > b.qty) return res.status(400).json({ error: `Only ${b.qty - shipped} units left in ${b.id}` });
  const s = { id: nextId('SHP', db.shipments, 3001), batchId, customer, qty: +qty, date: today() };
  db.shipments.push(s); res.status(201).json(s);
});

// Traceability: lot -> forward (batches, customers); batch -> backward (lots) + forward (customers)
app.get('/api/trace/:id', (req, res) => {
  const id = req.params.id.trim().toUpperCase();
  const lot = db.lots.find(l => l.id === id);
  if (lot) {
    const batches = db.batches.filter(b => b.inputs.some(i => i.lotId === id));
    const shipments = db.shipments.filter(s => batches.some(b => b.id === s.batchId));
    return res.json({ type: 'lot', lot, batches, shipments });
  }
  const batch = db.batches.find(b => b.id === id);
  if (batch) {
    const lots = batch.inputs.map(i => ({ ...db.lots.find(l => l.id === i.lotId), used: i.qty }));
    return res.json({ type: 'batch', batch, lots, shipments: db.shipments.filter(s => s.batchId === id) });
  }
  res.status(404).json({ error: `No lot or batch found for ${id}` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FoodTrace ERP running on port ${PORT}`));
