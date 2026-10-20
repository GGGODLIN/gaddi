# 9012 — A chip-anchored select lifts without a question mark

- **Status:** Accepted
- **Date:** 2026-10-21
- **Shipped in:** 2.9.0 (`ce3830d9`; narrowed after merging upstream 1.23.1)
- **Trail:** upstream issue [#543](https://github.com/AltanS/collie/issues/543) · fork commit `ce3830d9` ·
  upstream 1.23.1 commit `9ac77b3e` (`hasQuestionMark` and its negative test on
  `claude--v2296-question-fullwidth--w150.txt`) · GPT-6 Pro advisor review (`6ad79f5c`) ·
  `web/src/lib/harness/claude/prompt-select.ts` (`findChipQuestion`) ·
  `web/src/lib/harness/claude/preview-select.ts` (`readRuleAnchoredPreviewHead`) · fork-only divergence

## Context

In Claude Code's `AskUserQuestion` dialogs, the multi-question wizard (`wizard.ts`) and the checkbox
multi-select (`multi-select.ts`) find the question by the dialog's header row — the stepper or the
`☐ <header>` chip under the top `─` rule — and join every non-blank row between that header and option
`1.`, without checking whether the prompt ends in a question mark.

The single-question `select` (`prompt-select.ts`) and `preview-select` (`preview-select.ts`) grammars
shared their question scan with permission prompts (`Do you want to proceed?`), which carry no `☐`
chip, so both required a question mark on the prompt line (`t.includes("?")`, widened in upstream
1.23.1 `9ac77b3e` to `hasQuestionMark(t)` for `?`, `？` and `؟`). When Claude writes an imperative
single-question prompt ending in a colon or period (such as `請選擇你要部署的環境：` or a sentence ending in
`。`), upstream `9ac77b3e` declines the dialog (`detectPromptSelect` returns `null`), leaving Chat empty
until the operator switches to the terminal view. Upstream pinned that boundary in
`prompt-select.test.ts` by replacing `？` with `。` in `claude--v2296-question-fullwidth--w150.txt`
(which carries a ` ☐ レビュー対象 ` chip row and a live `❯` pointer) and asserting `toBeNull()`.

## Decision

This fork lifts a single-question Claude `select` or `preview-select` dialog even when its prompt
carries no question mark, provided the dialog's structural header sits directly under its top `─` rule:

- **In `prompt-select.ts` (`findChipQuestion`):** when `family === "select"` and a numbered option row
  carries the live `❯` pointer (`pointerOnOptionRows`), the scanner locates the dialog's top `─` rule
  within `QUESTION_SCAN_LIMIT` and checks whether the very first non-blank row below that rule is an
  unanswered single-question chip (`SINGLE_SELECT_CHIP`, `/^\s*☐\s+\S/u`). When it is, every non-blank
  row between that chip and `firstOpt` is joined as `question`, with `questionAt` set to the first
  question row so `dialogSubject` still walks up past the chip to the top `─` edge and `coreSignature`
  covers the whole prompt.
- **In `preview-select.ts` (`readRuleAnchoredPreviewHead`):** when `hasQuestionMark` finds a question
  mark, upstream's two-stage `readQuestionHead` runs unchanged (preserving its 48 + 48 row reach and
  never testing the question row itself against `CHIP_ROW`). Only when no question mark is present does
  the scanner fall back to checking whether the first non-blank row under the top `─` rule is a wizard
  stepper or `SINGLE_SELECT_CHIP`.
- **When no `☐` chip tops the dialog:** `hasQuestionMark` is still required, so permission prompts and
  chip-less numbered lists keep upstream's exact guard.
- **Upstream boundary:** upstream PRs for `preview-select` CJK display-column splitting and
  chip-bounded multi-paragraph `prompt-select` questions keep upstream's `hasQuestionMark` requirement
  and leave `9ac77b3e`'s negative test untouched.
