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
export type EncryptedVault = {
  version: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  updatedAt: string;
};

const encoder = new TextEncoder();
const toBase64 = (value: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

export async function encryptVault(
  entries: VaultEntry[],
  masterPassword: string,
  existing?: EncryptedVault,
): Promise<EncryptedVault> {
  const iterations = 600_000;
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
  if (vault.version !== 1 || vault.kdf !== "PBKDF2-SHA256")
    throw new Error("Formato de bóveda no compatible.");
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
