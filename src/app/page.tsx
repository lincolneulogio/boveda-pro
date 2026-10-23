"use client";

import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  decryptVault,
  type EncryptedVault,
  encryptVault,
  generateRecoveryKey,
  recoverVault,
  changeMasterPassword,
  resetMasterWithRecovery,
  generatePassword,
  totpCode,
  type VaultCategory,
  type VaultEntry,
} from "@/lib/crypto";

const AUTO_LOCK_OPTIONS = [1, 3, 5, 10, 15, 30] as const;
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";
const CATEGORIES: { value: VaultCategory; label: string }[] = [
  { value: "sitio", label: "Sitio web" }, { value: "tarjeta", label: "Tarjeta" },
  { value: "nota", label: "Nota segura" }, { value: "wifi", label: "Red Wi-Fi" },
  { value: "licencia", label: "Licencia" },
];
type LocalBackup = { name: string; updated_at: string };
function passwordStrength(password: string) {
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return score;
}

export default function Home() {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [master, setMaster] = useState("");
  const [confirmMaster, setConfirmMaster] = useState("");
  const [recoveryToShow, setRecoveryToShow] = useState<string | null>(null);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [savingRecoveryKey, setSavingRecoveryKey] = useState(false);
  const [credentialDialog, setCredentialDialog] = useState<"change" | "recover" | null>(null);
  const [currentMasterInput, setCurrentMasterInput] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryBackupFile, setRecoveryBackupFile] = useState<File | null>(null);
  const [recoveryBackupName, setRecoveryBackupName] = useState("");
  const [recoveryLocalBackups, setRecoveryLocalBackups] = useState<LocalBackup[]>([]);
  const [newMasterInput, setNewMasterInput] = useState("");
  const [confirmNewMasterInput, setConfirmNewMasterInput] = useState("");
  const [securityBusy, setSecurityBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [vaultCorrupted, setVaultCorrupted] = useState(false);
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
  const [categoryFilter, setCategoryFilter] = useState("todas");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [backupDue, setBackupDue] = useState(false);
  const [backupWarning, setBackupWarning] = useState("");
  const [generatorLength, setGeneratorLength] = useState(24);
  const [generatorNumbers, setGeneratorNumbers] = useState(true);
  const [generatorSymbols, setGeneratorSymbols] = useState(true);
  const [generatorEasy, setGeneratorEasy] = useState(true);
  const [generated, setGenerated] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState("todas");
  const [sortBy, setSortBy] = useState("updated");
  const [revealed, setRevealed] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [backupFrequency, setBackupFrequency] = useState(30);
  const [lastBackup, setLastBackup] = useState(0);
  const [syncDetails, setSyncDetails] = useState<{ url: string; token: string; available: boolean } | null>(null);
  const [localBackups, setLocalBackups] = useState<LocalBackup[]>([]);
  const [localRestoreChoice, setLocalRestoreChoice] = useState("");
  const [backupDirectory, setBackupDirectory] = useState("");
  const [totpCodes, setTotpCodes] = useState<Record<string, string>>({});
  const [attachmentFiles, setAttachmentFiles] = useState<{ name: string; type: string; data: string }[]>([]);
  const [checkingBreaches, setCheckingBreaches] = useState(false);
  const duplicateCount = useMemo(() => {
    const passwords = entries.map((entry) => entry.password).filter(Boolean);
    return passwords.length - new Set(passwords).size;
  }, [entries]);
  const oldPasswords = useMemo(() => entries.filter((entry) => entry.password && Date.now() - new Date(entry.passwordChangedAt || entry.updatedAt).getTime() > 365 * 86400000), [entries]);
  const duplicatePasswords = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) if (entry.password) counts.set(entry.password, (counts.get(entry.password) || 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([password]) => password));
  }, [entries]);
  const weakCount = useMemo(() => entries.filter((entry) => entry.password && passwordStrength(entry.password) <= 2).length, [entries]);
  const filtered = useMemo(() => {
    const selected = entries.filter((item) => (categoryFilter === "todas" || (item.category || "sitio") === categoryFilter) && (!favoritesOnly || item.favorite) && (
        `${item.title} ${item.username} ${item.url} ${item.notes} ${(item.customFields || []).map((field) => `${field.label} ${field.value}`).join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase())
      ) && (reviewFilter === "todas" || (reviewFilter === "debiles" && Boolean(item.password) && passwordStrength(item.password) <= 2) || (reviewFilter === "repetidas" && duplicatePasswords.has(item.password)) || (reviewFilter === "antiguas" && Boolean(item.password) && Date.now() - new Date(item.passwordChangedAt || item.updatedAt).getTime() > 365 * 86400000)));
    return selected.sort((a, b) => sortBy === "title" ? a.title.localeCompare(b.title, "es") : sortBy === "category" ? (a.category || "sitio").localeCompare(b.category || "sitio") : sortBy === "strength" ? passwordStrength(a.password) - passwordStrength(b.password) : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [entries, query, categoryFilter, favoritesOnly, reviewFilter, duplicatePasswords, sortBy]);
  const lock = useCallback(() => {
    setMaster("");
    setEntries([]);
    setUnlocked(false);
    setRecoveryToShow(null);
    setRecoveryAcknowledged(false);
    setCredentialDialog(null);
    setCurrentMasterInput("");
    setRecoveryInput("");
    setRecoveryBackupFile(null);
    setRecoveryBackupName("");
    setNewMasterInput("");
    setConfirmNewMasterInput("");
    setSecurityBusy(false);
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

  useEffect(() => {
    try {
      const last = Number(window.localStorage.getItem("boveda.lastBackup"));
      const frequency = Number(window.localStorage.getItem("boveda.backupFrequency")) || 30;
      const dismissedUntil = Number(window.localStorage.getItem("boveda.backupDismissedUntil")) || 0;
      setLastBackup(last);
      setBackupFrequency(frequency);
      setBackupDue((!last || Date.now() - last > frequency * 86400000) && Date.now() > dismissedUntil);
    } catch { setBackupDue(true); }
  }, []);

  useEffect(() => {
    if (!ready) return;
    invoke<{ url: string; token: string; available: boolean }>("sync_info").then(setSyncDetails).catch(() => setSyncDetails(null));
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    invoke<LocalBackup[]>("list_backups").then(setLocalBackups).catch(() => setLocalBackups([]));
  }, [ready, unlocked, entries]);

  useEffect(() => {
    if (!unlocked) return;
    invoke<string>("get_backup_directory")
      .then(setBackupDirectory)
      .catch(() => {
        setBackupDirectory("");
        setBackupWarning("No se puede acceder a la carpeta de copias configurada. Revisa que OneDrive, Google Drive o Dropbox esté disponible.");
      });
  }, [unlocked]);

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

  function changeBackupFrequency(value: string) {
    const days = Number(value);
    if (![7, 30, 90].includes(days)) return;
    setBackupFrequency(days);
    try { window.localStorage.setItem("boveda.backupFrequency", String(days)); } catch { /* Keep the active session setting. */ }
    const due = !lastBackup || Date.now() - lastBackup > days * 86400000;
    setBackupDue(due);
  }

  function dismissBackupReminder() {
    try { window.localStorage.setItem("boveda.backupDismissedUntil", String(Date.now() + 7 * 86400000)); } catch { /* Snooze only for this session. */ }
    setBackupDue(false);
  }

  async function chooseBackupDirectory() {
    const path = await openDialog({ directory: true, multiple: false, title: "Elige dónde guardar las copias cifradas" });
    if (typeof path !== "string") return;
    try {
      setBackupDirectory(await invoke<string>("set_backup_directory", { path }));
      if (encrypted) {
        const warning = await saveEncryptedVault(encrypted);
        setNotice(warning ? "Carpeta seleccionada, pero no se pudo crear la copia automática" : "Carpeta actualizada y copia cifrada creada");
      } else setNotice("Carpeta de copias actualizada");
    }
    catch { setError("No se pudo usar esa carpeta para las copias."); }
  }

  async function resetBackupDirectory() {
    try {
      setBackupDirectory(await invoke<string>("set_backup_directory", { path: null }));
      if (encrypted) {
        const warning = await saveEncryptedVault(encrypted);
        setNotice(warning ? "Carpeta local seleccionada, pero no se pudo crear la copia automática" : "Carpeta local actualizada y copia cifrada creada");
      } else setNotice("Las copias se guardarán en la carpeta segura de la app");
    }
    catch { setError("No se pudo cambiar la carpeta de copias."); }
  }

  useEffect(() => {
    let active = true;
    invoke<string | null>("load_vault")
      .then((saved) => {
        if (!active) return;
        if (!saved) {
          setEncrypted(null);
          setIsNew(true);
          return;
        }
        try {
          setEncrypted(JSON.parse(saved) as EncryptedVault);
          setIsNew(false);
        } catch {
          setEncrypted(null);
          setIsNew(true);
          setVaultCorrupted(true);
          setStartupError("El archivo local de la bóveda está dañado. Puedes restaurar un respaldo cifrado.");
        }
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
    if (!ready || IS_DEVELOPMENT) return;
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
    let lastActivity = Date.now();
    let timer = window.setTimeout(lock, timeoutMs);
    const reset = () => {
      lastActivity = Date.now();
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
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyH") {
        event.preventDefault();
        lock();
        void getCurrentWindow().minimize().catch(() => {});
        return;
      }
      reset();
    };
    const onFocus = () => {
      const remaining = timeoutMs - (Date.now() - lastActivity);
      if (remaining <= 0) { lock(); return; }
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, remaining);
    };
    const onVisibilityChange = () => { if (document.visibilityState === "hidden") lock(); };
    window.addEventListener("pointerdown", reset);
    window.addEventListener("pointermove", reset);
    window.addEventListener("touchstart", reset);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", lock);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("pointermove", reset);
      window.removeEventListener("touchstart", reset);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", lock);
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
        const recoveryKey = generateRecoveryKey();
        const newVault = await encryptVault([], master, undefined, recoveryKey);
        await saveEncryptedVault(newVault);
        setEncrypted(newVault);
        setIsNew(false);
        setEntries([]);
        setUnlocked(true);
        setRecoveryToShow(recoveryKey);
        setRecoveryAcknowledged(false);
        return;
      }
      setEntries(await decryptVault(saved, master));
      setEncrypted(saved);
      setIsNew(false);
      setUnlocked(true);
    } catch {
      setError(
        isNew
          ? "No se pudo crear la bóveda en este equipo. Inténtalo otra vez."
          : "No se pudo abrir. Verifica la contraseña maestra e inténtalo otra vez.",
      );
    }
  }

  async function persist(next: VaultEntry[]) {
    const box = await encryptVault(next, master, encrypted || undefined);
    try {
      await saveEncryptedVault(box);
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

  async function saveEncryptedVault(vault: EncryptedVault) {
    const result = await invoke<{ backupWarning: string | null }>("save_vault", { vaultJson: JSON.stringify(vault) });
    setBackupWarning(result.backupWarning || "");
    return result.backupWarning;
  }

  async function saveSecurityVault(vault: EncryptedVault, nextMaster?: string) {
    await saveEncryptedVault(vault);
    setEncrypted(vault);
    setStartupError("");
    setVaultCorrupted(false);
    if (nextMaster !== undefined) setMaster(nextMaster);
    setCredentialDialog(null);
    setCurrentMasterInput("");
    setRecoveryInput("");
    setRecoveryBackupFile(null);
    setRecoveryBackupName("");
    setNewMasterInput("");
    setConfirmNewMasterInput("");
  }

  function openRecoveryDialog(backupName = "") {
    setCredentialDialog("recover");
    setRecoveryBackupFile(null);
    setRecoveryBackupName(backupName);
    setError("");
    void invoke<LocalBackup[]>("list_backups").then(setRecoveryLocalBackups).catch(() => setRecoveryLocalBackups([]));
  }

  function closeCredentialDialog() {
    setCredentialDialog(null);
    setError("");
    setCurrentMasterInput("");
    setRecoveryInput("");
    setRecoveryBackupFile(null);
    setRecoveryBackupName("");
    setNewMasterInput("");
    setConfirmNewMasterInput("");
  }

  async function submitCredentialChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!encrypted && !recoveryBackupFile && !recoveryBackupName) return;
    if (newMasterInput.length < 12) {
      setError("La nueva contraseña maestra debe tener al menos 12 caracteres.");
      return;
    }
    if (newMasterInput !== confirmNewMasterInput) {
      setError("Las contraseñas maestras no coinciden.");
      return;
    }
    setSecurityBusy(true);
    try {
      if (credentialDialog === "change") {
        if (!encrypted) throw new Error("No hay una bóveda cargada.");
        const currentVault = encrypted;
        const existingEntries = await decryptVault(currentVault, currentMasterInput);
        const result = await changeMasterPassword(currentVault, currentMasterInput, newMasterInput, existingEntries);
        await saveSecurityVault(result.vault, newMasterInput);
        setEntries(existingEntries);
        if (result.recoveryKey) {
          setRecoveryToShow(result.recoveryKey);
          setRecoveryAcknowledged(false);
        } else {
          setNotice("Contraseña maestra actualizada");
        }
      } else if (credentialDialog === "recover") {
        let sourceVault = encrypted;
        if (recoveryBackupFile || recoveryBackupName) {
          const backupText = recoveryBackupFile
            ? await recoveryBackupFile.text()
            : await invoke<string>("read_backup", { name: recoveryBackupName });
          const parsed = JSON.parse(backupText) as EncryptedVault;
          if (parsed.version !== 2 || parsed.kdf !== "PBKDF2-SHA256") throw new Error("El respaldo no tiene un formato compatible con recuperación.");
          if (encrypted && !window.confirm("Este respaldo reemplazará la bóveda local. Se guardará una copia local antes de reemplazarla. ¿Continuar?")) return;
          sourceVault = parsed;
        }
        if (!sourceVault || sourceVault.version !== 2) throw new Error("No hay una bóveda con recuperación. Selecciona un respaldo v2 que incluya su clave de recuperación.");
        const restoredEntries = await recoverVault(sourceVault, recoveryInput);
        const replacement = await resetMasterWithRecovery(sourceVault, recoveryInput, newMasterInput, restoredEntries);
        await saveSecurityVault(replacement, newMasterInput);
        setEntries(restoredEntries);
        setIsNew(false);
        setUnlocked(true);
        setNotice("Contraseña restablecida con la clave de recuperación");
      }
    } catch {
      setError(credentialDialog === "recover"
        ? "No se pudo recuperar. Revisa la clave y que el respaldo sea una copia v2 válida de esta bóveda. No se modificó la bóveda."
        : "No se pudo validar la contraseña actual o guardar el cambio. No se modificó la bóveda.");
    } finally {
      setSecurityBusy(false);
    }
  }

  async function rotateRecoveryKey() {
    if (!encrypted) return;
    setError("");
    setSecurityBusy(true);
    try {
      const recoveryKey = generateRecoveryKey();
      const updatedVault = await encryptVault(entries, master, encrypted, recoveryKey);
      await saveSecurityVault(updatedVault);
      setRecoveryToShow(recoveryKey);
      setRecoveryAcknowledged(false);
    } catch {
      setNotice("No se pudo crear una nueva clave de recuperación");
    } finally {
      setSecurityBusy(false);
    }
  }

  async function copyRecoveryKey() {
    if (!recoveryToShow) return;
    try {
      const value = recoveryToShow;
      await navigator.clipboard.writeText(value);
      setNotice("Clave copiada. Pégala y guárdala en un lugar seguro.");
      window.setTimeout(async () => {
        try { if (await navigator.clipboard.readText() === value) await navigator.clipboard.writeText(""); } catch { /* Clipboard access may be denied by the operating system. */ }
      }, 30_000);
    } catch {
      setError("No se pudo copiar la clave. Selecciónala y guárdala manualmente.");
    }
  }

  async function saveRecoveryKeyFile() {
    if (!recoveryToShow) return;
    setSavingRecoveryKey(true);
    try {
      const path = await saveDialog({
        defaultPath: "Boveda Pro - clave de recuperacion.txt",
        filters: [{ name: "Archivo de texto", extensions: ["txt"] }],
      });
      if (!path) return;
      await invoke("save_recovery_key", { path, recoveryKey: recoveryToShow });
      setError("");
      setNotice("Archivo guardado. Mantén esta clave separada de los respaldos cifrados.");
    } catch {
      setError("No se pudo guardar el archivo. Inténtalo de nuevo o copia la clave manualmente.");
    } finally {
      setSavingRecoveryKey(false);
    }
  }

  function edit(item?: VaultEntry) {
    setEditing(item || null);
    setGenerated(null);
    setAttachmentFiles(item?.attachments || []);
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
      category: String(form.get("category") || "sitio") as VaultCategory,
      favorite: form.get("favorite") === "on",
      customFields: String(form.get("customFields") || "").split("\n").map((line) => {
        const separator = line.indexOf(":");
        return separator < 0 ? null : { label: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
      }).filter((field): field is { label: string; value: string } => Boolean(field?.label)),
      updatedAt: new Date().toISOString(),
      passwordChangedAt: editing?.password === String(form.get("password")) ? (editing.passwordChangedAt || editing.updatedAt) : new Date().toISOString(),
      totpSecret: String(form.get("totpSecret") || "").replace(/\s/g, ""),
      attachments: attachmentFiles,
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
  async function copy(value: string, sensitive = true) {
    await navigator.clipboard.writeText(value);
    setNotice(sensitive ? "Copiado; intentaré borrarlo en 30 s si sigue en el portapapeles" : "Copiado al portapapeles");
    if (sensitive) window.setTimeout(async () => {
      try { if (await navigator.clipboard.readText() === value) await navigator.clipboard.writeText(""); } catch { /* Clipboard read may be denied by the operating system. */ }
    }, 30_000);
    window.setTimeout(() => setNotice(""), 1800);
  }
  async function exportBackup() {
    if (!encrypted) return;
    try {
      const path = await saveDialog({
        defaultPath: "Boveda Pro - respaldo cifrado.json",
        filters: [{ name: "Respaldo cifrado", extensions: ["json"] }],
      });
      if (!path) return;
      await invoke("export_encrypted_backup", { path, vaultJson: JSON.stringify(encrypted, null, 2) });
      const timestamp = Date.now();
      try { window.localStorage.setItem("boveda.lastBackup", String(timestamp)); window.localStorage.removeItem("boveda.backupDismissedUntil"); } catch { /* Reminder is best effort. */ }
      setLastBackup(timestamp);
      setBackupDue(false);
      setNotice("Respaldo cifrado exportado a la ubicación elegida");
    } catch {
      setError("No se pudo guardar el respaldo cifrado en esa ubicación.");
    }
  }
  async function importBackup(file?: File) {
    if (!file) return;
    if (master.length < 12) {
      setError("Escribe la contraseña maestra que protege ese respaldo para poder restaurarlo.");
      return;
    }
    try {
      const box = JSON.parse(await file.text()) as EncryptedVault;
      const restored = await decryptVault(box, master);
      if (encrypted && !window.confirm("Este archivo reemplazará la bóveda actual. Se guardará una copia local antes de reemplazarla. ¿Continuar?")) return;
      const replacement = encrypted?.version === 2
        ? await encryptVault(restored, master, encrypted)
        : box;
      if (encrypted) await saveEncryptedVault(encrypted);
      await saveEncryptedVault(replacement);
      setEncrypted(replacement);
      setStartupError("");
      setVaultCorrupted(false);
      setIsNew(false);
      setEntries(restored);
      setUnlocked(true);
      setConfirmMaster("");
      setNotice("Respaldo importado");
    } catch {
      openRecoveryDialog();
      setRecoveryBackupFile(file);
      setError("Este respaldo no se abrió con la contraseña actual. Si conservas su clave de recuperación, puedes restablecerla desde aquí.");
    }
  }

  async function restoreLocalBackup(name: string) {
    const selected = localBackups.find((backup) => backup.name === name);
    if (master.length < 12) {
      setError("Escribe la contraseña maestra que protege esa copia para restaurarla.");
      return;
    }
    if (!selected || !window.confirm(`Restaurar la copia del ${new Date(selected.updated_at).toLocaleString("es-PE")}? Se guardará una copia de la bóveda actual antes de reemplazarla.`)) return;
    try {
      const json = await invoke<string>("read_backup", { name });
      const box = JSON.parse(json) as EncryptedVault;
      const restored = await decryptVault(box, master);
      const replacement = encrypted?.version === 2
        ? await encryptVault(restored, master, encrypted)
        : box;
      if (encrypted) await saveEncryptedVault(encrypted);
      await saveEncryptedVault(replacement);
      setEncrypted(replacement);
      setStartupError("");
      setVaultCorrupted(false);
      setEntries(restored);
      setIsNew(false);
      setUnlocked(true);
      setNotice("Copia local restaurada");
    } catch {
      openRecoveryDialog(name);
      setError("Esta copia no se abrió con la contraseña actual. Si guardaste su clave de recuperación, introdúcela para restaurar la copia y definir una contraseña nueva.");
    }
  }

  async function updateTotpCodes() {
    const next: Record<string, string> = {};
    for (const entry of entries) if (entry.totpSecret) {
      try { next[entry.id] = await totpCode(entry.totpSecret); } catch { /* Ignore invalid secrets. */ }
    }
    setTotpCodes(next);
  }

  useEffect(() => {
    if (!unlocked) return;
    void updateTotpCodes();
    const timer = window.setInterval(() => void updateTotpCodes(), 1000);
    return () => window.clearInterval(timer);
  }, [unlocked, entries]);

  async function readAttachments(files: FileList | null) {
    if (!files) return;
    const additions = await Promise.all(Array.from(files).map((file) => new Promise<{ name: string; type: string; data: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type || "application/octet-stream", data: String(reader.result) });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    })));
    setAttachmentFiles((current) => [...current, ...additions].slice(0, 5));
  }

  async function checkBreaches() {
    setCheckingBreaches(true);
    try {
      const exposures = new Map<string, number>();
      for (const password of new Set(entries.map((entry) => entry.password).filter(Boolean))) {
        const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password)))].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
        const response = await fetch(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`, { headers: { "Add-Padding": "true", "User-Agent": "Boveda-Pro/1.0" } });
        if (!response.ok) throw new Error("No se pudo consultar el servicio de filtraciones.");
        const match = (await response.text()).split("\n").find((line) => line.split(":")[0] === digest.slice(5));
        if (match) exposures.set(password, Number(match.split(":")[1]) || 1);
      }
      const count = entries.filter((entry) => exposures.has(entry.password)).length;
      setNotice(count ? `${count} acceso(s) usan contraseñas encontradas en filtraciones conocidas` : "No se encontraron contraseñas expuestas en la base consultada");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falló la consulta de filtraciones."); }
    finally { setCheckingBreaches(false); }
  }

  async function importCsv(file?: File) {
    if (!file) return;
    try {
      const lines = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
      const parse = (line: string) => {
        const cells: string[] = []; let cell = ""; let quoted = false;
        for (let index = 0; index < line.length; index++) {
          const character = line[index];
          if (character === '"' && quoted && line[index + 1] === '"') { cell += '"'; index++; }
          else if (character === '"') quoted = !quoted;
          else if (character === "," && !quoted) { cells.push(cell); cell = ""; }
          else cell += character;
        }
        cells.push(cell);
        return cells;
      };
      const headers = parse(lines.shift() || "").map((value) => value.trim().toLowerCase());
      const col = (...names: string[]) => headers.findIndex((name) => names.includes(name));
      const titleCol = col("name", "title", "nombre"); const userCol = col("username", "user", "login", "usuario", "email"); const passCol = col("password", "contraseña", "clave");
      if (titleCol < 0 || passCol < 0) throw new Error("El CSV debe incluir columnas Name/Title y Password.");
      const imported = lines.map((line) => {
        const row = parse(line); const value = (index: number) => index >= 0 ? row[index] || "" : "";
        return { id: crypto.randomUUID(), title: value(titleCol) || "Acceso importado", username: value(userCol), password: value(passCol), url: value(col("url", "website", "uri", "sitio web")), notes: value(col("note", "notes", "notas")), category: "sitio" as VaultCategory, updatedAt: new Date().toISOString(), passwordChangedAt: new Date().toISOString() };
      }).filter((entry) => entry.password);
      if (!imported.length) throw new Error("El archivo no contiene filas con contraseñas.");
      if (await persist([...imported, ...entries])) setNotice(`${imported.length} acceso(s) importados desde CSV`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo importar el CSV."); }
  }

  async function exportShare() {
    const passphrase = window.prompt("Crea una contraseña temporal para cifrar este archivo compartido (12 caracteres o más):");
    if (!passphrase) return;
    if (passphrase.length < 12) { setError("La contraseña para compartir debe tener al menos 12 caracteres."); return; }
    const box = await encryptVault(entries, passphrase);
    const blob = new Blob([JSON.stringify({ format: "boveda-share-v1", vault: box })], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "boveda-compartida-cifrada.json"; link.click(); URL.revokeObjectURL(url);
    setNotice("Archivo cifrado listo. Comparte la contraseña temporal por otro canal.");
  }

  async function importFile(file?: File) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.format === "boveda-share-v1") {
        const passphrase = window.prompt("Introduce la contraseña temporal del archivo compartido:");
        if (!passphrase) return;
        const incoming = await decryptVault(parsed.vault as EncryptedVault, passphrase);
        const byId = new Map(entries.map((entry) => [entry.id, entry]));
        for (const entry of incoming) byId.set(entry.id, entry);
        if (await persist([...byId.values()])) setNotice(`${incoming.length} acceso(s) compartidos añadidos`);
        return;
      }
      await importBackup(file);
    } catch { setError("Archivo compartido inválido o contraseña incorrecta."); }
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
          <>
            <p>{startupError}{!vaultCorrupted && " Cierra la aplicación y vuelve a intentarlo."}</p>
            {vaultCorrupted && <div className="repair-vault">
              <label htmlFor="repair-master">Contraseña maestra del respaldo</label>
              <input id="repair-master" type="password" autoComplete="current-password" value={master} onChange={(event) => setMaster(event.currentTarget.value)} placeholder="12 caracteres o más" />
              <label className="recovery-link backup-restore-link">Seleccionar respaldo cifrado<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.currentTarget.files?.[0]; void importBackup(file); event.currentTarget.value = ""; }} /></label>
              {localBackups.length > 0 && <div className="local-repair"><label htmlFor="repair-local-backup">O restaurar una copia automática</label><select id="repair-local-backup" value={localRestoreChoice} onChange={(event) => setLocalRestoreChoice(event.currentTarget.value)}><option value="">Selecciona una copia</option>{localBackups.map((backup) => <option key={backup.name} value={backup.name}>{new Date(backup.updated_at).toLocaleString("es-PE")}</option>)}</select><button type="button" disabled={!localRestoreChoice} onClick={() => void restoreLocalBackup(localRestoreChoice)}>Restaurar con contraseña maestra</button></div>}
              <button type="button" className="recovery-link" onClick={() => openRecoveryDialog()}>Restaurar con la clave de recuperación</button>
              {error && <div className="error">{error}</div>}
            </div>}
          </>
        )}
        {vaultCorrupted && credentialDialog === "recover" && <div className="modal-backdrop"><form className="modal" onSubmit={submitCredentialChange}>
          <button type="button" className="close" onClick={closeCredentialDialog}>×</button>
          <div className="eyebrow">RECUPERACIÓN</div><h2>Restaurar bóveda</h2>
          <p>Usa la clave de recuperación con una copia externa o automática. Sin una copia válida no se puede reconstruir un archivo dañado.</p>
          <label htmlFor="repair-recovery-input">Clave de recuperación</label><input id="repair-recovery-input" type="password" value={recoveryInput} onChange={(event) => setRecoveryInput(event.currentTarget.value)} required />
          <label htmlFor="repair-recovery-backup">Respaldo externo (opcional si eliges una copia local)</label><input id="repair-recovery-backup" type="file" accept="application/json,.json" onChange={(event) => { setRecoveryBackupFile(event.currentTarget.files?.[0] ?? null); if (event.currentTarget.files?.[0]) setRecoveryBackupName(""); }} />
          <label htmlFor="repair-recovery-local">Copia automática local</label><select id="repair-recovery-local" value={recoveryBackupName} onChange={(event) => { setRecoveryBackupName(event.currentTarget.value); if (event.currentTarget.value) setRecoveryBackupFile(null); }}><option value="">Selecciona una copia</option>{recoveryLocalBackups.map((backup) => <option key={backup.name} value={backup.name}>{new Date(backup.updated_at).toLocaleString("es-PE")}</option>)}</select>
          <label htmlFor="repair-new-master">Nueva contraseña maestra</label><input id="repair-new-master" type="password" minLength={12} value={newMasterInput} onChange={(event) => setNewMasterInput(event.currentTarget.value)} required />
          <label htmlFor="repair-confirm-master">Repite la nueva contraseña</label><input id="repair-confirm-master" type="password" minLength={12} value={confirmNewMasterInput} onChange={(event) => setConfirmNewMasterInput(event.currentTarget.value)} required />
          {error && <div className="error">{error}</div>}<div className="modal-actions"><button type="button" onClick={closeCredentialDialog}>Cancelar</button><button type="submit" className="primary">Restaurar</button></div>
        </form></div>}
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
    {!IS_DEVELOPMENT && (updateVersion ? (
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
    ))}
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
              <label className="recovery-link backup-restore-link">
                Restaurar respaldo cifrado con su contraseña maestra
                <input type="file" accept="application/json,.json" onChange={(event) => { const file = event.currentTarget.files?.[0]; void importBackup(file); event.currentTarget.value = ""; }} />
              </label>
              {!isNew && <button type="button" className="recovery-link" onClick={() => openRecoveryDialog()}>
                ¿Olvidaste tu contraseña? Usa la clave de recuperación
              </button>}
              {isNew && <button type="button" className="recovery-link" onClick={() => openRecoveryDialog()}>
                ¿Tienes un respaldo y su clave de recuperación? Restáuralo
              </button>}
              {isNew && localBackups.length > 0 && <div className="local-repair"><label htmlFor="unlock-local-backup">Restaurar copia automática local</label><select id="unlock-local-backup" value={localRestoreChoice} onChange={(event) => setLocalRestoreChoice(event.currentTarget.value)}><option value="">Selecciona una copia</option>{localBackups.map((backup) => <option key={backup.name} value={backup.name}>{new Date(backup.updated_at).toLocaleString("es-PE")}</option>)}</select><button type="button" disabled={!localRestoreChoice} onClick={() => void restoreLocalBackup(localRestoreChoice)}>Restaurar con contraseña maestra</button></div>}
              <small>{isNew
                ? "Al crear la bóveda recibirás una clave de recuperación. Guárdala fuera de este equipo."
                : encrypted?.version === 1
                  ? "Esta bóveda antigua no tiene clave de recuperación. Si la desbloqueas, podrás configurar una."
                  : "Sin la contraseña maestra o la clave de recuperación, no se pueden recuperar los datos."}</small>
            </form>
          </div>
        ) : (
          <div className="dashboard">
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
              <label className="lock-time-control" htmlFor="backup-frequency">
                <span>Recordar respaldo cada</span>
                <select id="backup-frequency" value={backupFrequency} onChange={(event) => changeBackupFrequency(event.currentTarget.value)}>
                  <option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option>
                </select>
              </label>
              <div className="lock-shortcut">
                Bloquear <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd> · Ocultar <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>H</kbd>
              </div>
              <button type="button" className="quiet" onClick={lock}>
                Bloquear ahora
              </button>
            </div>
            <details className="sync-panel">
              <summary>Seguridad de la bóveda</summary>
              <p>Cambia la contraseña maestra mientras la bóveda está desbloqueada o crea una clave de recuperación para restablecerla si la olvidas.</p>
              <div className="security-actions">
                <button type="button" className="quiet" onClick={() => { setCredentialDialog("change"); setError(""); }}>Cambiar contraseña maestra</button>
                <button type="button" className="quiet" disabled={securityBusy} onClick={() => void rotateRecoveryKey()}>{securityBusy ? "Procesando…" : encrypted?.version === 2 ? "Generar nueva clave de recuperación" : "Configurar clave de recuperación"}</button>
              </div>
              <small>La clave se muestra una sola vez. Guardarla fuera de la bóveda y de este equipo es tu responsabilidad.</small>
            </details>
            <details className="sync-panel">
              <summary>Conectar la extensión del navegador</summary>
              {syncDetails?.available ? <>
                <p>En la extensión, pega este token una sola vez. La app entrega únicamente la bóveda cifrada en tu equipo; ambos programas deben estar abiertos para sincronizar.</p>
                <code>{syncDetails.token}</code>
                <button type="button" className="quiet" onClick={() => copy(syncDetails.token)}>Copiar token de emparejamiento</button>
                <small>Endpoint local: {syncDetails.url} · Solo accesible desde una extensión emparejada.</small>
              </> : <p>El servicio local no pudo abrir el puerto de sincronización. Cierra otra instancia de Bóveda Pro y vuelve a intentarlo.</p>}
            </details>
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
                <button type="button" onClick={() => void exportShare()} title="Crear un archivo cifrado con una contraseña temporal">⇧ <span>Compartir cifrado</span></button>
                <label className="buttonlike">
                  ↑ <span>Importar</span>
                  <input
                    type="file"
                    accept="application/json,.csv,text/csv"
                    onChange={(e) => { const file = e.target.files?.[0]; if (file?.name.toLowerCase().endsWith(".csv")) void importCsv(file); else void importFile(file); e.currentTarget.value = ""; }}
                  />
                </label>
              </div>
            </div>
            <details className="sync-panel local-backups">
              <summary>Copias cifradas automáticas ({localBackups.length})</summary>
              <p>Se guarda una copia cifrada con cada cambio y se conservan las 20 más recientes. Por defecto quedan en este equipo; para cubrir pérdida o avería del PC, elige una carpeta sincronizada de OneDrive, Google Drive o Dropbox. La app creará dentro la carpeta «Boveda Pro Backups».</p>
              <div className="backup-location"><small>Carpeta: {backupDirectory || "Cargando…"}</small><button type="button" className="quiet" onClick={chooseBackupDirectory}>Elegir carpeta</button><button type="button" className="quiet" onClick={resetBackupDirectory}>Restablecer</button></div>
              {localBackups.slice(0, 8).map((backup) => <div className="backup-row" key={backup.name}><span>{new Date(backup.updated_at).toLocaleString("es-PE")}</span><button type="button" className="quiet" onClick={() => restoreLocalBackup(backup.name)}>Restaurar</button></div>)}
            </details>
            {(weakCount > 0 || duplicateCount > 0 || oldPasswords.length > 0 || (backupDue && encrypted !== null) || Boolean(backupWarning)) && (
              <div className="security-alerts" role="status">
                {weakCount > 0 && <span>⚠ {weakCount} contraseña(s) débil(es)</span>}
                {duplicateCount > 0 && <span>⚠ {duplicateCount} contraseña(s) reutilizada(s)</span>}
                {oldPasswords.length > 0 && <span>⟳ {oldPasswords.length} contraseña(s) con más de un año</span>}
                {backupWarning && <span>⚠ La bóveda se guardó, pero falló la copia automática: {backupWarning}</span>}
                {backupWarning && <button type="button" onClick={chooseBackupDirectory}>Elegir carpeta sincronizada</button>}
                {backupDue && encrypted && <span>▣ Es hora de exportar una copia cifrada{lastBackup ? ` · última exportación ${new Date(lastBackup).toLocaleDateString("es-PE")}` : " · aún no has exportado una copia externa"}</span>}
                {backupDue && encrypted && <button type="button" onClick={exportBackup}>Crear respaldo</button>}
                {backupDue && encrypted && <button type="button" onClick={dismissBackupReminder}>Recordar en 7 días</button>}
              </div>
            )}
            <div className="security-actions"><span>Revisión adicional</span><small>Consulta opcional de contraseñas contra filtraciones conocidas; solo se envían los primeros 5 caracteres del hash SHA-1.</small><button type="button" className="quiet" disabled={checkingBreaches || !entries.length} onClick={() => void checkBreaches()}>{checkingBreaches ? "Consultando…" : "Comprobar filtraciones"}</button></div>
            <div className="list-head">
              <div>
                <h2>Todos los accesos</h2>
                <span>{entries.length} elementos · {lastBackup ? `último respaldo ${new Date(lastBackup).toLocaleDateString("es-PE")}` : "sin respaldo exportado"}</span>
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
            <div className="filters">
              <select aria-label="Filtrar por categoría" value={categoryFilter} onChange={(event) => setCategoryFilter(event.currentTarget.value)}>
                <option value="todas">Todas las categorías</option>
                {CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
              </select>
              <button type="button" className={favoritesOnly ? "filter-active" : ""} onClick={() => setFavoritesOnly(!favoritesOnly)}>★ Favoritos</button>
              <select aria-label="Filtrar por estado de seguridad" value={reviewFilter} onChange={(event) => setReviewFilter(event.currentTarget.value)}>
                <option value="todas">Todos los estados</option><option value="debiles">Contraseñas débiles</option><option value="repetidas">Reutilizadas</option><option value="antiguas">Más de un año</option>
              </select>
              <select aria-label="Ordenar accesos" value={sortBy} onChange={(event) => setSortBy(event.currentTarget.value)}>
                <option value="updated">Más recientes</option><option value="title">Nombre A–Z</option><option value="category">Categoría</option><option value="strength">Menor fortaleza</option>
              </select>
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
                        <small>{CATEGORIES.find((category) => category.value === (item.category || "sitio"))?.label} · {item.url || "Sin URL"}</small>
                      </div>
                    </div>
                    <div className="username">{item.username || "—"}</div>
                    <div className="masked" title={item.password ? `Fortaleza: ${passwordStrength(item.password) >= 4 ? "fuerte" : passwordStrength(item.password) >= 3 ? "media" : "débil"}` : "Sin contraseña"}>
                      {item.password ? (revealed.includes(item.id) ? item.password : <>{"●".repeat(passwordStrength(item.password))}{"○".repeat(5 - passwordStrength(item.password))}</>) : "—"} <small>{item.password ? (passwordStrength(item.password) >= 4 ? "Fuerte" : passwordStrength(item.password) >= 3 ? "Media" : "Débil") : "Sin contraseña"}{duplicatePasswords.has(item.password) ? " · Repetida" : ""}</small>
                    </div>
                    <div className="date">
                      {new Date(item.updatedAt).toLocaleDateString("es-PE", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </div>
                    <div className="entry-actions">
                      <button type="button" title={item.favorite ? "Quitar de favoritos" : "Añadir a favoritos"} onClick={() => persist(entries.map((entry) => entry.id === item.id ? { ...entry, favorite: !entry.favorite } : entry))}>{item.favorite ? "★" : "☆"}</button>
                      <button
                        type="button"
                        title="Copiar usuario"
                        onClick={() => copy(item.username, false)}
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
                      <button type="button" title={revealed.includes(item.id) ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setRevealed(revealed.includes(item.id) ? revealed.filter((id) => id !== item.id) : [...revealed, item.id])}>{revealed.includes(item.id) ? "◉" : "◎"}</button>
                      <button type="button" title="Ver notas y campos" onClick={() => setExpanded(expanded.includes(item.id) ? expanded.filter((id) => id !== item.id) : [...expanded, item.id])}>ⓘ</button>
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
                    {expanded.includes(item.id) && <div className="entry-extra"><b>Notas</b><p>{item.notes || "Sin notas"}</p>{item.totpSecret && <p><b>Código de autenticación:</b> <code>{totpCodes[item.id] || "······"}</code> <button type="button" className="quiet" onClick={() => copy(totpCodes[item.id] || "")}>Copiar</button></p>}{item.customFields?.map((field) => <p key={`${item.id}-${field.label}`}><b>{field.label}:</b> {field.value}</p>)}{item.attachments?.map((attachment, index) => <p key={`${item.id}-file-${index}`}><b>Archivo:</b> <a href={attachment.data} download={attachment.name}>{attachment.name}</a></p>)}</div>}
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
          </div>
        )}
      </section>
      {recoveryToShow && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
            <div className="eyebrow">CLAVE DE RECUPERACIÓN</div>
            <h2 id="recovery-title">Guárdala ahora</h2>
            <p>Esta clave permite restablecer la contraseña maestra. Bóveda Pro no puede volver a mostrarla después de cerrar esta ventana. El archivo se guarda en texto claro: guárdalo en un lugar seguro y separado de los respaldos cifrados.</p>
            <code className="recovery-code">{recoveryToShow}</code>
            <div className="modal-actions recovery-actions">
              <button type="button" className="quiet" onClick={() => void copyRecoveryKey()}>Copiar clave</button>
              <button type="button" className="quiet" disabled={savingRecoveryKey} onClick={() => void saveRecoveryKeyFile()}>{savingRecoveryKey ? "Guardando…" : "Guardar archivo…"}</button>
            </div>
            {error && <div className="error">{error}</div>}
            <label className="checkbox-label recovery-confirm">
              <input type="checkbox" checked={recoveryAcknowledged} onChange={(event) => setRecoveryAcknowledged(event.currentTarget.checked)} />
              La guardé en un lugar seguro y podré encontrarla si la necesito.
            </label>
            <div className="modal-actions">
              <button type="button" className="primary" disabled={!recoveryAcknowledged} onClick={() => { setRecoveryToShow(null); setRecoveryAcknowledged(false); setNotice("Clave de recuperación guardada"); }}>Continuar</button>
            </div>
          </section>
        </div>
      )}
      {credentialDialog && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={submitCredentialChange}>
            <button type="button" className="close" aria-label="Cerrar" disabled={securityBusy} onClick={closeCredentialDialog}>×</button>
            <div className="eyebrow">SEGURIDAD DE LA BÓVEDA</div>
            <h2>{credentialDialog === "recover" ? "Restablecer contraseña" : "Cambiar contraseña maestra"}</h2>
            <p>{credentialDialog === "recover" ? "Introduce la clave de recuperación. Puedes usar la bóveda de este equipo, una copia automática local o un respaldo cifrado." : "Confirma tu contraseña actual para cifrar de nuevo la clave de la bóveda."}</p>
            {credentialDialog === "recover" ? (
              <>
                <label htmlFor="recovery-input">Clave de recuperación</label>
                <input id="recovery-input" type="password" autoComplete="off" value={recoveryInput} onChange={(event) => setRecoveryInput(event.currentTarget.value)} required />
                <label htmlFor="recovery-local-backup">Copia automática de este equipo <small>(opcional)</small></label>
                <select id="recovery-local-backup" value={recoveryBackupName} onChange={(event) => { setRecoveryBackupName(event.currentTarget.value); if (event.currentTarget.value) setRecoveryBackupFile(null); }}>
                  <option value="">Usar la bóveda actual</option>
                  {recoveryLocalBackups.map((backup) => <option key={backup.name} value={backup.name}>{new Date(backup.updated_at).toLocaleString("es-PE")}</option>)}
                </select>
                <label htmlFor="recovery-backup">O seleccionar un respaldo externo <small>(opcional)</small></label>
                <input id="recovery-backup" type="file" accept="application/json,.json" onChange={(event) => { setRecoveryBackupFile(event.currentTarget.files?.[0] ?? null); if (event.currentTarget.files?.[0]) setRecoveryBackupName(""); }} />
                <small className="recovery-limit">Si perdiste también la clave de recuperación, no existe una clave maestra de respaldo. Solo podrás abrir una copia si aún recuerdas la contraseña con la que se cifró.</small>
              </>
            ) : (
              <>
                <label htmlFor="current-master-input">Contraseña maestra actual</label>
                <input id="current-master-input" type="password" autoComplete="current-password" value={currentMasterInput} onChange={(event) => setCurrentMasterInput(event.currentTarget.value)} required />
              </>
            )}
            <label htmlFor="new-master-input">Nueva contraseña maestra</label>
            <input id="new-master-input" type="password" autoComplete="new-password" minLength={12} value={newMasterInput} onChange={(event) => setNewMasterInput(event.currentTarget.value)} required />
            <label htmlFor="confirm-new-master-input">Repite la nueva contraseña</label>
            <input id="confirm-new-master-input" type="password" autoComplete="new-password" minLength={12} value={confirmNewMasterInput} onChange={(event) => setConfirmNewMasterInput(event.currentTarget.value)} required />
            {error && <div className="error">{error}</div>}
            <div className="modal-actions">
              <button type="button" disabled={securityBusy} onClick={closeCredentialDialog}>Cancelar</button>
              <button type="submit" className="primary" disabled={securityBusy}>{securityBusy ? "Procesando…" : credentialDialog === "recover" ? "Restablecer contraseña" : "Guardar contraseña nueva"}</button>
            </div>
          </form>
        </div>
      )}
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
            <p>Se cifra antes de guardarse.</p>
            <div className="entry-form-grid">
              <div className="form-field"><label htmlFor="entry-title">Nombre del servicio</label><input id="entry-title" name="title" defaultValue={editing?.title} placeholder="Ej. Correo personal" required /></div>
              <div className="form-field"><label htmlFor="entry-username">Usuario o correo</label><input id="entry-username" name="username" defaultValue={editing?.username} placeholder="nombre@ejemplo.com" /></div>
              <div className="form-field"><label htmlFor="entry-url">URL</label><input id="entry-url" name="url" type="url" defaultValue={editing?.url} placeholder="https://ejemplo.com" /></div>
              <div className="form-field"><label htmlFor="entry-category">Categoría</label><select id="entry-category" name="category" defaultValue={editing?.category || "sitio"}>{CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></div>
            </div>
            <label className="checkbox-label"><input type="checkbox" name="favorite" defaultChecked={editing?.favorite} /> Guardar en favoritos</label>
            <label htmlFor="entry-password">Contraseña</label>
            <div className="password-input">
              <input
                id="entry-password"
                type="password"
                name="password"
                value={generated ?? editing?.password ?? ""}
                onChange={(event) => setGenerated(event.currentTarget.value)}
                required
              />
              <button
                type="button"
                onClick={(e) => {
                  setGenerated(generatePassword({ length: generatorLength, numbers: generatorNumbers, symbols: generatorSymbols, easy: generatorEasy }));
                }}
              >
                Generar
              </button>
            </div>
            <div className="generator-options">
              <label>Longitud <input type="number" min={8} max={64} value={generatorLength} onChange={(event) => setGeneratorLength(Math.max(8, Math.min(64, Number(event.currentTarget.value))))} /></label>
              <label><input type="checkbox" checked={generatorNumbers} onChange={(event) => setGeneratorNumbers(event.currentTarget.checked)} /> Números</label>
              <label><input type="checkbox" checked={generatorSymbols} onChange={(event) => setGeneratorSymbols(event.currentTarget.checked)} /> Símbolos</label>
              <label><input type="checkbox" checked={generatorEasy} onChange={(event) => setGeneratorEasy(event.currentTarget.checked)} /> Fácil de leer</label>
            </div>
            <details className="advanced-fields">
              <summary>Notas y campos adicionales</summary>
              <label htmlFor="entry-totp">Clave TOTP (opcional)</label>
              <input id="entry-totp" name="totpSecret" defaultValue={editing?.totpSecret} placeholder="JBSWY3DPEHPK3PXP" autoComplete="off" />
              <label htmlFor="entry-notes">Notas seguras</label>
              <textarea id="entry-notes" name="notes" defaultValue={editing?.notes} rows={2} />
              <label htmlFor="entry-custom-fields">Campos personalizados <small>(uno por línea: nombre: valor)</small></label>
              <textarea id="entry-custom-fields" name="customFields" defaultValue={editing?.customFields?.map((field) => `${field.label}: ${field.value}`).join("\n")} rows={2} placeholder={"Pregunta de recuperación: ...\nNúmero de cliente: ..."} />
              <label htmlFor="entry-attachments">Archivos cifrados con la bóveda <small>(máximo 5 archivos de hasta 2 MB cada uno)</small></label>
              <input id="entry-attachments" type="file" multiple onChange={(event) => { const files = Array.from(event.currentTarget.files || []); if (files.some((file) => file.size > 2 * 1024 * 1024)) { setError("Cada archivo debe pesar menos de 2 MB."); event.currentTarget.value = ""; return; } void readAttachments(event.currentTarget.files); event.currentTarget.value = ""; }} />
              {attachmentFiles.map((file, index) => <div className="backup-row" key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" className="quiet" onClick={() => setAttachmentFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>Quitar</button></div>)}
            </details>
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
