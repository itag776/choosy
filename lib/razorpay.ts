import type { RecoveryCampaign } from "@/lib/types";

interface RazorpayPaymentLinkResponse {
  id: string;
  short_url: string;
  reference_id: string;
  amount: number;
  status: "created" | "issued" | "paid" | "partially_paid" | "cancelled" | "expired";
}

function authHeader(): string {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Razorpay Test Mode keys are not configured.");
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

export async function createTestPaymentLink(caseId: string, amount: number): Promise<NonNullable<RecoveryCampaign["paymentLink"]>> {
  const referenceId = `recoveros_${caseId}_${Date.now()}`.slice(0, 40);

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return {
      id: `plink_preview_${Date.now()}`,
      shortUrl: "",
      referenceId,
      amount,
      mode: "demo_preview",
      status: "created",
    };
  }

  const response = await fetch("https://api.razorpay.com/v1/payment_links/", {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amount * 100,
      currency: "INR",
      reference_id: referenceId,
      description: "RecoverOS approved Test Mode recovery",
      expire_by: Math.floor(Date.now() / 1000) + 60 * 60,
      reminder_enable: false,
      notes: { recoveros_case_id: caseId, environment: "test_mode" },
      options: {
        checkout: {
          method: { card: false, upi: true, netbanking: true, wallet: false },
        },
      },
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Razorpay Payment Link creation failed (${response.status}): ${detail.slice(0, 240)}`);
  }

  const link = (await response.json()) as RazorpayPaymentLinkResponse;
  return {
    id: link.id,
    shortUrl: link.short_url,
    referenceId: link.reference_id,
    amount: link.amount / 100,
    mode: "razorpay_test",
    status: link.status === "paid" ? "paid" : "created",
  };
}

export async function fetchPaymentLink(id: string): Promise<RazorpayPaymentLinkResponse> {
  const response = await fetch(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(id)}`, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Razorpay sync failed with status ${response.status}.`);
  return (await response.json()) as RazorpayPaymentLinkResponse;
}
