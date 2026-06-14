import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";

// Progress defaults inferred from a shipment's status.
const progressForStatus = (status: string): number => {
  if (status === "Delivered") return 100;
  if (status === "In Transit") return 65;
  return 15;
};

const ALLOWED_STATUSES = ["Processing", "In Transit", "Delivered"];

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  // List all shipments, newest first.
  if (req.method === "GET") {
    const rows = await db.sql`SELECT * FROM shipments ORDER BY created_at DESC`;
    return Response.json(rows);
  }

  // Create a new shipment.
  if (req.method === "POST") {
    let body: Record<string, string> = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const id = (body.id ?? "").trim();
    const origin = (body.origin ?? "").trim();
    const destination = (body.destination ?? "").trim();
    const weight = (body.weight ?? "").trim();
    const status = ALLOWED_STATUSES.includes(body.status) ? body.status : "Processing";

    if (!id || !origin || !destination) {
      return Response.json(
        { error: "id, origin and destination are required" },
        { status: 400 }
      );
    }

    try {
      const [row] = await db.sql`
        INSERT INTO shipments (id, status, origin, destination, weight, progress)
        VALUES (${id}, ${status}, ${origin}, ${destination}, ${weight}, ${progressForStatus(status)})
        RETURNING *`;
      return Response.json(row, { status: 201 });
    } catch {
      // Most likely a duplicate primary key.
      return Response.json(
        { error: `A shipment with ID "${id}" already exists` },
        { status: 409 }
      );
    }
  }

  // Delete a shipment by id (from the path or a query string).
  if (req.method === "DELETE") {
    const id = url.searchParams.get("id") || decodeURIComponent(url.pathname.split("/").pop() || "");
    if (!id || id === "shipments") {
      return Response.json({ error: "Missing shipment id" }, { status: 400 });
    }
    await db.sql`DELETE FROM shipments WHERE id = ${id}`;
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: ["/api/shipments", "/api/shipments/:id"],
};
