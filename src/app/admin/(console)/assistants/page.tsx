import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { NoAccess } from "@/components/ui";
import { maskToken } from "@/lib/copilot-url";
import { ActionForm } from "../boxes/action-form";
import { saveAssistantSettings, saveCopilotSettings } from "./actions";
import { CopilotStatus } from "./copilot-status";

export const dynamic = "force-dynamic";

/** Settings → Assistants: the storefront assistant and the owner's local AI copilot. */
export default async function AssistantsPage() {
  const session = await requirePermission("settings:manage");
  if (!session) return <NoAccess />;
  const row = await db.storeSettings.findUnique({
    where: { id: "default" },
    select: { assistantEnabled: true, returnWindowDays: true, returnConditions: true, supportWhatsapp: true, copilotUrl: true, copilotToken: true },
  });

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Assistants</h1>
        <p className="mt-2 max-w-[66ch] text-ink-soft">
          The shopping assistant on the storefront, and your own AI copilot in this console. Every change is recorded in Activity.
        </p>
      </div>

      <section className="panel">
        <div className="panel-head">Storefront assistant</div>
        <ActionForm action={saveAssistantSettings} submitLabel="Save assistant" className="grid gap-4 p-4">
          <label className="flex items-start gap-3 text-small">
            <input type="checkbox" name="assistantEnabled" className="mt-1" defaultChecked={row?.assistantEnabled ?? true} />
            <span>
              <span className="font-semibold">Show the assistant on the storefront</span>
              <span className="block text-ink-soft">
                A &ldquo;Help&rdquo; button that tracks orders, checks delivery to a pincode, answers delivery and payment questions,
                and hands over to you on WhatsApp or email. It runs on rules (no AI service, no cost) and only states what the store
                itself knows.
              </span>
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="returnWindowDays">
                Returns can be asked for within (days of delivery)
              </label>
              <input id="returnWindowDays" name="returnWindowDays" type="number" min={0} max={60} className="field" defaultValue={row?.returnWindowDays ?? ""} placeholder="Not set" />
              <p className="mt-1 text-micro text-ink-faint">
                Leave blank until your refund policy is final: the assistant then never states a window and passes return requests to you.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="supportWhatsapp">
                WhatsApp number for support
              </label>
              <input id="supportWhatsapp" name="supportWhatsapp" inputMode="tel" className="field" defaultValue={row?.supportWhatsapp ?? ""} placeholder="98765 43210" />
              <p className="mt-1 text-micro text-ink-faint">Blank: the assistant offers your customer care email instead.</p>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="returnConditions">
              What can be returned, in your words
            </label>
            <textarea id="returnConditions" name="returnConditions" rows={3} maxLength={600} className="field" defaultValue={row?.returnConditions ?? ""} placeholder="Sealed, unused packs only. Damaged or wrong items: send a photo within 48 hours of delivery." />
            <p className="mt-1 text-micro text-ink-faint">Shown word for word by the assistant. It adds nothing of its own.</p>
          </div>
        </ActionForm>
      </section>

      <section className="panel">
        <div className="panel-head flex flex-wrap items-center justify-between gap-3">
          <span>Admin copilot (your local AI model)</span>
          <CopilotStatus refreshKey={row?.copilotUrl ?? ""} />
        </div>
        <div className="grid gap-4 p-4">
          <p className="max-w-[70ch] text-small text-ink-soft">
            Run an AI model on your own computer (free, with Ollama or LM Studio), start{" "}
            <code className="text-micro">scripts/admin_llm_copilot.py</code>, and share it with <code className="text-micro">ngrok http 8000</code>.
            Paste the ngrok address and the token the script prints. When it&apos;s offline, insights and Copilot answers come from the
            built-in rules instead. Only store totals are sent to it: rates, counts and pincodes, never customers&apos; names, numbers or
            addresses. Step by step: docs/COPILOT.md.
          </p>
          <ActionForm action={saveCopilotSettings} submitLabel="Save and connect" className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="copilotUrl">
                Local Admin LLM Endpoint / Ngrok URL
              </label>
              <input id="copilotUrl" name="copilotUrl" type="url" className="field" defaultValue={row?.copilotUrl ?? ""} placeholder="https://abcd-1234.ngrok-free.app" autoComplete="off" spellCheck={false} />
            </div>
            <div>
              <label className="label" htmlFor="copilotToken">
                Token
              </label>
              <input
                id="copilotToken"
                name="copilotToken"
                type="password"
                className="field"
                autoComplete="off"
                placeholder={row?.copilotToken ? `Saved (${maskToken(row.copilotToken)}). Leave blank to keep` : "COPILOT_TOKEN from the script"}
              />
            </div>
            {row?.copilotUrl && (
              <label className="flex items-center gap-2 text-small sm:col-span-2">
                <input type="checkbox" name="disconnect" /> Disconnect and forget this address and token
              </label>
            )}
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
