import { authed, json, parseBody } from "@/server/http";
import { commitImport, commitImportSchema } from "@/server/services/contacts";

export const POST = authed(async (req, ctx) => json(await commitImport(ctx, await parseBody(req, commitImportSchema))));
