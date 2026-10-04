import { redirect } from "next/navigation";
import { optionalPageCtx } from "@/server/session";

export default async function Home() {
  redirect((await optionalPageCtx()) ? "/dashboard" : "/login");
}
