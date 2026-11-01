import { NextRequest } from "next/server";
import { businessHttp } from "@/modules/analytics/business-http";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) { return businessHttp(request, "export", false); }
