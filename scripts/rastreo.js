// Rastreo de fonts RSS/Atom -> docs/data/{items,estado,actividad}.json
// Uso: node scripts/rastreo.js [--config config/fuentes.json] [--out docs/data] [--reset]
//
// Los "agentes" del panel son REGLAS automáticas (sin IA). Cada evento de actividad
// corresponde a algo que realmente ha ocurrido en esta ejecución.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import Parser from 'rss-parser';
import ical from 'node-ical';

const RAIZ = path.resolve(import.meta.dirname, '..');

// ---------- argumentos ----------
function leerArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}
const args = leerArgs(process.argv.slice(2));
const rutaConfig = path.resolve(RAIZ, args.config || 'config/fuentes.json');
const dirSalida = path.resolve(RAIZ, args.out || 'docs/data');
const rutaMunicipios = path.resolve(RAIZ, 'config/municipios.json');
const rutaEtiquetas = path.resolve(RAIZ, 'config/etiquetas.json');
const rutaServeis = path.resolve(RAIZ, 'config/serveis.json');
const executarFitxer = promisify(execFile);

// ---------- utilidades ----------
const normalizar = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function limpiarHtml(s) {
  return decodificarEntitatsNumeriques(String(s || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/(?:^|\s)[^{]{1,120}\{\s*[^{}]{0,400}(?:text-decoration|font-family|background-color|border\s*:)[^{}]*\}/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim());
}

function decodificarEntitatsNumeriques(text) {
  return text.replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (entitat, hexadecimal, decimal) => {
    const puntCodi = Number.parseInt(hexadecimal || decimal, hexadecimal ? 16 : 10);
    if (puntCodi < 1 || puntCodi > 0x10ffff || (puntCodi >= 0xd800 && puntCodi <= 0xdfff)) return entitat;
    return String.fromCodePoint(puntCodi);
  });
}

function recortar(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

function normalizarFecha(valor) {
  if (!valor) return null;
  const partes = String(valor).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*[-,]\s*(\d{1,2}):(\d{2}))?$/);
  if (!partes) {
    const fechaDirecta = new Date(valor);
    return Number.isFinite(fechaDirecta.getTime()) ? fechaDirecta.toISOString() : null;
  }
  const [, diaTexto, mesTexto, anyoTexto, horaTexto = '0', minutoTexto = '0'] = partes;
  const dia = Number(diaTexto);
  const mes = Number(mesTexto);
  const anyo = Number(anyoTexto);
  const hora = Number(horaTexto);
  const minuto = Number(minutoTexto);
  const fechaUtc = Date.UTC(anyo, mes - 1, dia, hora, minuto);
  const componentes = new Date(fechaUtc);
  if (
    componentes.getUTCFullYear() !== anyo ||
    componentes.getUTCMonth() !== mes - 1 ||
    componentes.getUTCDate() !== dia ||
    hora > 23 ||
    minuto > 59
  ) return null;

  const zona = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    timeZoneName: 'shortOffset'
  }).formatToParts(new Date(fechaUtc)).find((p) => p.type === 'timeZoneName')?.value;
  const offset = zona?.match(/^GMT([+-]\d{1,2})(?::(\d{2}))?$/);
  if (!offset) throw new Error(`No se pudo determinar la zona horaria para la fecha «${valor}»`);
  const minutosOffset = Number(offset[1]) * 60 + Math.sign(Number(offset[1])) * Number(offset[2] || 0);
  return new Date(fechaUtc - minutosOffset * 60000).toISOString();
}

function clauDiaLocal(data) {
  if (!(data instanceof Date) || !Number.isFinite(data.getTime())) return '';
  const valors = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(data).map(({ type, value }) => [type, value]));
  return `${valors.year}-${valors.month}-${valors.day}`;
}

function sumarDia(dia, quantitat) {
  const data = new Date(`${dia}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + quantitat);
  return data.toISOString().slice(0, 10);
}

const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

async function leerJson(ruta, porDefecto) {
  try {
    return JSON.parse(await readFile(ruta, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && porDefecto !== undefined) return porDefecto;
    throw new Error(`No se pudo leer ${ruta}: ${e.message}`);
  }
}

// Escribe solo si el contenido (sin 'actualizado') cambia, para no generar commits vacíos.
async function escribirSiCambia(ruta, objeto) {
  const sinFecha = (o) => JSON.stringify({ ...o, actualizado: undefined });
  const previo = await leerJson(ruta, null);
  if (previo && sinFecha(previo) === sinFecha(objeto)) return false;
  await writeFile(ruta, JSON.stringify({ ...objeto, actualizado: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  return true;
}

// Términos que obligan a revisión humana (heurística; ampliar con la redacción).
const SENSIBLES = new RegExp(
  '\\b(' +
    [
      'menor(es|s)?', 'nen(s|a|es)?', 'nin(o|a|os|as)', 'infant(s|es|il|iles)?', 'adolescent(s|es)?',
      'victim(a|as|es)', 'mort(s|a|es)?', 'muerte(s)?', 'muert(o|a|os|as)', 'fallecid(o|a|os|as)', 'fallec(e|er|imiento)',
      'difunt(s|a|es)?', 'cadaver(es)?', 'detingu(t|da|ts|des)', 'detenid(o|a|os|as)', 'arrestad(o|a|os|as)',
      'agressio sexual', 'agresion sexual', 'abus(os)? sexual(s|es)?', 'violacio', 'violacion', 'suicid\\w*',
      'assassin\\w*', 'asesin\\w*', 'homicid\\w*', 'maltractament', 'maltrato'
    ].join('|') +
    ')\\b'
);

// ---------- etiquetas y puntuación ----------
function prepararTexto(texto) {
  return ' ' + normalizar(texto).split(/[^a-z0-9]+/).filter(Boolean).join(' ') + ' ';
}

function etiquetar(textoPreparado, definiciones) {
  return definiciones.filter((def) =>
    def.palabras.some((p) => {
      const k = normalizar(p).trim();
      return k.endsWith('*') ? textoPreparado.includes(' ' + k.slice(0, -1)) : textoPreparado.includes(' ' + k + ' ');
    })
  );
}

function puntuar(item, etiquetasItem) {
  const motivos = [];
  let puntos = 0;
  if (item.tipo === 'oficial') {
    puntos += 1;
    motivos.push('font oficial');
  }
  const pesoEtiquetas = Math.min(4, etiquetasItem.reduce((s, e) => s + (e.peso || 0), 0));
  if (pesoEtiquetas > 0) {
    puntos += pesoEtiquetas;
    motivos.push(etiquetasItem.filter((e) => e.peso > 0).map((e) => e.nombre.toLowerCase()).join(', '));
  }
  return { puntos, motivos };
}

// ---------- duplicados ----------
const PARADAS = new Set(['para', 'con', 'por', 'los', 'las', 'una', 'uno', 'del', 'que', 'sus', 'como', 'mas', 'pero', 'este', 'esta', 'sobre', 'entre', 'tras', 'desde', 'hasta', 'dels', 'amb', 'per', 'les', 'els', 'pel', 'prueba']);
function tokensTitulo(titulo) {
  return new Set(normalizar(titulo).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !PARADAS.has(w)));
}
function similitud(a, b) {
  const comunes = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return { comunes, jaccard: union ? comunes / union : 0 };
}

// ---------- lectura de fuentes ----------
async function descargar(fuente, userAgent) {
  if (fuente.archivo) return readFile(path.resolve(RAIZ, fuente.archivo), 'utf8');
  let ultimoError;
  for (let intento = 0; intento <= (fuente.reintentos || 0); intento++) {
    try {
      const res = await fetch(fuente.url, {
        headers: {
          'User-Agent': userAgent,
          Accept: fuente.formato === 'acn-homepage'
            ? 'text/html,application/xhtml+xml'
            : 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5'
        },
        signal: AbortSignal.timeout(fuente.timeoutMs || 20000),
        redirect: 'follow'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      ultimoError = error;
    }
  }
  throw ultimoError;
}

function dataPublicacioACN(valor) {
  const coincidencia = String(valor || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!coincidencia || coincidencia[8]) return valor;

  const [, any, mes, dia, hora, minut, segon = '0', fraccio = ''] = coincidencia;
  const milisegon = Number(`0.${fraccio}`) * 1000;
  const horaUTC = Date.UTC(Number(any), Number(mes) - 1, Number(dia), Number(hora), Number(minut), Number(segon), milisegon);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(horaUTC));
  const local = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
  const horaLocalUTC = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return new Date(horaUTC - (horaLocalUTC - horaUTC)).toISOString();
}

function extraureNoticiesACN(html, fuente) {
  const dades = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!dades) throw new Error('La pàgina d’ACN no inclou les dades estructurades de portada');

  let pagina;
  try {
    pagina = JSON.parse(dades);
  } catch (error) {
    throw new Error(`No s’han pogut interpretar les dades de portada d’ACN: ${error.message}`);
  }
  const noticies = pagina.props?.pageProps?.story?.data;
  if (!Array.isArray(noticies)) throw new Error('La portada d’ACN no conté la llista esperada de notícies');

  return noticies.flatMap((noticia) => {
    const titol = limpiarHtml(noticia.title);
    if (!titol) return [];
    const alias = noticia.alias || normalizar(titol).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!alias) return [];

    const seccions = Array.isArray(noticia.sections) ? noticia.sections.join(' ') : noticia.sections || '';
    if (/(^|[^a-z])(opinio|editorial|tribuna|columna)([^a-z]|$)/.test(normalizar(seccions))) return [];

    const enllac = new URL(`/new/${encodeURIComponent(alias)}/texts`, fuente.url).href;
    return [{
      guid: noticia.projectId || noticia.primaryKey || enllac,
      title: titol,
      link: enllac,
      isoDate: dataPublicacioACN(noticia.publishUpDate),
      contentSnippet: limpiarHtml(`${noticia.subtitle || ''} ${seccions}`)
    }];
  });
}

async function descarregarResposta(url, accept, userAgent, capcaleres = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: accept, ...capcaleres },
    signal: AbortSignal.timeout(20000),
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function descarregarJsonTransit(url, userAgent) {
  const executavel = process.platform === 'win32' ? 'curl.exe' : 'curl';
  let stdout;
  try {
    ({ stdout } = await executarFitxer(executavel, [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      '20',
      '--user-agent',
      userAgent,
      '--header',
      'Accept: application/json',
      url
    ], {
      encoding: 'utf8',
      timeout: 25000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    }));
  } catch (error) {
    const diagnòstic = error.stderr?.trim() || error.code || error.message || error;
    throw new Error(`curl: ${diagnòstic}`, { cause: error });
  }
  return JSON.parse(stdout);
}

function urlIncidentsTransit(servei) {
  const url = new URL(servei.url);
  for (const tipus of servei.tipusIncidents || []) url.searchParams.set(tipus, 'on');
  url.searchParams.set('demarcacio', servei.demarcacio);
  url.searchParams.set('comarca', String(servei.comarca));
  url.searchParams.set('via', (servei.vies || []).join(','));
  url.searchParams.set('ordenacioSelect', '8');
  url.searchParams.set('ordenacioDirSelect', 'asc');
  url.searchParams.set('offset', '0');
  url.searchParams.set('limit', '1000');
  return url.href;
}

function textHtml(html) {
  return decodificarEntitatsNumeriques(String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim());
}

function dataHoraLocal(isoDia, hora, zonaHoraria) {
  if (!isoDia || !hora) return null;
  const utcBase = new Date(`${isoDia}T${hora}Z`);
  if (!Number.isFinite(utcBase.getTime())) return null;
  const nomZona = new Intl.DateTimeFormat('en-US', { timeZone: zonaHoraria, timeZoneName: 'shortOffset' })
    .formatToParts(utcBase)
    .find((part) => part.type === 'timeZoneName')?.value;
  const offset = nomZona?.match(/^GMT([+-]\d{1,2})(?::(\d{2}))?$/);
  if (!offset) return null;
  const minutsOffset = Number(offset[1]) * 60 + Math.sign(Number(offset[1])) * Number(offset[2] || 0);
  return new Date(utcBase.getTime() - minutsOffset * 60000);
}

function conteComarca(valor, idComarca) {
  if (Array.isArray(valor)) return valor.some((element) => conteComarca(element, idComarca));
  if (!valor || typeof valor !== 'object') return false;
  return Object.entries(valor).some(([clau, contingut]) =>
    (clau === 'idComarca' && String(contingut) === String(idComarca)) ||
    conteComarca(contingut, idComarca)
  );
}

function avisosMeteocat(episodis, tipus, idComarca, ara) {
  const resultat = [];
  for (const episodi of episodis) {
    for (const avís of episodi.avisos || []) {
      if (!conteComarca(avís, idComarca)) continue;
      const inici = avís.dataInici ? new Date(avís.dataInici) : null;
      const final = avís.dataFi ? new Date(avís.dataFi) : null;
      if ((inici && !Number.isFinite(inici.getTime())) || (final && !Number.isFinite(final.getTime()))) continue;
      if (final && final.getTime() < ara.getTime()) continue;
      const previst = inici && inici.getTime() > ara.getTime();
      if (previst && (tipus !== 'Preavís' || inici.getTime() - ara.getTime() > 48 * 3600000)) continue;
      if (!previst && avís.estat && normalizar(avís.estat) !== 'vigent') continue;

      const nomMeteor = episodi.meteor?.nom || 'Avís meteorològic';
      const titol = avís.llindar ? `${nomMeteor} · ${avís.llindar}` : nomMeteor;
      const afectacions = [];
      const recollirAfectacions = (valor) => {
        if (Array.isArray(valor)) {
          for (const element of valor) recollirAfectacions(element);
        } else if (valor && typeof valor === 'object') {
          if (String(valor.idComarca) === String(idComarca)) afectacions.push(valor);
          for (const [clau, contingut] of Object.entries(valor)) {
            if (clau !== 'idComarca') recollirAfectacions(contingut);
          }
        }
      };
      recollirAfectacions(avís);
      const perill = Math.max(0, ...afectacions.map((afectacio) => Number(afectacio.perill || afectacio.nivell || 0)));
      const evolucio = (avís.evolucions || []).find((element) => element.comentari)?.comentari;
      resultat.push({
        tipus,
        titol,
        detall: [evolucio, perill ? `Nivell de perill ${perill}` : null].filter(Boolean).join(' · '),
        inici: inici?.toISOString() || null,
        final: final?.toISOString() || null,
        publicat: avís.dataEmisio ? new Date(avís.dataEmisio).toISOString() : null,
        previst: Boolean(previst)
      });
    }
  }
  return resultat;
}

function extraureArrayEmbut(html, propietat, inici) {
  const cerca = new RegExp(`,\\s*${propietat}\\s*:\\s*\\[`, 'g');
  cerca.lastIndex = inici;
  const coincidencia = cerca.exec(html);
  if (!coincidencia) throw new Error(`No s’ha trobat «${propietat}» a la pàgina de Meteocat`);
  const iniciArray = cerca.lastIndex - 1;
  let profunditat = 0;
  let cometa = '';
  let escapada = false;
  for (let i = iniciArray; i < html.length; i++) {
    const caracter = html[i];
    if (cometa) {
      if (escapada) escapada = false;
      else if (caracter === '\\') escapada = true;
      else if (caracter === cometa) cometa = '';
      continue;
    }
    if (caracter === '"' || caracter === "'") {
      cometa = caracter;
    } else if (caracter === '[') {
      profunditat++;
    } else if (caracter === ']' && --profunditat === 0) {
      return JSON.parse(html.slice(iniciArray, i + 1));
    }
  }
  throw new Error(`L’array «${propietat}» de Meteocat no està complet`);
}

function atributsXml(element) {
  return Object.fromEntries([...element.matchAll(/([A-Za-z][\w:-]*)=["']([^"']*)["']/g)]
    .map(([, clau, valor]) => [clau, valor]));
}

function previsioMeteocat(xml, idComarca, ara) {
  const simbols = new Map([...xml.matchAll(/<simbol\b[^>]*\/?>/gi)]
    .map(([element]) => {
      const atributs = atributsXml(element);
      return [atributs.id, atributs.nomsimbol];
    }));
  const registre = [...xml.matchAll(/<prediccio\b[^>]*>[\s\S]*?<\/prediccio>/gi)]
    .map(([element]) => element)
    .find((element) => atributsXml(element.match(/<prediccio\b[^>]*>/i)?.[0] || '').idcomarca === String(idComarca));
  if (!registre) throw new Error(`Meteocat no publica previsió per a la comarca ${idComarca}`);
  const avui = clauDiaLocal(ara);
  const variable = [...registre.matchAll(/<variable\b[^>]*\/?>/gi)]
    .map(([element]) => atributsXml(element))
    .map((atributs) => {
      const coincidencia = atributs.data?.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (!coincidencia) return null;
      const dataISO = `${coincidencia[3]}-${coincidencia[2]}-${coincidencia[1]}`;
      const data = new Date(`${dataISO}T00:00:00Z`);
      if (!Number.isFinite(data.getTime()) || data.toISOString().slice(0, 10) !== dataISO) return null;
      return { ...atributs, dataISO };
    })
    .filter((atributs) => atributs && atributs.dataISO >= avui)
    .sort((a, b) => a.dataISO.localeCompare(b.dataISO))[0];
  if (!variable) throw new Error(`Meteocat no publica previsió des d’avui (${avui}) per a la comarca ${idComarca}`);

  const nomSimbol = (valor) => simbols.get(String(valor || '').replace(/\.png$/i, '')) || 'estat del cel no especificat';
  const estatPluja = (codi) => ({
    1: 'No se n’espera',
    2: 'No es descarta (<10%)',
    3: 'Possible (10–30%)',
    4: 'Probable (30–70%)',
    5: 'Molt probable (>70%)'
  })[Number(codi)] || '';
  const dataCreacio = xml.match(/<smc\b[^>]*\bdatacreacio=["']([^"']+)["']/i)?.[1] || null;
  const matí = nomSimbol(variable.simbolmati);
  const tarda = nomSimbol(variable.simboltarda);
  const precipitacio = [
    estatPluja(variable.probprecipitaciomati) ? `matí: ${estatPluja(variable.probprecipitaciomati)}` : '',
    estatPluja(variable.probprecipitaciotarda) ? `tarda: ${estatPluja(variable.probprecipitaciotarda)}` : ''
  ].filter(Boolean).join(' · ');
  const detall = [
    `${matí} al matí · ${tarda} a la tarda`,
    `Pluja ${precipitacio || 'sense dades'}`,
    dataCreacio ? `Actualitzada ${dataCreacio}` : ''
  ].filter(Boolean).join(' · ');
  const dataPrevisio = new Intl.DateTimeFormat('ca-ES', {
    timeZone: 'Europe/Madrid',
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(new Date(`${variable.dataISO}T12:00:00Z`));
  return {
    data: variable.data,
    dataISO: variable.dataISO,
    dataLlarga: dataPrevisio,
    actualitzat: dataCreacio,
    maxima: variable.tempmax,
    minima: variable.tempmin,
    mati: matí,
    tarda,
    precipitacio,
    detall
  };
}

function esAlertaMeteorologica(texto) {
  const normalitzat = normalizar(texto);
  return /\b(?:ventcat|inuncat|neucat|allaucat)\b/.test(normalitzat)
    || /\b(?:alerta|prealerta|avis)\s+(?:per|de)\s+(?:vent|pluja|inundacio|neu|tempesta|calor|fred)\b/.test(normalitzat)
    || /\bavis meteorologic\b/.test(normalitzat);
}

function esAlertaLocal(texto, municipis) {
  const normalitzat = normalizar(texto);
  if (normalitzat.includes('valles occidental')) return true;
  return municipis.some((municipi) => municipi.alias.some((alias) => {
    const terme = normalizar(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${terme}($|[^a-z0-9])`).test(normalitzat);
  }));
}

function alertesProteccioCivil(html, baseUrl, municipis) {
  const alertes = [];
  const llistes = html.matchAll(/<li\b[^>]*class=["'][^"']*NG-megamenu__nav-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi);
  for (const [, element] of llistes) {
    const enllac = element.match(/<a\b([^>]*)>/i)?.[1];
    if (!enllac) continue;
    const titol = enllac.match(/\btitle=["']([^"']+)["']/i)?.[1];
    const url = enllac.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!titol || !/\b(alerta|prealerta)\b/i.test(textHtml(titol))) continue;
    const titolNet = textHtml(titol);
    if (esAlertaMeteorologica(titolNet) || !esAlertaLocal(titolNet, municipis)) continue;
    alertes.push({
      titol: titolNet,
      detall: '',
      url: new URL(url || baseUrl, baseUrl).href
    });
  }
  return alertes;
}

async function consultarServei(servei, ara, userAgent, parser, municipis) {
  const base = {
    id: servei.id,
    nom: servei.nom,
    enllac: servei.enllac,
    alternatiu: servei.alternatiu || null,
    consultat: ara.toISOString()
  };
  if (servei.tipus === 'manual') {
    return { ...base, estat: 'no-verificat', detall: servei.detall };
  }

  try {
    if (servei.tipus === 'meteocat') {
      const [respostaAvisos, respostaPrevisio] = await Promise.all([
        descarregarResposta(servei.url, 'text/html,application/xhtml+xml', userAgent),
        descarregarResposta(servei.previsioUrl, 'application/xml,text/xml', userAgent)
      ]);
      const html = await respostaAvisos.text();
      const xml = await respostaPrevisio.text();
      const marcador = html.indexOf('Meteocat.avisosSMP(');
      if (marcador < 0) throw new Error('La pàgina de Meteocat no inclou el visor oficial d’avisos');
      const episodis = extraureArrayEmbut(html, 'avisos', marcador);
      const preavisos = extraureArrayEmbut(html, 'episodisPreavisos', marcador);
      const previsio = previsioMeteocat(xml, servei.comarca, ara);
      const avisos = [
        ...avisosMeteocat(episodis, 'Avís', servei.comarca, ara),
        ...avisosMeteocat(preavisos, 'Preavís', servei.comarca, ara)
      ]
        .sort((a, b) => Number(a.previst) - Number(b.previst) || new Date(a.final || 0) - new Date(b.final || 0))
        .slice(0, 5);
      return {
        ...base,
        estat: avisos.length ? 'avis' : 'previsio',
        detall: avisos.length
          ? `${avisos.length} ${avisos.length === 1 ? 'avís o preavís actiu' : 'avisos o preavisos actius'} al Vallès Occidental.`
          : `Sense avisos actius. Previsió de ${previsio.dataLlarga} al Vallès Occidental: màxima ${previsio.maxima}°, mínima ${previsio.minima}°. ${previsio.detall}.`,
        previsio,
        avisos
      };
    }
    if (servei.tipus === 'emergencies') {
      const resposta = await descarregarResposta(servei.url, 'text/html,application/xhtml+xml', userAgent);
      const html = await resposta.text();
      if (!html.includes('NG-megamenu__nav-item')) {
        throw new Error('No s’ha pogut llegir el mòdul d’alertes oficial d’Interior');
      }
      const avisos = alertesProteccioCivil(html, servei.url, municipis).slice(0, 5);
      return {
        ...base,
        estat: avisos.length ? 'avis' : 'cap-avis-recent',
        detall: avisos.length
          ? 'Alerta de Protecció Civil amb afectació local identificada.'
          : 'Cap alerta local no meteorològica identificada a les alertes destacades d’Interior.',
        avisos
      };
    }
    const accept = servei.tipus === 'rodalies'
      ? 'application/json'
      : servei.tipus === 'transit'
        ? 'application/rss+xml, application/xml, text/xml'
        : 'text/html,application/xhtml+xml';
    const resposta = servei.tipus === 'transit'
      ? null
      : await descarregarResposta(servei.url, accept, userAgent);
    if (servei.tipus === 'fgc') {
      const contingut = textHtml(await resposta.text());
      const capcalera = 'Línia Barcelona - Vallès';
      const final = 'Línia Llobregat - Anoia';
      const inici = contingut.toLowerCase().indexOf(capcalera.toLowerCase());
      const finalSeccio = contingut.toLowerCase().indexOf(final.toLowerCase(), inici + capcalera.length);
      if (inici < 0 || finalSeccio < 0) throw new Error('No s’ha trobat l’estat de la línia Barcelona–Vallès');
      const seccio = contingut.slice(inici + capcalera.length, finalSeccio).trim();
      const senseAvis = seccio.match(/Sense adequacions horàries\.?/i);
      if (senseAvis) return { ...base, estat: 'cap-avis-recent', detall: senseAvis[0] };
      return { ...base, estat: 'avis', detall: seccio.slice(0, 360) || 'La font publica una informació de servei.' };
    }
    if (servei.tipus === 'transit') {
      const dades = await descarregarJsonTransit(urlIncidentsTransit(servei), userAgent);
      const araTransit = new Date();
      if (!Array.isArray(dades.incidents)) throw new Error('La API de Trànsit no inclou la llista d’incidències');
      const dataCarrega = Number(dades.dataCarrega);
      if (!Number.isFinite(dataCarrega) || dataCarrega <= 0 || dataCarrega > araTransit.getTime()) {
        throw new Error('La API de Trànsit no inclou una data de càrrega vàlida');
      }
      const antiguitatCarrega = araTransit.getTime() - dataCarrega;
      if (antiguitatCarrega > (servei.maxSnapshotAgeMinutes || 180) * 60000) {
        throw new Error(`Les dades de Trànsit tenen més de ${servei.maxSnapshotAgeMinutes || 180} minuts i no es poden donar per actuals`);
      }
      const vies = new Set(servei.vies || []);
      const avisos = dades.incidents
        .map((incident) => {
          const publicat = Number(incident.dataHora);
          const data = new Date(publicat);
          const sentit = incident.descripcioSentit
            ? `Sentit ${incident.descripcioSentit}${incident.capa ? ` cap a ${incident.capa}` : ''}`
            : incident.capa ? `cap a ${incident.capa}` : '';
          const detall = [
            incident.descCarretera,
            incident.nomMunicipi,
            sentit,
            `Punt km. ${incident.quilometreInicial}-${incident.quilometreFinal}`,
            incident.infoAdicional
          ].filter(Boolean).join(' | ');
          return {
            titol: `${incident.descripcioCausa || 'Incidència viària'} · ${incident.descripcioNivell || 'afectació viària'}`,
            detall,
            publicat: Number.isFinite(publicat) && Number.isFinite(data.getTime()) ? data.toISOString() : null,
            carretera: incident.descCarretera,
            comarca: Number(incident.codiComarca)
          };
        })
        .filter((avís) =>
          avís.titol &&
          avís.publicat &&
          avís.comarca === Number(servei.comarca) &&
          vies.has(avís.carretera) &&
          clauDiaLocal(new Date(avís.publicat)) === clauDiaLocal(araTransit) &&
          new Date(avís.publicat).getTime() <= araTransit.getTime()
        )
        .sort((a, b) => new Date(b.publicat) - new Date(a.publicat))
        .slice(0, 5);
      return {
        ...base,
        estat: avisos.length ? 'avis' : 'cap-avis-recent',
        detall: avisos.length
          ? `${avisos.length} ${avisos.length === 1 ? 'incidència' : 'incidències'} d’avui a les carreteres seleccionades del Vallès Occidental, segons la llista actual de Trànsit.`
          : `Cap incidència d’avui a les carreteres seleccionades del Vallès Occidental, segons la llista actual de Trànsit.`,
        actualitzat: new Date(dataCarrega).toISOString(),
        avisos
      };
    }

    const dades = await resposta.json();
    if (!Array.isArray(dades.included)) throw new Error('La resposta de Rodalies no inclou la llista d’avisos');
    const avisos = dades.included
      .map((avís) => {
        const linies = (avís.lines || []).map((linia) => linia.id).filter(Boolean);
        const publicat = dataHoraLocal(avís.date, avís.time, 'Europe/Madrid');
        return {
          titol: avís.title?.ca || avís.title?.es || '',
          detall: avís.description?.ca || avís.description?.es || '',
          publicat: publicat?.toISOString() || null,
          linies
        };
      })
      .filter((avís) =>
        avís.titol &&
        avís.publicat &&
        avís.linies.some((linia) => servei.linies.includes(linia)) &&
        clauDiaLocal(new Date(avís.publicat)) === clauDiaLocal(ara) &&
        new Date(avís.publicat).getTime() <= ara.getTime()
      )
      .sort((a, b) => new Date(b.publicat) - new Date(a.publicat))
      .slice(0, 5);
    return {
      ...base,
      estat: avisos.length ? 'avis' : 'cap-avis-recent',
      detall: avisos.length
        ? `${avisos.length} ${avisos.length === 1 ? 'avís publicat avui' : 'avisos publicats avui'} a les línies ${servei.linies.join(' i ')}.`
        : `Cap avís publicat avui a les línies ${servei.linies.join(' i ')}.`,
      avisos
    };
  } catch (error) {
    return { ...base, estat: 'no-verificat', detall: `No s’ha pogut consultar la font oficial: ${String(error.message || error).slice(0, 180)}` };
  }
}

async function consultarServeis(config, ara) {
  const definicions = await leerJson(rutaServeis);
  const { municipios } = await leerJson(rutaMunicipios);
  const parser = new Parser();
  const serveis = await Promise.all(definicions.serveis.map((servei) => consultarServei(servei, ara, config.userAgent, parser, municipios)));
  return { serveis, consultat: ara.toISOString() };
}

async function consultarCalendariGoogle(calendari, clau, inici, final) {
  const consultarApi = async (url) => {
    const resposta = await fetch(url, {
      headers: { 'User-Agent': 'RedaccioVirtual/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(calendari.timeoutMs || 30000)
    });
    if (!resposta.ok) {
      const detall = (await resposta.text()).replace(/\s+/g, ' ').slice(0, 180);
      throw new Error(`Google Calendar API HTTP ${resposta.status}${detall ? `: ${detall}` : ''}`);
    }
    return resposta.json();
  };

  const urlColors = new URL(calendari.colorsUrl);
  urlColors.searchParams.set('key', clau);
  const promesaColors = consultarApi(urlColors);
  const elements = [];
  let tokenPagina = '';
  do {
    const urlEsdeveniments = new URL(calendari.apiUrl);
    urlEsdeveniments.searchParams.set('key', clau);
    urlEsdeveniments.searchParams.set('timeMin', inici.toISOString());
    urlEsdeveniments.searchParams.set('timeMax', final.toISOString());
    urlEsdeveniments.searchParams.set('singleEvents', 'true');
    urlEsdeveniments.searchParams.set('orderBy', 'startTime');
    urlEsdeveniments.searchParams.set('maxResults', '2500');
    urlEsdeveniments.searchParams.set('fields', 'items(id,summary,start,end,status,colorId),nextPageToken');
    if (tokenPagina) urlEsdeveniments.searchParams.set('pageToken', tokenPagina);
    const resposta = await consultarApi(urlEsdeveniments);
    if (!Array.isArray(resposta.items)) throw new Error('Google Calendar API no ha retornat la llista d’activitats');
    elements.push(...resposta.items);
    tokenPagina = resposta.nextPageToken || '';
  } while (tokenPagina);

  const paleta = await promesaColors;
  const colors = paleta.event || {};
  const activitats = elements.flatMap((esdeveniment) => {
    if (esdeveniment.status === 'cancelled' || !esdeveniment.summary || !esdeveniment.start || !esdeveniment.end) return [];
    const totElDia = Boolean(esdeveniment.start.date);
    const iniciEvent = totElDia
      ? dataHoraLocal(esdeveniment.start.date, '00:00', 'Europe/Madrid')
      : new Date(esdeveniment.start.dateTime);
    const finalEvent = totElDia
      ? dataHoraLocal(esdeveniment.end.date, '00:00', 'Europe/Madrid')
      : new Date(esdeveniment.end.dateTime);
    if (!iniciEvent || !finalEvent || !Number.isFinite(iniciEvent.getTime()) || !Number.isFinite(finalEvent.getTime())) return [];
    if (iniciEvent >= final || finalEvent <= inici) return [];
    const color = colors[esdeveniment.colorId]?.background;
    return [{
      titol: String(esdeveniment.summary).trim(),
      inici: iniciEvent.toISOString(),
      final: finalEvent.toISOString(),
      totElDia,
      color: typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ? color : null
    }];
  });
  return activitats;
}

async function consultarCalendari(config, ara) {
  const resultat = {
    estat: 'no-configurat',
    origen: 'no-configurat',
    colorsDisponibles: false,
    consultat: ara.toISOString(),
    total: 0,
    activitats: []
  };
  if (!config.calendari?.url) return resultat;

  try {
    const avui = clauDiaLocal(ara);
    const iniciDia = dataHoraLocal(avui, '00:00', 'Europe/Madrid');
    const fiDia = dataHoraLocal(sumarDia(avui, 1), '00:00', 'Europe/Madrid');
    if (!iniciDia || !fiDia) throw new Error(`No s’ha pogut determinar el dia local ${avui}`);

    const clau = process.env.GOOGLE_CALENDAR_API_KEY?.trim();
    if (clau && config.calendari.apiUrl && config.calendari.colorsUrl) {
      try {
        const activitats = await consultarCalendariGoogle(config.calendari, clau, iniciDia, fiDia);
        const ordenades = activitats.sort((a, b) =>
          Number(b.totElDia) - Number(a.totElDia) || new Date(a.inici) - new Date(b.inici)
        );
        return {
          ...resultat,
          estat: 'ok',
          origen: 'google-api',
          colorsDisponibles: true,
          total: ordenades.length,
          activitats: ordenades
        };
      } catch (error) {
        resultat.aviso = `Colors de Google no disponibles: ${String(error.message || error).slice(0, 180)}`;
        console.error(`[avís] ${resultat.aviso}`);
      }
    } else {
      resultat.aviso = 'Configura GOOGLE_CALENDAR_API_KEY per recuperar els colors dels esdeveniments.';
    }

    const resposta = await fetch(config.calendari.url, {
      headers: {
        'User-Agent': config.userAgent,
        Accept: 'text/calendar'
      },
      signal: AbortSignal.timeout(config.calendari.timeoutMs || 30000),
      redirect: 'follow'
    });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const ics = await resposta.text();
    if (ics.length > 15 * 1024 * 1024) throw new Error('L’exportació del calendari supera els 15 MB');

    const esdeveniments = await ical.async.parseICS(ics);

    const activitats = new Map();
    for (const esdeveniment of Object.values(esdeveniments)) {
      if (esdeveniment.type !== 'VEVENT' || esdeveniment.status?.toUpperCase() === 'CANCELLED' || !esdeveniment.summary) continue;
      const instancies = ical.expandRecurringEvent(esdeveniment, {
        from: iniciDia,
        to: fiDia,
        expandOngoing: true
      });
      for (const instancia of instancies) {
        if (!(instancia.start instanceof Date) || !Number.isFinite(instancia.start.getTime())) continue;
        const final = instancia.end instanceof Date && Number.isFinite(instancia.end.getTime())
          ? instancia.end
          : instancia.start;
        if (instancia.start >= fiDia || final <= iniciDia) continue;
        const titol = String(instancia.summary || esdeveniment.summary).trim();
        if (!titol) continue;
        const clau = `${titol}|${instancia.start.toISOString()}`;
        activitats.set(clau, {
          titol,
          inici: instancia.start.toISOString(),
          final: final.toISOString(),
          totElDia: Boolean(instancia.isFullDay || instancia.start.dateOnly),
          color: typeof esdeveniment.color === 'string' && /^#[\da-f]{6}$/i.test(esdeveniment.color)
            ? esdeveniment.color
            : null
        });
      }
    }

    const ordenades = [...activitats.values()].sort((a, b) =>
      Number(b.totElDia) - Number(a.totElDia) || new Date(a.inici) - new Date(b.inici)
    );
    return {
      ...resultat,
      estat: 'ok',
      origen: 'ical',
      colorsDisponibles: false,
      total: ordenades.length,
      activitats: ordenades
    };
  } catch (error) {
    const missatge = String(error.message || error).slice(0, 180);
    console.error(`[error] calendari: ${missatge}`);
    return { ...resultat, estat: 'error', error: missatge };
  }
}

function coincideixFont(crud, font, ara, municipis) {
  const text = normalizar(`${crud.title || ''} ${crud.contentSnippet || ''} ${crud.content || ''} ${crud.summary || ''}`);
  if (font.exclou?.some((terme) => coincideixTerme(text, terme))) return false;
  if (font.inclou?.length && !font.inclou.some((terme) => text.includes(normalizar(terme)))) return false;
  if (font.localitats?.length && !font.localitats.some((lloc) => coincideixTerme(text, lloc))) return false;
  if (font.municipis?.length && !municipis.some((municipi) =>
    font.municipis.includes(municipi.id) && municipi.alias.some((alias) => coincideixTerme(text, alias))
  )) return false;
  const antiguitatMaxima = font.maxAntiguitatDies;
  if (antiguitatMaxima) {
    const dataPublicacio = normalizarFecha(crud.isoDate || crud.pubDate);
    if (dataPublicacio && ara.getTime() - new Date(dataPublicacio).getTime() > antiguitatMaxima * 86400000) return false;
  }
  return true;
}

function coincideixTerme(texto, terme) {
  const normalitzat = prepararTexto(texto);
  const termePreparat = prepararTexto(terme).trim();
  return Boolean(termePreparat && normalitzat.includes(` ${termePreparat} `));
}

function detectarMunicipios(texto, municipios) {
  return municipios.filter((m) => m.alias.some((a) => coincideixTerme(texto, a))).map((m) => m.id);
}

function normalizarItem(crudo, fuente, municipios, ahora) {
  const enlace = (crudo.link || '').trim();
  const titulo = limpiarHtml(crudo.title);
  if (!titulo || !/^https?:\/\//i.test(enlace)) return null;
  const identificador = fuente.usaGuidComId ? crudo.guid || enlace || titulo : enlace || crudo.guid || titulo;

  const fecha = [crudo.isoDate, crudo.pubDate].map(normalizarFecha).find(Boolean) || null;
  const fechaDeclarada = crudo.isoDate || crudo.pubDate;
  if (fechaDeclarada && !fecha) {
    console.warn(`[avís] ${fuente.id}: data no vàlida a «${titulo}»; es conserva l'element sense data de publicació.`);
  }
  const resumenCompleto = limpiarHtml(crudo.contentSnippet || crudo.content || crudo.summary || '');
  const textoAnalisis = `${titulo} ${resumenCompleto}`;

  return {
    id: sha(identificador),
    titulo,
    enlace,
    fuente: fuente.id,
    fuenteNombre: fuente.nombre,
    tipo: fuente.tipo,
    // Solo las fuentes oficiales guardan un extracto corto; las de medios, solo titular y enlace.
    resumen: fuente.tipo === 'oficial' ? recortar(resumenCompleto, 240) : '',
    municipio: fuente.municipio,
    municipiosMencionados: detectarMunicipios(textoAnalisis, municipios),
    publicado: fecha,
    detectado: ahora.toISOString(),
    sensible: SENSIBLES.test(normalizar(textoAnalisis)),
    _texto: textoAnalisis // temporal: se elimina antes de guardar
  };
}

async function main() {
  const ahora = new Date();
  const config = await leerJson(rutaConfig);
  for (const fuente of config.fuentes) {
    fuente.exclou = [...new Set([...(fuente.exclou || []), ...(config.exclouGlobal || [])])];
  }
  const filtrarAvui = config.filtrarNoticiesAvui !== false;
  const diaAvui = clauDiaLocal(ahora);
  const { municipios } = await leerJson(rutaMunicipios);
  const { etiquetas: defEtiquetas, umbralPropuesta = 3 } = await leerJson(rutaEtiquetas);
  const ventanaMs = (config.ventanaEventosHoras || 24) * 3600000;
  const parser = new Parser();
  await mkdir(dirSalida, { recursive: true });

  const rutaItems = path.join(dirSalida, 'items.json');
  const rutaEstado = path.join(dirSalida, 'estado.json');
  const rutaActividad = path.join(dirSalida, 'actividad.json');

  const reiniciar = args.reset === true;
  const previo = reiniciar ? { items: [] } : await leerJson(rutaItems, { items: [] });
  const estadoPrevio = reiniciar ? { fuentes: {} } : await leerJson(rutaEstado, { fuentes: {} });
  const actividadPrevia = reiniciar ? { eventos: [] } : await leerJson(rutaActividad, { eventos: [] });

  const fontsNoticiesActives = new Set(config.fuentes.filter((fuente) => fuente.activa).map((fuente) => fuente.id));
  const itemsInicials = previo.items.filter((item) => {
    if (!fontsNoticiesActives.has(item.fuente)) return false;
    return !filtrarAvui || (item.publicado && clauDiaLocal(new Date(item.publicado)) === diaAvui);
  });
  const porId = new Map(itemsInicials.map((i) => [i.id, i]));
  const porEnlace = new Map(itemsInicials.filter((i) => i.fuente && i.enlace).map((i) => [`${i.fuente}|${i.enlace}`, i]));
  const nombreEtiqueta = Object.fromEntries(defEtiquetas.map((e) => [e.id, e.nombre]));

  const estado = {};
  const eventos = [];
  const nuevosItems = [];
  let secuencia = 0;
  const evento = (agente, texto, itemId = null) => {
    eventos.push({
      id: sha(`${agente}|${itemId || texto}|${texto}`),
      t: new Date(ahora.getTime() + secuencia++).toISOString(),
      agente,
      texto,
      itemId
    });
  };

  let activas = 0;
  let fallidas = 0;

  // 1) Lectura de fuentes
  for (const fuente of config.fuentes) {
    if (!fuente.activa) continue;
    if (!fuente.url && !fuente.archivo) {
      estado[fuente.id] = { ok: false, error: 'Sin URL configurada', items: 0 };
      console.warn(`[avís] ${fuente.id}: activa però sense URL`);
      continue;
    }
    activas++;
    try {
      const contingut = await descargar(fuente, config.userAgent);
      const elements = fuente.formato === 'acn-homepage'
        ? extraureNoticiesACN(contingut, fuente)
        : (await parser.parseString(contingut)).items;
      const elementosLocales = elements.filter((crudo) => coincideixFont(crudo, fuente, ahora, municipios));
      let leidos = 0;
      for (const crudo of elementosLocales) {
        const item = normalizarItem(crudo, fuente, municipios, ahora);
        if (!item) continue;
        if (filtrarAvui && (!item.publicado || clauDiaLocal(new Date(item.publicado)) !== diaAvui)) continue;
        leidos++;
        const existentPerId = porId.get(item.id);
        const existentPerEnllac = fuente.usaGuidComId ? null : porEnlace.get(`${item.fuente}|${item.enlace}`);
        const existente = existentPerId || existentPerEnllac;
        if (existente) {
          if (item.resumen) existente.resumen = item.resumen;
          existente.publicado = item.publicado;
          // Conserva lo calculado previamente salvo la fecha de publicación, que se sincroniza con la fuente.
          continue;
        }
        porId.set(item.id, item);
        porEnlace.set(`${item.fuente}|${item.enlace}`, item);
        nuevosItems.push(item);
      }
      estado[fuente.id] = { ok: true, items: leidos };
      console.log(`[ok] ${fuente.id}: ${leidos} elementos`);
      if (estadoPrevio.fuentes?.[fuente.id] && estadoPrevio.fuentes[fuente.id].ok === false) {
        evento('rastreador', `La font «${fuente.nombre}» torna a respondre.`);
      }
    } catch (e) {
      fallidas++;
      const mensaje = String(e.message || e).slice(0, 200);
      estado[fuente.id] = { ok: false, error: mensaje, items: 0 };
      console.error(`[error] ${fuente.id}: ${e.message}`);
      if (!estadoPrevio.fuentes?.[fuente.id] || estadoPrevio.fuentes[fuente.id].ok !== false) {
        evento('rastreador', `La font «${fuente.nombre}» no respon (${mensaje}).`);
      }
    }
  }

  // 2) Procesado de lo nuevo, de más antiguo a más reciente (el primero en llegar es el "original")
  const fechaDe = (i) => new Date(i.publicado || i.detectado).getTime();
  nuevosItems.sort((a, b) => fechaDe(a) - fechaDe(b));

  for (const item of nuevosItems) {
    const textoPreparado = prepararTexto(item._texto);
    const etiquetasItem = etiquetar(textoPreparado, defEtiquetas);
    const { puntos, motivos } = puntuar(item, etiquetasItem);

    // Duplicados: mismo hecho ya recogido en las 48 h anteriores.
    const tokens = tokensTitulo(item.titulo);
    let original = null;
    for (const otro of porId.values()) {
      if (otro.id === item.id || otro.duplicadaDe) continue;
      if (fechaDe(otro) > fechaDe(item) || fechaDe(item) - fechaDe(otro) > 48 * 3600000) continue;
      const { comunes, jaccard } = similitud(tokens, tokensTitulo(otro.titulo));
      if (comunes >= 3 && jaccard >= 0.6) {
        original = otro;
        break;
      }
    }

    item.etiquetas = etiquetasItem.map((e) => e.id);
    item.puntuacion = puntos;
    item.motivos = motivos;
    item.duplicadaDe = original ? original.id : null;
    item.propuesta = !original && puntos >= umbralPropuesta;
    delete item._texto;

    // Eventos de actividad: solo si el elemento es reciente (evita inundar el feed en la primera carga).
    if (ahora.getTime() - fechaDe(item) > ventanaMs) continue;
    evento('rastreador', `He recollit «${item.titulo}» (${item.fuenteNombre}).`, item.id);
    if (original) {
      evento('deduplicador', `Descartada perquè és duplicada: coincideix amb «${original.titulo}» (${original.fuenteNombre}).`, item.id);
      continue;
    }
    if (etiquetasItem.length) evento('etiquetador', `Etiquetes: ${etiquetasItem.map((e) => e.nombre).join(', ')}.`, item.id);
    if (item.sensible) evento('vigilante', 'Possible tema sensible (menors, víctimes, detinguts o dades personals): cal una revisió humana abans de qualsevol ús.', item.id);
    if (item.propuesta) evento('mesa', `Proposo incloure-ho a l'escaleta (${puntos} punts): ${motivos.join(' · ')}.`, item.id);
  }
  // Limpia el campo temporal por si algún elemento previo lo arrastrara.
  for (const i of porId.values()) {
    delete i._texto;
    if (i.resumen) i.resumen = recortar(limpiarHtml(i.resumen), 240);
  }

  // 3) Retención y guardado
  const limite = ahora.getTime() - (config.diasRetencion || 14) * 86400000;
  const antiguitatMaximaPerFont = new Map(
    config.fuentes.filter((fuente) => fuente.maxAntiguitatDies).map((fuente) => [fuente.id, fuente.maxAntiguitatDies])
  );
  const fontPerId = new Map(config.fuentes.map((fuente) => [fuente.id, fuente]));
  const items = [...porId.values()]
    .filter((i) => {
      if (filtrarAvui && (!i.publicado || clauDiaLocal(new Date(i.publicado)) !== diaAvui)) return false;
      if (new Date(i.detectado).getTime() < limite) return false;
      const font = fontPerId.get(i.fuente);
      if (font && !coincideixFont({ title: i.titulo, contentSnippet: i.resumen, isoDate: i.publicado }, font, ahora, municipios)) return false;
      const antiguitatMaxima = antiguitatMaximaPerFont.get(i.fuente);
      if (!antiguitatMaxima || !i.publicado) return true;
      return ahora.getTime() - new Date(i.publicado).getTime() <= antiguitatMaxima * 86400000;
    })
    .sort((a, b) => fechaDe(b) - fechaDe(a))
    .slice(0, 3000)
    .map((item) => ({
      ...item,
      municipiosMencionados: (item.municipiosMencionados || []).filter((id) => id !== 'terrassa')
    }));

  const idsEventos = new Set(actividadPrevia.eventos.map((e) => e.id));
  const todosEventos = [...actividadPrevia.eventos, ...eventos.filter((e) => !idsEventos.has(e.id))]
    .filter((e) => new Date(e.t).getTime() >= limite)
    .slice(-400);

  const listaMunicipios = municipios.map(({ id, nombre }) => ({ id, nombre }));
  const cambioItems = await escribirSiCambia(rutaItems, { municipios: listaMunicipios, etiquetas: nombreEtiqueta, items });
  await escribirSiCambia(rutaEstado, { fuentes: estado, consultat: ahora.toISOString() });
  await escribirSiCambia(rutaActividad, { eventos: todosEventos });
  if (config.monitorServeis) {
    const estatServeis = await consultarServeis(config, ahora);
    await escribirSiCambia(path.join(dirSalida, 'serveis.json'), estatServeis);
    for (const servei of estatServeis.serveis) {
      console.log(`[servei] ${servei.id}: ${servei.estat}${servei.estat === 'no-verificat' ? ` (${servei.detall})` : ''}`);
    }
  }
  const calendari = await consultarCalendari(config, ahora);
  await escribirSiCambia(path.join(dirSalida, 'calendari.json'), calendari);
  if (calendari.estat === 'ok') {
    console.log(`[calendari] ${calendari.total} activitats avui`);
  }

  console.log(`Novetats: ${nuevosItems.length} · Esdeveniments nous: ${eventos.length} · Total desat: ${items.length} · ${cambioItems ? 'items.json actualitzat' : 'sense canvis'}`);

  // Falla solo si TODAS las fuentes activas han fallado (para que la acción avise).
  if (activas > 0 && fallidas === activas) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
