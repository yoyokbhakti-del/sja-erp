import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { PermProvider, type Perm } from "@/components/perms";
import { Sidebar } from "@/components/sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: perms } = await sb.rpc("my_permissions");

  return (
    <PermProvider perms={(perms as Perm[]) ?? []} email={user.email ?? ""}>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1 px-6">{children}</main>
      </div>
    </PermProvider>
  );
}
