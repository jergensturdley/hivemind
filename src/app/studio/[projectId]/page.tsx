import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { WorkspaceClient } from "@/components/WorkspaceClient";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const { projectId } = await params;
  const { run } = await searchParams;
  const pid = Number(projectId);
  if (!Number.isFinite(pid)) redirect("/studio");
  return (
    <WorkspaceClient
      projectId={pid}
      user={{ id: user.id, name: user.name, hue: user.hue }}
      autoRun={run === "1"}
    />
  );
}
