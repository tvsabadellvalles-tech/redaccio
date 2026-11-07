// Servidor estático mínimo para ver el panel en local: http://localhost:8080
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const DOCS = path.join(RAIZ, 'docs');
const PUERTO = Number(process.env.PORT) || 8080;
const INTERVALO_RASTREO_MS = Number(process.env.RASTREO_CADA_MS) || 10 * 60 * 1000;
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

let rastreoEnMarcha = false;
function executarRastreig() {
  if (rastreoEnMarcha) return;
  rastreoEnMarcha = true;
  console.log('[rastreo] Iniciant consulta automàtica de fonts…');
  const procés = spawn(process.execPath, [path.join(RAIZ, 'scripts', 'rastreo.js')], {
    cwd: RAIZ,
    env: process.env,
    stdio: 'inherit'
  });
  procés.once('error', (error) => {
    rastreoEnMarcha = false;
    console.error(`[rastreo] No s’ha pogut iniciar: ${error.message}`);
  });
  procés.once('exit', (codi) => {
    rastreoEnMarcha = false;
    if (codi !== 0) console.error(`[rastreo] Ha acabat amb codi ${codi ?? 'desconegut'}.`);
  });
}

const servidor = http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let ruta = decodeURIComponent(url.pathname);
      if (ruta.endsWith('/')) ruta += 'index.html';
      const archivo = path.resolve(DOCS, '.' + ruta);
      if (archivo !== DOCS && !archivo.startsWith(DOCS + path.sep)) {
        res.writeHead(403).end('Prohibido');
        return;
      }
      const datos = await readFile(archivo);
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(datos);
    } catch {
      res.writeHead(404).end('No encontrado');
    }
  })
  .listen(PUERTO, '127.0.0.1', () => console.log(`Panel en http://localhost:${PUERTO}  (modo prueba: /?datos=prueba)`));

servidor.once('listening', () => {
  executarRastreig();
  setInterval(executarRastreig, INTERVALO_RASTREO_MS);
  console.log(`[rastreo] Actualització local cada ${Math.round(INTERVALO_RASTREO_MS / 60000)} minuts.`);
});
servidor.on('error', (error) => {
  if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
    console.error(`[servidor] El port ${PUERTO} no està disponible. Prova PowerShell: $env:PORT=8081; npm run servir`);
    return;
  }
  console.error(`[servidor] No s’ha pogut iniciar: ${error.message}`);
});
