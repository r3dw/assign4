"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { groupByCategory, type OsDevices } from "@/lib/osDevices";

export interface DevicesTarget {
  family: string;
  major: number;
  /** What to call it in the title, e.g. "iOS 26" or "HomePod 27". */
  label: string;
}

type Result = { key: string; data?: OsDevices; error?: string };

function versionRange(first: string, last: string): string {
  return first === last ? first : `${first} to ${last}`;
}

/**
 * A modal listing the devices that can run one major version of an OS. It uses the native
 * <dialog> element, so focus is trapped inside, Escape closes it, and focus goes back to the
 * button that opened it.
 */
export function DevicesDialog({ target, onClose }: { target: DevicesTarget | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [filter, setFilter] = useState("");

  const key = target ? `${target.family}|${target.major}` : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !target || !key) return;
    if (!dialog.open) dialog.showModal();
    let cancelled = false;
    fetch(`/api/os-devices?family=${encodeURIComponent(target.family)}&major=${target.major}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`The server returned ${res.status}`);
        return (await res.json()) as OsDevices;
      })
      .then((data) => !cancelled && setResult({ key, data }))
      .catch((e: unknown) => !cancelled && setResult({ key, error: e instanceof Error ? e.message : "Request failed" }));
    return () => {
      cancelled = true;
    };
  }, [target, key]);

  const loaded = result && result.key === key ? result : null;
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = loaded?.data?.devices ?? [];
    return groupByCategory(q ? all.filter((d) => d.name.toLowerCase().includes(q)) : all);
  }, [loaded, filter]);
  const total = loaded?.data?.devices.length ?? 0;
  const shown = groups.reduce((n, g) => n + g.devices.length, 0);

  function close() {
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      className="devices-dialog"
      aria-labelledby="devices-title"
      onClose={() => {
        setFilter("");
        onClose();
      }}
      // A click on the backdrop (the dialog element itself, outside its content) closes it.
      onClick={(e) => e.target === dialogRef.current && close()}
    >
      {target && (
        <>
          <div className="dd-head">
            <div>
              <h2 id="devices-title">{target.label} supported devices</h2>
              <p className="dd-sub" role="status">
                {loaded?.error
                  ? ""
                  : !loaded
                    ? "Loading…"
                    : `${total} ${total === 1 ? "device" : "devices"} can run ${target.label}${
                        loaded.data?.codename ? ` (${loaded.data.codename})` : ""
                      }. Versions shown are the first and last ${target.label} release for each.`}
              </p>
            </div>
            <button type="button" onClick={close} aria-label="Close">
              Close
            </button>
          </div>

          <div className="dd-body">
            {loaded?.error && <p className="status error">Could not load the device list ({loaded.error}). Please try again.</p>}
            {loaded?.data && total > 0 && (
              <>
                <label className="dd-filter">
                  <span className="visually-hidden">Filter devices by name</span>
                  <input
                    type="search"
                    placeholder="Filter devices"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </label>
                {shown === 0 && <p className="dd-empty">No devices match &ldquo;{filter}&rdquo;.</p>}
                {groups.map((g) => (
                  <section key={g.category} className="dd-group" aria-label={g.category}>
                    <h3>
                      {g.category} <span className="dd-count">({g.devices.length})</span>
                    </h3>
                    <ul>
                      {g.devices.map((d) => (
                        <li key={d.name}>
                          <span>{d.name}</span>
                          <span className="dd-range">{versionRange(d.first, d.last)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </>
            )}
            {loaded?.data && total === 0 && <p className="dd-empty">No device information is available for {target.label} yet.</p>}
          </div>
        </>
      )}
    </dialog>
  );
}
