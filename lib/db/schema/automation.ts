import { pgTable, text, boolean, integer, jsonb, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { id, createdAt, updatedAt, ts, tsNullable } from "./_common";
import { organizations, users } from "./tenancy";
import { devices } from "./devices";

/* ---------------------------------------------------------------------------------------------
 * Scripts, jobs (the durable command queue), schedules, automations (event -> condition -> action),
 * policies (desired state) and compliance.
 * ------------------------------------------------------------------------------------------- */

export type ScriptLanguage = "powershell" | "bash" | "zsh" | "python" | "cmd" | "node" | "applescript" | "sh";

export interface ScriptParameter {
  name: string;
  label?: string;
  type: "string" | "number" | "boolean" | "select" | "secret" | "device_field";
  required?: boolean;
  default?: string | number | boolean;
  options?: string[];
  description?: string;
}

export const scripts = pgTable(
  "scripts",
  {
    id: id(),
    /** null = global library entry visible to all orgs (shipped with the product or MSP-wide). */
    orgId: text("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    language: text("language").$type<ScriptLanguage>().notNull(),
    content: text("content").notNull(),
    parameters: jsonb("parameters").$type<ScriptParameter[]>().notNull().default([]),
    platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
    category: text("category"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    timeoutSeconds: integer("timeout_seconds").notNull().default(300),
    runAs: text("run_as").$type<"system" | "user" | "elevated_user">().notNull().default("system"),
    /** Expected exit codes considered success (default [0]). */
    successCodes: jsonb("success_codes").$type<number[]>().notNull().default([0]),
    /** Parses stdout as JSON and stores it as the run output for monitors / custom fields. */
    outputJson: boolean("output_json").notNull().default(false),
    version: integer("version").notNull().default(1),
    isBuiltin: boolean("is_builtin").notNull().default(false),
    isFavorite: boolean("is_favorite").notNull().default(false),
    /** Risk classification used by blast-radius guards and approval rules. */
    risk: text("risk").$type<"low" | "medium" | "high">().notNull().default("low"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("scripts_org_idx").on(t.orgId), index("scripts_category_idx").on(t.category)],
);

export const scriptVersions = pgTable(
  "script_versions",
  {
    id: id(),
    scriptId: text("script_id").notNull().references(() => scripts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    parameters: jsonb("parameters").$type<ScriptParameter[]>().notNull().default([]),
    changelog: text("changelog"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("script_versions_script_idx").on(t.scriptId, t.version)],
);

export type JobType =
  | "script" | "command" | "software_install" | "software_uninstall" | "patch_scan" | "patch_install" | "reboot" | "shutdown" | "wake_on_lan"
  | "inventory" | "file_push" | "file_pull" | "registry" | "service_action" | "process_kill" | "policy_apply" | "agent_update" | "agent_uninstall"
  | "lock_screen" | "logoff_user" | "message_user" | "rotate_local_admin" | "network_scan" | "security_scan" | "clear_cache" | "custom";

export type JobStatus = "draft" | "queued" | "awaiting_approval" | "running" | "completed" | "partial" | "failed" | "cancelled";
export type RunStatus = "pending" | "sent" | "running" | "succeeded" | "failed" | "timeout" | "cancelled" | "skipped" | "offline_queued";

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").$type<JobType>().notNull(),
    name: text("name").notNull(),
    targetType: text("target_type").$type<"device" | "group" | "site" | "org" | "filter">().notNull(),
    targetIds: jsonb("target_ids").$type<string[]>().notNull().default([]),
    targetFilter: jsonb("target_filter").$type<Record<string, unknown> | null>(),
    /** Type-specific payload: scriptId + params, command, packageId, patch ids, file info ... */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    source: text("source").$type<"manual" | "schedule" | "automation" | "policy" | "alert" | "api" | "ai" | "patch_window" | "portal">().notNull().default("manual"),
    sourceId: text("source_id"),
    /** Max devices executing concurrently (rolling deployment). 0 = unlimited. */
    concurrency: integer("concurrency").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(0),
    timeoutSeconds: integer("timeout_seconds").notNull().default(600),
    /** Queue the run for offline devices and execute when they reconnect (within expiresAt). */
    runWhenOnline: boolean("run_when_online").notNull().default(true),
    respectMaintenanceWindows: boolean("respect_maintenance_windows").notNull().default(false),
    /** Stop the job when failures exceed this percentage (blast-radius guard). */
    abortOnFailurePercent: integer("abort_on_failure_percent"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    approvedBy: text("approved_by"),
    scheduledAt: tsNullable("scheduled_at"),
    expiresAt: tsNullable("expires_at"),
    startedAt: tsNullable("started_at"),
    completedAt: tsNullable("completed_at"),
    stats: jsonb("stats").$type<{ total: number; pending: number; running: number; succeeded: number; failed: number; skipped: number }>().notNull().default({ total: 0, pending: 0, running: 0, succeeded: 0, failed: 0, skipped: 0 }),
    createdBy: text("created_by"),
    createdByName: text("created_by_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_org_created_idx").on(t.orgId, t.createdAt), index("jobs_status_idx").on(t.status)],
);

export const jobRuns = pgTable(
  "job_runs",
  {
    id: id(),
    jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    status: text("status").$type<RunStatus>().notNull().default("pending"),
    attempt: integer("attempt").notNull().default(1),
    /** The exact command envelope sent to the agent (for replay / audit). */
    command: jsonb("command").$type<Record<string, unknown>>().notNull().default({}),
    sentAt: tsNullable("sent_at"),
    startedAt: tsNullable("started_at"),
    finishedAt: tsNullable("finished_at"),
    exitCode: integer("exit_code"),
    stdout: text("stdout"),
    stderr: text("stderr"),
    output: jsonb("output").$type<Record<string, unknown> | null>(),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("job_runs_job_idx").on(t.jobId), index("job_runs_device_idx").on(t.deviceId, t.createdAt), index("job_runs_status_idx").on(t.status)],
);

export const schedules = pgTable(
  "schedules",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    /** A job definition (type, payload, targets...) instantiated on every tick. */
    jobTemplate: jsonb("job_template").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    /** Randomize start within N seconds to avoid thundering herds. */
    jitterSeconds: integer("jitter_seconds").notNull().default(0),
    lastRunAt: tsNullable("last_run_at"),
    lastJobId: text("last_job_id"),
    nextRunAt: tsNullable("next_run_at"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("schedules_org_idx").on(t.orgId), index("schedules_next_run_idx").on(t.enabled, t.nextRunAt)],
);

export type AutomationTriggerType =
  | "alert_opened" | "alert_resolved" | "alert_acknowledged" | "device_online" | "device_offline" | "device_enrolled" | "device_decommissioned"
  | "inventory_changed" | "software_installed" | "software_removed" | "patch_failed" | "patch_installed" | "job_completed" | "job_failed"
  | "ticket_created" | "ticket_updated" | "user_logon" | "security_finding" | "compliance_drift" | "schedule" | "webhook" | "manual" | "health_score_dropped";

export interface AutomationAction {
  type:
    | "run_script" | "run_job" | "create_ticket" | "update_ticket" | "notify" | "webhook" | "set_tags" | "remove_tags" | "set_custom_field"
    | "move_to_group" | "ack_alert" | "resolve_alert" | "ai_triage" | "wait" | "approval" | "reboot" | "install_software" | "patch_now" | "assign_policy" | "send_user_message";
  params: Record<string, unknown>;
}

export const automations = pgTable(
  "automations",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(true),
    trigger: jsonb("trigger").$type<{ type: AutomationTriggerType; filter?: Record<string, unknown>; cron?: string; webhookSecret?: string }>().notNull(),
    /** Conditions evaluated against the event + device (same clause language as DeviceFilter). */
    conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default({}),
    actions: jsonb("actions").$type<AutomationAction[]>().notNull().default([]),
    /** Safety rails: limit devices affected per run / per day and require approval beyond a threshold. */
    blastRadius: jsonb("blast_radius").$type<{ maxDevicesPerRun?: number; maxRunsPerHour?: number; requireApprovalAbove?: number }>().notNull().default({}),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(0),
    runCount: integer("run_count").notNull().default(0),
    lastRunAt: tsNullable("last_run_at"),
    lastError: text("last_error"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("automations_org_idx").on(t.orgId)],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    automationId: text("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    deviceId: text("device_id"),
    triggerEvent: jsonb("trigger_event").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<"running" | "succeeded" | "failed" | "skipped" | "awaiting_approval" | "cancelled">().notNull().default("running"),
    steps: jsonb("steps").$type<{ action: string; status: string; startedAt: string; finishedAt?: string; output?: unknown; error?: string }[]>().notNull().default([]),
    startedAt: ts("started_at"),
    finishedAt: tsNullable("finished_at"),
    error: text("error"),
  },
  (t) => [index("automation_runs_automation_idx").on(t.automationId, t.startedAt)],
);

export type PolicyType = "monitoring" | "patching" | "software" | "security" | "scripts" | "configuration" | "agent" | "compliance" | "remote_access" | "composite";

export const policies = pgTable(
  "policies",
  {
    id: id(),
    /** null = global template. */
    orgId: text("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").$type<PolicyType>().notNull(),
    /** Declarative desired state for the policy type - see lib/services/policies/types.ts */
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    /** Higher priority wins when multiple policies of the same type apply to a device. */
    priority: integer("priority").notNull().default(100),
    /** Child policy settings are merged over the parent's (inheritance). */
    parentId: text("parent_id"),
    platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
    isBuiltin: boolean("is_builtin").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("policies_org_idx").on(t.orgId), index("policies_type_idx").on(t.type)],
);

export const policyAssignments = pgTable(
  "policy_assignments",
  {
    id: id(),
    policyId: text("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    targetType: text("target_type").$type<"org" | "site" | "group" | "device">().notNull(),
    targetId: text("target_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("policy_assignments_policy_idx").on(t.policyId), index("policy_assignments_target_idx").on(t.targetType, t.targetId)],
);

export const policyCompliance = pgTable(
  "policy_compliance",
  {
    id: id(),
    policyId: text("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    status: text("status").$type<"compliant" | "noncompliant" | "pending" | "error" | "remediating" | "exempt">().notNull().default("pending"),
    /** Per-item results: [{ item, expected, actual, compliant, remediated }] */
    details: jsonb("details").$type<{ item: string; expected?: unknown; actual?: unknown; compliant: boolean; remediated?: boolean; message?: string }[]>().notNull().default([]),
    driftCount: integer("drift_count").notNull().default(0),
    checkedAt: tsNullable("checked_at"),
    lastCompliantAt: tsNullable("last_compliant_at"),
    updatedAt: updatedAt(),
  },
  (t) => [index("policy_compliance_policy_device_idx").on(t.policyId, t.deviceId), index("policy_compliance_device_idx").on(t.deviceId)],
);

/** Compliance benchmarks (CIS-style) are policies of type "compliance" whose settings hold checks. Results below. */
export const complianceResults = pgTable(
  "compliance_results",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    benchmarkId: text("benchmark_id").notNull(),
    benchmarkName: text("benchmark_name").notNull(),
    passed: integer("passed").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    scorePercent: integer("score_percent"),
    results: jsonb("results").$type<{ id: string; title: string; status: "pass" | "fail" | "skip" | "error"; actual?: string; expected?: string; remediation?: string; severity?: string }[]>().notNull().default([]),
    ts: ts(),
  },
  (t) => [index("compliance_results_device_idx").on(t.deviceId, t.ts)],
);

export const jobsRelations = relations(jobs, ({ many }) => ({ runs: many(jobRuns) }));
export const jobRunsRelations = relations(jobRuns, ({ one }) => ({
  job: one(jobs, { fields: [jobRuns.jobId], references: [jobs.id] }),
  device: one(devices, { fields: [jobRuns.deviceId], references: [devices.id] }),
}));
export const scriptsRelations = relations(scripts, ({ many, one }) => ({
  versions: many(scriptVersions),
  creator: one(users, { fields: [scripts.createdBy], references: [users.id] }),
}));
export const policiesRelations = relations(policies, ({ many }) => ({ assignments: many(policyAssignments), compliance: many(policyCompliance) }));
