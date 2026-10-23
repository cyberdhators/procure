"use server";

import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/components/action-form";

const str = (d: FormData, k: string) => String(d.get(k) ?? "").trim();

/** Records a license request from the pricing page and, when configured, emails the owner. */
export async function requestLicense(_: ActionState, d: FormData): Promise<ActionState> {
  if (str(d, "website")) return { ok: "Thank you. We will be in touch shortly." }; // honeypot
  const req = {
    organisation: str(d, "organisation"), contact_name: str(d, "contact_name"), email: str(d, "email"),
    country: str(d, "country"), message: str(d, "message"),
  };
  if (!req.organisation || !req.contact_name || !req.email) return { error: "Enter your organisation, name and email." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_license", {
    p_organisation: req.organisation, p_contact_name: req.contact_name, p_email: req.email,
    p_country: req.country, p_message: req.message,
  });
  if (error) return { error: error.message };
  await notifyOwner(req);
  return { ok: "Thank you. We will email your license key and invoice shortly." };
}

// Optional: set RESEND_API_KEY and LICENSE_REQUEST_EMAIL in Vercel to be emailed on each request.
async function notifyOwner(req: Record<string, string>) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.LICENSE_REQUEST_EMAIL;
  if (!key || !to) return;
  const text = Object.entries(req).map(([k, v]) => `${k.replace("_", " ")}: ${v}`).join("\n");
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "C-Procurement <no-reply@cprocurement.dev>", to: [to], reply_to: req.email,
        subject: `License request: ${req.organisation}`, text,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // The request is already stored; the email is a convenience.
  }
}
