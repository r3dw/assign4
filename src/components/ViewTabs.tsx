"use client";

import type { KeyboardEvent } from "react";
import { nextTabForKey, TAB_ORDER, type TabId } from "@/lib/tabs";
import { Icon } from "./Icon";

const LABELS: Record<TabId, { text: string; icon: string; tip: string }> = {
  versions: { text: "All versions", icon: "grid", tip: "Every Apple operating system and its newest version." },
  devices: { text: "My devices", icon: "iOS", tip: "Devices you have saved, with the newest OS each one can run." },
};

/**
 * A pill-shaped switch between the two views. The highlight slides between the tabs (CSS only,
 * driven by data-active). It follows the standard tabs pattern: arrow keys, Home and End move
 * between tabs, and only the selected tab is in the tab order.
 */
export function ViewTabs({
  tab,
  onSelect,
  count,
}: {
  tab: TabId;
  onSelect: (tab: TabId) => void;
  /** Number of saved devices, shown beside "My devices" when signed in. */
  count: number | null;
}) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = nextTabForKey(e.key, tab);
    if (!next) return;
    e.preventDefault();
    onSelect(next);
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
  }

  return (
    <div id="tabs" className="tabs" role="tablist" aria-label="View" data-active={tab} onKeyDown={onKeyDown}>
      <span className="tabs-thumb" aria-hidden="true" />
      {TAB_ORDER.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`tab-${id}`}
          className="tab"
          aria-selected={tab === id}
          aria-controls={`panel-${id}`}
          tabIndex={tab === id ? 0 : -1}
          onClick={() => onSelect(id)}
          data-tip={LABELS[id].tip}
        >
          <Icon name={LABELS[id].icon} />
          <span>{LABELS[id].text}</span>
          {id === "devices" && count !== null && (
            <span className="tab-count">
              {count}
              <span className="visually-hidden"> saved {count === 1 ? "device" : "devices"}</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
