import type { CSSProperties, ReactNode } from "react";
import {
  betaKey,
  cycleKey,
  formatDate,
  headBeta,
  newness,
  osName,
  visibleCycles,
} from "@/lib/format";
import type { Beta, FamilyResult } from "@/lib/versions";
import { Icon } from "./Icon";

interface BadgeContext {
  now: number;
  /** key -> animation delay (ms) for badges that should pulse */
  pulses: Record<string, number>;
}

function NewBadge({ itemKey, date, ctx }: { itemKey: string; date: string; ctx: BadgeContext }) {
  const when = newness(date, ctx.now);
  if (!when) return null;
  const delay = ctx.pulses[itemKey];
  const pulse = delay !== undefined;
  const style: CSSProperties | undefined = pulse ? { animationDelay: `${delay}ms` } : undefined;
  return (
    <span className={pulse ? "badge badge-new pulse" : "badge badge-new"} style={style}>
      New<span className="visually-hidden">, released {when}</span>
    </span>
  );
}

/** "Beta  27.2 RC, build 26B118, Oct 19, 2026" plus a New badge when it is recent. */
function BetaContent({ family, b, ctx }: { family: string; b: Beta; ctx: BadgeContext }): ReactNode {
  const build = b.build ? `, build ${b.build}` : "";
  return (
    <>
      <span className="badge">Beta</span>
      {` ${b.version} ${b.label}${build}, ${formatDate(b.date)}`}
      <NewBadge itemKey={betaKey(family, b)} date={b.date} ctx={ctx} />
    </>
  );
}

export function Card({
  family,
  older,
  showBeta,
  ctx,
}: {
  family: FamilyResult;
  older: boolean;
  showBeta: boolean;
  ctx: BadgeContext;
}) {
  const [latest, ...others] = visibleCycles(family, older);
  const hb = headBeta(family, latest);

  return (
    <article className="card glass">
      <div className="card-head">
        <h3>{family.name}</h3>
        <span className="device-tile" aria-hidden="true">
          <Icon name={family.name} className={family.name === "iPadOS" ? "landscape" : ""} />
        </span>
      </div>
      <p className="latest">
        {latest.version}
        <NewBadge itemKey={cycleKey(family.name, latest.version)} date={latest.date} ctx={ctx} />
      </p>
      <p className="meta">{latest.date ? `Released ${formatDate(latest.date)}` : "Release date not available"}</p>

      {showBeta && hb && (
        <p className="beta-line">
          <BetaContent family={family.name} b={hb} ctx={ctx} />
        </p>
      )}

      {others.length > 0 && (
        <table>
          <caption>Other versions</caption>
          <thead className="visually-hidden">
            <tr>
              <th scope="col">Release line</th>
              <th scope="col">Latest version</th>
              <th scope="col">Released</th>
            </tr>
          </thead>
          <tbody>
            {others.flatMap((c) => {
              const label = `${osName(family.name)} ${c.cycle}`;
              const rows = [
                <tr key={c.cycle} className={c.supported ? undefined : "older"}>
                  <th scope="row">{c.supported ? label : `${label} (older)`}</th>
                  <td className="num">
                    {c.version}
                    <NewBadge itemKey={cycleKey(family.name, c.version)} date={c.date} ctx={ctx} />
                  </td>
                  <td>{formatDate(c.date)}</td>
                </tr>,
              ];
              if (showBeta && c.beta) {
                rows.push(
                  <tr key={`${c.cycle}-beta`} className="beta-row">
                    <td colSpan={3}>
                      <BetaContent family={family.name} b={c.beta} ctx={ctx} />
                    </td>
                  </tr>,
                );
              }
              return rows;
            })}
          </tbody>
        </table>
      )}
    </article>
  );
}
