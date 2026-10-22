# Bóveda Pro

**Gestor de contraseñas de escritorio para Windows.** Bóveda Pro cifra la bóveda en el dispositivo y no necesita una cuenta ni un servidor para guardar tus credenciales.

[Descargar la última versión](https://github.com/lincolneulogio/boveda-pro/releases/latest) · [Reportar un problema](https://github.com/lincolneulogio/boveda-pro/issues/new/choose) · [Ver cambios](https://github.com/lincolneulogio/boveda-pro/releases)

Aplicación de escritorio instalable para Windows. Tauri empaqueta la interfaz Next.js + TypeScript dentro de una ventana nativa y utiliza Rust para guardar la bóveda cifrada en el espacio privado de la aplicación. No se abre en el navegador ni necesita servidor web, cuenta o conexión a Internet para abrir la bóveda; si hay Internet, consulta GitHub para detectar actualizaciones. Tauri usa el WebView2 del sistema para dibujar la interfaz.

## Funciones incluidas

- Crear, desbloquear y bloquear la bóveda con contraseña maestra.
- Crear, buscar, editar, eliminar y copiar credenciales; generar contraseñas aleatorias.
- Cifrado AES-256-GCM en la app con clave derivada mediante PBKDF2-SHA256 (600 000 iteraciones).
- Guardado local en el directorio de datos de la aplicación mediante Rust.
- Importación y exportación de respaldos cifrados.
- Historial local de copias cifradas, restauración e importación CSV.
- Categorías, favoritos, notas seguras, campos personalizados y archivos adjuntos cifrados.
- Generador flexible, evaluación de fortaleza y avisos de contraseñas débiles, repetidas o antiguas.
- Códigos TOTP, paquetes cifrados para compartir y comprobación manual de contraseñas expuestas mediante k-anonymity.
- Extensión de navegador con autorrelleno y sincronización local de la bóveda cifrada.
- Instaladores de Windows NSIS (`.exe`) y MSI (`.msi`).
- Tauri v2 con permisos mínimos: solo comandos Rust para leer y escribir el sobre cifrado.
- Biome para análisis estático y formato del frontend.
- Interfaz sin fuentes de terceros ni solicitudes de red.

## Requisitos

- Node.js 20.9 o posterior y pnpm.
- Rust estable con objetivo MSVC, Microsoft C++ Build Tools con “Desktop development with C++” y WebView2 Runtime. Tauri detalla los [requisitos para Windows](https://v2.tauri.app/start/prerequisites/).

## Descargar e instalar en Windows

1. Abre [Releases](https://github.com/lincolneulogio/boveda-pro/releases/latest) y descarga el instalador **.exe** recomendado o el paquete **.msi**. Ambos incluyen el número de versión en su nombre.
2. Abre el instalador y sigue las instrucciones de Windows.
3. Inicia Bóveda Pro y crea una bóveda o desbloquea la que ya tienes.

Las actualizaciones automáticas aparecen dentro de la aplicación cuando se publica una Release firmada. Si tienes instalada la versión 1.0.0, instala manualmente la 1.0.1 o una posterior una sola vez; la 1.0.0 no incluía el actualizador.

## Crear instalador de Windows

1. Instala los requisitos de Windows indicados arriba.
2. En la raíz del proyecto ejecuta `pnpm install`.
3. Ejecuta `pnpm desktop:build`.
4. Los instaladores aparecerán en `src-tauri/target/release/bundle/nsis/` y `src-tauri/target/release/bundle/msi/`.

Para desarrollar la app en una ventana nativa, ejecuta `pnpm desktop:dev`. `scripts/build-windows.ps1` automatiza la comprobación de herramientas y creación de los instaladores.

## Publicar actualizaciones automáticas

El actualizador consulta `latest.json` en la última GitHub Release. El flujo `.github/workflows/release.yml` compila los instaladores NSIS y MSI, firma los artefactos y publica la Release cuando se sube un tag `v*`. La app consulta actualizaciones al iniciarse y permite buscarlas manualmente; si hay una versión nueva, ofrece instalarla desde la propia app.

La app consulta `https://github.com/lincolneulogio/boveda-pro/releases/latest/download/latest.json`. El feed de actualizaciones y sus instaladores tienen que poder descargarse sin iniciar sesión. Si el repositorio de código sigue privado, publica los instaladores en un repositorio de releases público y cambia el endpoint a ese repositorio.

La clave pública de Tauri ya está configurada en `src-tauri/tauri.conf.json`. La clave privada está fuera del repositorio, en `../../work/secrets/boveda-pro-updater.key`; conserva una copia segura y no la subas al código. En GitHub → Settings → Secrets and variables → Actions, guarda el contenido de la clave privada como `TAURI_SIGNING_PRIVATE_KEY`. La clave actual no tiene contraseña; el secreto `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` puede quedar vacío.

La versión `1.0.1` incorpora el actualizador. La versión `1.0.0` instalada previamente no tiene el actualizador integrado, por lo que hay que instalar manualmente una vez una versión posterior; las siguientes versiones ya podrán ofrecerse desde la app. Para publicar cada actualización, aumenta la versión en `package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml`, y sube el tag correspondiente. GitHub Actions compilará y publicará los instaladores y el manifiesto que consulta la app. La firma de actualizaciones es obligatoria para que Tauri acepte los paquetes.

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
