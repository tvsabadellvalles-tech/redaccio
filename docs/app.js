// Monitor de notícies i estat dels serveis de Redacció virtual.

const params = new URLSearchParams(location.search);
const carpetaDatos = params.get('datos') ? `data/${params.get('datos').replace(/[^a-z0-9_-]/gi, '')}` : 'data';
const REFRESCO_MS = 60000;
const ANTIGUITAT_MAXIMA_SERVEIS_MS = 10 * 60 * 1000;
const ANTIGUITAT_MAXIMA_DADES_MS = 45 * 60 * 1000;
const NOVETAT_NOTICIA_MS = 15 * 60 * 1000;
const ZONA = 'Europe/Madrid';
const $ = (id) => document.getElementById(id);
const LOGOS_LINIA = {
  R4: {
    imatge: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/R4_barcelona.svg',
    fitxer: 'https://commons.wikimedia.org/wiki/File:R4_barcelona.svg',
    atribucio: 'Vilarrubla · CC BY-SA 3.0'
  },
  R7: {
    imatge: 'https://upload.wikimedia.org/wikipedia/commons/c/c0/R7_barcelona.svg',
    fitxer: 'https://commons.wikimedia.org/wiki/File:R7_barcelona.svg',
    atribucio: 'Vilarrubla · CC BY-SA 3.0'
  },
  S1: {
    imatge: 'https://upload.wikimedia.org/wikipedia/commons/e/e3/S1_barcelona.svg',
    fitxer: 'https://commons.wikimedia.org/wiki/File:S1_barcelona.svg',
    atribucio: 'Vilarrubla · CC BY-SA 3.0'
  },
  S2: {
    imatge: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/S2_barcelona.svg',
    fitxer: 'https://commons.wikimedia.org/wiki/File:S2_barcelona.svg',
    atribucio: 'Vilarrubla · CC BY-SA 3.0'
  }
};
const LOGO_FGC = 'https://upload.wikimedia.org/wikipedia/commons/a/a4/FGC_logo_%282019%29.svg';
const LOGO_RODALIES = 'https://upload.wikimedia.org/wikipedia/commons/2/26/Rodalies_de_Catalunya_logo.svg';
const LOGOS_CARRETERA = {
  'AP-7': {
    imatge: 'https://upload.wikimedia.org/wikipedia/commons/5/5a/ESP_AP-7.svg',
    fitxer: 'https://commons.wikimedia.org/wiki/File:ESP_AP-7.svg'
  },
  'B-30': {
    imatge: 'https://upload.wikimedia.org/wikipedia/commons/d/d9/ESP_B-30.svg',
    fitxer: 'https://commons.wikimedia.org/wiki/File:ESP_B-30.svg'
  },
  'C-58': {
    imatge: 'https://upload.wikimedia.org/wikipedia/commons/7/7a/ESP_C-58.svg',
    fitxer: 'https://commons.wikimedia.org/wiki/File:ESP_C-58.svg'
  },
  'N-150': {
    imatge: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/ESP_N-150.svg',
    fitxer: 'https://commons.wikimedia.org/wiki/File:ESP_N-150.svg'
  }
};

function el(tag, props = {}, ...fills) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const fill of fills) if (fill) node.append(fill);
  return node;
}

function decodificarEntitats(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (entitat, hexadecimal, decimal) => {
      const puntCodi = Number.parseInt(hexadecimal || decimal, hexadecimal ? 16 : 10);
      if (puntCodi < 1 || puntCodi > 0x10ffff || (puntCodi >= 0xd800 && puntCodi <= 0xdfff)) return entitat;
      return String.fromCodePoint(puntCodi);
    });
}

function dataClau(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const valors = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${valors.year}-${valors.month}-${valors.day}`;
}

function esDAvui(iso) {
  const data = new Date(iso);
  return Boolean(iso && Number.isFinite(data.getTime()) && dataClau(data) === dataClau(new Date()));
}

function hora(iso) {
  const data = new Date(iso);
  return Number.isFinite(data.getTime())
    ? new Intl.DateTimeFormat('ca-ES', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(data)
    : 'hora desconeguda';
}

function textRelatiu(iso) {
  const data = new Date(iso);
  if (!Number.isFinite(data.getTime())) return 'hora desconeguda';
  return new Intl.RelativeTimeFormat('ca', { numeric: 'auto' }).format(Math.round((data.getTime() - Date.now()) / 60000), 'minute');
}

const rellotgeFormat = new Intl.DateTimeFormat('ca-ES', {
  timeZone: ZONA,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});
const horaLocalFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONA,
  hour: '2-digit',
  hourCycle: 'h23'
});

function actualitzarRellotge() {
  const ara = new Date();
  const rellotge = $('hora-actual');
  rellotge.dateTime = ara.toISOString();
  rellotge.textContent = rellotgeFormat.format(ara);
  const dia = new Intl.DateTimeFormat('ca-ES', {
    timeZone: ZONA,
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(ara);
  $('data-actual').textContent = dia;
  actualitzarIconaPrevisio(ara);
}

function municipiItem(item) {
  const llocs = [item.municipio, ...(item.municipiosMencionados || [])]
    .filter((lloc, index, tots) => lloc && tots.indexOf(lloc) === index)
    .map((lloc) => nomsMunicipi[lloc] || (lloc === 'comarca' ? 'Comarca' : lloc));
  return llocs.join(' · ') || 'Vallès Occidental';
}

let dades = { items: [], municipis: [], etiquetes: {} };
let nomsMunicipi = { comarca: 'Comarca' };
let previsioActual = null;
let periodePrevisio = null;
const movimentNoticies = {
  ultimMarc: 0,
  residu: 0
};
const VELOCITAT_SCROLL_NOTICIES = 18;
const TEMPS_AVIS_SERVEI_MS = 15000;
const TRANSICIO_AVIS_SERVEI_MS = 650;
let avisosServeis = [];
let indexAvisServei = 0;
let temporitzadorTransicioAvis = null;

function noticiesAvui() {
  return dades.items
    .filter((item) => esDAvui(item.publicado) && !esPecaDOpinio(item))
    .sort((a, b) => new Date(b.publicado) - new Date(a.publicado));
}

function esPecaDOpinio(item) {
  if (item.genere === 'opinio' || item.genero === 'opinion') return true;

  let ruta = '';
  try {
    ruta = new URL(item.enlace).pathname;
  } catch (error) {
    console.warn(`No s’ha pogut comprovar la secció editorial de «${item.titulo}».`, error);
  }
  if (/\/(?:la-vinyeta|opinio|opinion|editorial|tribuna|columnes|columnistes)(?:\/|$)/i.test(ruta)) return true;

  const iniciTitol = String(item.titulo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  return /^(?:opinio|opinion|editorial|columna|tribuna)(?:\s*[:—-]|$)/i.test(iniciTitol);
}

function targetaNoticia(item) {
  const horaPublicacio = item.publicado;
  const detectada = new Date(item.detectado).getTime();
  const antiguitat = Date.now() - detectada;
  const esNova = Number.isFinite(detectada) && antiguitat >= 0 && antiguitat < NOVETAT_NOTICIA_MS;
  const article = el('article', { class: `noticia-fila${esNova ? ' noticia-nova' : ''}` });
  const titular = el('h3', { class: 'fila-titular' });
  if (esNova) titular.append(el('span', { class: 'noticia-nova-etiqueta', text: 'NOVA' }));
  titular.append(document.createTextNode(`${esNova ? ' ' : ''}${decodificarEntitats(item.titulo)}`));
  article.append(...[
    el('time', { class: 'fila-hora', datetime: horaPublicacio, text: hora(horaPublicacio) }),
    el('span', { class: 'fila-font', text: item.fuenteNombre }),
    titular
  ].filter(Boolean));
  return article;
}

function renderNoticies() {
  const llista = $('lista');
  const items = noticiesAvui();
  const scrollAnterior = llista.scrollTop;
  llista.replaceChildren();

  if (!items.length) {
    llista.append(el('div', { class: 'buit-avui' },
      el('span', { class: 'buit-icona', 'aria-hidden': 'true', text: '◷' }),
      el('h3', { text: 'Encara no hi ha notícies d’avui' }),
      el('p', { text: 'El monitor s’actualitza automàticament quan arriben noves publicacions.' })
    ));
  } else {
    const cicle = el('div', { class: 'noticies-cicle' });
    for (const item of items) cicle.append(targetaNoticia(item));
    llista.append(cicle);

    const alçadaCicle = cicle.getBoundingClientRect().height;
    const movimentReduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ciclesNecessaris = movimentReduit || alçadaCicle <= 0
      ? 1
      : Math.max(2, Math.ceil(llista.clientHeight / alçadaCicle) + 1);
    for (let index = 1; index < ciclesNecessaris; index += 1) {
      const repeticio = cicle.cloneNode(true);
      repeticio.setAttribute('aria-hidden', 'true');
      llista.append(repeticio);
    }

    llista.scrollTop = movimentReduit || alçadaCicle <= 0
      ? Math.min(scrollAnterior, llista.scrollHeight - llista.clientHeight)
      : scrollAnterior % alçadaCicle;
    return;
  }
  llista.scrollTop = 0;
}

function desplacarNoticies(marca) {
  const llista = $('lista');
  if (!movimentNoticies.ultimMarc) movimentNoticies.ultimMarc = marca;
  const delta = Math.min(marca - movimentNoticies.ultimMarc, 100);
  movimentNoticies.ultimMarc = marca;

  if (!document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const cicle = llista.querySelector('.noticies-cicle');
    const alçadaCicle = cicle?.getBoundingClientRect().height || 0;
    if (alçadaCicle > 0) {
      const moviment = VELOCITAT_SCROLL_NOTICIES * delta / 1000 + movimentNoticies.residu;
      const pas = Math.trunc(moviment);
      movimentNoticies.residu = moviment - pas;
      if (pas > 0) {
        llista.scrollTop = (llista.scrollTop + pas) % alçadaCicle;
      }
    }
  }
  requestAnimationFrame(desplacarNoticies);
}

function normalitzarScrollNoticies() {
  const llista = $('lista');
  const alçadaCicle = llista.querySelector('.noticies-cicle')?.getBoundingClientRect().height || 0;
  if (alçadaCicle > 0 && llista.scrollTop >= alçadaCicle) {
    llista.scrollTop %= alçadaCicle;
  }
}

function etiquetaEstatServei(servei) {
  if (servei.id === 'meteocat') {
    if (servei.avisos?.length) {
      return { text: `${servei.avisos.length} ${servei.avisos.length === 1 ? 'AVÍS' : 'AVISOS'}`, classe: 'servei-avis' };
    }
    if (servei.estat === 'desconegut' || servei.estat === 'no-verificat') return { text: 'NO VERIFICAT', classe: 'servei-desconegut' };
    return { text: 'SENSE AVISOS', classe: 'servei-ok' };
  }
  if (servei.estat === 'avis') {
    const total = servei.id === 'fgc' && !servei.avisos?.length ? 1 : servei.avisos?.length || 0;
    const text = servei.id === 'emergencies'
      ? `${total} ${total === 1 ? 'ALERTA' : 'ALERTES'}`
      : ['rodalies', 'transit'].includes(servei.id)
        ? `${total} ${total === 1 ? 'AVÍS' : 'AVISOS'} D'AVUI`
      : `${total} ${total === 1 ? 'AVÍS RECENT' : 'AVISOS RECENTS'}`;
    return { text, classe: 'servei-avis' };
  }
  if (servei.estat === 'cap-avis-recent') {
    const text = servei.id === 'fgc' ? 'SENSE INCIDÈNCIES'
      : servei.id === 'emergencies' ? 'SENSE ALERTES LOCALS'
        : ['rodalies', 'transit'].includes(servei.id) ? "SENSE AVISOS D'AVUI" : 'SENSE AVISOS RECENTS';
    return { text, classe: 'servei-ok' };
  }
  return { text: 'NO VERIFICAT', classe: 'servei-desconegut' };
}

function iconaServei(servei) {
  if (servei.id === 'meteocat') {
    if (servei.avisos?.length) return '⚠️';
    if (servei.estat === 'desconegut' || servei.estat === 'no-verificat') return '❔';
    return '☀️';
  }
  return { fgc: '🚆', rodalies: '🚉', transit: '🚗', emergencies: '🚨' }[servei.id] || '•';
}

function iconaServeiElement(servei) {
  const logos = { fgc: LOGO_FGC, rodalies: LOGO_RODALIES };
  const src = logos[servei.id];
  if (!src) return el('span', { class: 'servei-icona', 'aria-hidden': 'true', text: iconaServei(servei) });

  const fallback = servei.id === 'fgc' ? 'FGC' : 'R';
  const imatge = el('img', {
    class: 'servei-icona servei-icona-logo',
    src,
    alt: '',
    'aria-hidden': 'true',
    decoding: 'async'
  });
  imatge.addEventListener('error', () => {
    imatge.replaceWith(el('span', {
      class: 'servei-icona servei-icona-fallback',
      'aria-hidden': 'true',
      text: fallback
    }));
  }, { once: true });
  return imatge;
}

function normalitzarCarretera(valor) {
  const match = String(valor || '').trim().match(/^(AP|A|C|B|N)\s*-?\s*(\d+[A-Z]?)$/i);
  return match ? `${match[1].toUpperCase()}-${match[2].toUpperCase()}` : null;
}

function resumAvisServei(servei, avis) {
  const contingut = `${avis.titol || ''} ${avis.detall || ''}`.replace(/\s+/g, ' ').trim();
  if (servei.id === 'rodalies') {
    const linies = avis.linies?.length ? avis.linies : [...new Set(contingut.match(/\bR[1-9]\b/gi) || [])];
    const estacions = contingut.match(/entre\s+(.+?)\s+i\s+(.+?)(?:\.|,| Es recomana|$)/i);
    const retards = contingut.match(/(?:superar|superiors(?:\s+a)?)\s+(?:els?\s+)?(\d+)\s+minuts?/i);
    const titol = /interromp|suspendr|tallad[ae]/i.test(contingut)
      ? 'CIRCULACIÓ INTERROMPUDA'
      : retards
        ? `RETARDS >${retards[1]} MIN`
        : /demor|retard|fora del seu horari/i.test(contingut)
          ? 'RETARDS'
          : 'AVÍS DE CIRCULACIÓ';
    return {
      titol: `${linies.length ? `${linies.join(' / ')} · ` : ''}${titol}`,
      linies,
      detall: estacions
        ? `${estacions[1].trim()} → ${estacions[2].trim()}`
        : `${contingut.slice(0, 100)}${contingut.length > 100 ? '…' : ''}`
    };
  }
  if (servei.id === 'fgc') {
    const linies = avis.linies?.length
      ? avis.linies.map((linia) => String(linia).toUpperCase())
      : [...new Set(contingut.match(/\bS[1-9]\b/gi) || [])].map((linia) => linia.toUpperCase());
    return {
      titol: `${linies.length ? `${linies.join(' / ')} · ` : ''}AVÍS DE SERVEI`,
      linies,
      detall: `${contingut.slice(0, 100)}${contingut.length > 100 ? '…' : ''}`
    };
  }
  if (servei.id === 'transit') {
    const parts = (avis.detall || '').split('|').map((part) => part.trim()).filter(Boolean);
    const carretera = normalitzarCarretera(avis.carretera)
      || normalitzarCarretera(parts[0])
      || 'CARRETERA';
    const sentit = parts.find((part) => /^sentit\b/i.test(part)) || '';
    const destinacio = sentit.match(/cap a\s+(.+?)(?=-?\s*un carril tallat|$)/i)?.[1]?.replace(/-/g, ' ').trim();
    const motiu = /carril\s+tallat/i.test(contingut) ? 'CARRIL TALLAT'
      : /retenci|retenc/i.test(contingut) ? 'RETENCIONS'
        : /tallat|tancat|tallada/i.test(contingut) ? 'CARRETERA TALLADA'
        : /obres|treballs|manteniment|reparaci/i.test(contingut) ? 'OBRES'
        : 'INCIDÈNCIA VIÀRIA';
    const direccio = sentit.match(/^sentit\s+(\w+)/i)?.[1];
    return {
      titol: `${carretera} · ${motiu}`,
      carretera,
      detall: [parts[1] || '', direccio ? `Sentit ${direccio.toLocaleLowerCase('ca')}` : '', destinacio ? `cap a ${destinacio}` : '', parts.find((part) => /^Punt km\./i.test(part)) || '', parts.find((part) => /^HORARI:/i.test(part)) || ''].filter(Boolean).join(' · ')
    };
  }
  if (servei.id === 'emergencies') {
    const incident = contingut.match(/\b(?:incendi|explosio|fuita|accident|evacuacio|rescat|desapareg|derrum|esfondrament)\w*\b/i)?.[0];
    return {
      titol: incident ? `INCIDÈNCIA · ${incident.toLocaleUpperCase('ca')}` : 'ALERTA LOCAL DE PROTECCIÓ CIVIL',
      detall: 'Avís local identificat a les fonts d’Interior'
    };
  }
  if (servei.id === 'meteocat') {
    return { titol: avis.tipus ? `METEOCAT · ${avis.tipus.toUpperCase()}` : 'AVÍS METEOROLÒGIC', detall: contingut.slice(0, 100) };
  }
  return { titol: contingut.slice(0, 88), detall: servei.nom };
}

function targetaIncidenciaServei({ servei, resum }) {
  const noms = { fgc: 'FGC', rodalies: 'Rodalies', transit: 'Trànsit', meteocat: 'Meteocat', emergencies: 'Emergències' };
  const carretera = resum.carretera;
  const distintiusLinies = (resum.linies || []).map((linia) => {
    const logo = Object.prototype.hasOwnProperty.call(LOGOS_LINIA, linia) ? LOGOS_LINIA[linia] : null;
    if (!logo) return el('span', { class: 'incidencia-via-text', 'aria-hidden': 'true', text: linia });
    const atribucio = `${linia} · ${logo.atribucio} · Wikimedia Commons`;
    const enllac = el('a', {
      class: 'incidencia-logo-enllac',
      href: logo.fitxer,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: atribucio,
      'aria-label': `${linia}, ${logo.atribucio}; veure el fitxer a Wikimedia Commons`
    });
    const imatge = el('img', {
      class: 'incidencia-logo-linia',
      src: logo.imatge,
      alt: linia,
      decoding: 'async'
    });
    imatge.addEventListener('error', () => {
      enllac.replaceWith(el('span', { class: 'incidencia-via-text', 'aria-hidden': 'true', text: linia }));
    }, { once: true });
    enllac.append(imatge);
    return enllac;
  });
  const logoCarretera = LOGOS_CARRETERA[carretera];
  const distintiuCarretera = carretera
    ? logoCarretera
      ? el('a', {
        class: 'incidencia-logo-carretera',
        href: logoCarretera.fitxer,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: `Senyal ${carretera} · Wikimedia Commons`
      }, el('img', {
        class: 'incidencia-via-logo',
        src: logoCarretera.imatge,
        alt: carretera,
        decoding: 'async'
      }))
      : el('span', {
        class: 'incidencia-via-text incidencia-via-carretera',
        'aria-hidden': 'true',
        title: `Identificador de carretera ${carretera}`,
        text: carretera
      })
    : null;
  const imatgeCarretera = distintiuCarretera?.querySelector('img');
  if (imatgeCarretera) {
    imatgeCarretera.addEventListener('error', () => {
      distintiuCarretera.replaceWith(el('span', {
        class: 'incidencia-via-text incidencia-via-carretera',
        'aria-hidden': 'true',
        title: `Identificador de carretera ${carretera}`,
        text: carretera
      }));
    }, { once: true });
  }
  const distintiuFgc = servei.id === 'fgc' && !distintiusLinies.length
    ? el('img', {
      class: 'incidencia-logo-fgc',
      src: LOGO_FGC,
      alt: '',
      'aria-hidden': 'true',
      decoding: 'async'
    })
    : null;
  distintiuFgc?.addEventListener('error', () => {
    distintiuFgc.replaceWith(el('span', { class: 'incidencia-via-text', 'aria-hidden': 'true', text: 'FGC' }));
  }, { once: true });
  const titol = carretera
    ? resum.titol.slice(`${carretera} · `.length)
    : resum.linies?.length
      ? resum.titol.slice(`${resum.linies.join(' / ')} · `.length)
      : resum.titol;
  return el('article', { class: `servei-incidencia ${servei.id}`, 'aria-label': `${noms[servei.id] || servei.nom}: ${resum.titol}` },
    el('div', { class: 'incidencia-font' },
      el('span', { 'aria-hidden': 'true', text: iconaServei(servei) }),
      el('span', { text: noms[servei.id] || servei.nom })
    ),
    el('strong', { class: 'incidencia-titol' },
      ...distintiusLinies,
      distintiuCarretera,
      distintiuFgc,
      el('span', { class: 'incidencia-motiu', text: titol })
    ),
    resum.detall ? el('p', { class: 'incidencia-detall', text: resum.detall }) : null
  );
}

function mostrarAvisServei(index, ambTransicio = false) {
  const franjaAvisos = $('serveis-avisos');
  clearTimeout(temporitzadorTransicioAvis);
  temporitzadorTransicioAvis = null;
  if (!avisosServeis.length) {
    franjaAvisos.replaceChildren();
    franjaAvisos.hidden = true;
    return;
  }

  franjaAvisos.hidden = false;
  franjaAvisos.classList.remove('serveis-avisos-transicio');
  franjaAvisos.replaceChildren(targetaIncidenciaServei(avisosServeis[index]));
  indexAvisServei = index;
  if (ambTransicio && avisosServeis.length > 1) {
    const seguent = (index + 1) % avisosServeis.length;
    const entrant = targetaIncidenciaServei(avisosServeis[seguent]);
    entrant.classList.add('servei-incidencia-entrant');
    franjaAvisos.append(entrant);
    void entrant.offsetHeight;
    franjaAvisos.classList.add('serveis-avisos-transicio');
    temporitzadorTransicioAvis = setTimeout(() => {
      temporitzadorTransicioAvis = null;
      mostrarAvisServei(seguent);
    }, TRANSICIO_AVIS_SERVEI_MS);
  }
}

function iconaTemps(condicio) {
  const text = String(condicio || '').toLocaleLowerCase('ca');
  if (/tempest|tronad|llamp/.test(text)) return '⛈️';
  if (/pluj|ruix|x[aà]fec/.test(text)) return '🌧️';
  if (/neu|nevat/.test(text)) return '❄️';
  if (/boir|boirina/.test(text)) return '🌫️';
  if (/vent/.test(text)) return '💨';
  if (/n[uú]vol|ennuvol|ennuvolat/.test(text)) return /sol/.test(text) ? '🌤️' : '☁️';
  if (/sol|ser[eè]|clar/.test(text)) return '☀️';
  return '🌤️';
}

function etiquetaDiaPrevisio(dataISO, ara) {
  if (!dataISO) return 'Avui';
  const avui = dataClau(ara);
  if (dataISO === avui) return 'Avui';
  const dema = new Date(`${avui}T00:00:00Z`);
  dema.setUTCDate(dema.getUTCDate() + 1);
  if (dataISO === dema.toISOString().slice(0, 10)) return 'Demà';
  return new Intl.DateTimeFormat('ca-ES', {
    timeZone: ZONA,
    weekday: 'short',
    day: 'numeric',
    month: 'numeric'
  }).format(new Date(`${dataISO}T12:00:00Z`));
}

function actualitzarIconaPrevisio(ara) {
  const dataAvui = dataClau(ara);
  const dataPrevisio = previsioActual?.dataISO || dataAvui;
  const horaLocal = dataPrevisio === dataAvui ? Number(horaLocalFormat.format(ara)) : 9;
  const periode = horaLocal < 12 ? 'mati' : 'tarda';
  if (!previsioActual || (periode === periodePrevisio && $('previsio-icona'))) return;

  periodePrevisio = periode;
  const condicio = previsioActual[periode];
  const icona = $('previsio-icona');
  if (!icona) return;
  const dia = etiquetaDiaPrevisio(dataPrevisio, ara);
  $('previsio-dia').textContent = dia;
  icona.textContent = iconaTemps(condicio);
  $('prevision-cabecera').setAttribute(
    'aria-label',
    `Previsió de ${dia} al Vallès Occidental. ${periode === 'mati' ? 'Matí' : 'Tarda'}: ${condicio || 'sense dades'}. Màxima ${previsioActual.maxima} graus, mínima ${previsioActual.minima} graus.`
  );
}

function pintarPrevisio(dadesServeis) {
  const caixa = $('prevision-cabecera');
  const servei = dadesServeis?.serveis?.find((entrada) => entrada.id === 'meteocat');
  const previsio = servei?.previsio;
  caixa.replaceChildren();
  previsioActual = previsio || null;
  periodePrevisio = null;
  if (!previsio) {
    caixa.append(el('p', { class: 'prevision-buits', text: 'Previsió de Meteocat no disponible' }));
    return;
  }

  caixa.append(
    el('span', { id: 'previsio-dia', class: 'prevision-dia' }),
    el('span', { id: 'previsio-icona', class: 'prevision-icona', 'aria-hidden': 'true' }),
    el('strong', { class: 'prevision-temperatura maxima', text: `${previsio.maxima}°`, 'aria-label': `Màxima ${previsio.maxima} graus` }),
    el('strong', { class: 'prevision-temperatura minima', text: `${previsio.minima}°`, 'aria-label': `Mínima ${previsio.minima} graus` })
  );
  actualitzarIconaPrevisio(new Date());
}

function pintarServeis(dadesServeis) {
  const graella = $('serveis-grid');
  const franjaAvisos = $('serveis-avisos');
  graella.replaceChildren();
  if (!dadesServeis?.serveis?.length) {
    avisosServeis = [];
    mostrarAvisServei(0);
    graella.append(el('p', { class: 'serveis-buits', text: 'Encara no hi ha dades dels serveis oficials.' }));
    $('serveis-actualitzat').textContent = 'Sense dades';
    pintarPrevisio(null);
    return;
  }

  const consulta = dadesServeis.consultat ? new Date(dadesServeis.consultat) : null;
  const consultaValida = consulta && Number.isFinite(consulta.getTime());
  const dadesVelles = consultaValida && Date.now() - consulta.getTime() > ANTIGUITAT_MAXIMA_SERVEIS_MS;
  $('serveis-actualitzat').textContent = consultaValida
    ? `CONSULTAT ${hora(consulta.toISOString())} · ${textRelatiu(consulta.toISOString())}${dadesVelles ? ' · DESACTUALITZAT' : ''}`
    : 'HORA DE CONSULTA DESCONEGUDA';
  $('serveis-actualitzat').classList.toggle('dades-velles', Boolean(dadesVelles));
  pintarPrevisio(dadesServeis);

  const noms = { fgc: 'FGC', rodalies: 'Rodalies', transit: 'Trànsit', meteocat: 'Meteocat', emergencies: 'Emergències' };
  const avisos = [];
  for (const servei of dadesServeis.serveis) {
    const estat = etiquetaEstatServei(servei);
    const dataTransit = servei.id === 'transit' && servei.actualitzat
      ? new Date(servei.actualitzat)
      : null;
    graella.append(el('article', { class: `servei-card servei-card-${servei.id} ${estat.classe}` },
      el('div', { class: 'servei-resum' },
        iconaServeiElement(servei),
        el('span', { class: 'servei-nom', text: noms[servei.id] || servei.nom }),
        el('span', { class: 'servei-badge', text: estat.text })
      ),
      dataTransit && Number.isFinite(dataTransit.getTime())
        ? el('span', {
          class: 'servei-actualitzacio',
          text: `DADES ${hora(dataTransit.toISOString())} · ${textRelatiu(dataTransit.toISOString())}`
        })
        : null
    ));
    const avisosServei = servei.id === 'fgc' && servei.estat === 'avis' && !servei.avisos?.length
      ? [{ titol: servei.detall, detall: servei.detall }]
      : servei.avisos || [];
    for (const avis of avisosServei) {
      avisos.push({ servei, avis, resum: resumAvisServei(servei, avis) });
    }
  }
  const clauActual = avisosServeis[indexAvisServei]?.clau;
  avisosServeis = avisos.map(({ servei, avis, resum }) => ({
    servei,
    avis,
    resum,
    clau: `${servei.id}|${avis.titol || ''}|${avis.detall || ''}`
  }));
  const indexActual = avisosServeis.findIndex(({ clau }) => clau === clauActual);
  indexAvisServei = indexActual >= 0 ? indexActual : Math.min(indexAvisServei, Math.max(avisosServeis.length - 1, 0));
  clearTimeout(temporitzadorTransicioAvis);
  mostrarAvisServei(indexAvisServei);
}

function pintarAgenda(calendari) {
  const llista = $('agenda-activitats');
  llista.replaceChildren();
  if (!calendari || calendari.estat === 'error') {
    llista.append(el('p', {
      class: 'agenda-buits',
      text: 'Calendari no disponible ara mateix.'
    }));
    return;
  }
  if (calendari.estat !== 'ok') {
    llista.append(el('p', {
      class: 'agenda-buits',
      text: 'Calendari no configurat.'
    }));
    return;
  }
  if (!calendari.activitats?.length) {
    llista.append(el('p', {
      class: 'agenda-buits',
      text: 'Cap activitat programada per avui.'
    }));
    return;
  }

  for (const activitat of calendari.activitats) {
    const inici = new Date(activitat.inici);
    const final = new Date(activitat.final);
    const horaInici = hora(activitat.inici);
    const horaFinal = hora(activitat.final);
    const temps = activitat.totElDia
      ? 'TOT EL DIA'
      : esDAvui(activitat.inici)
        ? `${horaInici}${Number.isFinite(final.getTime()) && horaFinal !== horaInici ? ` – ${horaFinal}` : ''}`
        : 'EN CURS';
    const acabada = Number.isFinite(final.getTime()) && final.getTime() <= Date.now();
    const article = el('article', { class: `agenda-activitat${acabada ? ' agenda-activitat-passada' : ''}` },
      el('time', {
        class: 'agenda-hora',
        datetime: activitat.inici,
        text: temps
      }),
      el('h3', { class: 'agenda-titol', text: decodificarEntitats(activitat.titol) })
    );
    if (/^#[\da-f]{6}$/i.test(activitat.color || '')) {
      article.style.setProperty('--agenda-color', activitat.color);
      article.style.setProperty('--agenda-tint', `${activitat.color}18`);
    }
    llista.append(article);
  }
  const pendents = Math.max(0, Number(calendari.total || 0) - calendari.activitats.length);
  if (pendents) llista.append(el('p', {
    class: 'agenda-mes',
    text: `+ ${pendents} activitats més al calendari`
  }));
}

function pintarAvisos(estado) {
  const caixa = $('avisos');
  caixa.replaceChildren();
  const errors = Object.entries(estado.fuentes || {}).filter(([, font]) => !font.ok);
  const noms = {
    'ayto-sant-quirze': 'Ajuntament de Sant Quirze',
    'ayto-sabadell': 'Ajuntament de Sabadell',
    'ayto-sentmenat': 'Ajuntament de Sentmenat',
    'ayto-castellar': 'L’Actual'
  };
  for (const [id, font] of errors) {
    const error = String(font.error || '');
    const detall = /timeout|aborted|timed out/i.test(error)
      ? 'temps d’espera esgotat'
      : /HTTP \d+/i.test(error) ? error.match(/HTTP \d+/i)[0] : 'error de connexió';
    const avís = el('div', { text: `${noms[id] || id} · ${detall}` });
    avís.title = `La font no ha retornat dades: ${error || 'error desconegut'}`;
    caixa.append(avís);
  }
  caixa.hidden = errors.length === 0;
}

function pintarFrescorNoticies(estado) {
  const indicador = $('noticies-actualitzat');
  const consultat = estado?.consultat;
  const data = consultat ? new Date(consultat) : null;
  const valida = data && Number.isFinite(data.getTime());
  const vell = valida && Date.now() - data.getTime() > ANTIGUITAT_MAXIMA_DADES_MS;
  indicador.textContent = valida
    ? `FONTS CONSULTADES ${hora(data.toISOString())} · ${textRelatiu(data.toISOString())}${vell ? ' · DESACTUALITZAT' : ''}`
    : 'ACTUALITZACIÓ DE NOTÍCIES DESCONEGUDA';
  indicador.classList.toggle('dades-velles', Boolean(vell || !valida));
}

async function jsonOpcional(url) {
  try {
    const resposta = await fetch(url, { cache: 'no-store' });
    if (!resposta.ok) {
      console.error(`No s’han pogut carregar les dades (${resposta.status}): ${url}`);
      return null;
    }
    return await resposta.json();
  } catch (error) {
    console.error(`No s’han pogut carregar les dades: ${url}`, error);
    return null;
  }
}

async function carregar() {
  const [items, estat, serveis, calendari] = await Promise.all([
    jsonOpcional(`${carpetaDatos}/items.json`),
    jsonOpcional(`${carpetaDatos}/estado.json`),
    jsonOpcional(`${carpetaDatos}/serveis.json`),
    jsonOpcional(`${carpetaDatos}/calendari.json`)
  ]);
  pintarServeis(serveis);
  pintarAgenda(calendari);
  pintarFrescorNoticies(estat);
  pintarAvisos(estat || { fuentes: {} });
  if (!serveis) pintarPrevisio(null);
  if (!items) {
    if (!dades.items.length) $('lista').replaceChildren(el('p', {
      class: 'buit-avui',
      text: 'No s’han pogut carregar les dades. Inicia el panell amb «npm run servir» i obre l’adreça local.'
    }));
    return;
  }

  dades = items;
  for (const entrada of dades.municipis || []) nomsMunicipi[entrada.id] = entrada.nombre;
  renderNoticies();
}

actualitzarRellotge();
setInterval(actualitzarRellotge, 1000);
carregar();
setInterval(() => {
  if (document.hidden) return;
  carregar();
  if (avisosServeis.length > 1 && !temporitzadorTransicioAvis) {
    mostrarAvisServei((indexAvisServei + 1) % avisosServeis.length, true);
  }
}, REFRESCO_MS);
setInterval(() => {
  if (document.hidden || avisosServeis.length < 2 || temporitzadorTransicioAvis !== null) return;
  mostrarAvisServei((indexAvisServei + 1) % avisosServeis.length, true);
}, TEMPS_AVIS_SERVEI_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    movimentNoticies.ultimMarc = 0;
    movimentNoticies.residu = 0;
    carregar();
  }
});
window.addEventListener('resize', renderNoticies);
$('lista').addEventListener('scroll', normalitzarScrollNoticies, { passive: true });
requestAnimationFrame(desplacarNoticies);
