"use client";
import * as React from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";

function langExt(language: string) {
  switch (language) {
    case "powershell": return StreamLanguage.define(powerShell);
    case "python": return python();
    case "node": return javascript();
    case "cmd": return StreamLanguage.define(shell);
    case "applescript": return [];
    default: return StreamLanguage.define(shell);
  }
}

export function CodeEditor({ value, language, onChange, readOnly, height = "420px" }: { value: string; language: string; onChange: (v: string) => void; readOnly?: boolean; height?: string }) {
  const [light, setLight] = React.useState(false);
  React.useEffect(() => {
    const read = () => setLight(document.documentElement.getAttribute("data-theme") === "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  const extensions = React.useMemo(() => [langExt(language), EditorView.lineWrapping], [language]);
  return (
    <CodeMirror
      value={value}
      height={height}
      theme={light ? "light" : oneDark}
      extensions={extensions}
      editable={!readOnly}
      readOnly={readOnly}
      onChange={onChange}
      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly, autocompletion: false }}
      style={{ fontSize: 13 }}
      aria-label="Script content"
    />
  );
}
