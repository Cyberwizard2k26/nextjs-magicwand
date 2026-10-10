/** Every documented area. Add the import for a new area file here (one line); keep alphabetical. */
import type { EndpointDoc } from "../registry";
import ai from "./ai";
import alerts from "./alerts";
import apiKeys from "./api-keys";
import audit from "./audit";
import auth from "./auth";
import automations from "./automations";
import contacts from "./contacts";
import deviceActions from "./device-actions";
import deviceNotes from "./device-notes";
import deviceRpc from "./device-rpc";
import deviceSections from "./device-sections";
import deviceSessions from "./device-sessions";
import devices from "./devices";
import docs from "./docs";
import enrollment from "./enrollment";
import groups from "./groups";
import health from "./health";
import integrations from "./integrations";
import invites from "./invites";
import jobs from "./jobs";
import maintenance from "./maintenance";
import me from "./me";
import monitoring from "./monitoring";
import network from "./network";
import notifications from "./notifications";
import org from "./org";
import patches from "./patches";
import platform from "./platform";
import policies from "./policies";
import reports from "./reports";
import roles from "./roles";
import schedules from "./schedules";
import scripts from "./scripts";
import security from "./security";
import sessions from "./sessions";
import settings from "./settings";
import sites from "./sites";
import software from "./software";
import tickets from "./tickets";
import toolbox from "./toolbox";
import users from "./users";
import vault from "./vault";
import vulnerabilities from "./vulnerabilities";
import webhooks from "./webhooks";

export const ALL_ENDPOINTS: EndpointDoc[] = [
  ...health, ...auth, ...me, ...devices, ...deviceSections, ...deviceActions, ...deviceRpc, ...deviceSessions, ...deviceNotes, ...sessions,
  ...sites, ...groups, ...enrollment, ...jobs, ...scripts, ...toolbox, ...alerts, ...monitoring, ...maintenance, ...notifications, ...patches,
  ...software, ...vulnerabilities, ...security, ...network, ...vault, ...docs, ...reports, ...tickets, ...contacts, ...automations, ...schedules,
  ...policies, ...ai, ...apiKeys, ...users, ...roles, ...invites, ...audit, ...org, ...settings, ...webhooks, ...integrations, ...platform,
];
