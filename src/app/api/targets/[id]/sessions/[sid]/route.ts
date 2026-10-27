import { NextResponse } from "next/server";
import { readSession } from "@/lib/store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  const { id, sid } = await params;
  const session = readSession(id, sid);
  if (!session) return NextResponse.json({ error: "练习场次不存在" }, { status: 404 });
  return NextResponse.json({ session });
}
