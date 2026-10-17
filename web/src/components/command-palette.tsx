import { useEffect, useState } from "react";
import { Pencil, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/sheet";
import { AgentIcon } from "@/components/agent-icon";
import { commandsFor, FOUND_AGENTS, type AgentCommand } from "@/lib/agent-commands";
import { fetchClaudeCommands, type ClaudeCommand } from "@/lib/api";
import { canonicalAgent } from "@/lib/operator-scope";
import type { Scope } from "@/lib/scope";
import type { OperatorCommand } from "@/lib/types";
import { t } from "@/lib/i18n";
import { useLocale } from "@/hooks/use-locale";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  agent: string | undefined | null;
  /** The pane the palette types into; its machine is asked which skills Claude Code would load there. */
  paneId?: string;
  scope?: Scope;
  /** The operator's own rows (`commands.toml`); Claude merges them, other harnesses replace. */
  mine?: readonly OperatorCommand[];
  /** On-disk skills already read for this pane by the composer, when shared with inline suggestions. */
  found?: readonly ClaudeCommand[];
  /** Put the command in the composer for review; arg-taking commands include a trailing space. */
  onInsert: (text: string) => void;
}

/**
 * Reads the skills and commands the pane's agent would load off disk (ADR 9009, ADR 9011) whenever
 * `active` turns on (the Agent sheet opens, or the composer starts a `/` or `$` token).
 */
export function useFoundCommands(
  active: boolean,
  agent: string | undefined | null,
  paneId: string | undefined,
  scope?: Scope,
): readonly ClaudeCommand[] {
  const [state, setState] = useState<{ key: string; rows: readonly ClaudeCommand[] }>({
    key: "",
    rows: [],
  });
  const readsFound = FOUND_AGENTS.has(canonicalAgent(agent?.toLowerCase().trim() ?? ""));
  const host = scope?.host ?? "";
  const session = scope?.session ?? "";
  const targetKey = `${host}\0${session}\0${paneId ?? ""}`;

  // Asked on every open/trigger, because a skill installed a minute ago should be there; a failed
  // read (an older bridge, a crew member) leaves the palette as it was before ADR 9009.
  useEffect(() => {
    if (!active || !readsFound || paneId === undefined) return;
    const ac = new AbortController();
    const run = async () => {
      try {
        const rows = await fetchClaudeCommands(paneId, scope, ac.signal);
        if (!ac.signal.aborted) setState({ key: targetKey, rows });
      } catch {
        // The palette keeps the reference catalog and the operator's rows; nothing to say.
      }
    };
    void run();
    return () => ac.abort();
  }, [active, readsFound, paneId, host, session, scope, targetKey]);

  return state.key === targetKey ? state.rows : [];
}

interface CommandSuggestionsProps {
  commands: readonly AgentCommand[];
  onSelect: (command: AgentCommand) => void;
}

export function CommandSuggestions({ commands, onSelect }: CommandSuggestionsProps) {
  useLocale();
  return (
    <ul
      data-slot="command-suggestions"
      aria-label={t("commands.title")}
      className="mb-2 max-h-44 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card"
    >
      {commands.map((c) => (
        <li key={c.command}>
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onSelect(c)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "font-mono text-xs font-semibold",
                    c.dangerous ? "text-destructive" : "text-foreground",
                  )}
                >
                  {c.command}
                </span>
                {c.takesArg && (
                  <span className="font-mono text-[11px] text-muted-foreground">{c.argHint}</span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">{c.description}</p>
            </div>
            <Pencil aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function CommandPalette({
  open,
  onClose,
  agent,
  paneId,
  scope,
  mine,
  found: foundProp,
  onInsert,
}: CommandPaletteProps) {
  useLocale();
  const fetched = useFoundCommands(open && foundProp === undefined, agent, paneId, scope);
  const all = commandsFor(agent, mine, foundProp ?? fetched);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const q = query.trim().toLowerCase();
  const list = q
    ? all.filter(
        (c) =>
          c.command.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
      )
    : all.filter((c) => c.common);

  function pick(c: AgentCommand) {
    onInsert(`${c.command}${c.takesArg ? " " : ""}`);
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t("commands.title")} className="max-h-[85dvh]">
      {agent && (
        <div className="mb-3 flex items-center gap-2">
          <AgentIcon agent={agent} className="size-6" />
          <span className="text-sm font-medium">{agent}</span>
        </div>
      )}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("commands.search.placeholder", { count: all.length })}
          className="h-11 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-base placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>

      {!q && (
        <p className="mb-2 text-[11px] label-caps text-muted-foreground">
          {t("commands.common.hint", { count: all.length })}
        </p>
      )}

      <div className="flex flex-col gap-1">
        {list.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("commands.empty", { query })}
          </p>
        )}
        {list.map((c) => {
          return (
            <button
              key={c.command}
              type="button"
              onClick={() => pick(c)}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent active:scale-[0.99]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold",
                      c.dangerous ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {c.command}
                  </span>
                  {c.takesArg && (
                    <span className="font-mono text-[11px] text-muted-foreground">{c.argHint}</span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{c.description}</p>
              </div>
              <Pencil className="size-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
