import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Sidebar, TopBar, BottomNav } from "@/components/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-full flex-1 bg-[#f4f6f7]">
      <Sidebar user={user} />
      <div className="md:pl-64 flex flex-col min-h-full">
        <TopBar user={user} />
        <main className="flex-1 px-4 sm:px-6 py-5 pb-24 md:pb-8 max-w-5xl w-full mx-auto">{children}</main>
      </div>
      <BottomNav user={user} />
    </div>
  );
}
