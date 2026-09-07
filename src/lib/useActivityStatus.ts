import { useEffect, useState } from "react";
import type { ActivityStatus } from "../domain/activities";
import { activityStatusGet, listenEvent } from "./tauri";

export function useActivityStatus() {
  const [status, setStatus] = useState<ActivityStatus | null>(null);
  useEffect(() => {
    let active = true;
    let eventReceived = false;
    let dispose: (() => void) | undefined;
    void listenEvent<ActivityStatus>("runtime://activity-status", (next) => {
      eventReceived = true;
      if (active) setStatus(next);
    })
      .then(async (unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        dispose = unlisten;
        const initial = await activityStatusGet();
        if (active && !eventReceived) setStatus(initial);
      })
      .catch(() => {
        if (active && !eventReceived) setStatus({ state: "unavailable" });
      });
    return () => {
      active = false;
      dispose?.();
    };
  }, []);
  return status;
}
