import { Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-8 space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card space-y-3 p-5">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="card space-y-4 p-5 lg:col-span-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="card space-y-3 p-5">
          <Skeleton className="h-4 w-28" />
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      </div>
    </div>
  );
}
