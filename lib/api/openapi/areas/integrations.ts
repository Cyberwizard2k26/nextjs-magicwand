import { z } from "zod";
import { endpoint, type EndpointDoc } from "../registry";
import { IntegrationCreate, IntegrationListQuery, IntegrationListResponse, IntegrationPatch, IntegrationSchema, IntegrationTestResponse } from "../../contracts/integrations";

const area: EndpointDoc[] = [
  endpoint({
    method: "GET", path: "/api/v1/integrations", operationId: "listIntegrations", tag: "Integrations", permission: "integrations.manage", risk: "read",
    summary: "List configured integrations and the connector catalog", query: IntegrationListQuery, response: IntegrationListResponse,
    notes: ["`catalog` describes every supported connector: category, the fields it needs (which are secret) and what the platform does with it.", "`status` is `unconfigured` until a test passes (`ok`) or fails (`error`); it never claims a sync that did not happen.", "Credentials are never returned; `secretKeys` lists which ones are stored."],
    aiHint: "Use to see which PSA, chat, identity, backup, security or storage systems are connected and whether their last test passed.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/integrations", operationId: "createIntegration", tag: "Integrations", permission: "integrations.manage", risk: "write",
    summary: "Configure an integration", body: IntegrationCreate, response: IntegrationSchema,
    bodyExample: { type: "chat_slack", name: "NOC channel", config: { channel: "#noc" }, secrets: { webhookUrl: "https://hooks.slack.com/services/..." } },
    notes: ["`config` holds non-secret fields, `secrets` the credential fields from the catalog; secrets are AES-256-GCM encrypted at rest.", "Run POST /integrations/{id}/test afterwards to validate.", "Emits `integration.created`."],
    aiHint: "Use to connect an external system; look up the required fields in the catalog first and ask the operator for credentials rather than guessing.",
  }),
  endpoint({ method: "GET", path: "/api/v1/integrations/{id}", operationId: "getIntegration", tag: "Integrations", permission: "integrations.manage", risk: "read", summary: "Get an integration", params: { id: "Integration id" }, response: IntegrationSchema, aiHint: "Use to read an integration's settings and last error." }),
  endpoint({ method: "PATCH", path: "/api/v1/integrations/{id}", operationId: "updateIntegration", tag: "Integrations", permission: "integrations.manage", risk: "write", summary: "Update settings or credentials", params: { id: "Integration id" }, body: IntegrationPatch, response: IntegrationSchema, notes: ["Send an empty string for a secret to remove it.", "Changing config or secrets resets status to `unconfigured` until tested again.", "Emits `integration.updated`."], aiHint: "Use to rotate an API key or fix an endpoint URL, then test again." }),
  endpoint({ method: "DELETE", path: "/api/v1/integrations/{id}", operationId: "deleteIntegration", tag: "Integrations", permission: "integrations.manage", risk: "dangerous", summary: "Remove an integration", params: { id: "Integration id" }, response: z.object({ ok: z.literal(true) }), notes: ["Deletes the stored credentials. Emits `integration.deleted`."], aiHint: "Use to disconnect a system permanently." }),
  endpoint({ method: "POST", path: "/api/v1/integrations/{id}/test", operationId: "testIntegration", tag: "Integrations", permission: "integrations.manage", risk: "write", summary: "Validate configuration and reachability", params: { id: "Integration id" }, response: IntegrationTestResponse, notes: ["Checks required fields, URL syntax and (for http/https endpoints) that the host answers within 6 s.", "Stores the outcome as the integration's status/lastError."], aiHint: "Use after configuring or changing an integration to confirm it is set up correctly." }),
];
export default area;
