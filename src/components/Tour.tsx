"use client";

import { useEffect, useRef, useState } from "react";
import type { Settings, Theme } from "@/lib/useSettings";

interface Step {
  target?: string;
  title: string;
  body: string;
  demo?: () => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The guided tour. Mounted only while the tour is running; unmounting ends it.
 * Demos change settings temporarily (not saved) and the snapshot taken at the
 * start is restored when the tour ends.
 */
export function Tour({
  settings,
  panelOpen,
  setPanelOpen,
  setLift,
  tip,
  onEnd,
}: {
  settings: Settings;
  /** Whether the settings panel is currently shown. The tour re-positions its dialog when this changes. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  setLift: (lift: boolean) => void;
  tip: { show: (host: HTMLElement, control: Element) => void; hide: () => void };
  onEnd: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [demoRunning, setDemoRunning] = useState(false);
  const [snapshot] = useState(() => ({
    theme: settings.theme,
    size: settings.size,
    older: settings.older,
    beta: settings.beta,
  }));
  const dialogRef = useRef<HTMLDivElement>(null);
  const highlighted = useRef<HTMLElement | null>(null);

  const { setTheme, setSize, setOptions } = settings;

  const steps: Step[] = [
    {
      title: "Welcome",
      body:
        "This page shows the current version of each Apple operating system. This short tour covers the controls. " +
        "You can move at your own pace, and press Escape at any time to leave.",
    },
    {
      target: "tabs",
      title: "Two views",
      body:
        "Use these tabs to switch between every Apple OS and your own saved devices. Sign in to save your devices " +
        "and see the newest version each one can run.",
    },
    {
      target: "settings-btn",
      title: "The settings menu",
      body:
        "The gear button at the top right opens the settings menu: theme, text size, and which versions to show. " +
        "The next few steps open it for you.",
    },
    {
      target: "tour-theme",
      title: "Choose a theme",
      body: "Light, Dark and Terminal themes are all designed to be easy to read. Your choice is remembered.",
      demo: async () => {
        for (const t of ["dark", "terminal", "light"] as Theme[]) {
          setTheme(t, false);
          await sleep(1400);
        }
        setTheme(snapshot.theme, false);
      },
    },
    {
      target: "tour-size",
      title: "Change the text size",
      body: "Use A+ and A− to resize the text. Your browser's own zoom (Ctrl or Cmd with + and −) also works.",
      demo: async () => {
        setSize(2, false);
        await sleep(1800);
        setSize(snapshot.size, false);
      },
    },
    {
      target: "tour-options",
      title: "Show or hide versions",
      body:
        "Older versions (outside the three newest major releases) are hidden by default. " +
        "Turn on Beta versions to see the newest beta in testing, if Apple has one.",
      demo: async () => {
        setOptions(true, true, false);
        await sleep(2200);
        setOptions(snapshot.older, snapshot.beta, false);
      },
    },
    {
      target: "refresh",
      title: "Refresh the data",
      body:
        "The circular arrow button next to the gear reloads the version information. " +
        "Hover over or focus any control to see a tooltip explaining it.",
      demo: async () => {
        const host = document.getElementById("refresh");
        if (!host) return;
        tip.show(host, host);
        await sleep(3500);
        tip.hide();
      },
    },
    { title: "You're all set", body: "Choose Take the tour at any time to see this again." },
  ];
  const step = steps[index];
  const last = index === steps.length - 1;

  function end() {
    // Restore whatever the user had before any demonstration.
    setTheme(snapshot.theme, false);
    setSize(snapshot.size, false);
    setOptions(snapshot.older, snapshot.beta, false);
    tip.hide();
    setPanelOpen(false);
    setLift(false);
    onEnd();
  }

  function place(target: HTMLElement | null) {
    const d = dialogRef.current;
    if (!d) return;
    const panel = document.getElementById("settings-panel");
    if (!target) {
      d.style.left = `${Math.max(8, (window.innerWidth - d.offsetWidth) / 2)}px`;
      d.style.top = `${Math.max(8, (window.innerHeight - d.offsetHeight) / 3)}px`;
      return;
    }
    if (panel && panel.contains(target) && panel.hidden) return; // not shown yet: measuring it would give zeros
    const r = target.getBoundingClientRect();
    if (panel && panel.contains(target)) {
      // Keep the settings panel readable: put the dialog beside it, or below it on narrow screens.
      const p = panel.getBoundingClientRect();
      const beside = p.left - d.offsetWidth - 16;
      if (beside >= 8) {
        d.style.left = `${beside}px`;
        d.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - d.offsetHeight - 8))}px`;
      } else {
        d.style.left = `${Math.max(8, Math.min(p.left, window.innerWidth - d.offsetWidth - 8))}px`;
        d.style.top = `${Math.min(p.bottom + 16, Math.max(8, window.innerHeight - d.offsetHeight - 8))}px`;
      }
      return;
    }
    const left = Math.max(8, Math.min(r.left, window.innerWidth - d.offsetWidth - 8));
    const below = r.bottom + 16;
    const top = below + d.offsetHeight > window.innerHeight ? Math.max(8, r.top - d.offsetHeight - 16) : below;
    d.style.left = `${left}px`;
    d.style.top = `${top}px`;
  }

  // Show the current step: open or close the settings panel, highlight the target, position the dialog.
  useEffect(() => {
    const s = steps[index];
    tip.hide();
    const target = s.target ? document.getElementById(s.target) : null;
    // Steps that point inside the settings menu open it; other steps close it.
    const panel = document.getElementById("settings-panel");
    setPanelOpen(!!target && !!panel && panel.contains(target));
    const header = document.getElementById("site-header");
    setLift(!!target && !!header && header.contains(target));
    if (target) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      target.setAttribute("data-tour-highlight", "");
      highlighted.current = target;
    }
    // Wait a frame so layout (and scrolling) settles before measuring.
    const raf = requestAnimationFrame(() => {
      place(target);
      dialogRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      target?.removeAttribute("data-tour-highlight");
      highlighted.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- steps is rebuilt each render; only the index matters
  }, [index]);

  // Opening the panel takes a render, so a step that opens it cannot be measured straight away.
  // Place the dialog again once the panel is actually on screen.
  useEffect(() => {
    const raf = requestAnimationFrame(() => place(highlighted.current));
    return () => cancelAnimationFrame(raf);
  }, [panelOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
    };
    const onResize = () => place(highlighted.current);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers only use refs and stable setters
  }, []);

  async function runDemo() {
    if (demoRunning || !step.demo) return;
    setDemoRunning(true);
    await step.demo();
    setDemoRunning(false);
  }

  return (
    <>
      <div className="tour-backdrop" />
      <div
        ref={dialogRef}
        className="tour-dialog"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
      >
        <p className="tour-step">{`Step ${index + 1} of ${steps.length}`}</p>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        <div className="tour-buttons">
          {step.demo && (
            <button type="button" aria-disabled={demoRunning} onClick={runDemo}>
              Show me
            </button>
          )}
          <span className="spacer" />
          {!last && (
            <button type="button" onClick={end}>
              Skip tour
            </button>
          )}
          {index > 0 && (
            <button type="button" onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          <button type="button" className="primary" onClick={() => (last ? end() : setIndex(index + 1))}>
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
