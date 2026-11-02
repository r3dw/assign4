"use client";

import { Show, SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detect, evaluate, type DeviceInfo } from "@/lib/device";
import { badgeEntries, formatDateTime, newness, previewDate } from "@/lib/format";
import { hashForTab, tabFromHash, type TabId } from "@/lib/tabs";
import { load, save, SIZES, useSettings, type Theme } from "@/lib/useSettings";
import type { Payload } from "@/lib/versions";
import { Card } from "./Card";
import { DevicesDialog, type DevicesTarget } from "./DevicesDialog";
import { Icon } from "./Icon";
import { MyDevicesSection } from "./MyDevices";
import { Tour } from "./Tour";
import { ViewTabs } from "./ViewTabs";
import { useTooltip } from "./Tooltip";

const DEVICE_ICONS = { ok: "✓", warn: "⚠", info: "ℹ" };

function Spinner() {
  return (
    <svg
      className="spinner"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: 12 }, (_, i) => (
        <line
          key={i}
          x1="12"
          y1="2.5"
          x2="12"
          y2="7"
          transform={`rotate(${i * 30} 12 12)`}
          opacity={[0.18, 0.25, 0.33, 0.4, 0.48, 0.55, 0.63, 0.7, 0.78, 0.85, 0.93, 1][i]}
        />
      ))}
    </svg>
  );
}

/** "?device=macOS:26.5" previews the messages for a given version. */
function forcedDevice(search: string): DeviceInfo | null {
  const m = /^(iOS|iPadOS|macOS):([\d.]+)$/.exec(new URLSearchParams(search).get("device") || "");
  return m ? { family: m[1], version: m[2] } : null;
}

export function VersionsApp() {
  const settings = useSettings();
  const { theme, size, older, beta, setTheme, setSize, setOptions } = settings;

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ text: "Loading versions…", error: false });
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [now, setNow] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [pulses, setPulses] = useState<Record<string, number>>({});

  const [panelOpen, setPanelOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [showTitle, setShowTitle] = useState(false);
  const [lift, setLift] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const [devicesTarget, setDevicesTarget] = useState<DevicesTarget | null>(null);

  // Two views of one page: all versions, or the signed-in user's saved devices.
  const { isLoaded, isSignedIn } = useAuth();
  const [tab, setTab] = useState<TabId>("versions");
  const [deviceCount, setDeviceCount] = useState<number | null>(null);
  const chose = useRef(false); // true once the visitor (or a link) has picked a tab

  const panelRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const loadingRef = useRef(false);
  const dataRef = useRef<Payload | null>(null);
  const seenNew = useRef<Set<string>>(new Set());
  const returnFocus = useRef<HTMLElement | null>(null);
  const live = useRef({ older, beta, tourActive, previewing });
  useEffect(() => {
    live.current = { older, beta, tourActive, previewing };
  });

  const tip = useTooltip();

  // ---------- Pulsing "New" badges ----------

  // Badges pulse only the first time a visitor sees that version.
  const startPulses = useCallback((d: Payload, at: number) => {
    const { older: o, beta: b, previewing: preview } = live.current;
    const next: Record<string, number> = {};
    let delay = 0;
    for (const [key, date] of badgeEntries(d, o, b)) {
      if (!newness(date, at) || next[key] !== undefined) continue;
      if (!preview && seenNew.current.has(key)) continue;
      next[key] = delay;
      delay += 150; // stagger so several badges don't pulse in unison
    }
    setPulses(next);
    if (Object.keys(next).length && !preview) {
      Object.keys(next).forEach((k) => seenNew.current.add(k));
      save("seenNew", JSON.stringify([...seenNew.current].slice(-50)));
    }
  }, []);

  // ---------- Loading data ----------

  const loadData = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const had = dataRef.current !== null;
    setStatus({ text: had ? "Refreshing…" : "Loading versions…", error: false });
    try {
      const resp = await fetch("/api/versions", { cache: "no-cache" });
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
      const d: Payload = await resp.json();
      const at = previewDate(location.search) ?? Date.now();
      dataRef.current = d;
      setData(d);
      setNow(at);
      if (!live.current.tourActive && load("tourSeen", "false") === "true") startPulses(d, at);
      const fresh = d.families.reduce(
        (n, f) => n + f.cycles.filter((c) => c.supported && newness(c.date, at)).length,
        0,
      );
      const failed = Object.values(d.sources).filter((s) => s !== "ok").length;
      setStatus({
        text:
          `Data as of ${formatDateTime(d.generated)}.` +
          (fresh
            ? ` ${fresh} ${fresh === 1 ? "version was" : "versions were"} released in the last day or so and marked New.`
            : "") +
          (failed
            ? ` ${failed} of ${Object.keys(d.sources).length} data sources had problems; see Data sources below.`
            : ""),
        error: false,
      });
    } catch {
      setStatus({
        text: dataRef.current
          ? "Could not refresh. Showing the previous results. Please try again."
          : "Could not load version data. Please try again with the Refresh button.",
        error: true,
      });
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [startPulses]);

  const startTour = useCallback(() => {
    if (live.current.tourActive) return;
    // The Take the tour button lives in the settings panel, which the tour closes.
    const active = document.activeElement as HTMLElement | null;
    returnFocus.current = panelRef.current?.contains(active) ? settingsBtnRef.current : active;
    live.current.tourActive = true;
    setTourActive(true);
  }, []);

  const endTour = useCallback(() => {
    live.current.tourActive = false;
    setTourActive(false);
    save("tourSeen", "true");
    if (dataRef.current) startPulses(dataRef.current, previewDate(location.search) ?? Date.now()); // badges hidden behind the tour pulse now
    const back = returnFocus.current;
    const target = back && document.contains(back) && back.offsetParent !== null ? back : settingsBtnRef.current;
    target?.focus();
  }, [startPulses]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const preview = new URLSearchParams(location.search).has("now");
    live.current.previewing = preview;
    setPreviewing(preview);
    try {
      seenNew.current = new Set(JSON.parse(load("seenNew", "[]")));
    } catch {
      seenNew.current = new Set();
    }
    const forced = forcedDevice(location.search);
    (forced ? Promise.resolve(forced) : detect(navigator)).then(setDevice);
    loadData().then(() => {
      if (load("tourSeen", "false") !== "true") startTour();
    });
  }, [loadData, startTour]);

  const deviceResult = useMemo(() => (device && data ? evaluate(device, data.families) : null), [device, data]);

  // ---------- Pinned header ----------

  // The header bar is sticky and never changes height, so nothing here moves the layout.
  // Once the page scrolls the bar gets a glass background, and once the large title has
  // scrolled behind the bar, a compact title appears in it.
  useEffect(() => {
    const update = () => {
      setStuck(window.scrollY > 8);
      const title = titleRef.current;
      const header = headerRef.current;
      if (title && header) setShowTitle(title.getBoundingClientRect().bottom < header.offsetHeight);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // ---------- Settings panel (a non-modal popover) ----------

  useEffect(() => {
    if (!panelOpen) return;
    const onClick = (e: MouseEvent) => {
      if (live.current.tourActive) return;
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !settingsBtnRef.current?.contains(t)) setPanelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !live.current.tourActive) {
        setPanelOpen(false);
        settingsBtnRef.current?.focus();
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [panelOpen]);

  function togglePanel() {
    const open = !panelOpen;
    setPanelOpen(open);
    if (open) requestAnimationFrame(() => panelRef.current?.focus());
  }

  // Options changed by the user re-render without the pulse animation.
  function changeOptions(o: boolean, b: boolean) {
    setPulses({});
    setOptions(o, b);
  }

  // ---------- Tabs ----------

  const selectTab = useCallback((next: TabId) => {
    chose.current = true;
    setTab(next);
    save("tab", next);
    // Show #my-devices in the address bar without adding a history entry.
    history.replaceState(null, "", `${location.pathname}${location.search}${hashForTab(next)}`);
  }, []);

  // A link ending in #my-devices opens that tab, now and whenever the hash changes.
  useEffect(() => {
    const fromHash = () => {
      const t = tabFromHash(location.hash);
      if (t) {
        chose.current = true;
        setTab(t);
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  // Signed-in visitors return to the tab they used last. Signed-out visitors always start on
  // All versions, since My devices would only show them a sign-in prompt.
  useEffect(() => {
    if (isLoaded && isSignedIn && !chose.current && load("tab", "versions") === "devices") setTab("devices");
  }, [isLoaded, isSignedIn]);

  const ctx = { now, pulses };
  const sourceEntries = data ? Object.entries(data.sources) : [];
  const headerClass = ["site-header", stuck && "is-stuck", showTitle && "show-title", lift && "tour-lift"]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <div className="ambient" aria-hidden="true" />

      <header ref={headerRef} className={headerClass} id="site-header">
        <div className="header-inner">
          {/* Compact title, shown once the large title has scrolled away. Decorative: the h1 below is the real heading. */}
          <p className="bar-title" aria-hidden="true">
            Current Apple OS Versions
          </p>

          <div className="toolbar">
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button type="button" className="signin-btn" data-tip="Sign in or create an account with your email address, to save your devices.">
                  Sign in
                </button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <div className="user-slot">
                <UserButton appearance={{ elements: { avatarBox: { width: "1.9rem", height: "1.9rem" } } }} />
              </div>
            </Show>

            <button
              type="button"
              id="refresh"
              className={loading ? "icon-btn is-loading" : "icon-btn"}
              aria-disabled={loading}
              onClick={() => !loading && loadData()}
              data-tip="Reload the version data. Results are cached for up to an hour, so very recent releases may take a little while to appear."
            >
              <Icon name="refresh" />
              <span className="visually-hidden">Refresh versions</span>
            </button>

            <div className="settings-wrap">
              <button
                type="button"
                id="settings-btn"
                ref={settingsBtnRef}
                className="icon-btn"
                aria-expanded={panelOpen}
                aria-controls="settings-panel"
                aria-haspopup="dialog"
                onClick={togglePanel}
                data-tip="Settings: theme, text size, and which versions to show."
              >
                <Icon name="settings" />
                <span className="visually-hidden">Settings</span>
              </button>

              <div
                id="settings-panel"
                ref={panelRef}
                className="settings-panel glass"
                role="dialog"
                aria-labelledby="settings-title"
                tabIndex={-1}
                hidden={!panelOpen}
                onBlur={(e) => {
                  // Tabbing out of the panel closes it, so it never lingers over the page.
                  const to = e.relatedTarget as Node | null;
                  if (tourActive || !to) return;
                  if (!panelRef.current?.contains(to) && to !== settingsBtnRef.current) setPanelOpen(false);
                }}
              >
                <h2 id="settings-title">Settings</h2>

                <div className="control-group" id="tour-theme">
                  <fieldset>
                    <legend>Theme</legend>
                    <div className="segmented">
                      {(
                        [
                          ["light", "Light", "Light theme: dark text on a light background."],
                          ["dark", "Dark", "Dark theme: light text on a dark background, easier on the eyes at night."],
                          ["terminal", "Terminal", "Terminal theme: green monospace text on black, like a command line."],
                        ] as [Theme, string, string][]
                      ).map(([value, label, tipText]) => (
                        <label key={value} data-tip={tipText}>
                          <input
                            type="radio"
                            name="theme"
                            value={value}
                            checked={theme === value}
                            onChange={() => setTheme(value)}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>

                <div className="control-group" id="tour-size">
                  <fieldset>
                    <legend>Text size</legend>
                    <div className="segmented">
                      <button
                        type="button"
                        aria-label="Decrease text size"
                        aria-disabled={size === SIZES[0]}
                        onClick={() => size !== SIZES[0] && setSize(size - 1)}
                        data-tip="Make text smaller."
                      >
                        A&minus;
                      </button>
                      <button
                        type="button"
                        aria-label="Reset text size to default"
                        onClick={() => setSize(0)}
                        data-tip="Return text to its default size."
                      >
                        A
                      </button>
                      <button
                        type="button"
                        aria-label="Increase text size"
                        aria-disabled={size === SIZES[SIZES.length - 1]}
                        onClick={() => size !== SIZES[SIZES.length - 1] && setSize(size + 1)}
                        data-tip="Make text larger."
                      >
                        A+
                      </button>
                    </div>
                  </fieldset>
                </div>

                <div className="control-group" id="tour-options">
                  <fieldset>
                    <legend>Show</legend>
                    <label
                      className="check"
                      data-tip="Include versions older than the three newest major releases. Apple no longer updates these."
                    >
                      <input type="checkbox" checked={older} onChange={(e) => changeOptions(e.target.checked, beta)} />{" "}
                      Older (unsupported) versions
                    </label>
                    <label
                      className="check"
                      data-tip="Include the newest beta or release candidate, when Apple has one in testing."
                    >
                      <input type="checkbox" checked={beta} onChange={(e) => changeOptions(older, e.target.checked)} />{" "}
                      Beta versions
                    </label>
                  </fieldset>
                </div>

                <div className="control-group">
                  <button type="button" id="tour-start" onClick={startTour} data-tip="Replay the guided tour of this page.">
                    Take the tour
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="hero">
        <h1 id="page-title" ref={titleRef}>
          Current Apple OS Versions
        </h1>
        <p className="lead">Latest released versions of Apple&apos;s operating systems, with betas when available.</p>
      </div>

      <main>
        <div id="device-status" className="device-status" role="status" hidden={!deviceResult} data-kind={deviceResult?.kind}>
          <span id="device-icon" className="device-icon" aria-hidden="true">
            {deviceResult ? DEVICE_ICONS[deviceResult.kind] : ""}
          </span>
          <p id="device-text">{deviceResult?.message}</p>
        </div>

        <ViewTabs tab={tab} onSelect={selectTab} count={isSignedIn ? deviceCount : null} />

        <div id="content" tabIndex={-1}>
          {/* Both panels stay in the page; the hidden one is only not displayed, so switching is instant
              and anything half-typed in the My devices form is still there on return. */}
          <div id="panel-versions" className="tab-panel" role="tabpanel" aria-labelledby="tab-versions" hidden={tab !== "versions"}>
            <p id="status" className={status.error ? "status error" : "status"} role="status" aria-live="polite">
              {status.text}
            </p>

            {/* First-load spinner. Decorative: the status line above announces "Loading versions…". */}
            <div id="loading" className="loading" aria-hidden="true" hidden={!loading || data !== null}>
              <Spinner />
            </div>

            <section id="results" className="results" aria-label="Apple OS versions" tabIndex={-1}>
              {data?.families.map((f, i) => (
                <Card
                  key={f.name}
                  family={f}
                  older={older}
                  showBeta={beta}
                  ctx={ctx}
                  onShowDevices={setDevicesTarget}
                  tourId={i === 0 ? "tour-supported-devices" : undefined}
                />
              ))}
            </section>

            <section id="source-info" className="source-info" hidden={!data}>
              <h2>Data sources</h2>
              <ul id="source-list">
                {sourceEntries.map(([name, state]) => (
                  <li key={name}>{`${name}: ${state === "ok" ? "working" : state}`}</li>
                ))}
              </ul>
            </section>
          </div>

          <div id="panel-devices" className="tab-panel" role="tabpanel" aria-labelledby="tab-devices" hidden={tab !== "devices"}>
            <MyDevicesSection onCount={setDeviceCount} />
          </div>
        </div>
      </main>

      <footer className="site-footer">
        <p>
          Data comes from endoflife.date, Apple&apos;s developer release feed, and{" "}
          <a href="https://appledb.dev">AppleDB</a> (MIT licensed), which supplies betas, release candidates, and which
          devices each version runs on. This is an unofficial tool and is not affiliated with Apple. The device check
          runs in your browser; nothing about your device is sent anywhere.
        </p>
      </footer>

      <DevicesDialog target={devicesTarget} onClose={() => setDevicesTarget(null)} />

      {tip.bubble}

      {tourActive && (
        <Tour
          settings={settings}
          tab={tab}
          setTab={setTab}
          signedIn={!!isSignedIn}
          panelOpen={panelOpen}
          setPanelOpen={setPanelOpen}
          setLift={setLift}
          tip={tip}
          onEnd={endTour}
        />
      )}
    </>
  );
}
