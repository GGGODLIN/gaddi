import { useMemo, useState } from "react";

import { LaunchRow, PaneRow, Section, type ThreadSidebarProps } from "@/components/agent-sidebar";
import { SessionFilterEmpty, SessionFilterField } from "@/components/session-filter-field";
import { TRICK_ROW_DRAWN, TrickSessionRow } from "@/components/trick-session";
import { useLocale } from "@/hooks/use-locale";
import { pinnedRows } from "@/lib/dash-view";
import { paneRowKey } from "@/lib/hosts";
import { t } from "@/lib/i18n";
import { useLastViewedShortcut } from "@/lib/last-viewed";
import { byScore, filterOffered, matchPanes, PANE_FILTER, type PaneField } from "@/lib/pane-filter";
import { groupPanesByWorkspace } from "@/lib/pane-groups";
import { toggleFoldedParent, triageTrees, useFoldedParents } from "@/lib/pane-tree";
import { pinMatcher, type Pin } from "@/lib/pins";
import { isTrickPane } from "@/lib/tricks/places";
import type { AgentStatus, AgentView, Launcher } from "@/lib/types";
import { cn } from "@/lib/utils";

export type AttentionSwitcherProps = Omit<ThreadSidebarProps, "order" | "onOrderChange" | "highlightedKey">;

const NO_PANES: AgentView[] = [];
const NO_LAUNCHERS: readonly Launcher[] = [];
const NO_PINS: readonly Pin[] = [];
const NO_FOLDED: ReadonlySet<string> = new Set();
const DRAWN: ReadonlySet<PaneField> = new Set<PaneField>(["name", "space", "tab", "account"]);
const MARK = {
  needs: "blocked",
  ready: "done",
  working: "working",
  recent: "idle",
} as const satisfies Record<string, AgentStatus>;

/** The callers freeze the pane arrays when this sheet opens, so a poll cannot move a row under a tap. */
export function AttentionSwitcher({
  agents,
  shellPanes = NO_PANES,
  currentPaneKey,
  onSelect,
  trickSessions = NO_PANES,
  onSelectTrick,
  tabs,
  servers,
  workspaces,
  scope,
  sessions,
  shellsOpen = true,
  onShellsOpenChange,
  pins = NO_PINS,
  launchers = NO_LAUNCHERS,
  launchersHome = "",
  onLaunch,
  launching,
  launchRefusal,
  launchOpen = true,
  onLaunchOpenChange,
  className,
  roomy = false,
  filterLevel = PANE_FILTER.level,
  filterOrder = PANE_FILTER.order,
  filterHidden = PANE_FILTER.hidden,
  filterClassName = "top-0",
  initialQuery = "",
  filter = true,
}: AttentionSwitcherProps) {
  useLocale();
  const folded = useFoldedParents();
  const allPanes = useMemo(() => [...agents, ...shellPanes], [agents, shellPanes]);
  const lastViewed = useLastViewedShortcut(true, allPanes, currentPaneKey);
  const tricks = onSelectTrick === undefined ? NO_PANES : trickSessions;
  const [query, setQuery] = useState(initialQuery);
  const total = allPanes.length + tricks.length;
  const offered = filter && filterOffered(total);
  const activeQuery = offered ? query : "";
  const hits = useMemo(() => {
    const options = { level: filterLevel, hidden: filterHidden, ctx: { servers } };
    const paneHits = matchPanes(allPanes, activeQuery, { ...options, drawn: DRAWN });
    if (paneHits === null || tricks.length === 0) return paneHits;
    const trickHits = matchPanes(tricks, activeQuery, { ...options, drawn: TRICK_ROW_DRAWN });
    return new Map([...paneHits, ...(trickHits ?? [])]);
  }, [allPanes, tricks, activeQuery, filterLevel, filterHidden, servers]);

  const last = hits === null ? lastViewed : undefined;
  const lastKey = last === undefined ? null : paneRowKey(last);
  const isPinned = pinMatcher(pins);
  const grouped = groupPanesByWorkspace(agents, shellPanes, { order: "fixed", tabs, servers, workspaces, scope, sessions });
  const keep = (pane: AgentView) => hits === null || hits.has(paneRowKey(pane));
  const pinned = pinnedRows(grouped, isPinned).filter((pane) => paneRowKey(pane) !== lastKey && keep(pane));
  const attentionAgents = agents.filter((pane) => !isPinned(pane) && paneRowKey(pane) !== lastKey);
  const sections = triageTrees(attentionAgents, hits === null ? folded : NO_FOLDED)
    .toSorted((a, b) => Number(a.section.key === "working") - Number(b.section.key === "working"))
    .map((group) => ({ section: group.section, count: group.count, rows: group.rows.filter((entry) => keep(entry.pane)) }));
  const shells = shellPanes.filter((pane) => !isPinned(pane) && paneRowKey(pane) !== lastKey && keep(pane));
  const trickRows = tricks.filter(keep);
  const best = hits !== null && filterOrder === "best" ? byScore([...allPanes, ...tricks], hits) : null;
  const shown = best ?? [
    ...(last === undefined ? [] : [last]),
    ...pinned,
    ...sections.flatMap((group) => group.rows.map((entry) => entry.pane)),
    ...shells,
    ...trickRows,
  ];
  const row = (pane: AgentView) => isTrickPane(pane) ? (
    <TrickSessionRow key={paneRowKey(pane)} pane={pane} variant="switch" active={paneRowKey(pane) === currentPaneKey} onOpen={(p) => onSelectTrick?.(p)} match={hits?.get(paneRowKey(pane))} />
  ) : (
    <PaneRow key={paneRowKey(pane)} pane={pane} active={paneRowKey(pane) === currentPaneKey} onSelect={onSelect} roomy={roomy} match={hits?.get(paneRowKey(pane))} />
  );
  const showLaunch = launchers.length > 0 && onLaunch !== undefined;
  if (total === 0 && !showLaunch) {
    return <div className="px-4 py-12 text-center text-sm text-muted-foreground">{t("home.empty.noAgents")}</div>;
  }

  return (
    <div className={cn("flex flex-col px-2 py-3", roomy ? "gap-6" : "gap-4", className)}>
      {offered && (
        <SessionFilterField
          query={query}
          onQuery={setQuery}
          shown={shown.length}
          total={total}
          onGo={() => {
            const first = hits === null ? undefined : shown[0];
            if (first === undefined) return;
            if (isTrickPane(first)) onSelectTrick?.(first);
            else onSelect(first);
          }}
          className={cn("sticky z-10 border-b border-rule bg-card py-2", filterClassName)}
        />
      )}
      {best !== null ? best.map(row) : (
        <>
          {last !== undefined && (
            <Section roomy={roomy} id="switch-last-viewed" headingId="switch-last-viewed-heading" label={t("chat.switcher.lastViewed")}>
              {row(last)}
            </Section>
          )}
          {pinned.length > 0 && (
            <Section roomy={roomy} id="switch-pinned" headingId="switch-pinned-heading" label={t("home.pinned.title")}>
              {pinned.map(row)}
            </Section>
          )}
          {sections.map(({ section, rows, count }) => {
            if (rows.length === 0) return null;
            return (
              <Section key={section.key} roomy={roomy} id={`switch-${section.key}`} label={section.label} count={hits === null ? count : rows.length} mark={MARK[section.key]} {...(section.accent !== undefined ? { accent: section.accent } : {})}>
                {rows.map((entry) => {
                  const key = paneRowKey(entry.pane);
                  return <PaneRow key={key} pane={entry.pane} active={key === currentPaneKey} onSelect={onSelect} roomy={roomy} match={hits?.get(key)} tree={entry} onToggleFold={hits === null && entry.childCount > 0 ? () => toggleFoldedParent(key) : undefined} />;
                })}
              </Section>
            );
          })}
          {shells.length > 0 && (
            <Section roomy={roomy} id="switch-shells" label={t("home.sidebar.shells")} count={shells.length} dot="bg-status-unknown" {...(onShellsOpenChange && hits === null ? { open: shellsOpen, onToggle: onShellsOpenChange } : {})}>
              {shells.map(row)}
            </Section>
          )}
          {trickRows.length > 0 && (
            <Section roomy={roomy} id="switch-tricks" label={t("tricks.space.title")} count={trickRows.length} tone={roomy ? "quiet" : "strong"}>
              {trickRows.map(row)}
            </Section>
          )}
        </>
      )}
      {hits !== null && shown.length === 0 && <SessionFilterEmpty query={activeQuery.trim()} onClear={() => setQuery("")} />}
      {hits === null && showLaunch && (
        <Section roomy={roomy} id="switch-launch" label="Launch" count={launchers.length} dot="bg-status-unknown" {...(onLaunchOpenChange ? { open: launchOpen, onToggle: onLaunchOpenChange } : {})}>
          {launchers.map((launcher) => <LaunchRow key={launcher.command} launcher={launcher} home={launchersHome} busy={launching?.has(launcher.command) ?? false} refusal={launchRefusal} onLaunch={onLaunch} />)}
        </Section>
      )}
    </div>
  );
}
