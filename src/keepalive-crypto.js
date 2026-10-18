const crypto = require("crypto");

function getKey() {
  const secret = process.env.KEEPALIVE_ENCRYPTION_KEY || process.env.ADMIN_PASSWORD;
  if (!secret || !String(secret).trim()) {
    throw new Error("请设置 ADMIN_PASSWORD 或 KEEPALIVE_ENCRYPTION_KEY，用于加密保活凭据和浏览器登录态");
  }
  return crypto.scryptSync(String(secret), "remain-keepalive-encryption-v1", 32);
}

function encryptText(value) {
  if (value === undefined || value === null || value === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final()
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

function decryptText(value) {
  if (!value) return "";
  if (typeof value !== "string" || !value.startsWith("v1:")) {
    throw new Error("加密数据格式不受支持");
  }
  const parts = value.split(":");
  if (parts.length !== 4) throw new Error("加密数据格式无效");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const encrypted = Buffer.from(parts[3], "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]).toString("utf8");
}

module.exports = { encryptText, decryptText };
