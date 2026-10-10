"use client";
import * as React from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Sheet } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/menu";
import { useLocalStorage } from "@/lib/client/hooks";
import { cn } from "@/lib/util/cn";
import { useMediaQuery } from "./use-media";

/**
 * ScreenConnect-style console shell: a session-group tree on the left, the machine/session list in the middle and a
 * detail pane on the right. Below the `lg` breakpoint the tree and the detail become Sheets and the list takes the
 * full width. The tree can also be collapsed on desktop (persisted) to give the list more room on small laptops.
 */
interface PaneContext {
  isDesktop: boolean;
  treeCollapsed: boolean;
  toggleTree: () => void;
  openTree: () => void;
}
const Ctx = React.createContext<PaneContext>({ isDesktop: true, treeCollapsed: false, toggleTree: () => {}, openTree: () => {} });
export const useThreePane = () => React.useContext(Ctx);

export function ThreePane({ storageKey, header, tree, treeTitle, list, detail, detailTitle, detailOpen, onDetailClose, className }: { storageKey: string; header?: React.ReactNode; tree: React.ReactNode; treeTitle: string; list: React.ReactNode; detail: React.ReactNode; detailTitle?: React.ReactNode; detailOpen: boolean; onDetailClose: () => void; className?: string }) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [treeCollapsed, setTreeCollapsed] = useLocalStorage<boolean>(`${storageKey}.tree-collapsed`, false);
  const [treeSheet, setTreeSheet] = React.useState(false);
  const ctx = React.useMemo<PaneContext>(() => ({ isDesktop, treeCollapsed, toggleTree: () => setTreeCollapsed((c) => !c), openTree: () => setTreeSheet(true) }), [isDesktop, treeCollapsed, setTreeCollapsed]);
  const showTree = isDesktop && !treeCollapsed;
  return (
    <Ctx.Provider value={ctx}>
      <div className={cn("flex min-h-[560px] flex-col", "h-[calc(100dvh-var(--topbar-height)-3rem)] md:h-[calc(100dvh-var(--topbar-height)-4rem)]", className)}>
        {header}
        <div
          className={cn(
            "grid min-h-0 flex-1 gap-3",
            isDesktop
              ? showTree
                ? "grid-cols-[232px_minmax(0,1fr)_340px] xl:grid-cols-[252px_minmax(0,1fr)_384px] 2xl:grid-cols-[272px_minmax(0,1fr)_424px]"
                : "grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_384px] 2xl:grid-cols-[minmax(0,1fr)_424px]"
              : "grid-cols-1",
          )}
        >
          {showTree && (
            <Pane aria-label={treeTitle}>
              {tree}
            </Pane>
          )}
          <Pane aria-label="List" className="@container/list">{list}</Pane>
          {isDesktop && <Pane aria-label={typeof detailTitle === "string" ? detailTitle : "Detail"} className="@container/detail">{detail}</Pane>}
        </div>
      </div>
      {!isDesktop && (
        <>
          <Sheet open={treeSheet} onOpenChange={setTreeSheet} side="left" title={treeTitle} width="max-w-sm" className="[&>div:nth-child(2)]:px-2 [&>div:nth-child(2)]:py-2">
            <div className="@container/tree" onClickCapture={(e) => { const t = e.target as HTMLElement; if (t.closest("[data-tree-select]")) setTreeSheet(false); }}>{tree}</div>
          </Sheet>
          <Sheet open={detailOpen} onOpenChange={(o) => !o && onDetailClose()} side="right" title={detailTitle ?? "Detail"} width="max-w-xl" className="[&>div:nth-child(2)]:p-0 @container/detail">
            {detail}
          </Sheet>
        </>
      )}
    </Ctx.Provider>
  );
}

function Pane({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("card flex min-h-0 min-w-0 flex-col overflow-hidden", className)} {...props}>
      {children}
    </section>
  );
}

/** Button for the list header: collapses/expands the tree on desktop, opens it as a sheet on small screens. */
export function TreeToggle({ label = "Groups" }: { label?: string }) {
  const { isDesktop, treeCollapsed, toggleTree, openTree } = useThreePane();
  if (!isDesktop) return <Button size="icon-sm" variant="ghost" aria-label={`Open ${label.toLowerCase()}`} onClick={openTree}><PanelLeftOpen className="h-4 w-4" /></Button>;
  return (
    <Tooltip content={treeCollapsed ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`}>
      <Button size="icon-sm" variant="ghost" aria-label={treeCollapsed ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`} onClick={toggleTree}>{treeCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}</Button>
    </Tooltip>
  );
}

/** Sticky pane header used by all three panes. */
export function PaneHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex shrink-0 items-center gap-2 border-b border-border bg-surface-2/60 px-3 py-2", className)}>{children}</div>;
}
