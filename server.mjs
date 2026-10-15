import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import chat from './api/chat.js';
const root=resolve('public');
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.ttf':'font/ttf'};
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/chat'){await chat(req,res);return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
  if(!(await stat(path)).isFile()){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:await readFile(path));
 }catch{if(!res.headersSent)res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.PORT||3000),()=>console.log('Lapaas assistant: http://localhost:'+ (process.env.PORT||3000)));
