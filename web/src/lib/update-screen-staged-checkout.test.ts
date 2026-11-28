import { describe, expect, it } from "vitest";

import type { UpdateCrewMember, UpdateRun, UpdateRunState } from "./types";
import type { UpdateClaim } from "./update-ribbon";
import { updateScreenView, type UpdateScreenCrewRun, type UpdateScreenInput } from "./update-screen";

// A staged checkout records its run with the folder names, `v2.17.2` → `v2.17.3`.
const NOW = 1_800_000_000_000;
const FROM = "2.17.2";
const TO = "2.17.3";

const CLAIM: UpdateClaim = {
  startedAt: NOW - 10_000,
  runId: "run-1",
  target: TO,
  peersOnly: false,
  bundleAtStart: "bundle-a",
  skipped: [],
  lead: "lodge",
  members: ["workshop"],
  lastPhase: null,
};

const CREW: UpdateCrewMember[] = [{ name: "workshop", version: FROM, verdict: "green", reasons: [], asOf: NOW - 3_000 }];

const run = (state: UpdateRunState, over: Partial<UpdateRun> = {}): UpdateRun => ({
  schema: 2,
  state,
  from: `v${FROM}`,
  to: `v${TO}`,
  startedAt: NOW - 10_000,
  updatedAt: NOW - 5_000,
  pid: 4242,
  attempt: 0,
  runId: "run-1",
  ...over,
});

const read = (over: Partial<UpdateScreenInput> = {}) =>
  updateScreenView({
    run: undefined,
    crew: CREW,
    leadName: "lodge",
    stage: "idle",
    progress: null,
    installingSince: null,
    startedHere: true,
    controllerChangedAt: null,
    released: false,
    now: NOW,
    claim: CLAIM,
    bundle: { id: "bundle-a", version: FROM },
    serverStale: false,
    ...over,
  });

describe("updateScreenView: a staged checkout's v-prefixed run", () => {
  it("keeps step 6 open on the old bundle instead of ticking This phone", () => {
    const view = read({
      run: run("done", {
        peers: [{ name: "workshop", state: "done", version: TO, updatedAt: NOW - 1_000 }],
        settledAt: NOW - 1_000,
        updatedAt: NOW - 1_000,
      }),
      serverStale: true,
    });
    expect(view.phase).toBe("phone");
    expect(view.step).toBe(6);
    expect(view.kickPhone).toBe(true);
    expect(view.target).toBe(TO);
    expect(view.from).toBe(FROM);
  });

  it("finishes a rollback once the phone runs the bare version it went back to", () => {
    const view = read({
      claim: { ...CLAIM, target: FROM, bundleAtStart: null, rollback: true },
      run: run("done", { from: `v${TO}`, to: `v${FROM}`, action: "rollback" }),
      crew: [{ name: "workshop", version: FROM, verdict: "green", reasons: [], asOf: NOW }],
    });
    expect(view.phase).toBe("done");
  });

  it("shows a member still on the old version as queued, not ok", () => {
    const view = read({ run: run("staging") });
    expect(view.rows.find((r) => r.key === "peer:workshop")?.status).toBe("queued");
  });

  it("follows the crew run whose bare target matches the run's", () => {
    const crewRun: UpdateScreenCrewRun = {
      legs: [{ name: "workshop", state: "updating", version: FROM, updatedAt: NOW - 1_000 }],
      settledAt: null,
      to: TO,
      current: FROM,
    };
    const view = read({ run: run("done", { updatedAt: NOW - 1_000 }), crewRun });
    expect(view.phase).toBe("members");
    expect(view.rows.find((r) => r.key === "peer:workshop")?.status).toBe("active");
  });
});
