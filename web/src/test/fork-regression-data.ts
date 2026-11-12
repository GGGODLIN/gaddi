import type { AgentStatus, AgentView, OperatorCommand, PaneDescription } from "@/lib/types";

// Extracted from existing unit inputs so the browser tier does not invent a second payload tree.
const waitWhatRule = "─".repeat(60);
export const waitWhatBox = ["", waitWhatRule, "❯ ", waitWhatRule, "   ◆ Opus 5.5 (high)  ⎇ main"];
export const waitWhatHeader = "wait what [ 白話 ] [ 跟丟了 ]                                     [-]";
export const waitWhatIdleRows = ["● Done.", "", waitWhatHeader, ...waitWhatBox];
export const waitWhatRecapRows = [
  "● Done.",
  "",
  "wait what [ 白話 ] [ 跟丟了 ] [ 清除 ]",
  "recap · 藏 band → 跑測試",
  "── 白話 · 往回 1 turn  (送出 201 字 → http:gemini · 6.5s)",
  "   退回原因：timeout",
  "╭────────────╮",
  "│ 重講內容   │",
  "╰────────────╯",
  ...waitWhatBox,
];

export const operatorDeploy: OperatorCommand = {
  agent: "claude",
  command: "/deploy",
  description: "Deploy staging",
  takesArg: false,
  argHint: "",
};
export const operatorClear: OperatorCommand = {
  agent: "claude",
  command: "/clear",
  description: "Clear after saving notes",
  takesArg: true,
  argHint: "[note]",
  confirm: false,
};
export const operatorUnscoped: OperatorCommand = {
  command: "/deploy",
  description: "Ship it",
  takesArg: false,
  argHint: "",
};

export const recapDescription: PaneDescription = {
  goal: "讀取 hello.txt",
  now: "已讀取檔案",
  next: "等待你的下一個指令",
  source: "recap",
  at: 1,
};
export const promptDescription: PaneDescription = { now: "你：修 build", source: "prompt", at: 1 };

export function regressionAgent(
  paneId: string,
  status: AgentStatus,
  ts: { active?: number; seen?: number } = {},
): AgentView {
  return {
    paneId,
    workspaceId: "w0",
    workspaceLabel: "proj",
    workspaceNumber: 1,
    tabId: "w0:t1",
    agent: "claude",
    status,
    cwd: "/home/k/proj",
    focused: false,
    lastActiveAt: ts.active,
    lastSeenAt: ts.seen,
  };
}
export const namedHeaderConfig = {
  push: false,
  vapidPublicKey: "",
  mux: { name: "reference", capabilities: {}, unsupportedKeys: [], notes: {} },
};

export const newestAttentionAgents = [
  regressionAgent("old", "blocked", { active: 100, seen: 0 }),
  regressionAgent("new", "blocked", { active: 900, seen: 0 }),
  regressionAgent("mid", "blocked", { active: 500, seen: 0 }),
];

export const parentChildAgents: AgentView[] = [
  {
    ...regressionAgent("t1", "idle", { active: 100, seen: 100 }),
    workspaceId: "spProj",
    workspaceLabel: "projects",
    tabId: "tbMain",
    tabLabel: "main-task",
    soleTabName: "main-task",
    tabPosition: 0,
  },
  {
    ...regressionAgent("t2", "done", { active: 250, seen: 100 }),
    workspaceId: "spProj",
    workspaceLabel: "projects",
    tabId: "tbMain",
    tabLabel: "main-task",
    paneLabel: "fix-qnx",
    parentPaneId: "t1",
    unpaned: true,
    tabPosition: 1,
  },
  {
    ...regressionAgent("t3", "blocked", { active: 300, seen: 100 }),
    workspaceId: "spProj",
    workspaceLabel: "projects",
    tabId: "tbMain",
    tabLabel: "main-task",
    paneLabel: "mf2-cli",
    parentPaneId: "t1",
    unpaned: true,
    tabPosition: 2,
  },
  {
    ...regressionAgent("t4", "working", { active: 150, seen: 100 }),
    workspaceId: "spProj",
    workspaceLabel: "projects",
    tabId: "tbMail",
    tabLabel: "inbox-watch",
    soleTabName: "inbox-watch",
    tabPosition: 0,
  },
];

