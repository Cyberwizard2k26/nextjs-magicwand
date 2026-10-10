"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section, type PanelProps } from "./panel-bits";

const PROMPTS = [
  "Why is this machine slow right now?",
  "Summarise everything that happened on this device in the last 24 hours.",
  "Which open alerts should I handle first and how?",
  "Check whether this device is fully patched and list what is missing.",
  "Draft a message to the signed-in user about the pending reboot.",
];

/** Hand-off into the AI copilot with the device pre-selected; prompts are passed as `q` so the chat starts immediately. */
export function AiPanel({ detail, actions }: PanelProps) {
  const d = detail.device;
  const href = (q?: string) => `/copilot?device=${encodeURIComponent(d.id)}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  return (
    <>
      <div className="mb-4 rounded-lg border border-accent/30 bg-accent-soft/40 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-fg"><Sparkles className="h-4 w-4 text-accent-hover" />Ask AI about {d.name}</div>
        <p className="mt-1 text-xs text-fg-muted">The copilot sees this machine&apos;s inventory, timeline, alerts, jobs and notes through the same API you use, and can run tools on it with your permissions. Risky actions ask for confirmation.</p>
        <Button size="sm" className="mt-3" leftIcon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => actions.askAi(d.id)}>Open copilot for this machine</Button>
      </div>
      <Section title="Start with a question">
        <ul className="space-y-1">
          {PROMPTS.map((q) => (
            <li key={q}>
              <Link href={href(q)} className="group flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-fg hover:border-border-strong hover:bg-surface-hover/70 focus-ring">
                <span className="min-w-0 flex-1">{q}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-fg-subtle group-hover:text-accent-hover" />
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
