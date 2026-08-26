import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { SettingsClient } from "@/components/SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  return <SettingsClient user={{ id: user.id, name: user.name, email: user.email, hue: user.hue }} />;
}
