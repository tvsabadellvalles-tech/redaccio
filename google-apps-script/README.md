# Proxy autenticado de Google Calendar

El calendario que la web consulta de forma anónima no entrega los colores personales de cada evento. Google solo muestra esos colores a quien tiene permiso para modificar el calendario. Este Web App se ejecuta como el propietario, con permiso **solo de lectura**, y publica únicamente los eventos de hoy y mañana con su color.

## Configuración (una sola vez)

1. Abre [Google Apps Script](https://script.google.com/home/start) y crea un proyecto nuevo.
2. Sustituye el contenido de `Code.gs` por el archivo de este directorio.
3. En el proyecto de Google Cloud vinculado a Apps Script, comprueba que está habilitada **Google Calendar API**. En el editor, abre **Project Settings** y activa **Show "appsscript.json" manifest file in editor**. Abre el manifiesto y sustitúyelo por el contenido de `appsscript.json` de este directorio.
4. Guarda el proyecto. Asegúrate de que lo autorizas con la cuenta propietaria del calendario (o con permiso para modificar sus eventos). En el selector de funciones elige `testCalendarAccess` y pulsa **Run**. Autoriza el acceso a Google Calendar de solo lectura y las peticiones externas. La ejecución registra solo el número de eventos y cuántos tienen color; no registra títulos ni credenciales.
5. Pulsa **Deploy → New deployment → Web app**.
   - **Execute as:** Me.
   - **Who has access:** Anyone.
6. Despliega y copia la URL terminada en `/exec`.

El endpoint es público porque la página de TV es pública. El script está limitado a un calendario fijo, consulta únicamente hoy y mañana y no contiene ninguna operación de escritura. No compartas el token OAuth: Apps Script lo gestiona internamente.

## Activar la web

En [GitHub → Settings → Secrets and variables → Actions](https://github.com/tvsabadellvalles-tech/redaccio/settings/secrets/actions), crea este secreto:

- Nombre: `GOOGLE_CALENDAR_APPS_SCRIPT_URL`
- Valor: la URL `/exec` que acaba de darte Google.

Después, en [GitHub Actions](https://github.com/tvsabadellvalles-tech/redaccio/actions/workflows/rastreo.yml), pulsa **Run workflow** una vez. El navegador consultará el proxy cada 20 segundos y seguirá usando el JSON publicado como respaldo si Google no responde.

## Colores compatibles

El script lee tanto los colores clásicos (`colorId`) como las nuevas etiquetas de color (`eventLabelId`) y sus colores personalizados. La paleta y las etiquetas se guardan en caché durante seis horas; los eventos se vuelven a consultar en cada petición.
