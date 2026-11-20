"use server";

import { requireUser } from "../auth/dal";
import { issueAddinToken } from "../addin";
import { audit, clientIp } from "../audit";

/** Called from the add-in's sign-in pop-up (with the normal sign-in cookie): a token for the Outlook panel. */
export async function connectAddin(): Promise<{ token?: string; error?: string }> {
  const user = await requireUser();
  if (user.must_change_password) return { error: "Change your password in the CRM first, then connect again." };
  const token = issueAddinToken(user.id, await clientIp());
  await audit(user, "addin.connect");
  return { token };
}
