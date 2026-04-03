import { NextRequest } from "next/server";
import { apiResponse, apiNotFound, apiServerError, apiValidationError } from "@/lib/api-response";
import { getTable, updateTable } from "@/modules/ps-park/service";
import { updateTableSchema } from "@/modules/ps-park/validation";

/**
 * GET /api/ps-park/:id — get single table
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const resource = await getTable(id);
    if (!resource) return apiNotFound("Стол не найден");
    return apiResponse(resource);
  } catch {
    return apiServerError();
  }
}

/**
 * PATCH /api/ps-park/:id — update table (admin)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateTableSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const existing = await getTable(id);
    if (!existing) return apiNotFound("Стол не найден");

    const updated = await updateTable(id, parsed.data);
    return apiResponse(updated);
  } catch {
    return apiServerError();
  }
}
