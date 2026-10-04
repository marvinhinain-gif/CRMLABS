import type { Ctx } from "../context";
import { listUserOrgs } from "../auth/service";
import { navCounts } from "./settings";
import { can } from "../permissions";
import { avatarUrl, myAvatarUpdatedAt } from "./avatars";

export async function buildMe(ctx: Ctx) {
  const [orgs, counts, avatarAt] = await Promise.all([listUserOrgs(ctx.userId), navCounts(ctx), myAvatarUpdatedAt(ctx.userId)]);
  return {
    user: { id: ctx.userId, name: ctx.userName, email: ctx.userEmail, role: ctx.role, avatarUrl: avatarUrl(ctx.userId, avatarAt) },
    org: { id: ctx.orgId, ...ctx.org },
    orgs,
    counts,
    permissions: {
      dataAll: can(ctx, "data.all"),
      teamManage: can(ctx, "team.manage"),
      integrations: can(ctx, "integrations.manage"),
      orgSettings: can(ctx, "org.settings"),
      pipelineEdit: can(ctx, "pipeline.edit"),
      assign: can(ctx, "contacts.assign"),
      import: can(ctx, "contacts.import"),
      merge: can(ctx, "contacts.merge"),
      savedReplies: can(ctx, "savedReplies.manage"),
      decide: can(ctx, "opportunity.decide"),
    },
  };
}
