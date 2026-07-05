# ACOMAACAP v9 — PWA

Sistema de facturación de agua potable y caja/tesorería para la Junta Administradora
de Agua Potable de Cantón Las Piletas, Coatepeque, Santa Ana.

## Contenido del paquete

| Archivo                    | Descripción                                              |
|-----------------------------|-----------------------------------------------------------|
| `index.html`                | App principal (facturación de agua). Es la pantalla de inicio. |
| `caja.html`                 | Módulo de Caja / Tesorería.                               |
| `manifest.json`             | Manifiesto de la PWA (nombre, íconos, colores).           |
| `sw.js`                     | Service Worker (funcionamiento sin conexión).             |
| `offline.html`              | Pantalla que se muestra si no hay red y no hay caché.     |
| `html2pdf.bundle.min.js`    | Librería para generar PDF (se usa dentro del APK Android).|
| `icons/`                    | Íconos de la app en distintos tamaños (48 a 512px).       |

## Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub (o usa uno existente).
2. Sube **todos** los archivos y la carpeta `icons/` **en la raíz del repositorio**
   (no dentro de una subcarpeta), respetando los nombres tal cual están.
3. Ve a **Settings → Pages**.
4. En "Build and deployment" selecciona:
   - Source: `Deploy from a branch`
   - Branch: `main` (o `master`) y carpeta `/ (root)`
5. Guarda. GitHub te dará una URL como:
   `https://tu-usuario.github.io/tu-repositorio/`
6. Abre esa URL: cargará automáticamente `index.html`, que es la app de inicio.

> **Importante:** las rutas dentro de los archivos (`manifest.json`, `sw.js`,
> `icons/...`, `caja.html`) son relativas, así que funcionan igual si el repo
> se publica en la raíz del dominio o en una subcarpeta tipo
> `usuario.github.io/repo/`.

## Instalar como app (PWA)

- **Android (Chrome):** al abrir la URL aparecerá un aviso o el menú ⋮ tendrá
  la opción "Instalar aplicación" / "Agregar a pantalla de inicio".
- **Windows/escritorio (Chrome/Edge):** aparece un ícono de instalación (➕) en
  la barra de direcciones.
- Una vez instalada, abre directo con el ícono del sello de ACOMAACAP, sin
  barra del navegador, y funciona sin conexión para las pantallas ya visitadas
  (los datos siguen guardándose en `localStorage` / Firebase como antes).

## Impresión de recibos y reportes (cambio importante)

Antes, el botón 📄 solo generaba un PDF y lo descargaba. Ahora:

- **Dentro del APK Android** (cuando existe el puente `Android.guardarArchivo`):
  el comportamiento **no cambió** — se sigue generando el PDF y guardándolo
  igual que antes.
- **En PC / Windows (navegador)**: el botón 📄 ahora abre el **diálogo de
  impresión nativo de Windows** (`window.print()`). Desde ahí el usuario puede:
  - Enviarlo a una impresora física conectada, o
  - Elegir "Microsoft Print to PDF" para seguir guardando un PDF si lo prefiere.

  Esto aplica a los recibos de agua (`index.html`), a los tickets de caja y a
  los reportes (anual/mensual/diario) en `caja.html`.

## Actualizar la app luego de subir cambios

Cada vez que subas cambios a `index.html`, `caja.html` u otros archivos
cacheados, sube también el número de versión dentro de `sw.js`:

```js
const CACHE_VERSION = 'acomaacap-v9-1'; // cámbialo, ej: 'acomaacap-v9-2'
```

Esto obliga al Service Worker a descartar la caché vieja y tomar los archivos
nuevos la próxima vez que el usuario abra la app.

## Notas técnicas

- Firebase (Auth + Firestore) se sigue cargando desde
  `https://www.gstatic.com/firebasejs/...` vía CDN — eso requiere conexión a
  internet para el login y la sincronización en la nube. El resto de la
  interfaz (PWA/app shell) queda disponible sin conexión gracias al
  Service Worker.
- Si necesitas regenerar los íconos con otro logo, reemplaza los archivos en
  `icons/` manteniendo los mismos nombres y tamaños.
