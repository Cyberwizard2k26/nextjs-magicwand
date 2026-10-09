"use client";
import * as React from "react";
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState, type RowSelectionState, type OnChangeFn } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/util/cn";
import { Checkbox } from "./input";
import { Skeleton } from "./misc";

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: React.ReactNode;
  onRowClick?: (row: T) => void;
  rowHref?: (row: T) => string | undefined;
  selectable?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  getRowId?: (row: T) => string;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  manualSorting?: boolean;
  dense?: boolean;
  className?: string;
  stickyHeader?: boolean;
  rowClassName?: (row: T) => string | undefined;
  pagination?: { page: number; pages: number; total: number; pageSize: number; onPageChange: (p: number) => void; onPageSizeChange?: (n: number) => void };
}

export function DataTable<T>({ columns, data, loading, emptyMessage = "Nothing here yet.", onRowClick, selectable, rowSelection, onRowSelectionChange, getRowId, sorting, onSortingChange, manualSorting, dense, className, stickyHeader = true, rowClassName, pagination }: DataTableProps<T>) {
  const [internalSorting, setInternalSorting] = React.useState<SortingState>([]);
  const cols = React.useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!selectable) return columns;
    const sel: ColumnDef<T, unknown> = {
      id: "__select",
      size: 36,
      header: ({ table }) => <Checkbox checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} aria-label="Select all" />,
      cell: ({ row }) => <Checkbox checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} onClick={(e) => e.stopPropagation()} aria-label="Select row" />,
      enableSorting: false,
    };
    return [sel, ...columns];
  }, [columns, selectable]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: cols,
    state: { sorting: sorting ?? internalSorting, rowSelection: rowSelection ?? {} },
    onSortingChange: onSortingChange ?? setInternalSorting,
    onRowSelectionChange,
    enableRowSelection: !!selectable,
    getRowId,
    manualSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
  });

  return (
    <div className={cn("card overflow-hidden", className)}>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className={cn("bg-surface-2/80 text-left text-xs text-fg-muted", stickyHeader && "sticky top-0 z-10 backdrop-blur")}>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} style={{ width: h.getSize() !== 150 ? h.getSize() : undefined }} className={cn("border-b border-border px-3 font-medium whitespace-nowrap", dense ? "h-8" : "h-10", h.column.getCanSort() && "cursor-pointer select-none hover:text-fg")} onClick={h.column.getToggleSortingHandler()}>
                    <span className="inline-flex items-center gap-1">
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === "asc" && <ArrowUp className="h-3 w-3" />}
                      {h.column.getIsSorted() === "desc" && <ArrowDown className="h-3 w-3" />}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading && data.length === 0
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/60">
                    {cols.map((_, j) => (
                      <td key={j} className={cn("px-3", dense ? "h-9" : "h-12")}>
                        <Skeleton className="h-3.5 w-[70%]" />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={cn("border-b border-border/60 transition-colors last:border-0", onRowClick && "cursor-pointer hover:bg-surface-hover/70", row.getIsSelected() && "bg-accent-soft/40", rowClassName?.(row.original))}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={cn("px-3 align-middle", dense ? "h-9" : "h-12")}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
            {!loading && data.length === 0 && (
              <tr>
                <td colSpan={cols.length} className="py-12 text-center text-sm text-fg-muted">{emptyMessage}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pagination && (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-2/50 px-3 py-2 text-xs text-fg-muted">
          <div>
            {pagination.total === 0 ? "0 results" : `${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(pagination.total, pagination.page * pagination.pageSize)} of ${pagination.total.toLocaleString()}`}
          </div>
          <div className="flex items-center gap-1">
            {pagination.onPageSizeChange && (
              <select className="mr-2 h-7 rounded-md border border-border bg-surface-2 px-1.5 text-xs" value={pagination.pageSize} onChange={(e) => pagination.onPageSizeChange?.(Number(e.target.value))}>
                {[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n} / page</option>)}
              </select>
            )}
            <PageBtn disabled={pagination.page <= 1} onClick={() => pagination.onPageChange(1)}><ChevronsLeft className="h-3.5 w-3.5" /></PageBtn>
            <PageBtn disabled={pagination.page <= 1} onClick={() => pagination.onPageChange(pagination.page - 1)}><ChevronLeft className="h-3.5 w-3.5" /></PageBtn>
            <span className="px-2 tabular">{pagination.page} / {Math.max(1, pagination.pages)}</span>
            <PageBtn disabled={pagination.page >= pagination.pages} onClick={() => pagination.onPageChange(pagination.page + 1)}><ChevronRight className="h-3.5 w-3.5" /></PageBtn>
            <PageBtn disabled={pagination.page >= pagination.pages} onClick={() => pagination.onPageChange(pagination.pages)}><ChevronsRight className="h-3.5 w-3.5" /></PageBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function PageBtn({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-hover disabled:opacity-40 focus-ring" {...props}>{children}</button>;
}
