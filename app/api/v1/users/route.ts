import { api } from "@/lib/api/route";
import { UserListQuery } from "@/lib/api/contracts/users";
import { listMembers } from "@/lib/services/users";

export const dynamic = "force-dynamic";

/** Members of the active organization with their role, site scope, status and last sign-in. */
export const GET = api({ permission: "users.view", query: UserListQuery }, async ({ orgId, query }) => listMembers({ orgId, ...query }));
