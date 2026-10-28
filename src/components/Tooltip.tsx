"use client";

import { useCallback, useEffect, useRef, type ReactElement } from "react";

/**
 * Shared tooltip bubble. Any element with a `data-tip` attribute shows its text on
 * hover or keyboard focus. The bubble and the aria-describedby link are managed
 * directly on the DOM, as in the original page, because they are driven by
 * document-level events rather than React state.
 */
export function useTooltip(): {
  show: (host: HTMLElement, control: Element) => void;
  hide: () => void;
  bubble: ReactElement;
} {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const ownerRef = useRef<Element | null>(null);

  const hide = useCallback(() => {
    const owner = ownerRef.current;
    if (!owner) return;
    const ids = (owner.getAttribute("aria-describedby") || "").split(" ").filter((i) => i && i !== "tooltip");
    if (ids.length) owner.setAttribute("aria-describedby", ids.join(" "));
    else owner.removeAttribute("aria-describedby");
    ownerRef.current = null;
    if (bubbleRef.current) bubbleRef.current.hidden = true;
  }, []);

  const show = useCallback(
    (host: HTMLElement, control: Element) => {
      const tip = bubbleRef.current;
      if (!tip) return;
      hide();
      ownerRef.current = control;
      tip.textContent = host.dataset.tip ?? "";
      tip.hidden = false;
      const r = host.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - t.width - 8));
      const below = r.bottom + 8;
      const top = below + t.height > window.innerHeight ? Math.max(8, r.top - t.height - 8) : below;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      const ids = (control.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
      if (!ids.includes("tooltip")) control.setAttribute("aria-describedby", ids.concat("tooltip").join(" "));
    },
    [hide],
  );

  useEffect(() => {
    const tip = bubbleRef.current;
    if (!tip) return;
    const hostOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-tip]") : null);
    // For labels, describe the form control inside them.
    const controlOf = (host: HTMLElement) =>
      host.matches("label") ? host.querySelector("input") || host : host;

    const onEnter = (e: Event) => {
      const host = hostOf(e.target);
      if (host) show(host, controlOf(host));
    };
    const onLeave = (e: MouseEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && (tip.contains(to) || hostOf(e.target)?.contains(to))) return;
      hide();
    };
    const onTipLeave = (e: MouseEvent) => {
      if (!hostOf(e.relatedTarget)) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !tip.hidden) hide();
    };

    document.addEventListener("mouseover", onEnter);
    document.addEventListener("focusin", onEnter);
    document.addEventListener("mouseout", onLeave);
    document.addEventListener("focusout", hide);
    tip.addEventListener("mouseleave", onTipLeave);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseover", onEnter);
      document.removeEventListener("focusin", onEnter);
      document.removeEventListener("mouseout", onLeave);
      document.removeEventListener("focusout", hide);
      tip.removeEventListener("mouseleave", onTipLeave);
      document.removeEventListener("keydown", onKey);
    };
  }, [show, hide]);

  return { show, hide, bubble: <div id="tooltip" ref={bubbleRef} className="tooltip" role="tooltip" hidden /> };
}
