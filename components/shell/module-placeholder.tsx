import { Construction } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui/misc";

/** Temporary page body used while a module's UI is being built out. */
export function ModulePlaceholder({ title, description }: { title: string; description?: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState icon={<Construction />} title={`${title} is being wired up`} description="This module's API is registered; its screens are on the way." />
    </>
  );
}
