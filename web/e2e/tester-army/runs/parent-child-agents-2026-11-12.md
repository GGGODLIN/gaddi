# herdr-core 父子 Agent 樹狀列表與未讀降噪實跑紀錄（2026-11-12）

- **契約**：[contracts/parent-child-agents.v1.md](/web/e2e/tester-army/contracts/parent-child-agents.v1.md)
- **測試檔**：`web/e2e/tester-army/parent-child-agents.e2e.ts`（共用輸入抽自 `web/src/test/fork-regression-data.ts` `parentChildAgents`）
- **受測 checkout**：`dev` `887afc4a8`（含 `6bf4a1c43`、`f8d82fb32`、`4d45fc664`）

## 1. 錯預期負向控制（RED check）

- 暫時移除 `web/src/lib/triage.ts` `isUnseen` 的 `a.parentPaneId === undefined` 條件，建置隔離副本執行 `COLLIE_E2E_RUN_ID=parent-child-red-20261112 npx e2e run parent-child-agents.e2e.ts`（`E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1`）。
- 結果：exit 1，`parent-child-dashboard/v1` 精準失敗於 `ASSERTION_FAILED: expected "1 needs you\n1 unseen\n1\n1\nswitch pane" not to contain "unseen"`（3.74s）。

## 2. 正式隔離建置實跑（GREEN）

- 還原 `web/src/lib/triage.ts`，對隔離建置執行 `COLLIE_E2E_RUN_ID=parent-child-final-20261112 npx e2e run parent-child-agents.e2e.ts`。
- 結果：exit 0，**5/5 passed**（3.61s，startup 393ms）：
  1. `parent-child-dashboard/v1` — 710ms PASS（預設展開 `fix-qnx`／`mf2-cli`、無 `unseen`、無橫向捲動溢位）
  2. `parent-child-fold-persist/v1` — 1.03s PASS（收合不誤導航、顯示子項 `needs you` 燈號、`reload` 後保持收合並可再展開）
  3. `parent-child-switcher-attention/v1` — 305ms PASS（`blocked` 子項將父項整組提上 `#switch-needs`，無 `#switch-ready`）
  4. `parent-child-pane-strip/v1` — 541ms PASS（父窗格隱藏 `unpaned` 膠囊列，子窗格顯示父膠囊並一鍵返回 `/pane/t1`）
  5. `parent-child-orphan-fallback/v1` — 268ms PASS（無 `parentPaneId` 孤兒退回頂層並恢復 `1 unseen`）

## 3. 真實 `hc 0.1.20` 雙引擎活體補驗（隔離 `HC_SESSION=lab`）

- 以真實 `hc 0.1.20` 在獨立暫存 `XDG_STATE_HOME` 建立父終端 `t1` 與 `--parent t1` 子終端 `t2`（`--outlive-parent`）、`t3`（無 `--outlive-parent`），由前景程序發出真實 OSC 7501 狀態並接 `:8798` 隔離 bridge：
  - **WebKit（Safari 引擎，390×844）**：首頁樹狀展開、收合跨重整記憶、切換窗格 `#switch-needs` 家族提昇與零溢位 PASS。
  - **Chromium（390×844）**：同上 PASS；另進入 `/pane/t2` 驗證 `PaneStrip` 雙膠囊 `["claude", "fix-qnx"]`，經 `/api/pane/t2/keys` 寫入真 PTY 並由 `hc read t2` 讀回 `GOT:ok7` PASS；最後執行真實 `hc kill t1`，確認 `t3` 隨父結束消失、`t2` 卸除 `parentPaneId` 保留於頂層列表 PASS，測試後已執行 `hc server stop` 並移除暫存目錄。
