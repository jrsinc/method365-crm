import "server-only";
import { getSecuritySettings } from "../settings";

export function passwordProblem(pw: string) {
  const min = getSecuritySettings().password_min_length;
  if (pw.length < min) return `Use at least ${min} characters.`;
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return "Use upper- and lower-case letters and a number.";
  return null;
}
