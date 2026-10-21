import { authed, json, parseBody } from "@/server/http";
import { importCaktoOrders, importSchema } from "@/server/services/checkout";

export const POST = authed(async (req, ctx) => json(await importCaktoOrders(ctx, await parseBody(req, importSchema))));
