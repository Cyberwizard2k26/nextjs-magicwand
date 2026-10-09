CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_ips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"target_name" text,
	"ip" text,
	"user_agent" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"source_path" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"role_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_allowlist" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"cidr" text NOT NULL,
	"note" text,
	"applies_to" text DEFAULT 'all' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"role_id" text NOT NULL,
	"site_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" text,
	"kind" text DEFAULT 'client' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"active_org_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"timezone" text DEFAULT 'UTC',
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"networks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location" jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"issuer" text,
	"client_id" text,
	"client_secret_enc" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_role_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_org_preferences" (
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "user_org_preferences_user_id_org_id_pk" PRIMARY KEY("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"avatar_url" text,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"recovery_codes_hash" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_login_ip" text,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_token_hash" text,
	"action_token_expires_at" timestamp with time zone,
	"phone" text,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_type" text,
	"backed_up" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT 'Passkey' NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"platform" text NOT NULL,
	"arch" text NOT NULL,
	"channel" text DEFAULT 'stable' NOT NULL,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"signature" text,
	"notes" text,
	"is_current" boolean DEFAULT false NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"device_id" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"source" text DEFAULT 'agent' NOT NULL,
	"actor_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_group_members" (
	"group_id" text NOT NULL,
	"device_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text,
	"parent_id" text,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"icon" text,
	"is_dynamic" boolean DEFAULT false NOT NULL,
	"filter" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_hardware" (
	"device_id" text PRIMARY KEY NOT NULL,
	"cpu" jsonb,
	"memory" jsonb,
	"disks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gpus" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bios" jsonb,
	"baseboard" jsonb,
	"chassis" jsonb,
	"monitors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"batteries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tpm" jsonb,
	"usb" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"printers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"virtualization" jsonb,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_local_users" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"username" text NOT NULL,
	"full_name" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"password_expires" boolean DEFAULT true NOT NULL,
	"last_logon_at" timestamp with time zone,
	"uid" text,
	"managed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_security" (
	"device_id" text PRIMARY KEY NOT NULL,
	"posture" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" integer,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_services" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"start_type" text DEFAULT 'unknown' NOT NULL,
	"account" text,
	"pid" integer,
	"path" text,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_software" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"version" text,
	"publisher" text,
	"install_date" text,
	"source" text DEFAULT 'other' NOT NULL,
	"size_bytes" bigint,
	"install_location" text,
	"uninstall_string" text,
	"is_system_component" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text,
	"group_id" text,
	"agent_id" text,
	"agent_public_key" text,
	"name" text NOT NULL,
	"hostname" text,
	"display_name" text,
	"description" text,
	"platform" text DEFAULT 'other' NOT NULL,
	"device_type" text DEFAULT 'workstation' NOT NULL,
	"os_name" text,
	"os_version" text,
	"os_build" text,
	"os_eol_at" timestamp with time zone,
	"kernel" text,
	"arch" text,
	"agent_version" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_agentless" boolean DEFAULT false NOT NULL,
	"is_probe" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_boot_at" timestamp with time zone,
	"last_inventory_at" timestamp with time zone,
	"last_patch_scan_at" timestamp with time zone,
	"last_user_login_at" timestamp with time zone,
	"public_ip" text,
	"local_ips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mac_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"serial_number" text,
	"manufacturer" text,
	"model" text,
	"cpu_model" text,
	"cpu_cores" integer,
	"memory_bytes" bigint,
	"disk_total_bytes" bigint,
	"logged_in_user" text,
	"logged_in_users" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timezone" text,
	"domain" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health_score" integer,
	"health_factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location" jsonb,
	"warranty" jsonb,
	"pending_reboot" boolean DEFAULT false NOT NULL,
	"agentless_config" jsonb,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enrollment_token_id" text,
	"enrolled_at" timestamp with time zone,
	"decommissioned_at" timestamp with time zone,
	"notes" text,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollment_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text,
	"group_id" text,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"require_approval" boolean DEFAULT false NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agent_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"entity" text NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" jsonb,
	"is_shared" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"cpu_percent" real,
	"mem_used_bytes" bigint,
	"mem_total_bytes" bigint,
	"swap_used_bytes" bigint,
	"disks" jsonb,
	"net_rx_bps" double precision,
	"net_tx_bps" double precision,
	"uptime_seconds" bigint,
	"process_count" integer,
	"load_avg" jsonb,
	"temperatures" jsonb,
	"battery_percent" real,
	"gpu_percent" real,
	"latency_ms" real,
	"top_processes" jsonb
);
--> statement-breakpoint
CREATE TABLE "alert_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"alert_id" text NOT NULL,
	"author_id" text,
	"author_name" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"device_id" text,
	"monitor_id" text,
	"site_id" text,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"fingerprint" text NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"source" text DEFAULT 'monitor' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"snoozed_until" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution" text,
	"ticket_id" text,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"last_notified_at" timestamp with time zone,
	"remediation_job_id" text,
	"ai_triage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalation_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"repeat_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"target_type" text NOT NULL,
	"target_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"recurrence" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"suppress_alerts" boolean DEFAULT true NOT NULL,
	"allow_patching" boolean DEFAULT true NOT NULL,
	"allow_reboots" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitor_results" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"device_id" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"value" real,
	"message" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "monitor_states" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"device_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"value" real,
	"message" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"failing_since" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"alert_id" text,
	"remediation_count_today" integer DEFAULT 0 NOT NULL,
	"remediation_day" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"interval_seconds" integer DEFAULT 60 NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"policy_id" text,
	"device_id" text,
	"group_id" text,
	"site_id" text,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_on_probe" boolean DEFAULT false NOT NULL,
	"auto_remediation_script_id" text,
	"auto_remediation_max_per_day" integer DEFAULT 3 NOT NULL,
	"auto_resolve" boolean DEFAULT true NOT NULL,
	"auto_resolve_after_seconds" integer DEFAULT 0 NOT NULL,
	"notification_channel_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escalation_policy_id" text,
	"create_ticket" boolean DEFAULT false NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"config_enc" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"min_severity" text DEFAULT 'info' NOT NULL,
	"quiet_hours" jsonb,
	"last_used_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"channel_id" text,
	"alert_id" text,
	"kind" text DEFAULT 'alert' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"org_id" text NOT NULL,
	"device_id" text,
	"trigger_event" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blast_radius" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cooldown_seconds" integer DEFAULT 0 NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_results" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"device_id" text NOT NULL,
	"benchmark_id" text NOT NULL,
	"benchmark_name" text NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"score_percent" integer,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"org_id" text NOT NULL,
	"device_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"command" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"exit_code" integer,
	"stdout" text,
	"stderr" text,
	"output" jsonb,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"target_type" text NOT NULL,
	"target_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_filter" jsonb,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"concurrency" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 0 NOT NULL,
	"timeout_seconds" integer DEFAULT 600 NOT NULL,
	"run_when_online" boolean DEFAULT true NOT NULL,
	"respect_maintenance_windows" boolean DEFAULT false NOT NULL,
	"abort_on_failure_percent" integer,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"approved_by" text,
	"scheduled_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{"total":0,"pending":0,"running":0,"succeeded":0,"failed":0,"skipped":0}'::jsonb NOT NULL,
	"created_by" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"parent_id" text,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"org_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_compliance" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"device_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"drift_count" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone,
	"last_compliant_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"job_template" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"jitter_seconds" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_job_id" text,
	"next_run_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"script_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changelog" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"name" text NOT NULL,
	"description" text,
	"language" text NOT NULL,
	"content" text NOT NULL,
	"parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timeout_seconds" integer DEFAULT 300 NOT NULL,
	"run_as" text DEFAULT 'system' NOT NULL,
	"success_codes" jsonb DEFAULT '[0]'::jsonb NOT NULL,
	"output_json" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"risk" text DEFAULT 'low' NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patch_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"target_type" text DEFAULT 'org' NOT NULL,
	"target_id" text,
	"external_id" text,
	"rule" jsonb,
	"decision" text NOT NULL,
	"defer_until" timestamp with time zone,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"device_id" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"source" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"severity" text DEFAULT 'unknown' NOT NULL,
	"kb" text,
	"version" text,
	"current_version" text,
	"size_bytes" bigint,
	"status" text DEFAULT 'available' NOT NULL,
	"reboot_required" boolean DEFAULT false NOT NULL,
	"cve_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"release_date" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"installed_at" timestamp with time zone,
	"install_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_job_id" text,
	"support_url" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "software_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"name" text NOT NULL,
	"publisher" text,
	"description" text,
	"icon_url" text,
	"category" text,
	"platform" text NOT NULL,
	"package_manager" text NOT NULL,
	"package_id" text,
	"version" text,
	"download_url" text,
	"sha256" text,
	"install_args" text,
	"uninstall_args" text,
	"install_script" text,
	"uninstall_script" text,
	"detection" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"self_service" boolean DEFAULT false NOT NULL,
	"requires_reboot" boolean DEFAULT false NOT NULL,
	"license_type" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "software_licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"vendor" text,
	"match_name" text,
	"seats" integer,
	"key_enc" text,
	"purchase_date" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"cost" real,
	"currency" text DEFAULT 'USD',
	"notes" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vulnerabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"device_id" text NOT NULL,
	"cve_id" text NOT NULL,
	"title" text,
	"severity" text DEFAULT 'unknown' NOT NULL,
	"cvss" real,
	"epss" real,
	"known_exploited" boolean DEFAULT false NOT NULL,
	"package_name" text,
	"installed_version" text,
	"fixed_version" text,
	"source" text DEFAULT 'osv' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"device_id" text,
	"group_id" text,
	"reason" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approver_id" text,
	"approver_note" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"ticket_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"device_id" text NOT NULL,
	"session_id" text,
	"ticket_id" text,
	"sender" text NOT NULL,
	"sender_id" text,
	"sender_name" text,
	"body" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"device_id" text NOT NULL,
	"name" text,
	"token_hash" text NOT NULL,
	"session_types" jsonb DEFAULT '["desktop"]'::jsonb NOT NULL,
	"view_only" boolean DEFAULT true NOT NULL,
	"require_consent" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"window" jsonb,
	"created_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"session_id" text,
	"device_id" text NOT NULL,
	"user_id" text,
	"direction" text NOT NULL,
	"path" text NOT NULL,
	"size_bytes" bigint,
	"sha256" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "remote_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"device_id" text NOT NULL,
	"user_id" text,
	"user_name" text,
	"share_id" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"consent_required" boolean DEFAULT false NOT NULL,
	"consent_result" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"bytes_in" bigint DEFAULT 0 NOT NULL,
	"bytes_out" bigint DEFAULT 0 NOT NULL,
	"viewer_count" integer DEFAULT 1 NOT NULL,
	"recording_id" text,
	"access_request_id" text,
	"ip" text,
	"notes" text,
	"summary" text,
	"ticket_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_recordings" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"org_id" text NOT NULL,
	"path" text NOT NULL,
	"format" text DEFAULT 'mwrec' NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"sha256" text,
	"retain_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tunnels" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"device_id" text NOT NULL,
	"user_id" text,
	"protocol" text NOT NULL,
	"remote_host" text DEFAULT '127.0.0.1' NOT NULL,
	"remote_port" integer NOT NULL,
	"name" text,
	"status" text DEFAULT 'open' NOT NULL,
	"bytes_in" bigint DEFAULT 0 NOT NULL,
	"bytes_out" bigint DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_devices" (
	"contact_id" text NOT NULL,
	"device_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"title" text,
	"department" text,
	"portal_enabled" boolean DEFAULT false NOT NULL,
	"portal_password_hash" text,
	"is_vip" boolean DEFAULT false NOT NULL,
	"notes" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"targets" jsonb NOT NULL,
	"business_hours" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"author_type" text NOT NULL,
	"author_id" text,
	"author_name" text,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"number" serial NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'new' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"type" text DEFAULT 'incident' NOT NULL,
	"category" text,
	"site_id" text,
	"device_id" text,
	"contact_id" text,
	"assignee_id" text,
	"alert_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sla_policy_id" text,
	"first_response_due_at" timestamp with time zone,
	"resolve_due_at" timestamp with time zone,
	"first_responded_at" timestamp with time zone,
	"sla_breached" boolean DEFAULT false NOT NULL,
	"due_at" timestamp with time zone,
	"time_spent_minutes" integer DEFAULT 0 NOT NULL,
	"external_system" text,
	"external_id" text,
	"external_url" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_summary" text,
	"satisfaction_rating" integer,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ticket_id" text,
	"session_id" text,
	"user_id" text NOT NULL,
	"minutes" integer NOT NULL,
	"note" text,
	"billable" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text,
	"title" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_insights" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"device_id" text,
	"alert_id" text,
	"ticket_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"confidence" integer,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"author_id" text,
	"author_name" text,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovered_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text,
	"last_scan_id" text,
	"ip" text NOT NULL,
	"mac" text,
	"hostname" text,
	"vendor" text,
	"os_guess" text,
	"device_type_guess" text,
	"open_ports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snmp" jsonb,
	"services" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"promoted_device_id" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text,
	"device_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_published_to_portal" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"include_in_ai_context" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_enc" text,
	"status" text DEFAULT 'unconfigured' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"sync_interval_minutes" integer DEFAULT 60 NOT NULL,
	"mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_scans" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text,
	"probe_device_id" text,
	"targets" jsonb NOT NULL,
	"methods" jsonb DEFAULT '["arp","ping"]'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"found_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"job_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"org_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"storage_key" text,
	"format" text,
	"size_bytes" bigint,
	"error" text,
	"delivered_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"format" text DEFAULT 'pdf' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"brand_for_client" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"hostname" text NOT NULL,
	"version" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"agent_connections" integer DEFAULT 0 NOT NULL,
	"user_connections" integer DEFAULT 0 NOT NULL,
	"is_leader" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snmp_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"version" text DEFAULT 'v2c' NOT NULL,
	"community_enc" text,
	"v3" jsonb,
	"v3_secrets_enc" text,
	"port" integer DEFAULT 161 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text,
	"device_id" text,
	"name" text NOT NULL,
	"category" text DEFAULT 'password' NOT NULL,
	"username" text,
	"secret_enc" text NOT NULL,
	"url" text,
	"notes" text,
	"totp_secret_enc" text,
	"expires_at" timestamp with time zone,
	"last_rotated_at" timestamp with time zone,
	"auto_rotate_days" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_code" integer,
	"response_body" text,
	"next_retry_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret_enc" text,
	"events" jsonb DEFAULT '["*"]'::jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"last_status" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_allowlist" ADD CONSTRAINT "ip_allowlist_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_providers" ADD CONSTRAINT "sso_providers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_org_preferences" ADD CONSTRAINT "user_org_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_org_preferences" ADD CONSTRAINT "user_org_preferences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_group_members" ADD CONSTRAINT "device_group_members_group_id_device_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."device_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_group_members" ADD CONSTRAINT "device_group_members_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_groups" ADD CONSTRAINT "device_groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_groups" ADD CONSTRAINT "device_groups_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_hardware" ADD CONSTRAINT "device_hardware_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_local_users" ADD CONSTRAINT "device_local_users_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_security" ADD CONSTRAINT "device_security_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_services" ADD CONSTRAINT "device_services_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_software" ADD CONSTRAINT "device_software_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_group_id_device_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."device_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD CONSTRAINT "enrollment_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD CONSTRAINT "enrollment_tokens_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD CONSTRAINT "enrollment_tokens_group_id_device_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."device_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD CONSTRAINT "enrollment_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry" ADD CONSTRAINT "telemetry_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_comments" ADD CONSTRAINT "alert_comments_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_results" ADD CONSTRAINT "monitor_results_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_results" ADD CONSTRAINT "monitor_results_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_states" ADD CONSTRAINT "monitor_states_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_states" ADD CONSTRAINT "monitor_states_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_results" ADD CONSTRAINT "compliance_results_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_compliance" ADD CONSTRAINT "policy_compliance_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_compliance" ADD CONSTRAINT "policy_compliance_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patch_approvals" ADD CONSTRAINT "patch_approvals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patches" ADD CONSTRAINT "patches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patches" ADD CONSTRAINT "patches_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_catalog" ADD CONSTRAINT "software_catalog_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_licenses" ADD CONSTRAINT "software_licenses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulnerabilities" ADD CONSTRAINT "vulnerabilities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulnerabilities" ADD CONSTRAINT "vulnerabilities_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_shares" ADD CONSTRAINT "device_shares_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_shares" ADD CONSTRAINT "device_shares_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_transfers" ADD CONSTRAINT "file_transfers_session_id_remote_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."remote_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_transfers" ADD CONSTRAINT "file_transfers_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_sessions" ADD CONSTRAINT "remote_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_sessions" ADD CONSTRAINT "remote_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_sessions" ADD CONSTRAINT "remote_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_session_id_remote_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."remote_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tunnels" ADD CONSTRAINT "tunnels_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_devices" ADD CONSTRAINT "contact_devices_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_devices" ADD CONSTRAINT "contact_devices_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_notes" ADD CONSTRAINT "device_notes_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_devices" ADD CONSTRAINT "discovered_devices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_scans" ADD CONSTRAINT "network_scans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_scans" ADD CONSTRAINT "network_scans_probe_device_id_devices_id_fk" FOREIGN KEY ("probe_device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snmp_profiles" ADD CONSTRAINT "snmp_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_secrets" ADD CONSTRAINT "vault_secrets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_secrets" ADD CONSTRAINT "vault_secrets_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_org_entity_key_idx" ON "custom_field_definitions" USING btree ("org_id","entity","key");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_idx" ON "invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invites_org_idx" ON "invites" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ip_allowlist_org_idx" ON "ip_allowlist" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_org_idx" ON "memberships" USING btree ("user_id","org_id");--> statement-breakpoint
CREATE INDEX "memberships_org_idx" ON "memberships" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "organizations_parent_idx" ON "organizations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "roles_org_idx" ON "roles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sites_org_idx" ON "sites" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sso_providers_org_idx" ON "sso_providers" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_credential_id_idx" ON "webauthn_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "webauthn_user_idx" ON "webauthn_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_releases_unique_idx" ON "agent_releases" USING btree ("version","platform","arch","channel");--> statement-breakpoint
CREATE INDEX "device_events_device_ts_idx" ON "device_events" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "device_events_org_ts_idx" ON "device_events" USING btree ("org_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "device_group_members_idx" ON "device_group_members" USING btree ("group_id","device_id");--> statement-breakpoint
CREATE INDEX "device_groups_org_idx" ON "device_groups" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "device_groups_parent_idx" ON "device_groups" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_local_users_idx" ON "device_local_users" USING btree ("device_id","username");--> statement-breakpoint
CREATE UNIQUE INDEX "device_services_device_name_idx" ON "device_services" USING btree ("device_id","name");--> statement-breakpoint
CREATE INDEX "device_software_device_idx" ON "device_software" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "device_software_org_name_idx" ON "device_software" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_agent_id_idx" ON "devices" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "devices_org_idx" ON "devices" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "devices_site_idx" ON "devices" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "devices_group_idx" ON "devices" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "devices_status_idx" ON "devices" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "devices_hostname_idx" ON "devices" USING btree ("hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_tokens_hash_idx" ON "enrollment_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "enrollment_tokens_org_idx" ON "enrollment_tokens" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "saved_views_org_idx" ON "saved_views" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "telemetry_device_ts_idx" ON "telemetry" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "alert_comments_alert_idx" ON "alert_comments" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "alerts_org_status_idx" ON "alerts" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "alerts_device_idx" ON "alerts" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "alerts_fingerprint_idx" ON "alerts" USING btree ("fingerprint","status");--> statement-breakpoint
CREATE INDEX "alerts_opened_idx" ON "alerts" USING btree ("opened_at");--> statement-breakpoint
CREATE INDEX "escalation_policies_org_idx" ON "escalation_policies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "inbox_notifications_user_idx" ON "inbox_notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "maintenance_windows_org_idx" ON "maintenance_windows" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "monitor_results_monitor_device_ts_idx" ON "monitor_results" USING btree ("monitor_id","device_id","ts");--> statement-breakpoint
CREATE INDEX "monitor_states_monitor_device_idx" ON "monitor_states" USING btree ("monitor_id","device_id");--> statement-breakpoint
CREATE INDEX "monitor_states_device_idx" ON "monitor_states" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "monitors_org_idx" ON "monitors" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "monitors_device_idx" ON "monitors" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "monitors_policy_idx" ON "monitors" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "notification_channels_org_idx" ON "notification_channels" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "notifications_org_idx" ON "notifications" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_runs_automation_idx" ON "automation_runs" USING btree ("automation_id","started_at");--> statement-breakpoint
CREATE INDEX "automations_org_idx" ON "automations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "compliance_results_device_idx" ON "compliance_results" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "job_runs_job_idx" ON "job_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_runs_device_idx" ON "job_runs" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "job_runs_status_idx" ON "job_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_org_created_idx" ON "jobs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "policies_org_idx" ON "policies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "policies_type_idx" ON "policies" USING btree ("type");--> statement-breakpoint
CREATE INDEX "policy_assignments_policy_idx" ON "policy_assignments" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "policy_assignments_target_idx" ON "policy_assignments" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "policy_compliance_policy_device_idx" ON "policy_compliance" USING btree ("policy_id","device_id");--> statement-breakpoint
CREATE INDEX "policy_compliance_device_idx" ON "policy_compliance" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "schedules_org_idx" ON "schedules" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "schedules_next_run_idx" ON "schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "script_versions_script_idx" ON "script_versions" USING btree ("script_id","version");--> statement-breakpoint
CREATE INDEX "scripts_org_idx" ON "scripts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "scripts_category_idx" ON "scripts" USING btree ("category");--> statement-breakpoint
CREATE INDEX "patch_approvals_org_idx" ON "patch_approvals" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patches_device_external_idx" ON "patches" USING btree ("device_id","external_id");--> statement-breakpoint
CREATE INDEX "patches_org_status_idx" ON "patches" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "patches_org_external_idx" ON "patches" USING btree ("org_id","external_id");--> statement-breakpoint
CREATE INDEX "software_catalog_org_idx" ON "software_catalog" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "software_catalog_platform_idx" ON "software_catalog" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "software_licenses_org_idx" ON "software_licenses" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vulnerabilities_device_cve_pkg_idx" ON "vulnerabilities" USING btree ("device_id","cve_id","package_name");--> statement-breakpoint
CREATE INDEX "vulnerabilities_org_status_idx" ON "vulnerabilities" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "access_requests_org_status_idx" ON "access_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "access_requests_requester_idx" ON "access_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "chat_messages_device_idx" ON "chat_messages" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_shares_token_idx" ON "device_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "device_shares_device_idx" ON "device_shares" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "file_transfers_device_idx" ON "file_transfers" USING btree ("device_id","started_at");--> statement-breakpoint
CREATE INDEX "remote_sessions_org_idx" ON "remote_sessions" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "remote_sessions_device_idx" ON "remote_sessions" USING btree ("device_id","started_at");--> statement-breakpoint
CREATE INDEX "remote_sessions_user_idx" ON "remote_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_recordings_session_idx" ON "session_recordings" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "tunnels_device_idx" ON "tunnels" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_devices_idx" ON "contact_devices" USING btree ("contact_id","device_id");--> statement-breakpoint
CREATE INDEX "contacts_org_idx" ON "contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "sla_policies_org_idx" ON "sla_policies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ticket_comments_ticket_idx" ON "ticket_comments" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_org_status_idx" ON "tickets" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "tickets_device_idx" ON "tickets" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "tickets_assignee_idx" ON "tickets" USING btree ("assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_org_number_idx" ON "tickets" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "time_entries_ticket_idx" ON "time_entries" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "time_entries_user_idx" ON "time_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_insights_org_idx" ON "ai_insights" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_insights_device_idx" ON "ai_insights" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "attachments_entity_idx" ON "attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "dashboards_org_idx" ON "dashboards" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "device_notes_device_idx" ON "device_notes" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discovered_devices_org_site_ip_idx" ON "discovered_devices" USING btree ("org_id","site_id","ip");--> statement-breakpoint
CREATE INDEX "discovered_devices_status_idx" ON "discovered_devices" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "documents_org_idx" ON "documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "documents_device_idx" ON "documents" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "integrations_org_idx" ON "integrations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "integrations_type_idx" ON "integrations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "network_scans_org_idx" ON "network_scans" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "report_runs_report_idx" ON "report_runs" USING btree ("report_id","generated_at");--> statement-breakpoint
CREATE INDEX "reports_org_idx" ON "reports" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "snmp_profiles_org_idx" ON "snmp_profiles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "status_pages_slug_idx" ON "status_pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "vault_secrets_org_idx" ON "vault_secrets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "vault_secrets_device_idx" ON "vault_secrets" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_idx" ON "webhook_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_retry_idx" ON "webhook_deliveries" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "webhooks_org_idx" ON "webhooks" USING btree ("org_id");