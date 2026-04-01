import { NextResponse } from 'next/server';
import { listClients } from '@/lib/shipsourced';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await listClients();
    return NextResponse.json({ clients: data.clients || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, clients: [] }, { status: 500 });
  }
}
