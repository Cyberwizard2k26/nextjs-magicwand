export const dynamic = "force-dynamic";

import { Wand2 } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md animate-in">
        <div className="mb-8 flex items-center justify-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-info text-white shadow-glow">
            <Wand2 className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <div className="text-lg font-semibold tracking-tight">MagicWand</div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-fg-subtle">Remote Management</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
