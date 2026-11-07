# Redacció virtual · TV Sabadell-Vallès

Panell intern de seguiment: rastreja fonts municipals, mitjans locals i avisos de servei, i presenta les notícies en una graella visual per a pantalles de redacció. Només mostra peces publicades durant el dia actual a l’hora de Barcelona. **No publica res**.

Cobertura territorial: els 23 municipis del Vallès Occidental, inclosos a `config/municipios.json` per detectar mencions als titulars i filtrar avisos locals. La cobertura de fonts municipals no és encara completa: alguns ajuntaments no ofereixen un feed vigent o accessible.

La interfície utilitza BR Sonoma, amb els pesos i estils inclosos a `docs/fonts/`.

El monitor presenta totes les notícies del dia en una escaleta de files ordenades per hora de publicació, sense categories ni controls interactius. S’exclouen les peces de seccions editorials explícites (opinió, editorial, tribuna, columna i la-vinyeta); no s’infereix el gènere a partir dels temes de la notícia. Cada fila prioritza titular, hora i font. Està dissenyat per a una pantalla de televisió: mostra la previsió i l’hora a la capçalera, resumeix l’estat dels serveis en una fila diferenciada i destaca els avisos amb titulars concisos i llegibles. Quan no caben totes les notícies a la pantalla, la llista es desplaça suaument cap avall i cap amunt amb una pausa de 5 segons als extrems. Els avisos de servei es mostren d’un en un a tota l’amplada i s’alternen cada 15 segons amb una transició vertical; les animacions es desactiven si el dispositiu indica preferència per moviment reduït.

## Probarlo en 2 minutos (VS Code)

Requisito: Node.js 20.11 o superior.

1. Abre esta carpeta en VS Code (`Archivo → Abrir carpeta`) y abre una terminal (`Ctrl+ñ`).
2. `npm install`
3. `npm run prueba` → rastreja fixtures locals de RSS/XML i de la portada estructurada d’ACN, i genera `docs/data/prueba/`.
4. `npm run servir` y abre <http://localhost:8080/?datos=prueba>.

Veureu el monitor amb notícies fictícies i el resum de l’estat dels serveis. Les dades de prova inclouen una notícia **sensible**, una font de tipus «mitjà», una notícia **duplicada** i incidències fictícies de trànsit.

> Si ya habías ejecutado la prueba antes de esta versión, `npm run prueba` borra y regenera sus datos (usa `--reset`), así que no hace falta limpiar nada.

En local, `npm run servir` inicia un rastreig en arrencar i el repeteix cada 10 minuts (configurable amb `RASTREO_CADA_MS`). La pàgina consulta els fitxers de dades cada minut. A GitHub Pages, el workflow rastreja i publica el lloc cada 5 minuts; també ho fa en cada `push` a `main` i es pot iniciar manualment des de la pestanya Actions. Cinc minuts és el mínim de programació de GitHub Actions, i GitHub pot endarrerir el `cron`; per tant, no es pot garantir una actualització al minut.

El lloc es publica a <https://tvsabadellvalles-tech.github.io/redaccio/>. El workflow configura GitHub Pages automàticament en el primer desplegament i utilitza `docs/` com a contingut del lloc.

## Connectar fonts reals

`config/fuentes.json` activa 20 canals de notícies. El rastrejador conserva només les peces d'avui i, als mitjans comarcals, aplica una llista de localitats dels 23 municipis. ACN no ofereix un RSS accessible a les rutes verificades: s'utilitzen les dades estructurades de portada i es conserva només titular, data i enllaç original. 3CatInfo utilitza el seu RSS oficial de Barcelona i filtra les peces que mencionen municipis del Vallès Occidental. El resum de serveis consulta a part FGC, Rodalies, Trànsit, Meteocat i Interior; les incidències de trànsit no s'inclouen com a notícies. També consulta el calendari públic de TV Sabadell-Vallès: l'exportació ICS es processa per generar només les activitats del dia amb hora i títol; no es desen descripcions ni assistents.

### Cadència i salut de les fonts

| Procés | Freqüència | Què significa |
|---|---:|---|
| Rastreig local | A l'inici i cada 10 min | `npm run servir`; configurable amb `RASTREO_CADA_MS`. |
| GitHub Actions | Cada 5 min | Interval mínim programable; GitHub pot endarrerir-lo. |
| Consulta del navegador | Cada 60 s | Torna a llegir els JSON; no força una nova ingesta. |
| Calendari públic | Cada rastreig | Les activitats d'avui es publiquen al JSON de dades amb títol i horari, sense descripció ni assistents. |

Per reproduir els colors dels esdeveniments, activa Google Calendar API al projecte de Google Cloud i crea una clau restringida a aquesta API. Configura-la com a variable d'entorn `GOOGLE_CALENDAR_API_KEY` en local i com a secret del repositori GitHub amb el mateix nom. La clau no s'ha d'afegir als fitxers del projecte. Sense la clau, l'agenda continua funcionant amb el feed ICS públic, però Google no hi inclou els colors personalitzats per esdeveniment.

La comprovació de connectivitat i parseig s'ha fet durant aquesta revisió. Un feed que respon i es parseja amb zero notícies d'avui es considera operatiu: pot no haver publicat avui, o els titulars poden no mencionar la comarca. Això és diferent d'un error HTTP, un timeout o un feed antic.

| Canal actiu | Estat comprovat | Abast |
|---|---|---|
| iSabadell, Ràdio Sabadell, Diari de Sabadell | HTTP 200 | Sabadell i Vallès quan el titular ho identifica. |
| Diari de Terrassa | HTTP 200; RSS parsejable i amb peça d'avui | Filtrat per menció d'un dels 23 municipis o del Vallès Occidental. |
| Ajuntament de Ripollet | HTTP 200; Atom parsejable amb notícies recents | S'incorpora el feed municipal; es conserven només les peces d'avui. |
| 3CatInfo · Barcelona | HTTP 200; RSS parsejable | Col·lecció de diverses comarques, filtrada per municipis del Vallès Occidental. |
| ACN | HTTP 200; dades estructurades de portada | Només peces amb localitat comarcal detectada; la portada no és un arxiu complet. |
| L'Actual (Castellar), Sentmenat | HTTP 200 | Fonts locals dels municipis corresponents. |
| Ràdio Palau, Polinyà, avisos de Polinyà | HTTP 200 | Font local; els avisos es poden actualitzar menys sovint que les notícies. |
| Santa Perpètua, avisos de Santa Perpètua | HTTP 200 | Font local. |
| Montcada i Reixac, avisos de Montcada | HTTP 200 | Font local. |
| Barberà, Cerdanyola, Badia | HTTP 200 | Fonts municipals; sense novetats d'avui no vol dir que el feed falli. |
| Sant Quirze del Vallès | Timeout intermitent en la prova directa; la ingesta completa ha acabat correctament | Configurat amb 30 s i un segon intent abans de marcar-lo com a fallit. |

Les URLs i els estats d'activació es mantenen a `config/fuentes.json`; l'estat de cada font i l'hora de l'últim rastreig (`consultat`) queden a `docs/data/estado.json`. El monitor mostra aquesta frescor separada de la consulta dels serveis i marca els serveis com a desactualitzats al cap de 10 minuts i les notícies al cap de 45 minuts. La ingesta diària descarta deliberadament peces antigues i elements sense una data fiable.

Abans de programar rastrejos, reviseu les condicions d'ús de cada web i el seu `robots.txt`, i substituïu el contacte pendent de `userAgent`. Després: `npm run servir` → <http://localhost:8080>. El rastreig local s’executa automàticament mentre el servidor és obert; també es pot llançar manualment amb `npm run rastreo`.

- El monitor de serveis consulta les incidències i retards de Rodalies publicats avui a les línies R4 i R7; s'exclouen avisos antics que l'API manté a l'històric, i el text del panell diferencia retards d'interrupcions. Trànsit es consulta a la llista oficial d'incidències del Vallès Occidental, limitada a les vies configurades i a registres d'avui. La resposta es verifica amb la seva hora de càrrega i es descarta si té més de cinc minuts. La ingesta usa el `curl` natiu de Windows perquè el servidor del CIT no negocia TLS amb el client HTTPS de Node ni amb el `curl` de Linux del runner de GitHub. FGC i Meteocat conserven les consultes actuals. Emergències només mostra avisos no meteorològics que identifiquin el Vallès Occidental o un municipi cobert; els avisos meteorològics es mostren únicament a Meteocat. No trobar un avís local a la portada d'Interior no certifica que no hi hagi cap emergència.
- El monitor de notícies filtra la data de publicació al dia natural de Barcelona, tant en el rastrejador com a la interfície. Els elements sense data fiable queden fora. La configuració de prova conserva dates fixes per poder repetir les proves en qualsevol moment.
- Meteocat es consulta a partir de les dades públiques que incorpora el visor de la seva pàgina oficial; la previsió comarcal (màximes, mínimes, cel i probabilitat de pluja) es llegeix de `https://static-m.meteo.cat/content/opendata/ctermini_comarcal.xml`. Aquest XML és una previsió, no un feed d'alertes. Si la previsió d'avui ja no hi és, el panell mostra la data futura més propera disponible i l'etiqueta com a «Demà» o amb el dia corresponent. Si canvien els formats, el panell indica «No verificat».
- Emergències es consulta des de les alertes destacades a la portada del Departament d'Interior. No trobar una alerta destacada no certifica que no hi hagi cap incident local; el panell descriu exactament l'abast de la consulta.
- Fonts `oficials`: es desa el titular, l'enllaç i un extracte de fins a 240 caràcters.
- Fonts `mitjà`: només titular, nom de la font i enllaç.
- **Sabadell:** la pàgina de notes de premsa <https://web.sabadell.cat/servei-de-premsa/notes-premsa> respon HTTP 200, però és HTML i no exposa un RSS validat; continua desactivada fins que hi hagi un extractor amb dates fiables.
- **Palau-solità i Plegamans:** la pàgina <https://www.palauplegamans.cat/actualitat/noticies> encara no s'ha pogut consultar des de l'entorn de rastreig. El canal oficial continua desactivat; sí que està connectat el feed de Ràdio Palau, «Palau al Dia».
- **Ripollet:** el nou RSS <https://www.ripollet.cat/actualitat/noticies/noticies/RSS> retorna Atom parsejable amb notícies recents; s'ha activat i el rastrejador en desa només les peces publicades avui.
- **Sant Quirze:** el feed és intermitent i ha superat el temps d'espera en una prova directa; les dues ingestes completes posteriors l'han llegit correctament. S'hi ha afegit un timeout de 30 segons i un segon intent per reduir falsos errors.
- **Ràdio Sabadell:** el feed correcte és `https://radiosabadell.fm/rss.xml`; `/feed` retorna 404.
- **3CatInfo:** la pàgina <https://www.3cat.cat/3catinfo/barcelona/> publica un RSS oficial que abasta diverses comarques; està activat amb filtratge per menció de municipis del Vallès Occidental. L'enllaç de Feeder és una pàgina de descoberta, no l'URL del feed.
- **Govern.cat:** l'endpoint RSS facilitat continua retornant HTTP 403; la font es manté desactivada perquè encara no es poden filtrar les notícies comarcals.
- **El Periódico i AEMET RSS:** El Periódico respon HTTP 406 i l'URL RSS d'AEMET retorna HTTP 404. Meteocat s'integra amb les dades públiques del visor oficial. La clau de l'API d'AEMET no s'ha afegit a cap fitxer; les credencials s'han de desar com a secrets d'entorn.
- **La Vanguardia · Vallès Occidental:** el RSS és parsejable, però l'últim article observat era del 29 de setembre de 2026; es manté desactivat perquè no és una font recent en aquesta comprovació.
- **Cobertura municipal:** els 23 municipis ja participen en els filtres locals, les mencions d'ACN i les alertes de Protecció Civil/Trànsit. Això no equival a tenir 23 feeds municipals: cal validar un canal recent per cada ajuntament abans d'activar-lo.
- **Trànsit:** es consulta l'API oficial d'incidències del Vallès Occidental. La resposta es demana amb `curl.exe` a Windows perquè la negociació TLS falla amb els clients Node i Linux disponibles; no s'abaixa el nivell de seguretat TLS.
- **Protecció Civil:** Telegram és un canal de missatgeria, no un feed RSS. El dataset d'activació de plans indicat retorna HTTP 404; el panell consulta les alertes destacades a la portada d'Interior. DOGC i BOPB continuen pendents de localitzar i verificar.

## Publicarlo gratis (GitHub)

1. Crea un repositorio en GitHub y sube la carpeta (`git init`, `git add .`, `git commit`, `git push`).
2. **Settings → Pages → Deploy from a branch → `main` / carpeta `/docs`.**
3. El workflow `.github/workflows/rastreo.yml` rastrea y publica cada 5 minutos (mínimo programable de GitHub; puede retrasarse) y guarda los cambios en `docs/data/`. También se puede lanzar a mano desde la pestaña *Actions*.

Cosas que conviene comprobar en la documentación de GitHub, porque cambian:

- Pages gratuito suele requerir repositorio **público**. Aquí solo hay datos de fuentes públicas; **no subas nada interno de la TV**.
- Cuota de minutos de Actions y el retraso de los `cron` en horas punta.
- GitHub puede desactivar los `cron` de repos públicos tras un periodo largo sin actividad.

La web lleva `noindex`, pero quien tenga la URL puede verla.

## Qué no hace (todavía)

- No rastreja X: l'API oficial és de pagament i el scraping pot incomplir-ne les condicions d'ús.
- No tiene acceso al archivo de la TV.

## Siguientes pasos sugeridos

1. Completar les fonts municipals pendents amb RSS verificats.
2. Afegir transcripció de plens i cercador de l'arxiu.

## Estructura

```
config/       fuentes.json (fuentes), municipios.json (alias), fuentes.prueba.json
fixtures/     feeds ficticios para pruebas
scripts/      rastreo.js (rastreo), servir.js (servidor local)
docs/         panel estático (index.html, app.js, estil.css) y data/ (salida)
prompts/      plantilla de dossier
.github/      workflow de rastreo programado
```
