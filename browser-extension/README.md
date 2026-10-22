# Extensión de autorrelleno de Bóveda Pro

Extensión local compatible con Chrome, Edge y otros navegadores basados en Chromium (Manifest V3). El archivo de la bóveda permanece cifrado en el almacenamiento de la extensión; la contraseña maestra y los registros descifrados solo se usan en la ventana emergente abierta.

## Instalar

1. Abre `chrome://extensions` (o `edge://extensions`), activa **Modo de desarrollador** y elige **Cargar descomprimida** para seleccionar esta carpeta `browser-extension`.
2. En Bóveda Pro, desbloquea la bóveda y abre **Conectar la extensión del navegador**.
3. Copia el token de emparejamiento, pégalo en la extensión y elige **Conectar y sincronizar**. La extensión lee la bóveda cifrada de la app local cada vez que se abre; la app debe estar ejecutándose para recibir cambios recientes.
4. Si la app está cerrada, puedes seguir usando el último archivo cifrado sincronizado o importar un respaldo exportado.
5. En el sitio de acceso, abre la extensión, desbloquea y pulsa **Rellenar este acceso**.

La extensión compara el dominio exacto del sitio con la URL guardada y requiere que el usuario pulse el botón de rellenado. No envía credenciales ni el respaldo a servidores. El contrato de sincronización local está descrito en `openapi.yaml`; el endpoint entrega solo el archivo cifrado, exige token y solo acepta origen de extensión. La extensión no envía el formulario por ti.
