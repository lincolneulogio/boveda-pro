"use client";

import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  decryptVault,
  type EncryptedVault,
  encryptVault,
  generatePassword,
  type VaultEntry,
} from "@/lib/crypto";

const AUTO_LOCK_OPTIONS = [1, 3, 5, 10, 15, 30] as const;

export default function Home() {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [master, setMaster] = useState("");
  const [confirmMaster, setConfirmMaster] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [encrypted, setEncrypted] = useState<EncryptedVault | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState<
    (typeof AUTO_LOCK_OPTIONS)[number]
  >(5);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<VaultEntry | null>(null);
  const filtered = useMemo(
    () =>
      entries.filter((item) =>
        `${item.title} ${item.username} ${item.url}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [entries, query],
  );
  const lock = useCallback(() => {
    setMaster("");
    setEntries([]);
    setUnlocked(false);
    setError("");
  }, []);

  useEffect(() => {
    try {
      const storedMinutes = Number(
        window.localStorage.getItem("boveda.autoLockMinutes"),
      );
      if (AUTO_LOCK_OPTIONS.some((minutes) => minutes === storedMinutes)) {
        setAutoLockMinutes(
          storedMinutes as (typeof AUTO_LOCK_OPTIONS)[number],
        );
      }
    } catch {
      // Keep the secure five-minute default if local settings are unavailable.
    }
  }, []);

  function changeAutoLockMinutes(value: string) {
    const minutes = Number(value);
    if (!AUTO_LOCK_OPTIONS.some((option) => option === minutes)) return;
    setAutoLockMinutes(minutes as (typeof AUTO_LOCK_OPTIONS)[number]);
    try {
      window.localStorage.setItem("boveda.autoLockMinutes", String(minutes));
    } catch {
      setNotice(
        "Se aplicó el ajuste, pero no se pudo guardar para la próxima vez",
      );
    }
  }

  useEffect(() => {
    let active = true;
    invoke<string | null>("load_vault")
      .then((saved) => {
        if (!active) return;
        setEncrypted(saved ? (JSON.parse(saved) as EncryptedVault) : null);
        setIsNew(!saved);
      })
      .catch(() => {
        if (active)
          setStartupError("No se pudo acceder a los datos de la aplicación.");
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const checkForUpdates = useCallback(async (showResult = true) => {
    setCheckingUpdate(true);
    try {
      const update = await check();
      setUpdateVersion(update?.version ?? null);
      if (showResult) {
        setNotice(
          update
            ? `Actualización ${update.version} disponible`
            : "Tienes la versión más reciente",
        );
      }
      await update?.close();
    } catch {
      if (showResult) setNotice("No se pudo consultar GitHub ahora");
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => checkForUpdates(false), 2500);
    return () => window.clearTimeout(timer);
  }, [ready, checkForUpdates]);

  async function installUpdate() {
    setInstallingUpdate(true);
    try {
      const update = await check();
      if (!update) {
        setUpdateVersion(null);
        setNotice("Tienes la versión más reciente");
        return;
      }
      await update.downloadAndInstall();
    } catch {
      setNotice("No se pudo instalar la actualización");
    } finally {
      setInstallingUpdate(false);
    }
  }

  useEffect(() => {
    if (!unlocked) return;
    const timeoutMs = autoLockMinutes * 60 * 1000;
    let timer = window.setTimeout(lock, timeoutMs);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, timeoutMs);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.code === "KeyL"
      ) {
        event.preventDefault();
        lock();
        return;
      }
      reset();
    };
    window.addEventListener("pointerdown", reset);
    window.addEventListener("pointermove", reset);
    window.addEventListener("touchstart", reset);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("pointermove", reset);
      window.removeEventListener("touchstart", reset);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [unlocked, lock, autoLockMinutes]);

  async function unlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (master.length < 12) {
      setError("Usa una contraseña maestra de al menos 12 caracteres.");
      return;
    }
    if (isNew && master !== confirmMaster) {
      setError("Las contraseñas maestras no coinciden.");
      return;
    }
    if (isNew) setConfirmMaster("");
    try {
      const saved = encrypted;
      if (!saved) {
        setIsNew(true);
        setEntries([]);
        setUnlocked(true);
        return;
      }
      setEntries(await decryptVault(saved, master));
      setEncrypted(saved);
      setIsNew(false);
      setUnlocked(true);
    } catch {
      setError(
        "No se pudo abrir. Verifica la contraseña maestra e inténtalo otra vez.",
      );
    }
  }

  async function persist(next: VaultEntry[]) {
    const box = await encryptVault(next, master, encrypted || undefined);
    try {
      await invoke("save_vault", { vaultJson: JSON.stringify(box) });
    } catch {
      setError(
        "No se pudo guardar la bóveda en el equipo. Inténtalo otra vez.",
      );
      return false;
    }
    setEncrypted(box);
    setEntries(next);
    setIsNew(false);
    setNotice("Guardado cifrado en este equipo");
    window.setTimeout(() => setNotice(""), 3500);
    return true;
  }

  function edit(item?: VaultEntry) {
    setEditing(item || null);
    setDialog(true);
  }
  async function saveEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const item: VaultEntry = {
      id: editing?.id || crypto.randomUUID(),
      title: String(form.get("title")),
      username: String(form.get("username")),
      url: String(form.get("url")),
      password: String(form.get("password")),
      notes: String(form.get("notes")),
      updatedAt: new Date().toISOString(),
    };
    const next = editing
      ? entries.map((entry) => (entry.id === item.id ? item : entry))
      : [item, ...entries];
    if (await persist(next)) setDialog(false);
  }
  async function removeEntry(item: VaultEntry) {
    if (!window.confirm(`¿Borrar el acceso de ${item.title}?`)) return;
    await persist(entries.filter((entry) => entry.id !== item.id));
  }
  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setNotice("Copiado al portapapeles");
    window.setTimeout(() => setNotice(""), 1800);
  }
  function exportBackup() {
    if (!encrypted) return;
    const blob = new Blob([JSON.stringify(encrypted, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "boveda-pro-respaldo-cifrado.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }
  async function importBackup(file?: File) {
    if (!file) return;
    try {
      const box = JSON.parse(await file.text()) as EncryptedVault;
      await decryptVault(box, master);
      await invoke("save_vault", { vaultJson: JSON.stringify(box) });
      setEncrypted(box);
      setIsNew(false);
      setEntries(await decryptVault(box, master));
      setNotice("Respaldo importado");
    } catch {
      setError("Respaldo inválido o no corresponde a esta contraseña maestra.");
    }
  }

  if (!ready || startupError) {
    return (
      <main className="startup-screen">
        <div className="brandmark">B</div>
        <h1>
          {startupError
            ? "No se pudo iniciar Bóveda Pro"
            : "Abriendo Bóveda Pro…"}
        </h1>
        {startupError && (
          <p>{startupError} Cierra la aplicación y vuelve a intentarlo.</p>
        )}
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="rail">
        <div className="brandmark">B</div>
        <button type="button" className="rail-active" title="Bóveda">
          ▤
        </button>
        <div className="rail-spacer" />
        <span className="avatar">P</span>
      </aside>
      <section className="workspace">
        <header className="header">
          <div className="crumb">
            ESPACIO PERSONAL <span>/</span> BÓVEDA
          </div>
          <div className="header-right">
            {updateVersion ? (
              <button
                type="button"
                className="update-cta"
                onClick={installUpdate}
                disabled={installingUpdate}
              >
                {installingUpdate
                  ? "Instalando…"
                  : `Instalar actualización ${updateVersion}`}
              </button>
            ) : (
              <button
                type="button"
                className="update-check"
                onClick={() => checkForUpdates(true)}
                disabled={checkingUpdate}
              >
                {checkingUpdate ? "Buscando…" : "Buscar actualizaciones"}
              </button>
            )}
            <span className="secure">
              <i /> CIFRADO ACTIVO
            </span>
            {unlocked && (
              <button type="button" className="quiet" onClick={lock}>
                Bloquear bóveda
              </button>
            )}
          </div>
        </header>
        {!unlocked ? (
          <div className="unlock-layout">
            <div className="hero">
              <div className="eyebrow">TU ESPACIO PRIVADO</div>
              <h1>
                Un lugar seguro
                <br />
                para tus accesos.
              </h1>
              <p>
                Una bóveda personal que se cifra y guarda en este equipo. No
                no necesita cuenta ni conexión para abrir tu bóveda. Si hay
                Internet, consulta GitHub solo para buscar actualizaciones.
              </p>
              <div className="feature-list">
                <span>✓ Cifrado AES-256-GCM</span>
                <span>✓ Sin servidor ni cuenta en línea</span>
                <span>✓ Respaldo cifrado portable</span>
              </div>
            </div>
            <form className="unlock-card" onSubmit={unlock}>
              <div className="lock-icon">⌑</div>
              <h2>{isNew ? "Crea tu bóveda" : "Bienvenida de vuelta"}</h2>
              <p>
                {isNew
                  ? "Elige una contraseña maestra que solo tú conozcas."
                  : "Desbloquea para ver tus accesos guardados."}
              </p>
              <label htmlFor="master">Contraseña maestra</label>
              <input
                id="master"
                autoComplete="current-password"
                type="password"
                value={master}
                onChange={(e) => setMaster(e.target.value)}
                placeholder="12 caracteres o más"
                required
                minLength={12}
              />
              {isNew && (
                <>
                  <label htmlFor="confirm-master">
                    Repite la contraseña maestra
                  </label>
                  <input
                    id="confirm-master"
                    autoComplete="new-password"
                    type="password"
                    value={confirmMaster}
                    onChange={(e) => setConfirmMaster(e.target.value)}
                    placeholder="Vuelve a escribirla"
                    required
                    minLength={12}
                  />
                </>
              )}
              {error && <div className="error">{error}</div>}
              <button type="submit" className="primary full">
                {isNew ? "Crear bóveda segura" : "Desbloquear bóveda"}
                <span>→</span>
              </button>
              <small>
                Si pierdes la contraseña maestra, no podremos recuperar tus
                datos.
              </small>
            </form>
          </div>
        ) : (
          <>
            <div className="page-title">
              <div>
                <div className="eyebrow">GESTIÓN DE CREDENCIALES</div>
                <h1>Mis contraseñas</h1>
                <p>Accesos protegidos y disponibles para ti.</p>
              </div>
              <button
                type="button"
                className="primary add"
                onClick={() => edit()}
              >
                ＋ <span>Nuevo acceso</span>
              </button>
            </div>
            <div className="security-controls">
              <label className="lock-time-control" htmlFor="auto-lock-minutes">
                <span>Bloquear tras</span>
                <select
                  id="auto-lock-minutes"
                  value={autoLockMinutes}
                  onChange={(event) =>
                    changeAutoLockMinutes(event.currentTarget.value)
                  }
                >
                  {AUTO_LOCK_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} {minutes === 1 ? "minuto" : "minutos"}
                    </option>
                  ))}
                </select>
                <span>de inactividad</span>
              </label>
              <div className="lock-shortcut">
                Atajo <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd>
              </div>
              <button type="button" className="quiet" onClick={lock}>
                Bloquear ahora
              </button>
            </div>
            <div className="stat-row">
              <div className="stat">
                <span className="stat-icon">▣</span>
                <div>
                  <b>{entries.length}</b>
                  <small>ACCESOS GUARDADOS</small>
                </div>
              </div>
              <div className="stat">
                <span className="stat-icon green">◈</span>
                <div>
                  <b>En este dispositivo</b>
                  <small>ESTADO DE LA BÓVEDA</small>
                </div>
              </div>
              <div className="stat stat-actions">
                <button type="button" onClick={exportBackup}>
                  ↓ <span>Exportar respaldo</span>
                </button>
                <label className="buttonlike">
                  ↑ <span>Importar</span>
                  <input
                    type="file"
                    accept="application/json"
                    onChange={(e) => importBackup(e.target.files?.[0])}
                  />
                </label>
              </div>
            </div>
            <div className="list-head">
              <div>
                <h2>Todos los accesos</h2>
                <span>{entries.length} elementos</span>
              </div>
              <div className="search-wrap">
                <span>⌕</span>
                <input
                  aria-label="Buscar acceso"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar un acceso…"
                />
              </div>
            </div>
            <div className="table">
              <div className="table-head">
                <span>SERVICIO</span>
                <span>USUARIO</span>
                <span>CONTRASEÑA</span>
                <span>ÚLTIMA EDICIÓN</span>
                <span />
              </div>
              {filtered.length ? (
                filtered.map((item) => (
                  <article className="entry" key={item.id}>
                    <div className="service">
                      <div className="service-icon">
                        {item.title.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <b>{item.title}</b>
                        <small>{item.url || "Sin URL"}</small>
                      </div>
                    </div>
                    <div className="username">{item.username || "—"}</div>
                    <div className="masked" title="Contraseña protegida">
                      ••••••••••••
                    </div>
                    <div className="date">
                      {new Date(item.updatedAt).toLocaleDateString("es-PE", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </div>
                    <div className="entry-actions">
                      <button
                        type="button"
                        title="Copiar usuario"
                        onClick={() => copy(item.username)}
                      >
                        ♧
                      </button>
                      <button
                        type="button"
                        title="Copiar contraseña"
                        onClick={() => copy(item.password)}
                      >
                        ▣
                      </button>
                      <button
                        type="button"
                        title="Editar"
                        onClick={() => edit(item)}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title="Borrar acceso"
                        onClick={() => removeEntry(item)}
                      >
                        ×
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty">
                  <div>▤</div>
                  <b>
                    {query
                      ? "No encontramos resultados"
                      : "Tu bóveda está lista"}
                  </b>
                  <p>
                    {query
                      ? "Prueba otra búsqueda."
                      : "Añade tu primer acceso para empezar."}
                  </p>
                  {!query && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => edit()}
                    >
                      ＋ Añadir acceso
                    </button>
                  )}
                </div>
              )}
            </div>
            {notice && <div className="toast">✓ &nbsp;{notice}</div>}
          </>
        )}
      </section>
      {dialog && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={saveEntry}>
            <button
              type="button"
              className="close"
              onClick={() => setDialog(false)}
            >
              ×
            </button>
            <div className="eyebrow">BÓVEDA PERSONAL</div>
            <h2>{editing ? "Editar acceso" : "Añadir acceso"}</h2>
            <p>La información se cifra antes de guardarse.</p>
            <label htmlFor="entry-title">Nombre del servicio</label>
            <input
              id="entry-title"
              name="title"
              defaultValue={editing?.title}
              placeholder="Ej. Correo personal"
              required
            />
            <label htmlFor="entry-username">Usuario o correo</label>
            <input
              id="entry-username"
              name="username"
              defaultValue={editing?.username}
              placeholder="nombre@ejemplo.com"
            />
            <label htmlFor="entry-url">URL</label>
            <input
              id="entry-url"
              name="url"
              type="url"
              defaultValue={editing?.url}
              placeholder="https://ejemplo.com"
            />
            <label htmlFor="entry-password">Contraseña</label>
            <div className="password-input">
              <input
                id="entry-password"
                type="password"
                name="password"
                defaultValue={editing?.password}
                required
              />
              <button
                type="button"
                onClick={(e) => {
                  const field = e.currentTarget
                    .previousElementSibling as HTMLInputElement;
                  field.value = generatePassword();
                }}
              >
                Generar
              </button>
            </div>
            <label htmlFor="entry-notes">Notas</label>
            <textarea
              id="entry-notes"
              name="notes"
              defaultValue={editing?.notes}
              rows={3}
            />
            <div className="modal-actions">
              <button type="button" onClick={() => setDialog(false)}>
                Cancelar
              </button>
              <button type="submit" className="primary">
                Guardar acceso
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
