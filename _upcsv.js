const fs = require('fs');
const base = 'http://127.0.0.1:10600';
async function j(url, opts) { const r = await fetch(url, opts); const t = await r.text(); let b; try { b = t ? JSON.parse(t) : {}; } catch (e) { b = {}; } return { status: r.status, body: b }; }
(async () => {
  const login = await j(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: '123456' }) });
  const t = login.body.token;
  const H = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t };
  const files = [
    ['data/test_gbk.csv', 'GBK编码台账.csv', 'text/csv'],
    ['data/test_utf8.csv', 'UTF8台账.csv', 'text/csv']
  ];
  for (const [p, name, mime] of files) {
    const b64 = fs.readFileSync(p).toString('base64');
    const r = await j(base + '/api/files', { method: 'POST', headers: H, body: JSON.stringify({ cabinetId: 1, shelf: 0, slot: 0, filename: name, mime: mime, dataBase64: b64 }) });
    console.log('upload', name, r.status, r.body.ok);
  }
})();
