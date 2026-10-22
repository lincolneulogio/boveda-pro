# Bóveda Pro

Aplicación de escritorio instalable para Windows. Tauri empaqueta la interfaz Next.js + TypeScript dentro de una ventana nativa y utiliza Rust para guardar la bóveda cifrada en el espacio privado de la aplicación. No se abre en el navegador ni necesita servidor web, cuenta o conexión a Internet para abrir la bóveda; si hay Internet, consulta GitHub para detectar actualizaciones. Tauri usa el WebView2 del sistema para dibujar la interfaz.

## Funciones incluidas

- Crear, desbloquear y bloquear la bóveda con contraseña maestra.
- Crear, buscar, editar, eliminar y copiar credenciales; generar contraseñas aleatorias.
- Cifrado AES-256-GCM en la app con clave derivada mediante PBKDF2-SHA256 (600 000 iteraciones).
- Guardado local en el directorio de datos de la aplicación mediante Rust.
- Importación y exportación de respaldos cifrados.
- Instaladores de Windows NSIS (`.exe`) y MSI (`.msi`).
- Tauri v2 con permisos mínimos: solo comandos Rust para leer y escribir el sobre cifrado.
- Biome para análisis estático y formato del frontend.
- Interfaz sin fuentes de terceros ni solicitudes de red.

## Requisitos

- Node.js 20.9 o posterior y pnpm.
- Rust estable con objetivo MSVC, Microsoft C++ Build Tools con “Desktop development with C++” y WebView2 Runtime. Tauri detalla los [requisitos para Windows](https://v2.tauri.app/start/prerequisites/).

## Crear instalador de Windows

1. Instala los requisitos de Windows indicados arriba.
2. En la raíz del proyecto ejecuta `pnpm install`.
3. Ejecuta `pnpm desktop:build`.
4. Los instaladores aparecerán en `src-tauri/target/release/bundle/nsis/` y `src-tauri/target/release/bundle/msi/`.

Para desarrollar la app en una ventana nativa, ejecuta `pnpm desktop:dev`. `scripts/build-windows.ps1` automatiza la comprobación de herramientas y creación de los instaladores.

## Publicar actualizaciones automáticas

El actualizador consulta `latest.json` en la última GitHub Release. El flujo `.github/workflows/release.yml` compila los instaladores NSIS y MSI, firma los artefactos y publica la Release cuando se sube un tag `v*`. La app consulta actualizaciones al iniciarse y permite buscarlas manualmente; si hay una versión nueva, ofrece instalarla desde la propia app.

Antes de publicar el repositorio hay que reemplazar `OWNER/REPOSITORY` en `src-tauri/tauri.conf.json` con el propietario y nombre reales del repositorio, y sustituir `PUBLIC_KEY_TO_BE_CONFIGURED` por la clave pública de Tauri. La clave privada debe permanecer fuera del repositorio. En GitHub → Settings → Secrets and variables → Actions, guardar la clave privada como `TAURI_SIGNING_PRIVATE_KEY` y su contraseña (si se configuró una) como `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Para publicar una actualización, aumenta la versión en `package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml`, crea y sube el tag correspondiente, por ejemplo `v1.0.1`. GitHub Actions compilará y publicará los instaladores y el manifiesto que consulta la app. La firma de actualizaciones es obligatoria para que Tauri acepte los paquetes.

## Datos y respaldos

El archivo `vault.json` vive en la carpeta de datos de Bóveda Pro administrada por Windows. Solo contiene el sobre cifrado; la clave derivada y las contraseñas se mantienen en memoria mientras la bóveda está desbloqueada. Usa “Exportar respaldo” para guardar una copia cifrada fuera del equipo. La contraseña maestra no se puede recuperar.

El frontend usa Web Crypto para cifrar antes de invocar el backend Rust. El backend solo acepta estructuras de sobre versión 1 y realiza escrituras atómicas dentro del directorio de datos de la app. No hay acceso arbitrario al sistema de archivos desde JavaScript.

## Estructura

```text
src/app/                 Next.js App Router, UI y estilos
src/lib/crypto.ts        Cifrado, descifrado y generador
src-tauri/                App de escritorio y comandos Rust
scripts/                  Creación de instaladores
```
