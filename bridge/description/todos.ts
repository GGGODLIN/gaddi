import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { JsonObject, JsonValue } from "../json.ts";
import { asRecord, asText, tokenCount } from "../journal/cache-probe.ts";
import { isSessionId } from "../journal/claude.ts";
import { containedRealpath } from "../journal/files.ts";
import { clipLine } from "./resolve.ts";

export type PaneTodoStatus = "pending" | "in_progress" | "completed";

export interface PaneTodo {
  id: string;
  text: string;
  status: PaneTodoStatus;
  activeForm?: string;
}

export const DEFAULT_TASKS_DIR = join(homedir(), ".claude", "tasks");
export const MAX_TODOS = 50;
export const TODO_TEXT_MAX = 200;

const TASK_FILE_RE = /^\d+\.json$/;
const TASK_FILE_MAX_BYTES = 64 * 1024;

function parseJsonObject(text: string): JsonObject | null {
  try {
    // SAFETY: `JSON.parse` output IS a JsonValue by construction; `asRecord` narrows it to an object.
    return asRecord(JSON.parse(text) as JsonValue);
  } catch {
    return null;
  }
}

function asInputObject(raw: JsonValue | undefined): JsonObject | null {
  const text = asText(raw);
  if (text !== undefined) return parseJsonObject(text);
  return asRecord(raw);
}

function asId(raw: JsonValue | undefined): string | undefined {
  const s = asText(raw)?.trim();
  if (s !== undefined && s !== "") return s;
  const n = tokenCount(raw);
  return n !== undefined ? String(n) : undefined;
}

function parseStatus(raw: JsonValue | undefined): PaneTodoStatus | "deleted" | undefined {
  const s = asText(raw)?.trim().toLowerCase();
  if (s === "pending" || s === "todo" || s === "open") return "pending";
  if (s === "in_progress" || s === "doing" || s === "working") return "in_progress";
  if (s === "completed" || s === "done") return "completed";
  if (s === "deleted" || s === "cancelled" || s === "canceled" || s === "dropped") return "deleted";
  return undefined;
}

function buildTodo(
  id: string,
  rawText: string,
  status: PaneTodoStatus,
  rawActive?: string,
): PaneTodo | undefined {
  const text = clipLine(rawText, TODO_TEXT_MAX);
  if (text === "") return undefined;
  const todo: PaneTodo = { id, text, status };
  const active = rawActive === undefined ? undefined : clipLine(rawActive, TODO_TEXT_MAX);
  if (active !== undefined && active !== "") todo.activeForm = active;
  return todo;
}

function parseClaudeTaskRecord(r: JsonObject, fallbackId: string): PaneTodo | "deleted" | undefined {
  const status = parseStatus(r.status) ?? "pending";
  if (status === "deleted") return "deleted";
  const id = asId(r.id) ?? fallbackId;
  const subject = asText(r.subject) ?? asText(r.content) ?? asText(r.description);
  if (subject === undefined) return undefined;
  return buildTodo(id, subject, status, asText(r.activeForm));
}

/**
 * Read Claude Code's on-disk `<tasksDir>/<sessionId>/<n>.json` files, when any exist.
 *
 * Every path goes through `containedRealpath` after validating `sessionId` as a canonical UUID.
 * Missing, empty, malformed or escaping directories return `undefined`.
 */
export async function readClaudeTasks(dir: string, sessionId: string): Promise<PaneTodo[] | undefined> {
  if (!isSessionId(sessionId)) return undefined;
  const sessionDir = await containedRealpath(join(dir, sessionId), dir);
  if (sessionDir === null) return undefined;
  let names: string[];
  try {
    names = await readdir(sessionDir);
  } catch {
    return undefined;
  }
  const taskFiles = names
    .filter((name) => TASK_FILE_RE.test(name))
    .toSorted((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)))
    .slice(0, MAX_TODOS);
  if (taskFiles.length === 0) return undefined;

  const todos: PaneTodo[] = [];
  for (const name of taskFiles) {
    const filePath = await containedRealpath(join(sessionDir, name), sessionDir);
    if (filePath === null) continue;
    try {
      const text = await Bun.file(filePath).slice(0, TASK_FILE_MAX_BYTES).text();
      const record = parseJsonObject(text);
      if (record === null) continue;
      const parsed = parseClaudeTaskRecord(record, name.slice(0, -5));
      if (parsed !== undefined && parsed !== "deleted") todos.push(parsed);
    } catch {
      continue;
    }
  }
  return todos.length > 0 ? todos : undefined;
}

function parseTodoItems(items: readonly JsonValue[]): PaneTodo[] {
  const out: PaneTodo[] = [];
  for (let i = 0; i < items.length && out.length < MAX_TODOS; i++) {
    const r = asRecord(items[i]);
    if (r === null) continue;
    const status = parseStatus(r.status) ?? "pending";
    if (status === "deleted") continue;
    const text = asText(r.content) ?? asText(r.step) ?? asText(r.subject) ?? asText(r.title);
    if (text === undefined) continue;
    const id = asId(r.id) ?? String(i + 1);
    const todo = buildTodo(id, text, status, asText(r.activeForm));
    if (todo !== undefined) out.push(todo);
  }
  return out;
}

function mergeTodoItems(current: readonly PaneTodo[], items: readonly JsonValue[]): PaneTodo[] {
  const byId = new Map<string, PaneTodo>();
  for (const item of current) byId.set(item.id, item);
  for (let i = 0; i < items.length; i++) {
    const r = asRecord(items[i]);
    if (r === null) continue;
    const id = asId(r.id) ?? String(i + 1);
    const status = parseStatus(r.status);
    if (status === "deleted") {
      byId.delete(id);
      continue;
    }
    const prev = byId.get(id);
    const rawText = asText(r.content) ?? asText(r.step) ?? asText(r.subject) ?? prev?.text;
    if (rawText === undefined) continue;
    const todo = buildTodo(
      id,
      rawText,
      status ?? prev?.status ?? "pending",
      asText(r.activeForm) ?? prev?.activeForm,
    );
    if (todo !== undefined) byId.set(id, todo);
  }
  return [...byId.values()].slice(0, MAX_TODOS);
}

function maxNumericId(todos: Iterable<PaneTodo>): number {
  let max = 0;
  for (const t of todos) {
    const n = Number(t.id);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

function sortTasks(tasks: Iterable<PaneTodo>): PaneTodo[] {
  return [...tasks]
    .toSorted((a, b) => {
      const na = Number(a.id);
      const nb = Number(b.id);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.id.localeCompare(b.id);
    })
    .slice(0, MAX_TODOS);
}

/**
 * Extract the latest todo list from raw journal lines (Claude `TaskCreate`/`TaskUpdate`/`TodoWrite`,
 * OpenCode `todowrite`, Codex `update_plan`, Grok `todo_write`).
 *
 * Pure — no fs, no clock. If `lines` holds no todo tool calls at all, returns `previous` unchanged.
 */
export function parseJournalTodos(
  lines: readonly string[],
  previous?: readonly PaneTodo[],
): PaneTodo[] | undefined {
  const taskMap = new Map<string, PaneTodo>();
  if (previous !== undefined) {
    for (const item of previous) taskMap.set(item.id, { ...item });
  }
  let nextId = maxNumericId(taskMap.values()) + 1;
  let touched = false;

  const replaceAll = (items: readonly PaneTodo[]): void => {
    touched = true;
    taskMap.clear();
    for (const item of items) taskMap.set(item.id, item);
    nextId = maxNumericId(taskMap.values()) + 1;
  };

  const parsedRows: JsonObject[] = [];
  const assignedIds = new Map<string, string>();
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;
    const row = parseJsonObject(trimmed);
    if (row === null) continue;
    parsedRows.push(row);
    if (row.type === "user" && row.isSidechain !== true) {
      const result = asRecord(row.toolUseResult);
      const realId = asId(asRecord(result?.task)?.id);
      if (realId === undefined) continue;
      const msg = asRecord(row.message);
      const blocks = Array.isArray(msg?.content) ? msg.content : [];
      for (const block of blocks) {
        const b = asRecord(block);
        const callId = b?.type === "tool_result" ? asText(b.tool_use_id) : undefined;
        if (callId !== undefined) assignedIds.set(callId, realId);
      }
    }
  }

  for (const row of parsedRows) {
    // 1. OpenCode composed line: `{ parts: [{ data: { type: "tool", tool|name: "todowrite", state: { input } } }] }`
    if (Array.isArray(row.parts)) {
      for (const part of row.parts) {
        const p = asRecord(part);
        const d = asRecord(p?.data);
        if (d === null || d.type !== "tool") continue;
        const name = (asText(d.tool) ?? asText(d.name) ?? "").toLowerCase();
        if (name !== "todowrite" && name !== "todo_write") continue;
        const state = asRecord(d.state);
        const input = asInputObject(state?.input);
        if (input !== null && Array.isArray(input.todos)) {
          replaceAll(parseTodoItems(input.todos));
        }
      }
      continue;
    }

    const type = asText(row.type);

    // 2. Codex `response_item` -> `function_call` -> `update_plan`
    if (type === "response_item") {
      const payload = asRecord(row.payload);
      if (payload === null || payload.type !== "function_call") continue;
      const name = (asText(payload.name) ?? "").toLowerCase();
      if (name === "update_plan") {
        const input = asInputObject(payload.arguments);
        if (input !== null && Array.isArray(input.plan)) {
          replaceAll(parseTodoItems(input.plan));
        }
      } else if (name === "todowrite" || name === "todo_write") {
        const input = asInputObject(payload.arguments);
        if (input !== null && Array.isArray(input.todos)) {
          replaceAll(parseTodoItems(input.todos));
        }
      }
      continue;
    }

    if (row.isSidechain === true) continue;

    // 3. Grok `assistant` row with `tool_calls`
    if (type === "assistant" && Array.isArray(row.tool_calls)) {
      for (const call of row.tool_calls) {
        const c = asRecord(call);
        if (c === null) continue;
        const name = (asText(c.name) ?? "").toLowerCase();
        if (name !== "todo_write" && name !== "todowrite") continue;
        const input = asInputObject(c.arguments);
        if (input === null || !Array.isArray(input.todos)) continue;
        if (input.merge === true) {
          replaceAll(mergeTodoItems([...taskMap.values()], input.todos));
        } else {
          replaceAll(parseTodoItems(input.todos));
        }
      }
    }

    // 4. Claude `assistant` row with `message.content` `tool_use` blocks
    if (type === "assistant") {
      const msg = asRecord(row.message);
      if (msg === null || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        const b = asRecord(block);
        if (b === null || b.type !== "tool_use") continue;
        const name = asText(b.name);
        const input = asRecord(b.input);
        if (name === undefined || input === null) continue;

        if (name === "TodoWrite" && Array.isArray(input.todos)) {
          replaceAll(parseTodoItems(input.todos));
        } else if (name === "TaskCreate") {
          const subject = asText(input.subject) ?? asText(input.description);
          if (subject === undefined) continue;
          const callId = asText(b.id);
          const taskId = (callId === undefined ? undefined : assignedIds.get(callId)) ?? String(nextId++);
          const numId = Number(taskId);
          if (Number.isInteger(numId) && numId >= nextId) nextId = numId + 1;
          // Only a genuinely new task id after an all-completed batch starts a new batch; re-reading an
          // existing id in an overlapping tail keeps the batch intact.
          if (!taskMap.has(taskId) && taskMap.size > 0 && [...taskMap.values()].every((t) => t.status === "completed")) {
            taskMap.clear();
          }
          const todo = buildTodo(taskId, subject, "pending", asText(input.activeForm));
          if (todo === undefined) continue;
          touched = true;
          taskMap.set(taskId, todo);
        } else if (name === "TaskUpdate") {
          const taskId = asId(input.taskId);
          if (taskId === undefined) continue;
          const status = parseStatus(input.status);
          if (status === "deleted") {
            if (taskMap.delete(taskId)) touched = true;
            continue;
          }
          const existing = taskMap.get(taskId);
          if (existing === undefined) continue;
          const nextText = asText(input.subject) === undefined ? existing.text : clipLine(asText(input.subject)!, TODO_TEXT_MAX);
          const nextActive =
            asText(input.activeForm) === undefined ? existing.activeForm : clipLine(asText(input.activeForm)!, TODO_TEXT_MAX);
          const updated = buildTodo(taskId, nextText, status ?? existing.status, nextActive);
          if (updated !== undefined) {
            touched = true;
            taskMap.set(taskId, updated);
          }
        }
      }
      continue;
    }

    // 5. Claude `user` row with `toolUseResult.tasks` (from `TaskList`)
    if (type === "user") {
      const result = asRecord(row.toolUseResult);
      if (result === null || !Array.isArray(result.tasks) || result.tasks.length === 0) continue;
      const listed: PaneTodo[] = [];
      for (const item of result.tasks) {
        const r = asRecord(item);
        if (r === null) continue;
        const parsed = parseClaudeTaskRecord(r, String(listed.length + 1));
        if (parsed !== undefined && parsed !== "deleted") {
          const prev = taskMap.get(parsed.id);
          if (parsed.activeForm === undefined && prev?.activeForm !== undefined) {
            parsed.activeForm = prev.activeForm;
          }
          listed.push(parsed);
        }
      }
      if (listed.length > 0) replaceAll(listed);
    }
  }

  if (!touched) return previous !== undefined && previous.length > 0 ? [...previous] : undefined;
  const sorted = sortTasks(taskMap.values());
  return sorted.length > 0 ? sorted : undefined;
}
