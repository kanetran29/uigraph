import http from 'node:http';
import fs from 'node:fs';
const out = new URL('./navlog.jsonl', import.meta.url).pathname;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type' };
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => { fs.appendFileSync(out, body.trim() + '\n'); res.writeHead(204, cors); res.end(); });
    return;
  }
  res.writeHead(404, cors); res.end();
}).listen(4599, '127.0.0.1', () => console.log('collector up'));
