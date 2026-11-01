import { NextRequest } from "next/server";
import { businessHttp } from "@/modules/analytics/business-http";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) { return businessHttp(request, "test", true); }
