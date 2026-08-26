import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { SignIn } from "@/components/SignIn";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect("/studio");
  return <SignIn />;
}
