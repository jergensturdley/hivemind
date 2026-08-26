import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { StudioClient } from "@/components/StudioClient";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  return <StudioClient user={{ id: user.id, name: user.name, email: user.email, hue: user.hue }} />;
}
