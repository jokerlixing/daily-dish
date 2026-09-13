import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 4173;
const server = http.createServer((req, res) => {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405);res.end();return; }
  let pathname;
  try { pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch (_) {res.writeHead(400);res.end();return;}
  if (pathname === '/favicon.ico') {res.writeHead(204);res.end();return;}
  const isIndex=['/','/index.html'].includes(pathname);
  const assetRoot=path.join(root,'assets','photos');
  const target=isIndex?path.join(root,'index.html'):path.resolve(root,'.'+pathname);
  if(!isIndex&&(!pathname.startsWith('/assets/photos/')||!target.startsWith(assetRoot+path.sep)||!['.jpg','.jpeg','.png','.webp'].includes(path.extname(target).toLowerCase()))){res.writeHead(404);res.end();return;}
  try {const content=fs.readFileSync(target);const mime=isIndex?'text/html; charset=utf-8':({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[path.extname(target).toLowerCase()]);res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:content);}
  catch(_){res.writeHead(isIndex?503:404,{'Content-Type':'text/plain; charset=utf-8'});res.end(isIndex?'请先运行 npm run build':'图片不存在');}
});
server.listen(port,'0.0.0.0',()=>{
  console.log(`电脑预览：http://localhost:${port}`);
  for (const nets of Object.values(os.networkInterfaces())) for (const net of nets || []) if (net.family==='IPv4'&&!net.internal) console.log(`同一局域网的手机可尝试：http://${net.address}:${port}`);
  console.log('保持此终端运行；Ctrl+C 停止。');
});
