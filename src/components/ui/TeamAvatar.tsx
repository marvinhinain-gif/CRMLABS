"use client";

import { useMemberAvatar } from "@/lib/me";
import { Avatar } from "./index";

/** Avatar de um membro da equipe, com a foto de perfil quando houver. */
export function TeamAvatar({ userId, name, size, className }: { userId: string | null | undefined; name: string | null | undefined; size?: number; className?: string }) {
  const src = useMemberAvatar(userId);
  return <Avatar name={name} src={src} size={size} tone="neutral" className={className} />;
}
