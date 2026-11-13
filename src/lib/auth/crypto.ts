import "server-only";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
export const randomToken = () => crypto.randomBytes(32).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const randomOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

/** A bcrypt hash of a random value, used to keep timing equal for unknown emails. */
export const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 11);
