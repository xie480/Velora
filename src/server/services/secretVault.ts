import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const databasePath = resolve(
  process.cwd(),
  process.env.DATABASE_FILE ?? ".data/project-chronicle.sqlite",
);
const keyPath = resolve(dirname(databasePath), "provider-secrets.key");
let cachedKey: Buffer | undefined;

function loadKey(createIfMissing = true): Buffer {
  if (cachedKey) return cachedKey;
  mkdirSync(dirname(keyPath), { recursive: true });

  try {
    cachedKey = readFileSync(keyPath);
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) {
      throw new Error("Local provider secret key cannot be read.");
    }
    if (!createIfMissing) throw new Error("Local provider secret key is missing.");

    const generatedKey = randomBytes(32);
    try {
      writeFileSync(keyPath, generatedKey, { flag: "wx", mode: 0o600 });
      if (process.platform !== "win32") chmodSync(keyPath, 0o600);
      cachedKey = generatedKey;
    } catch (writeError) {
      if (!(typeof writeError === "object" && writeError !== null && "code" in writeError && writeError.code === "EEXIST")) {
        throw new Error("Local provider secret key cannot be created.");
      }
      cachedKey = readFileSync(keyPath);
    }
  }

  if (cachedKey.length !== 32) {
    cachedKey = undefined;
    throw new Error("Local provider secret key has an invalid length.");
  }
  return cachedKey;
}

export function encryptSecret(value: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptSecret(value: string): string {
  const [version, noncePart, tagPart, ciphertextPart, ...rest] = value.split(":");
  if (version !== "v1" || !noncePart || !tagPart || !ciphertextPart || rest.length > 0) {
    throw new Error("Stored provider secret has an unsupported format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    loadKey(false),
    Buffer.from(noncePart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
