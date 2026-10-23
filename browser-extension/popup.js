const $ = (id) => document.getElementById(id);
const encoder = new TextEncoder();
const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
let activeTab;
let decryptedEntries = [];

function show(section) {
  for (const id of ["setup", "unlock", "matches"]) $(id).hidden = id !== section;
  $("message").textContent = "";
}

async function readTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  try {
    const url = new URL(tab.url);
    $("site").textContent = `Sitio actual: ${url.hostname}`;
    return url;
  } catch {
    throw new Error("Abre un sitio web normal para buscar accesos.");
  }
}

async function getVault() {
  const { encryptedVault, syncToken } = await chrome.storage.local.get(["encryptedVault", "syncToken"]);
  if (syncToken) {
    try {
      const refreshed = await syncVault(syncToken);
      if (refreshed) return refreshed;
    } catch { /* Keep the last encrypted copy available while the desktop app is closed. */ }
  }
  return encryptedVault || null;
}

async function syncVault(token) {
  const response = await fetch("http://127.0.0.1:47821/v1/vault", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(response.status === 401 ? "Token incorrecto. Cópialo de la app y vuelve a emparejar." : "No se pudo conectar con Bóveda Pro.");
  const result = await response.json();
  if (!result.vault) throw new Error("La bóveda aún no existe en la app.");
  await chrome.storage.local.set({ encryptedVault: result.vault });
  return result.vault;
}

async function decryptVault(vault, masterPassword) {
  if (![1, 2].includes(vault.version) || vault.kdf !== "PBKDF2-SHA256") throw new Error("El archivo no es un respaldo compatible de Bóveda Pro.");
  if (vault.version === 2) {
    const masterContext = encoder.encode("boveda:v2:master-key");
    const dataContext = encoder.encode("boveda:v2:vault-data");
    const material = await crypto.subtle.importKey("raw", encoder.encode(masterPassword), "PBKDF2", false, ["deriveKey"]);
    const wrappingKey = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: fromBase64(vault.masterSalt), iterations: vault.iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const rawDataKey = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(vault.masterIv), additionalData: masterContext }, wrappingKey, fromBase64(vault.wrappedKey));
    const dataKey = await crypto.subtle.importKey("raw", rawDataKey, { name: "AES-GCM" }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(vault.dataIv), additionalData: dataContext }, dataKey, fromBase64(vault.ciphertext));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  const material = await crypto.subtle.importKey("raw", encoder.encode(masterPassword), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: fromBase64(vault.salt), iterations: vault.iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(vault.iv) }, key, fromBase64(vault.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}

function renderMatches(site) {
  const host = site.hostname.toLowerCase();
  const matches = decryptedEntries.filter((entry) => {
    if (!entry.url) return false;
    try { return new URL(entry.url).hostname.toLowerCase() === host; } catch { return false; }
  });
  $("match-heading").textContent = matches.length ? `${matches.length} acceso(s) para ${host}` : `No hay accesos guardados para ${host}.`;
  const list = $("list");
  list.replaceChildren();
  for (const entry of matches) {
    const card = document.createElement("div");
    card.className = "credential";
    const title = document.createElement("b"); title.textContent = entry.title || host;
    const username = document.createElement("small"); username.textContent = entry.username || "Sin usuario";
    const fill = document.createElement("button"); fill.textContent = "Rellenar este acceso";
    fill.addEventListener("click", async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          args: [{ username: entry.username || "", password: entry.password || "" }],
          func: (credentials) => {
            const visible = (element) => !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
            const fields = [...document.querySelectorAll("input")].filter(visible).filter((input) => !input.disabled && !input.readOnly && ["", "text", "email", "tel"].includes(input.type));
            const password = fields.find((input) => input.type === "password");
            const user = fields.find((input) => input.type === "email") || fields.find((input) => /user|email|login|account/i.test(`${input.name} ${input.id} ${input.autocomplete}`)) || fields.find((input) => input.type === "text");
            if (!password) throw new Error("No encontramos un campo de contraseña en esta página.");
            const setValue = (input, value) => {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
              setter?.call(input, value);
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
            };
            if (user && credentials.username) setValue(user, credentials.username);
            setValue(password, credentials.password);
            password.focus();
          }
        });
        $("message").textContent = "Campos rellenados. Revisa y envía el formulario.";
        $("message").style.color = "#b4e6a9";
      } catch (error) { $("message").textContent = error.message || "No se pudo rellenar esta página."; }
    });
    card.append(title, username, fill); list.append(card);
  }
  show("matches");
}

async function init() {
  try {
    const site = await readTab();
    const vault = await getVault();
    show(vault ? "unlock" : "setup");
    $("backup").addEventListener("change", async (event) => {
      try {
        const file = event.target.files[0]; if (!file) return;
        const parsed = JSON.parse(await file.text());
        if (![1, 2].includes(parsed.version) || parsed.kdf !== "PBKDF2-SHA256") throw new Error("Selecciona un respaldo cifrado de Bóveda Pro.");
        await chrome.storage.local.set({ encryptedVault: parsed });
        show("unlock");
        $("message").style.color = "#b4e6a9";
        $("message").textContent = "Respaldo cifrado importado.";
      } catch (error) { $("message").textContent = error.message || "No se pudo leer el archivo."; }
    });
    $("pair").addEventListener("click", async () => {
      try {
        const token = $("pair-token").value.trim();
        const box = await syncVault(token);
        await chrome.storage.local.set({ syncToken: token });
        $("pair-token").value = "";
        show("unlock");
        $("message").style.color = "#b4e6a9";
        $("message").textContent = `Conectado. Respaldo cifrado actualizado (${box.updatedAt}).`;
      } catch (error) { $("message").style.color = "#ff938c"; $("message").textContent = error.message || "No se pudo emparejar la extensión."; }
    });
    $("replace").addEventListener("click", () => show("setup"));
    $("open").addEventListener("click", async () => {
      try {
        const box = await getVault();
        decryptedEntries = await decryptVault(box, $("master").value);
        $("master").value = "";
        renderMatches(site);
      } catch { $("message").style.color = "#ff938c"; $("message").textContent = "No se pudo descifrar. Comprueba la contraseña maestra."; }
    });
    $("sync").addEventListener("click", async () => {
      try {
        const { syncToken } = await chrome.storage.local.get("syncToken");
        if (!syncToken) { show("setup"); $("message").textContent = "Pega el token de la app para activar la sincronización."; return; }
        const box = await syncVault(syncToken);
        $("message").style.color = "#b4e6a9";
        $("message").textContent = `Bóveda actualizada (${box.updatedAt}). Escribe la contraseña maestra y desbloquea para continuar.`;
      } catch (error) { $("message").style.color = "#ff938c"; $("message").textContent = error.message || "No se pudo sincronizar."; }
    });
    $("lock").addEventListener("click", () => { decryptedEntries = []; window.close(); });
  } catch (error) {
    show("setup");
    $("message").textContent = error.message || "No se pudo leer la pestaña actual.";
  }
}

init();
