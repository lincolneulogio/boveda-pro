# Bóveda Pro

**Gestor de contraseñas de escritorio para Windows.** Bóveda Pro cifra la bóveda en el dispositivo y no necesita una cuenta ni un servidor para guardar tus credenciales.

[Descargar la última versión](https://github.com/lincolneulogio/boveda-pro/releases/latest) · [Reportar un problema](https://github.com/lincolneulogio/boveda-pro/issues/new/choose) · [Ver cambios](https://github.com/lincolneulogio/boveda-pro/releases)

Aplicación de escritorio instalable para Windows. Tauri empaqueta la interfaz Next.js + TypeScript dentro de una ventana nativa y utiliza Rust para guardar la bóveda cifrada en el espacio privado de la aplicación. No se abre en el navegador ni necesita servidor web, cuenta o conexión a Internet para abrir la bóveda; si hay Internet, consulta GitHub para detectar actualizaciones. Tauri usa el WebView2 del sistema para dibujar la interfaz.

## Instalar en Windows

1. Abre [la última versión](https://github.com/lincolneulogio/boveda-pro/releases/latest).
2. Descarga el instalador **`.exe`** recomendado o el **`.msi`**. Los archivos `.sig` son firmas del actualizador; no son instaladores.
3. Ejecuta el instalador y sigue las indicaciones de Windows.
4. Abre Bóveda Pro y crea una bóveda o desbloquea la que ya tienes.

El instalador puede descargar WebView2 si Windows aún no lo tiene. La bóveda puede abrirse sin conexión; buscar actualizaciones y comprobar contraseñas filtradas requiere Internet.

> **Actualizaciones:** Bóveda Pro comprueba si hay una versión nueva al iniciar y permite buscarla desde la aplicación. La versión 1.0.0 no incluye el actualizador: si la tienes, instala manualmente una versión posterior una vez. A partir de entonces, las versiones nuevas se pueden instalar desde la app.

## Funciones

- Guarda accesos de sitios web, tarjetas, notas seguras, redes Wi-Fi y licencias de software.
- Busca, filtra y ordena registros; marca favoritos y revisa contraseñas débiles, repetidas o con más de un año.
- Genera contraseñas de 8 a 64 caracteres y ajusta números, símbolos y caracteres fáciles de distinguir.
- Almacena notas y campos personalizados, claves TOTP y hasta cinco archivos adjuntos de 2 MB por acceso.
- Bloquea la bóveda manualmente, con `Ctrl` + `Shift` + `L` o tras un periodo de inactividad configurable. También se bloquea al ocultarse la ventana.
- Exporta e importa respaldos cifrados, conserva copias locales y permite elegir dónde guardarlas. Puede recordarte que crees un respaldo externo.
- Comparte registros mediante un archivo cifrado con una frase de paso temporal; comparte esa frase por otro canal.
- Incluye una extensión para Chrome, Edge y otros navegadores Chromium, con autorrelleno iniciado por el usuario. [Instrucciones de la extensión](browser-extension/README.md).
- Ofrece una comprobación opcional de contraseñas expuestas usando Pwned Passwords.
- Genera una clave de recuperación para restablecer la contraseña maestra y permite cambiarla desde la bóveda desbloqueada.

## Privacidad y seguridad

- La bóveda se cifra en la aplicación con AES-256-GCM y una clave derivada mediante PBKDF2-SHA-256 (600 000 iteraciones).
- La app de escritorio guarda localmente el sobre cifrado. No sincroniza tus contraseñas con una cuenta o un servidor central.
- La contraseña maestra debe tener al menos 12 caracteres. No se puede restablecer sin la clave de recuperación.
- La clave de recuperación en claro se muestra al crearla y no se guarda en la bóveda; el archivo solo conserva su copia cifrada. Guárdala fuera del equipo y de Bóveda Pro. Cualquier persona que obtenga la clave puede restablecer la contraseña maestra y acceder a la bóveda.
- La extensión conserva una copia cifrada y solo descifra registros mientras su ventana está abierta. Compara el dominio exacto y rellena únicamente cuando lo solicitas; no envía el formulario.
- La comprobación de filtraciones es opcional y se inicia manualmente. Envía a Pwned Passwords los primeros cinco caracteres del hash SHA-1 de cada contraseña única, con relleno de consulta; el servicio no recibe las contraseñas en claro.
- El copiado de contraseñas intenta limpiar el portapapeles después de 30 segundos. El sistema operativo puede impedir esa limpieza.

## Recuperar o cambiar la contraseña maestra

Al crear una bóveda nueva, guarda la clave de recuperación que aparece en pantalla. Si olvidas la contraseña, en la pantalla de desbloqueo pulsa **¿Olvidaste tu contraseña?** y establece una nueva con esa clave. El flujo también permite elegir una copia automática local o un respaldo cifrado v2, incluso en una instalación nueva. Si recuerdas la contraseña del respaldo, puedes restaurarlo directamente desde la pantalla de desbloqueo sin la clave de recuperación.

En la pantalla de la clave puedes copiarla o guardarla como archivo `.txt` desde el selector del sistema. Ese archivo contiene la clave en texto claro; guárdalo aparte de la bóveda y de sus respaldos cifrados.

Con la bóveda desbloqueada, abre **Seguridad de la bóveda** para cambiar la contraseña actual o generar una nueva clave de recuperación. Al cambiar la contraseña de una bóveda antigua, la app la migra al formato nuevo y muestra una clave de recuperación; guárdala antes de continuar. Si generas otra clave, la anterior deja de funcionar.

La recuperación cambia la clave de acceso sin enviar tus datos fuera del dispositivo. Si el archivo local está dañado, la app ofrece restaurar una copia. Si pierdes la contraseña maestra y también la clave de recuperación, solo podrás abrir una copia cuya contraseña todavía recuerdes; no existe una puerta trasera para descifrar los datos. Un respaldo v1 antiguo tampoco tiene recuperación: requiere su contraseña original.

## Respaldos y restauración

El respaldo exportado contiene la bóveda cifrada y se restaura con la misma contraseña maestra. La importación reemplaza la bóveda actual; la aplicación crea antes una copia local. Con cada cambio se guarda automáticamente una copia cifrada y se conservan hasta 20 versiones. Por defecto están en este equipo. Para protegerte ante pérdida o avería del equipo, en **Copias cifradas automáticas → Elegir carpeta** selecciona una carpeta sincronizada por OneDrive, Google Drive o Dropbox; la app crea dentro `Boveda Pro Backups`. Si la carpeta elegida deja de estar disponible, la app avisa que la copia automática falló, aunque el archivo principal sí se haya guardado.

Las copias locales ayudan ante cambios accidentales o daño del archivo y se pueden restaurar con la contraseña o la clave de recuperación correspondiente a esa versión. Tras cambiar la contraseña, una copia antigua puede requerir la clave de recuperación. Para más protección, usa la carpeta sincronizada y guarda la clave de recuperación aparte, por ejemplo en papel o en otro dispositivo seguro. Ninguna copia evita la pérdida si todos los respaldos están solo en el equipo que falla.

## Extensión del navegador

La extensión se carga manualmente como extensión sin empaquetar; no se distribuye desde Chrome Web Store ni Microsoft Edge Add-ons actualmente.

1. Abre `chrome://extensions` o `edge://extensions` y activa **Modo de desarrollador**.
2. Elige **Cargar descomprimida** y selecciona la carpeta `browser-extension` de este repositorio.
3. En Bóveda Pro, desbloquea la bóveda y abre **Conectar la extensión del navegador**.
4. Copia el token de emparejamiento en la extensión y pulsa **Conectar y sincronizar**.
5. En un sitio web, abre la extensión, desbloquéala y pulsa **Rellenar este acceso**.

La app debe estar abierta para sincronizar cambios recientes. Si está cerrada, la extensión puede usar la última bóveda cifrada sincronizada o un respaldo que importes. Consulta [la guía completa](browser-extension/README.md).

## Desarrollo

La aplicación usa Tauri 2, Rust, Next.js, React y TypeScript. Para compilar en Windows necesitas Node.js 20.9 o posterior, pnpm 10, Rust estable con MSVC, Microsoft C++ Build Tools y WebView2. Consulta los [requisitos de Tauri para Windows](https://v2.tauri.app/start/prerequisites/).

```powershell
pnpm install --frozen-lockfile
pnpm desktop:dev
```

| Comando | Acción |
| --- | --- |
| `pnpm dev` | Inicia la interfaz web de desarrollo. |
| `pnpm build` | Compila la interfaz estática que usa Tauri. |
| `pnpm lint` | Revisa formato y problemas estáticos con Biome. |
| `pnpm desktop:dev` | Ejecuta la aplicación en una ventana Tauri. |
| `pnpm desktop:build` | Crea los instaladores de Windows. |

Los instaladores se generan en `src-tauri/target/release/bundle/nsis/` y `src-tauri/target/release/bundle/msi/`.

## Publicar una versión

El flujo de GitHub Actions en `.github/workflows/release.yml` crea instaladores NSIS y MSI, los firma y publica una Release cuando se sube un tag `v*`.

1. Actualiza la misma versión en `package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml`.
2. Crea y publica un tag que coincida, por ejemplo `v1.0.3`.
3. Configura `TAURI_SIGNING_PRIVATE_KEY` en **Settings → Secrets and variables → Actions**. La clave pública correspondiente ya está en `src-tauri/tauri.conf.json`; nunca publiques la clave privada ni la agregues al repositorio.

El actualizador descarga `latest.json` y los instaladores desde la última Release pública. La firma debe corresponder a la clave pública incluida en la app.

## Estructura del proyecto

```text
src/app/             Interfaz, páginas y estilos
src/lib/crypto.ts    Cifrado, descifrado, TOTP y generador
src-tauri/           Aplicación de escritorio y almacenamiento Rust
browser-extension/   Extensión Chromium y guía de instalación
scripts/             Ayudantes para compilar en Windows
```
