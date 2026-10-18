import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseJournalTodos, readClaudeTasks } from "./todos.ts";

const SID = "1d8a30f9-fe99-4897-8c2b-0cb9b0e4d8cd";
const dir = mkdtempSync(join(tmpdir(), "collie-tasks-"));
const outside = mkdtempSync(join(tmpdir(), "collie-tasks-out-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("readClaudeTasks", () => {
  test("reads numbered task JSON files in numeric order and skips deleted tasks", async () => {
    const sessionDir = join(dir, SID);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "2.json"),
      JSON.stringify({
        id: "2",
        subject: "Second task",
        activeForm: "Working on second",
        status: "in_progress",
      }),
    );
    writeFileSync(
      join(sessionDir, "10.json"),
      JSON.stringify({
        id: "10",
        subject: "Tenth task",
        status: "pending",
      }),
    );
    writeFileSync(
      join(sessionDir, "1.json"),
      JSON.stringify({
        id: "1",
        subject: "First task",
        status: "completed",
      }),
    );
    writeFileSync(
      join(sessionDir, "3.json"),
      JSON.stringify({
        id: "3",
        subject: "Deleted task",
        status: "deleted",
      }),
    );
    writeFileSync(join(sessionDir, ".highwatermark"), "10");

    expect(await readClaudeTasks(dir, SID)).toEqual([
      { id: "1", text: "First task", status: "completed" },
      { id: "2", text: "Second task", status: "in_progress", activeForm: "Working on second" },
      { id: "10", text: "Tenth task", status: "pending" },
    ]);
  });

  test("rejects non-uuid session ids and symlink escapes", async () => {
    const escapeId = "22222222-2222-2222-2222-222222222222";
    mkdirSync(join(outside, escapeId), { recursive: true });
    writeFileSync(join(outside, escapeId, "1.json"), JSON.stringify({ id: "1", subject: "leak", status: "pending" }));
    symlinkSync(join(outside, escapeId), join(dir, escapeId));

    expect(await readClaudeTasks(dir, "../etc")).toBeUndefined();
    expect(await readClaudeTasks(dir, "not-a-uuid")).toBeUndefined();
    expect(await readClaudeTasks(dir, escapeId)).toBeUndefined();
  });

  test("scans past 50 deleted task files to keep active tasks after them and returns an empty array when all are deleted", async () => {
    const manyId = "33333333-3333-3333-3333-333333333333";
    const sessionDir = join(dir, manyId);
    mkdirSync(sessionDir, { recursive: true });
    for (let i = 1; i <= 50; i++) {
      writeFileSync(
        join(sessionDir, `${String(i)}.json`),
        JSON.stringify({ id: String(i), subject: `Deleted ${String(i)}`, status: "deleted" }),
      );
    }
    expect(await readClaudeTasks(dir, manyId)).toEqual([]);

    writeFileSync(
      join(sessionDir, "51.json"),
      JSON.stringify({ id: "51", subject: "Fifty-first task", status: "pending" }),
    );
    expect(await readClaudeTasks(dir, manyId)).toEqual([
      { id: "51", text: "Fifty-first task", status: "pending" },
    ]);
  });
});

describe("parseJournalTodos", () => {
  test("folds Claude TaskCreate, toolUseResult id assignment, and TaskUpdate in order", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_1", name: "TaskCreate", input: { subject: "Step one", activeForm: "Doing one" } },
            { type: "tool_use", id: "call_2", name: "TaskCreate", input: { subject: "Step two" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        toolUseResult: { task: { id: "6", subject: "Step one" } },
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "Task #6 created" }] },
      }),
      JSON.stringify({
        type: "user",
        toolUseResult: { task: { id: "7", subject: "Step two" } },
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call_2", content: "Task #7 created" }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_3", name: "TaskUpdate", input: { taskId: "6", status: "completed" } },
            { type: "tool_use", id: "call_4", name: "TaskUpdate", input: { taskId: "7", status: "in_progress", activeForm: "Running two" } },
          ],
        },
      }),
    ];

    expect(parseJournalTodos(lines)).toEqual([
      { id: "6", text: "Step one", status: "completed", activeForm: "Doing one" },
      { id: "7", text: "Step two", status: "in_progress", activeForm: "Running two" },
    ]);
  });

  test("starts a fresh batch when a new TaskCreate arrives after all prior tasks completed", () => {
    const previous = [
      { id: "1", text: "Old one", status: "completed" as const },
      { id: "2", text: "Old two", status: "completed" as const },
    ];
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_new", name: "TaskCreate", input: { subject: "New batch task" } }],
        },
      }),
      JSON.stringify({
        type: "user",
        toolUseResult: { task: { id: "3", subject: "New batch task" } },
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call_new", content: "Task #3 created" }] },
      }),
    ];

    expect(parseJournalTodos(lines, previous)).toEqual([
      { id: "3", text: "New batch task", status: "pending" },
    ]);
  });

  test("re-reading an overlapping tail when task 1 scrolled off does not drop task 1", () => {
    const previous = [
      { id: "1", text: "Step one", status: "completed" as const },
      { id: "2", text: "Step two", status: "completed" as const },
    ];
    // Task 1's TaskCreate scrolled out of the 128 KB tail; Task 2's TaskCreate and TaskUpdate are still in the tail.
    const overlappingTail = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_2", name: "TaskCreate", input: { subject: "Step two" } }],
        },
      }),
      JSON.stringify({
        type: "user",
        toolUseResult: { task: { id: "2", subject: "Step two" } },
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call_2", content: "Task #2 created" }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_4", name: "TaskUpdate", input: { taskId: "2", status: "completed" } }],
        },
      }),
    ];

    expect(parseJournalTodos(overlappingTail, previous)).toEqual([
      { id: "1", text: "Step one", status: "completed" },
      { id: "2", text: "Step two", status: "completed" },
    ]);
  });

  test("re-reading the same tail that contains a batch reset does not resurrect the completed earlier batch", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_1", name: "TaskCreate", input: { subject: "Batch one" } }],
        },
      }),
      JSON.stringify({
        type: "user",
        toolUseResult: { task: { id: "1", subject: "Batch one" } },
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "Task #1 created" }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_u1", name: "TaskUpdate", input: { taskId: "1", status: "completed" } }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_2", name: "TaskCreate", input: { subject: "Batch two" } }],
        },
      }),
      JSON.stringify({
        type: "user",
        toolUseResult: { task: { id: "2", subject: "Batch two" } },
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call_2", content: "Task #2 created" }] },
      }),
    ];

    const first = parseJournalTodos(lines);
    expect(first).toEqual([{ id: "2", text: "Batch two", status: "pending" }]);
    expect(parseJournalTodos(lines, first)).toEqual([{ id: "2", text: "Batch two", status: "pending" }]);
  });

  test("does not leave a ghost task when a TaskCreate is read before its toolUseResult assigns the real id", () => {
    const createLine = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_A", name: "TaskCreate", input: { subject: "Unassigned yet" } }],
      },
    });
    const resultLine = JSON.stringify({
      type: "user",
      toolUseResult: { task: { id: "6", subject: "Unassigned yet" } },
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call_A", content: "Task #6 created" }] },
    });

    const pending = parseJournalTodos([createLine]);
    expect(pending).toHaveLength(1);
    expect(parseJournalTodos([createLine, resultLine], pending)).toEqual([
      { id: "6", text: "Unassigned yet", status: "pending" },
    ]);
  });

  test("clears previous tasks when TaskList returns an empty list or only deleted tasks", () => {
    const previous = [{ id: "1", text: "Still here", status: "pending" as const }];
    const emptyList = JSON.stringify({
      type: "user",
      toolUseResult: { tasks: [] },
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tl_1", content: "No tasks" }] },
    });
    expect(parseJournalTodos([emptyList], previous)).toBeUndefined();

    const deletedList = JSON.stringify({
      type: "user",
      toolUseResult: { tasks: [{ id: "1", subject: "Still here", status: "deleted" }] },
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tl_2", content: "No tasks" }] },
    });
    expect(parseJournalTodos([deletedList], previous)).toBeUndefined();
  });

  test("reads Claude TodoWrite, OpenCode todowrite, Codex update_plan, and Grok todo_write", () => {
    const claudeTodo = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tw_1",
            name: "TodoWrite",
            input: {
              todos: [
                { id: "a", content: "Write tests", status: "completed" },
                { id: "b", content: "Wire UI", status: "in_progress", activeForm: "Wiring UI" },
              ],
            },
          },
        ],
      },
    });
    expect(parseJournalTodos([claudeTodo])).toEqual([
      { id: "a", text: "Write tests", status: "completed" },
      { id: "b", text: "Wire UI", status: "in_progress", activeForm: "Wiring UI" },
    ]);

    const opencodeLine = JSON.stringify({
      id: "msg_1",
      ts: 1,
      data: { role: "assistant" },
      parts: [
        {
          id: "prt_1",
          data: {
            type: "tool",
            tool: "todowrite",
            state: {
              status: "completed",
              input: {
                todos: [
                  { id: "1", content: "Inspect DB", status: "completed" },
                  { id: "2", content: "Dropped item", status: "cancelled" },
                  { id: "3", content: "Ship dock", status: "pending" },
                ],
              },
            },
          },
        },
      ],
    });
    expect(parseJournalTodos([opencodeLine])).toEqual([
      { id: "1", text: "Inspect DB", status: "completed" },
      { id: "3", text: "Ship dock", status: "pending" },
    ]);

    const codexLine = JSON.stringify({
      timestamp: "2026-10-17T00:00:00.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "update_plan",
        call_id: "call_plan",
        arguments: JSON.stringify({
          explanation: "plan",
          plan: [
            { step: "Check types", status: "completed" },
            { step: "Run tests", status: "in_progress" },
          ],
        }),
      },
    });
    expect(parseJournalTodos([codexLine])).toEqual([
      { id: "1", text: "Check types", status: "completed" },
      { id: "2", text: "Run tests", status: "in_progress" },
    ]);

    const grokLines = [
      JSON.stringify({
        type: "assistant",
        content: "",
        tool_calls: [
          {
            id: "gk_1",
            name: "todo_write",
            arguments: JSON.stringify({
              merge: false,
              todos: [
                { id: "t1", content: "First", status: "in_progress" },
                { id: "t2", content: "Second", status: "pending" },
              ],
            }),
          },
        ],
      }),
      JSON.stringify({
        type: "assistant",
        content: "",
        tool_calls: [
          {
            id: "gk_2",
            name: "todo_write",
            arguments: JSON.stringify({
              merge: true,
              todos: [{ id: "t1", content: "First", status: "completed" }],
            }),
          },
        ],
      }),
    ];
    expect(parseJournalTodos(grokLines)).toEqual([
      { id: "t1", text: "First", status: "completed" },
      { id: "t2", text: "Second", status: "pending" },
    ]);
  });
});
