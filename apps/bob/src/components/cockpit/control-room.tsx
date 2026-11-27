"use client";

import { beatLine, beatTone } from "@bob/arcade";
import type { ControlRoomFeed, Hud } from "@bob/arcade";
import "./control-room.css";

export function ControlRoom({
  feed,
  status,
  live,
  counts,
  today,
  waiting,
}: {
  feed: ControlRoomFeed;
  status: string;
  live: boolean;
  counts: Hud;
  today: number | null;
  waiting: boolean;
}) {
  const ciTone = feed.ci && beatTone(feed.ci);
  const stats = [
    ["Agents", counts.agents],
    ["In CI", counts.ci],
    ["In flight", counts.inFlight],
    ["Needs you", counts.needsYou],
    ["Stalled", counts.stalled],
    ["Deploying", counts.deploying],
    ["Shipped", counts.shipped],
    ["Failed", counts.failed],
    ["Shipped today · all projects", today],
  ] as const;
  return (
    <>
      <header className="arcade-marquee">
        <div className="arcade-heading">
          <span className="arcade-connection" data-live={live}>
            {status}
          </span>
          <h2>Bob Arcade</h2>
          <p aria-live="polite">
            {feed.events[0]
              ? beatLine(feed.events[0])
              : live
                ? "Waiting for floor activity"
                : "Waiting for the live feed"}
          </p>
        </div>
        <div className="arcade-workshop" aria-hidden="true">
          {live && feed.agent && <i key={feed.agent.id} className="arcade-plate terminal" />}
          {live && feed.ci && <i key={feed.ci.id} className="arcade-plate rack" data-tone={ciTone} />}
          {live && feed.shipment && <i key={feed.shipment.id} className="arcade-plate dispatch" />}
        </div>
      </header>
      <dl className="arcade-stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{waiting || value === null ? "–" : value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
