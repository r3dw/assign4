"use client";

import { useEffect, useRef, useState } from "react";
import type { TabId } from "@/lib/tabs";
import { tourSteps, type DemoId } from "@/lib/tourSteps";
import type { Settings, Theme } from "@/lib/useSettings";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The guided tour. Mounted only while the tour is running; unmounting ends it.
 * Demos change settings temporarily (not saved) and the snapshot taken at the
 * start (theme, text size, options, and which tab was showing) is restored when
 * the tour ends. The steps themselves are in src/lib/tourSteps.ts.
 */
export function Tour({
  settings,
  tab,
  setTab,
  signedIn,
  panelOpen,
  setPanelOpen,
  setLift,
  tip,
  onEnd,
}: {
  settings: Settings;
  /** The tab showing now. Steps that point into a tab switch to it (without saving the choice). */
  tab: TabId;
  setTab: (tab: TabId) => void;
  signedIn: boolean;
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
    tab,
  }));
  const dialogRef = useRef<HTMLDivElement>(null);
  const highlighted = useRef<HTMLElement | null>(null);

  const { setTheme, setSize, setOptions } = settings;

  const demos: Record<DemoId, () => Promise<void>> = {
    theme: async () => {
      for (const t of ["dark", "terminal", "light"] as Theme[]) {
        setTheme(t, false);
        await sleep(1400);
      }
      setTheme(snapshot.theme, false);
    },
    size: async () => {
      setSize(2, false);
      await sleep(1800);
      setSize(snapshot.size, false);
    },
    options: async () => {
      setOptions(true, true, false);
      await sleep(2200);
      setOptions(snapshot.older, snapshot.beta, false);
    },
    refresh: async () => {
      const host = document.getElementById("refresh");
      if (!host) return;
      tip.show(host, host);
      await sleep(3500);
      tip.hide();
    },
    // The real dialog is a native modal, which makes everything behind it (including this tour box)
    // unusable while it is open, so it is shown for a few seconds and then closed. Closing it hands
    // focus back to the button that was focused when it opened: "Show me".
    devices: async () => {
      const link = document.getElementById("tour-supported-devices");
      if (!link) return;
      link.click();
      await sleep(5000);
      document.querySelector<HTMLDialogElement>("dialog.devices-dialog")?.close();
    },
  };

  const steps = tourSteps(signedIn);
  const step = steps[index];
  const last = index === steps.length - 1;

  function end() {
    // Restore whatever the user had before any demonstration.
    setTheme(snapshot.theme, false);
    setSize(snapshot.size, false);
    setOptions(snapshot.older, snapshot.beta, false);
    setTab(snapshot.tab);
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
    // Not shown yet (the panel or tab is still opening): measuring it would give zeros.
    if (target.getClientRects().length === 0) return;
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
    // A target inside a card is spotlighted with its whole card, so sit below or above the card and
    // leave all of it visible. A card too tall to leave room is skipped: anchor to the target itself.
    const card = target.closest<HTMLElement>(".card");
    const a = (card && fitsWithDialog(card) ? card : target).getBoundingClientRect();
    const left = Math.max(8, Math.min(a.left, window.innerWidth - d.offsetWidth - 8));
    const below = a.bottom + 16;
    const above = a.top - d.offsetHeight - 16;
    let top: number;
    if (below + d.offsetHeight <= window.innerHeight - 8) top = below;
    else if (above >= 8) top = above;
    else {
      // Neither side has room: take the end of the screen that keeps the highlighted target clear.
      const overlaps = (t: number) => t < r.bottom + 8 && t + d.offsetHeight > r.top - 8;
      const atBottom = window.innerHeight - d.offsetHeight - 8;
      top = !overlaps(atBottom) ? atBottom : 8;
    }
    d.style.left = `${left}px`;
    d.style.top = `${top}px`;
  }

  /** Whether an element and the tour box can both be on screen at once. */
  function fitsWithDialog(el: HTMLElement): boolean {
    const d = dialogRef.current;
    return !!d && el.offsetHeight + d.offsetHeight + 40 <= window.innerHeight;
  }

  // Show the current step: switch to its tab, open or close the settings panel, highlight the target
  // (lifting its card above the dimmed page), and position the dialog. It runs again when the tab
  // changes, because a target on a tab that was hidden cannot be scrolled to or measured until the tab shows.
  useEffect(() => {
    const s = steps[index];
    tip.hide();
    if (s.tab && s.tab !== tab) setTab(s.tab);
    const target = s.target ? document.getElementById(s.target) : null;
    // Steps that point inside the settings menu open it; other steps close it.
    const panel = document.getElementById("settings-panel");
    setPanelOpen(!!target && !!panel && panel.contains(target));
    const header = document.getElementById("site-header");
    setLift(!!target && !!header && header.contains(target));
    // The cards' frosted glass traps their contents behind the backdrop, so lift the whole card.
    const card = target?.closest<HTMLElement>(".card") ?? null;
    if (target) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // A card that fits goes at the top of the page with room for the tour box below it;
      // anything else is centred.
      const wholeCard = card && fitsWithDialog(card);
      (wholeCard ? card : target).scrollIntoView({ block: wholeCard ? "start" : "center", behavior: reduced ? "auto" : "smooth" });
      target.setAttribute("data-tour-highlight", "");
      card?.setAttribute("data-tour-lift", "");
      highlighted.current = target;
    }
    // Scrolling can take a moment, and the tour box must end up where the target ends up, so keep
    // placing it frame by frame until the target stops moving (or a second and a half has passed).
    let raf = 0;
    let frames = 0;
    let steady = 0;
    let lastTop = Number.NaN;
    const follow = () => {
      place(target);
      if (frames === 0) dialogRef.current?.focus();
      const top = target ? Math.round(target.getBoundingClientRect().top) : 0;
      steady = top === lastTop ? steady + 1 : 0;
      lastTop = top;
      if (++frames < 90 && steady < 4) raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => {
      cancelAnimationFrame(raf);
      target?.removeAttribute("data-tour-highlight");
      card?.removeAttribute("data-tour-lift");
      highlighted.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- steps is rebuilt each render; only the step and tab matter
  }, [index, tab]);

  // Opening the panel takes a render, so a step that opens it cannot be measured straight away.
  // Place the dialog again once the panel is actually on screen.
  useEffect(() => {
    const raf = requestAnimationFrame(() => place(highlighted.current));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- place only reads the DOM and refs
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
    await demos[step.demo]();
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
