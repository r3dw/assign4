"use client";

import { Show, SignInButton } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  MAX_NICKNAME_LENGTH,
  MAX_SAVED_DEVICES,
  catalogCategories,
  deviceLabel,
  devicesByType,
  osRange,
  type CatalogDevice,
  type MyDevice,
} from "@/lib/myDevices";

type Message = { text: string; error: boolean };

async function errorText(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

/** The signed-in view: the saved devices and a form to add more. */
function SavedDevices() {
  const [catalog, setCatalog] = useState<CatalogDevice[] | null>(null);
  const [saved, setSaved] = useState<MyDevice[] | null>(null);
  const [limit, setLimit] = useState(MAX_SAVED_DEVICES);
  const [category, setCategory] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  // Fetching and storing are separate so the effect below can call setState from a callback.
  const fetchSaved = useCallback(async () => {
    const res = await fetch("/api/my-devices", { cache: "no-store" });
    if (!res.ok) throw new Error(await errorText(res, "Could not load your devices"));
    return (await res.json()) as { devices: MyDevice[]; limit: number };
  }, []);

  const loadSaved = useCallback(async () => {
    const body = await fetchSaved();
    setSaved(body.devices);
    setLimit(body.limit);
  }, [fetchSaved]);

  useEffect(() => {
    fetch("/api/devices")
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorText(res, "Could not load the device list"));
        setCatalog(((await res.json()) as { devices: CatalogDevice[] }).devices);
      })
      .catch((e: Error) => setMessage({ text: e.message, error: true }));
    fetchSaved()
      .then((body) => {
        setSaved(body.devices);
        setLimit(body.limit);
      })
      .catch((e: Error) => setMessage({ text: e.message, error: true }));
  }, [fetchSaved]);

  const categories = useMemo(() => (catalog ? catalogCategories(catalog) : []), [catalog]);
  const groups = useMemo(() => (catalog && category ? devicesByType(catalog, category) : []), [catalog, category]);
  const full = saved !== null && saved.length >= limit;

  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!deviceId) {
      setMessage({ text: category ? "Choose a device first." : "Choose a category and a device first.", error: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/my-devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: Number(deviceId), nickname }),
      });
      if (!res.ok) throw new Error(await errorText(res, "Could not save the device"));
      const name = catalog?.find((d) => String(d.id) === deviceId)?.name ?? "Device";
      await loadSaved();
      setDeviceId("");
      setNickname("");
      setMessage({ text: `Saved ${name}.`, error: false }); // the category stays, to add several devices quickly
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  async function remove(device: MyDevice) {
    const label = device.nickname ? `${device.nickname} (${device.name})` : device.name;
    setMessage(null);
    try {
      const res = await fetch(`/api/my-devices?id=${encodeURIComponent(device.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await errorText(res, "Could not remove the device"));
      await loadSaved();
      setMessage({ text: `Removed ${label}.`, error: false });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  }

  return (
    <>
      <p className="meta">
        Save your devices to see the oldest and newest Apple OS each one can run. Your list is private to your account
        and is remembered the next time you sign in.
      </p>

      <p className={message?.error ? "status error" : "status"} role="status" aria-live="polite">
        {message?.text ?? (saved === null ? "Loading your devices…" : "")}
      </p>

      {saved !== null && saved.length === 0 && <p className="md-empty">You haven&apos;t saved any devices yet.</p>}

      {saved !== null && saved.length > 0 && (
        <ul className="md-list">
          {saved.map((d) => {
            const { oldest, newest } = osRange(d);
            return (
              <li key={d.id} className="md-item">
                <div className="md-main">
                  <h3>{d.nickname ?? d.name}</h3>
                  {d.nickname && <p className="md-model">{d.name}</p>}
                  <p className="md-os">
                    Newest OS it can run: <strong>{newest}</strong>
                    <span className="md-sep" aria-hidden="true"> &middot; </span>
                    <span className="md-oldest">Oldest: {oldest}</span>
                  </p>
                  <p className={d.max_os_is_supported ? "md-ok" : "md-warn"}>
                    <span aria-hidden="true">{d.max_os_is_supported ? "✓ " : "⚠ "}</span>
                    {d.max_os_is_supported
                      ? "Its newest OS still receives updates from Apple."
                      : "Its newest OS no longer receives updates from Apple."}
                  </p>
                </div>
                <button type="button" onClick={() => remove(d)} aria-label={`Remove ${d.nickname ?? d.name}`}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form className="md-form" onSubmit={add}>
        <h3>Add a device</h3>
        <label>
          <span>Category</span>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setDeviceId("");
            }}
            disabled={!catalog || full}
          >
            <option value="">{catalog ? "Choose a category\u2026" : "Loading devices\u2026"}</option>
            {categories.map((c) => (
              <option key={c.category} value={c.category}>
                {c.category} ({c.count})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Device (newest first)</span>
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={!category || full}>
            <option value="">{category ? "Choose a device\u2026" : "Choose a category first"}</option>
            {groups.map((g) => {
              const options = g.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {deviceLabel(d)}
                </option>
              ));
              return g.label ? (
                <optgroup key={g.label} label={g.label}>
                  {options}
                </optgroup>
              ) : (
                options
              );
            })}
          </select>
        </label>
        <label>
          <span>Nickname (optional)</span>
          <input
            type="text"
            value={nickname}
            maxLength={MAX_NICKNAME_LENGTH}
            placeholder="For example, Mom's iPad"
            onChange={(e) => setNickname(e.target.value)}
            disabled={full}
          />
        </label>
        <button type="submit" className="primary" aria-disabled={busy || full}>
          Add device
        </button>
        {full && <p className="md-warn">You&apos;ve reached the limit of {limit} saved devices. Remove one to add another.</p>}
      </form>
    </>
  );
}

/** The "My devices" section: the saved list when signed in, a sign-in prompt otherwise. */
export function MyDevicesSection() {
  return (
    <section id="my-devices" className="my-devices card glass" aria-labelledby="my-devices-title">
      <h2 id="my-devices-title">My devices</h2>
      <Show when="signed-in">
        <SavedDevices />
      </Show>
      <Show when="signed-out">
        <p className="meta">
          Sign in with your email address to save your devices and see the newest Apple OS each one can run. Nothing is
          required to browse the versions above.
        </p>
        <SignInButton mode="modal">
          <button type="button" className="primary">
            Sign in to save devices
          </button>
        </SignInButton>
      </Show>
    </section>
  );
}
