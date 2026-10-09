"use client";
import * as React from "react";
import { AlertCircle, Eye, EyeOff, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/util/cn";

export function AuthHeader({ icon, title, description }: { icon?: React.ReactNode; title: string; description?: React.ReactNode }) {
  return (
    <div className="mb-7">
      {icon && <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border-strong bg-surface-2 text-accent-hover [&>svg]:h-5 [&>svg]:w-5">{icon}</div>}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{description}</p>}
    </div>
  );
}

export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger animate-in">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Password input with show/hide toggle and a Caps Lock warning. */
export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">>(function PasswordInput({ className, onKeyUp, onKeyDown, onBlur, ...props }, ref) {
  const [show, setShow] = React.useState(false);
  const [caps, setCaps] = React.useState(false);
  const check = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  return (
    <div>
      <div className="relative">
        <Input
          ref={ref}
          type={show ? "text" : "password"}
          leftIcon={<KeyRound />}
          className={cn("h-10 pr-10", className)}
          onKeyDown={(e) => { check(e); onKeyDown?.(e); }}
          onKeyUp={(e) => { check(e); onKeyUp?.(e); }}
          onBlur={(e) => { setCaps(false); onBlur?.(e); }}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg focus-ring"
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {caps && <p className="mt-1.5 text-xs text-warning">Caps Lock is on.</p>}
    </div>
  );
});

/** Rough password strength (0-4) — guidance only, the server enforces the real policy. */
export function passwordScore(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 12) s++;
  if (pw.length >= 16) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length < 12) s = Math.min(s, 1);
  return s;
}

export function PasswordStrength({ value }: { value: string }) {
  const score = passwordScore(value);
  const label = ["Too short", "Weak", "Fair", "Good", "Strong"][score];
  const color = ["bg-danger", "bg-danger", "bg-warning", "bg-success", "bg-success"][score];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors", value && i < Math.max(1, score) ? color : "bg-surface-3")} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-fg-subtle">
        <span>{value ? label : "12+ characters, mix cases, numbers and symbols"}</span>
        {value && <span className="tabular">{value.length} chars</span>}
      </div>
    </div>
  );
}

/** Segmented one-time-code input: auto-advance, backspace navigation and paste support. */
export function OtpInput({ length = 6, value, onChange, onComplete, disabled, invalid }: { length?: number; value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean; invalid?: boolean }) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");
  const set = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };
  React.useEffect(() => { refs.current[0]?.focus(); }, []);
  return (
    <div className={cn("flex justify-between gap-2", invalid && "animate-[shake_300ms_ease]")} role="group" aria-label="Verification code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={length}
          aria-label={`Digit ${i + 1}`}
          className={cn(
            "mono h-14 w-full min-w-0 rounded-xl border bg-surface-2 text-center text-xl font-semibold text-fg transition-colors focus-ring focus:border-accent/60 disabled:opacity-50",
            invalid ? "border-danger/60" : d ? "border-border-strong" : "border-border",
          )}
          onFocus={(e) => {
            // Digits fill left to right: focusing past the first empty box jumps back to it.
            if (i > value.length) refs.current[value.length]?.focus();
            else e.target.select();
          }}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (!v) return;
            if (v.length > 1) { set(v); refs.current[Math.min(v.length, length - 1)]?.focus(); return; }
            set(value.slice(0, i) + v + value.slice(i + 1));
            refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              if (digits[i]) onChange(value.slice(0, i) + value.slice(i + 1));
              else if (i > 0) { onChange(value.slice(0, i - 1) + value.slice(i)); refs.current[i - 1]?.focus(); }
            } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            else if (e.key === "ArrowRight" && i < Math.min(value.length, length - 1)) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const v = e.clipboardData.getData("text").replace(/\D/g, "");
            if (v) { set(v); refs.current[Math.min(v.length, length) - 1]?.focus(); }
          }}
        />
      ))}
    </div>
  );
}
