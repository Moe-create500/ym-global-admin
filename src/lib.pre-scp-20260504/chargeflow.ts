const CF_BASE = 'https://api.chargeflow.io/public/2025-04-01';

export interface CFDispute {
  id: string;
  source: string;
  source_id: string;
  created_at: string;
  reason: string;
  due_by: string | null;
  amount: number;
  currency: string;
  status: string;  // under_review, won, lost, needs_response
  stage: string;   // Chargeback, Inquiry
  closed_at: string | null;
  order: string | null;
  transaction: string | null;
}

export interface CFDisputesResponse {
  disputes: CFDispute[];
  pagination: {
    totalCount: number;
    offset: number;
    limit: number;
    totalPages: number;
  };
}

export async function getDisputes(apiKey: string, page = 1, limit = 100): Promise<CFDisputesResponse> {
  const res = await fetch(`${CF_BASE}/disputes?offset=${page}&limit=${limit}`, {
    headers: { 'x-api-key': apiKey },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Chargeflow API error ${res.status}: ${await res.text().catch(() => 'Unknown')}`);
  }
  return res.json();
}

export async function getAllDisputes(apiKey: string): Promise<CFDispute[]> {
  const all: CFDispute[] = [];
  let page = 1;
  while (true) {
    const data = await getDisputes(apiKey, page, 100);
    all.push(...(data.disputes || []));
    if (all.length >= data.pagination.totalCount || data.disputes.length === 0) break;
    page++;
  }
  return all;
}
