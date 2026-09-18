import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-static";

/**
 * Policy pages — Privacy, Terms, Refunds, Shipping.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE SCAFFOLDS AND NOT FINISHED TEXT
 * ---------------------------------------------------------------------------
 * Razorpay will not activate a live account without these four pages, so they
 * block taking payment at all — which is why they exist now rather than later.
 *
 * But what they say is a legal undertaking that binds SooulOne, and inventing
 * plausible-sounding policy text would be worse than leaving them empty. A
 * generated refund window, a made-up data-retention period or an invented
 * grievance officer is a promise the business did not make and may not be able
 * to keep, and it would read as finished to everyone including the person
 * responsible for checking it.
 *
 * So each page ships the SECTIONS Indian e-commerce rules expect, with a
 * prompt describing what belongs in each, and says plainly at the top that it
 * is unfinished. The structure is the useful part; the words are the
 * business's and its counsel's.
 *
 * Replace `DRAFT_SECTIONS` content with real copy and delete the banner.
 */

interface Section {
  heading: string;
  prompt: string;
}

interface Policy {
  title: string;
  intro: string;
  sections: Section[];
}

const POLICIES: Record<string, Policy> = {
  privacy: {
    title: "Privacy Policy",
    intro:
      "How SooulOne collects, uses, stores and shares personal information, and the choices customers have about it.",
    sections: [
      {
        heading: "What we collect",
        prompt:
          "List each category actually collected: name, email, phone, delivery address, order history, payment identifiers returned by Razorpay (never card numbers — those never reach our servers), and any health-related answers if the gummies quiz is launched. Health-adjacent data carries heavier obligations, so name it explicitly if collected.",
      },
      {
        heading: "Why we collect it",
        prompt:
          "State the purpose for each category — fulfilling orders, delivery updates, customer support, statutory record-keeping. Marketing must be listed separately, because it runs on explicit consent rather than on the order.",
      },
      {
        heading: "Who we share it with",
        prompt:
          "Name the processors: the payment gateway, courier partners, email provider, hosting and analytics. State that data is not sold.",
      },
      {
        heading: "How long we keep it",
        prompt:
          "Give a real retention period per category. Tax and FSSAI record-keeping obligations set a floor for order records; marketing preferences should not outlive the relationship.",
      },
      {
        heading: "Your rights and how to use them",
        prompt:
          "Access, correction, deletion, and withdrawing marketing consent. Give the actual mechanism, not just an address — an unanswered inbox is not a rights process.",
      },
      {
        heading: "Grievance Officer",
        prompt:
          "Indian rules require a named grievance officer with contact details and a response timeline. Insert the real name, email and address.",
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    intro: "The terms on which SooulOne sells to customers in India.",
    sections: [
      { heading: "Who we are", prompt: "Registered entity name, registered address, GSTIN and FSSAI licence number." },
      { heading: "Orders and acceptance", prompt: "When a contract forms — on payment, on dispatch, or on confirmation — and the right to decline or cancel an order, with the reasons." },
      { heading: "Pricing and taxes", prompt: "That prices are in INR and inclusive of GST, and how pricing errors are handled." },
      { heading: "Product information", prompt: "That supplements support normal function and are not medicines, are not a substitute for a balanced diet or medical advice, and that customers should consult a professional where relevant." },
      { heading: "Limitation of liability", prompt: "Drafted by counsel. Consumer-protection law limits what can be excluded, so boilerplate copied from a foreign template is likely unenforceable here." },
      { heading: "Governing law", prompt: "Governing law and the courts with jurisdiction." },
    ],
  },
  refunds: {
    title: "Refunds and Cancellations",
    intro: "When an order can be cancelled, when it can be returned, and how refunds are processed.",
    sections: [
      { heading: "Cancelling before dispatch", prompt: "The window and the method." },
      {
        heading: "Returns on food and supplements",
        prompt:
          "The important one. Opened consumables generally cannot be resold or accepted back on safety grounds — state the position plainly, along with what always IS accepted: damaged, defective, wrongly sent, or short-dated on arrival.",
      },
      { heading: "How to raise a problem", prompt: "The actual channel, what evidence helps (photographs of the pack and batch code), and the deadline." },
      { heading: "How refunds are paid", prompt: "Back to the original payment method, the timeline in working days, and how cash-on-delivery refunds are handled since there is no card to credit." },
    ],
  },
  shipping: {
    title: "Shipping and Delivery",
    intro: "Where we deliver, how long it takes, and what it costs.",
    sections: [
      { heading: "Where we deliver", prompt: "Serviceable areas, and any pincodes or product types excluded — some short-shelf-life items are sold in stores only." },
      { heading: "Dispatch and delivery times", prompt: "Order cut-off, dispatch time, and realistic delivery windows by region. Give ranges you can actually meet." },
      { heading: "Charges", prompt: "The delivery charge and the free-delivery threshold, noting that the threshold is tested against the discounted order total." },
      {
        heading: "Freshness on arrival",
        prompt:
          "Worth saying explicitly, because it is a genuine differentiator: stock is picked so that a minimum proportion of shelf life remains on delivery, in line with FSSAI's e-commerce requirement.",
      },
      { heading: "Failed deliveries", prompt: "What happens if nobody is available, and how a refused cash-on-delivery order is treated." },
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(POLICIES).map((policy) => ({ policy }));
}

export default async function PolicyPage({ params }: { params: Promise<{ policy: string }> }) {
  const { policy: slug } = await params;
  const policy = POLICIES[slug];
  if (!policy) notFound();

  return (
    <>
      <PageHeader title={policy.title} intro={policy.intro} />

      <article className="mx-auto max-w-[68ch] px-5 py-12">
        <div className="mb-10 border-l-4 border-alert bg-shelf px-4 py-3">
          <p className="text-small font-semibold">This page is not finished.</p>
          <p className="mt-1 text-small text-ink-soft">
            The sections below are the structure this policy needs. The wording is a legal
            undertaking and has to be written by SooulOne with its own advisers — so it has been
            left blank rather than filled with plausible-sounding text that nobody actually agreed
            to. Razorpay requires all four policy pages before a live account is activated.
          </p>
        </div>

        <div className="grid gap-8">
          {policy.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-h3 font-bold">{section.heading}</h2>
              <p className="mt-2 text-ink-soft">{section.prompt}</p>
            </section>
          ))}
        </div>
      </article>
    </>
  );
}
