/**
 * Proxy de només lectura per a l'agenda pública de TV Sabadell-Vallès.
 * S'executa com el propietari del script perquè Google no exposa els colors
 * personals dels esdeveniments a lectors anònims del calendari públic.
 *
 * Desplega com a Web App: Execute as "Me" i accés "Anyone".
 * No accepta cap calendarId del client i només retorna avui + demà.
 */
const CALENDAR_ID = 'tvsabadellvalles@gmail.com';
const TIME_ZONE = 'Europe/Madrid';
const CACHE_SECONDS = 21600;

function doGet(e) {
  let dades;
  try {
    dades = crearAgenda_();
  } catch (error) {
    dades = {
      estat: 'error',
      error: String(error && error.message ? error.message : error).slice(0, 240),
      activitats: []
    };
  }

  const json = JSON.stringify(dades).replace(/</g, '\\u003c');
  const prefix = String(e && e.parameter && e.parameter.prefix || '');
  const match = prefix.match(/^window\.([A-Za-z_$][A-Za-z0-9_$]*)$/);
  if (match) {
    return ContentService
      .createTextOutput('window.' + match[1] + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/** Ejecuta esta función una vez desde el editor para autorizar y comprobar el acceso. */
function testCalendarAccess() {
  const dades = crearAgenda_();
  const ambColor = dades.activitats.filter(event => Boolean(event.color)).length;
  Logger.log(JSON.stringify({
    activitats: dades.activitats.length,
    ambColor: ambColor,
    consultat: dades.consultat
  }));
  return dades.activitats.length;
}

function crearAgenda_() {
  const cache = CacheService.getScriptCache();
  const clauCache = 'agenda_publica_v2';
  const guardat = cache.get(clauCache);
  if (guardat) {
    try {
      return JSON.parse(guardat);
    } catch (error) {
      cache.remove(clauCache);
    }
  }

  const dades = crearAgendaSenseCache_();
  try {
    cache.put(clauCache, JSON.stringify(dades), 15);
  } catch (error) {
    console.warn('No s’ha pogut desar la memòria cau curta de l’agenda: ' + error.message);
  }
  return dades;
}

function crearAgendaSenseCache_() {
  const ara = new Date();
  const inici = new Date(ara.getTime());
  inici.setHours(0, 0, 0, 0);
  const final = new Date(inici.getTime());
  final.setDate(final.getDate() + 2);

  const token = ScriptApp.getOAuthToken();
  const colors = llegirCacheApi_(
    'calendar_event_colors',
    'https://www.googleapis.com/calendar/v3/colors?fields=event',
    token
  ).event || {};

  const calendarId = encodeURIComponent(CALENDAR_ID);
  const meta = llegirCacheApi_(
    'calendar_label_properties',
    'https://www.googleapis.com/calendar/v3/calendars/' + calendarId
      + '?fields=labelProperties(eventLabels(id,backgroundColor,name))',
    token
  );
  const etiquetes = meta.labelProperties && Array.isArray(meta.labelProperties.eventLabels)
    ? meta.labelProperties.eventLabels
    : [];
  const colorsEtiquetes = Object.fromEntries(
    etiquetes.filter(label => label && label.id && label.backgroundColor)
      .map(label => [label.id, label.backgroundColor])
  );

  // Google requereix eventLabelVersion=0 per als colors clàssics
  // i eventLabelVersion=1 per a les etiquetes personalitzades.
  const esdeveniments = llistarEsdeveniments_(calendarId, inici, final, 0, token);
  let esdevenimentsEtiquetes = [];
  if (etiquetes.length) {
    esdevenimentsEtiquetes = llistarEsdeveniments_(calendarId, inici, final, 1, token);
  }
  const etiquetaPerId = new Map(
    esdevenimentsEtiquetes.map(event => [event.id, event.eventLabelId])
  );
  const activitats = [];

  for (const event of esdeveniments) {
    if (!event || event.status === 'cancelled' || !event.summary || !event.start || !event.end) continue;
    const totElDia = Boolean(event.start.date);
    const dataInici = dataEvent_(event.start);
    const dataFinal = dataEvent_(event.end);
    if (!dataInici || !dataFinal || !Number.isFinite(dataInici.getTime())
      || !Number.isFinite(dataFinal.getTime())) continue;
    if (dataInici >= final || dataFinal <= inici) continue;

    const eventLabelId = etiquetaPerId.get(event.id);
    const color = colorsEtiquetes[eventLabelId]
      || (event.colorId && colors[event.colorId] ? colors[event.colorId].background : null);
    activitats.push({
      titol: String(event.summary).trim(),
      inici: dataInici.toISOString(),
      final: dataFinal.toISOString(),
      totElDia: totElDia,
      color: typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ? color : null
    });
  }

  activitats.sort((a, b) =>
    Number(b.totElDia) - Number(a.totElDia) || new Date(a.inici) - new Date(b.inici)
  );
  return {
    estat: 'ok',
    origen: 'google-oauth-apps-script',
    colorsDisponibles: activitats.some(event => Boolean(event.color)),
    consultat: new Date().toISOString(),
    total: activitats.length,
    activitats: activitats
  };
}

function dataEvent_(valor) {
  if (valor.date) {
    const parts = valor.date.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0);
  }
  return valor.dateTime ? new Date(valor.dateTime) : null;
}

function llistarEsdeveniments_(calendarId, inici, final, versioEtiquetes, token) {
  const base = 'https://www.googleapis.com/calendar/v3/calendars/' + calendarId + '/events';
  const resultat = [];
  let pageToken = '';
  const camps = versioEtiquetes === 1
    ? 'items(id,eventLabelId),nextPageToken'
    : 'items(id,summary,start,end,status,colorId),nextPageToken';

  do {
    const params = {
      timeMin: inici.toISOString(),
      timeMax: final.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      eventLabelVersion: String(versioEtiquetes),
      fields: camps
    };
    if (pageToken) params.pageToken = pageToken;
    const json = apiGet_(construirUrl_(base, params), token);
    if (!Array.isArray(json.items)) throw new Error('Google Calendar no ha retornat una llista d’esdeveniments.');
    resultat.push.apply(resultat, json.items);
    pageToken = json.nextPageToken || '';
  } while (pageToken);

  return resultat;
}

function llegirCacheApi_(clau, url, token) {
  const cache = CacheService.getScriptCache();
  const guardat = cache.get(clau);
  if (guardat) {
    try {
      return JSON.parse(guardat);
    } catch (ignored) {
      cache.remove(clau);
    }
  }
  const dades = apiGet_(url, token);
  cache.put(clau, JSON.stringify(dades), CACHE_SECONDS);
  return dades;
}

function apiGet_(url, token) {
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('Google Calendar API HTTP ' + status + ': ' + body.replace(/\s+/g, ' ').slice(0, 180));
  }
  return JSON.parse(body);
}

function construirUrl_(base, params) {
  const query = Object.keys(params)
    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))
    .join('&');
  return base + '?' + query;
}
