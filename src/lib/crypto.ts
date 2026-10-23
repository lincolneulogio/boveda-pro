export type VaultCategory = "sitio" | "tarjeta" | "nota" | "wifi" | "licencia";
export type VaultEntry = {
  id: string;
  title: string;
  username: string;
  url: string;
  password: string;
  notes: string;
  category?: VaultCategory;
  favorite?: boolean;
  customFields?: { label: string; value: string }[];
  passwordChangedAt?: string;
  totpSecret?: string;
  attachments?: { name: string; type: string; data: string }[];
  updatedAt: string;
};

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function decodeBase32(value: string): Uint8Array<ArrayBuffer> {
  const clean = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) bits += BASE32.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const result = new Uint8Array(new ArrayBuffer(bytes.length));
  result.set(bytes);
  return result;
}

export async function totpCode(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", decodeBase32(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = Math.floor(Date.now() / 30000);
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}
type EncryptedVaultV1 = {
  version: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  updatedAt: string;
};
type EncryptedVaultV2 = {
  version: 2;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  masterSalt: string;
  masterIv: string;
  wrappedKey: string;
  recoverySalt: string;
  recoveryIv: string;
  recoveryWrappedKey: string;
  dataIv: string;
  ciphertext: string;
  updatedAt: string;
};
export type EncryptedVault = EncryptedVaultV1 | EncryptedVaultV2;

const encoder = new TextEncoder();
type CryptoBytes = Uint8Array<ArrayBuffer>;
const toBase64 = (value: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const KDF_ITERATIONS = 600_000;
const MASTER_KEY_CONTEXT = encoder.encode("boveda:v2:master-key");
const RECOVERY_KEY_CONTEXT = encoder.encode("boveda:v2:recovery-key");
const VAULT_DATA_CONTEXT = encoder.encode("boveda:v2:vault-data");

function hex(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function generateRecoveryKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return hex(bytes).match(/.{1,8}/g)?.join("-") ?? hex(bytes);
}

function recoveryKeyBytes(recoveryKey: string): CryptoBytes {
  const normalized = recoveryKey.replace(/[-\s]/g, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(normalized)) throw new Error("La clave de recuperación debe tener 64 caracteres hexadecimales.");
  return encoder.encode(normalized);
}

async function deriveWrappingKey(secret: string | CryptoBytes, salt: CryptoBytes, iterations: number) {
  const material = await crypto.subtle.importKey("raw", typeof secret === "string" ? encoder.encode(secret) : secret, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function wrapDataKey(dataKey: CryptoBytes, secret: string | CryptoBytes, context: CryptoBytes, iterations = KDF_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(secret, salt, iterations);
  const wrappedKey = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: context }, wrappingKey, dataKey);
  return { salt: toBase64(salt), iv: toBase64(iv), wrappedKey: toBase64(new Uint8Array(wrappedKey)) };
}

async function unwrapRawDataKey(wrappedKey: string, salt: string, iv: string, secret: string | CryptoBytes, iterations: number, context: CryptoBytes) {
  const wrappingKey = await deriveWrappingKey(secret, fromBase64(salt), iterations);
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv), additionalData: context },
    wrappingKey,
    fromBase64(wrappedKey),
  );
}

async function unwrapDataKey(wrappedKey: string, salt: string, iv: string, secret: string | CryptoBytes, iterations: number, context: CryptoBytes) {
  const rawKey = await unwrapRawDataKey(wrappedKey, salt, iv, secret, iterations, context);
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptVaultV2(entries: VaultEntry[], masterPassword: string, recoveryKey: string, dataKey?: CryptoKey, masterWrap?: { salt: string; iv: string; wrappedKey: string }, recoveryWrap?: { salt: string; iv: string; wrappedKey: string }, iterations = KDF_ITERATIONS): Promise<EncryptedVaultV2> {
  const rawDataKey = dataKey ? null : crypto.getRandomValues(new Uint8Array(32));
  const key = dataKey ?? await crypto.subtle.importKey("raw", rawDataKey!, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  const [newMasterWrap, newRecoveryWrap] = await Promise.all([
    masterWrap ? Promise.resolve(masterWrap) : wrapDataKey(rawDataKey!, masterPassword, MASTER_KEY_CONTEXT),
    recoveryWrap ? Promise.resolve(recoveryWrap) : wrapDataKey(rawDataKey!, recoveryKeyBytes(recoveryKey), RECOVERY_KEY_CONTEXT),
  ]);
  const dataIv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: dataIv, additionalData: VAULT_DATA_CONTEXT },
    key,
    encoder.encode(JSON.stringify(entries)),
  );
  return {
    version: 2,
    kdf: "PBKDF2-SHA256",
    iterations,
    masterSalt: newMasterWrap.salt,
    masterIv: newMasterWrap.iv,
    wrappedKey: newMasterWrap.wrappedKey,
    recoverySalt: newRecoveryWrap.salt,
    recoveryIv: newRecoveryWrap.iv,
    recoveryWrappedKey: newRecoveryWrap.wrappedKey,
    dataIv: toBase64(dataIv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString(),
  };
}

async function decryptVaultV2(vault: EncryptedVaultV2, key: CryptoKey) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(vault.dataIv), additionalData: VAULT_DATA_CONTEXT },
    key,
    fromBase64(vault.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as VaultEntry[];
}

function masterWrapFrom(vault: EncryptedVaultV2) {
  return { salt: vault.masterSalt, iv: vault.masterIv, wrappedKey: vault.wrappedKey };
}

function recoveryWrapFrom(vault: EncryptedVaultV2) {
  return { salt: vault.recoverySalt, iv: vault.recoveryIv, wrappedKey: vault.recoveryWrappedKey };
}

export async function encryptVault(
  entries: VaultEntry[],
  masterPassword: string,
  existing?: EncryptedVault,
  recoveryKey?: string,
): Promise<EncryptedVault> {
  if (existing?.version === 2) {
    let dataKey: CryptoKey;
    let nextRecoveryWrap = recoveryWrapFrom(existing);
    if (recoveryKey) {
      const rawDataKey = new Uint8Array(await unwrapRawDataKey(existing.wrappedKey, existing.masterSalt, existing.masterIv, masterPassword, existing.iterations, MASTER_KEY_CONTEXT));
      dataKey = await crypto.subtle.importKey("raw", rawDataKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
      nextRecoveryWrap = await wrapDataKey(rawDataKey, recoveryKeyBytes(recoveryKey), RECOVERY_KEY_CONTEXT, existing.iterations);
    } else {
      dataKey = await unwrapDataKey(existing.wrappedKey, existing.masterSalt, existing.masterIv, masterPassword, existing.iterations, MASTER_KEY_CONTEXT);
    }
    return encryptVaultV2(entries, masterPassword, "", dataKey, masterWrapFrom(existing), nextRecoveryWrap, existing.iterations);
  }
  if (recoveryKey) return encryptVaultV2(entries, masterPassword, recoveryKey);

  const iterations = KDF_ITERATIONS;
  const salt = existing
    ? fromBase64(existing.salt)
    : crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(masterPassword),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(entries)),
  );
  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString(),
  };
}

export async function decryptVault(
  vault: EncryptedVault,
  masterPassword: string,
): Promise<VaultEntry[]> {
  if (vault.kdf !== "PBKDF2-SHA256")
    throw new Error("Formato de bóveda no compatible.");
  if (vault.version === 2) {
    const key = await unwrapDataKey(vault.wrappedKey, vault.masterSalt, vault.masterIv, masterPassword, vault.iterations, MASTER_KEY_CONTEXT);
    return decryptVaultV2(vault, key);
  }
  if (vault.version !== 1) throw new Error("Formato de bóveda no compatible.");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(masterPassword),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: fromBase64(vault.salt),
      iterations: vault.iterations,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(vault.iv) },
    key,
    fromBase64(vault.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as VaultEntry[];
}

export async function recoverVault(vault: EncryptedVault, recoveryKey: string) {
  if (vault.version !== 2) throw new Error("Esta bóveda no tiene una clave de recuperación configurada.");
  const key = await unwrapDataKey(vault.recoveryWrappedKey, vault.recoverySalt, vault.recoveryIv, recoveryKeyBytes(recoveryKey), vault.iterations, RECOVERY_KEY_CONTEXT);
  return decryptVaultV2(vault, key);
}

export async function changeMasterPassword(vault: EncryptedVault, currentMaster: string, newMaster: string, entries: VaultEntry[]) {
  if (vault.version === 2) {
    const rawDataKey = new Uint8Array(await unwrapRawDataKey(vault.wrappedKey, vault.masterSalt, vault.masterIv, currentMaster, vault.iterations, MASTER_KEY_CONTEXT));
    const dataKey = await crypto.subtle.importKey("raw", rawDataKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    const nextMasterWrap = await wrapDataKey(rawDataKey, newMaster, MASTER_KEY_CONTEXT, vault.iterations);
    return { vault: await encryptVaultV2(entries, newMaster, "", dataKey, nextMasterWrap, recoveryWrapFrom(vault), vault.iterations), recoveryKey: null };
  }
  const recoveryKey = generateRecoveryKey();
  return { vault: await encryptVaultV2(entries, newMaster, recoveryKey), recoveryKey };
}

export async function resetMasterWithRecovery(vault: EncryptedVault, recoveryKey: string, newMaster: string, entries: VaultEntry[]) {
  if (vault.version !== 2) throw new Error("Esta bóveda no tiene una clave de recuperación configurada.");
  const rawDataKey = new Uint8Array(await unwrapRawDataKey(vault.recoveryWrappedKey, vault.recoverySalt, vault.recoveryIv, recoveryKeyBytes(recoveryKey), vault.iterations, RECOVERY_KEY_CONTEXT));
  const dataKey = await crypto.subtle.importKey("raw", rawDataKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  const nextMasterWrap = await wrapDataKey(rawDataKey, newMaster, MASTER_KEY_CONTEXT, vault.iterations);
  return encryptVaultV2(entries, newMaster, "", dataKey, nextMasterWrap, recoveryWrapFrom(vault), vault.iterations);
}

export function generatePassword(options: { length?: number; numbers?: boolean; symbols?: boolean; easy?: boolean } = {}): string {
  const { length = 24, numbers = true, symbols = true, easy = true } = options;
  let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  if (numbers) alphabet += easy ? "23456789" : "0123456789";
  if (symbols) alphabet += "!@#$%^&*_-+?";
  if (easy) alphabet = alphabet.replace(/[O0Il1]/g, "");
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  let result = "";
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(Math.max(16, length - result.length)));
    for (const byte of bytes) {
      if (byte < max) result += alphabet[byte % alphabet.length];
      if (result.length === length) break;
    }
  }
  return result;
}
