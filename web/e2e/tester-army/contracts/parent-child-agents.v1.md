# herdr-core 父子 Agent 樹狀列表與未讀降噪契約（v1）

- **來源**：[ADR 9014](/.adr/9014-a-child-terminal-reports-completion-to-its-parent.md)、[ADR 9004 增補](/.adr/9004-both-pane-switcher-entries-use-attention.md)、`CLAUDE.md` 與 2026-11-12 使用者定案（`1a` 全部列表統一父子樹、`2a` 壓掉子項完成未讀、只留 `blocked`、`3b` 預設展開並支援手動收合記憶）。
- **測試檔案**：`web/e2e/tester-army/parent-child-agents.e2e.ts`
- **觀察邊界**：本套件以真 Chromium（390×844 手機視窗）載入隔離建置的正式網頁 bundle，驗證前端路由、DOM 可見性、點擊隔離、`localStorage` 跨重整持久化與橫向溢位；真實 `hc 0.1.20` pty 與 bridge socket 另於獨立活體驗收紀錄驗證。

## 案例清單

1. `parent-child-dashboard/v1`：首頁預設展開顯示 `fix-qnx` 與 `mf2-cli`，`done` 子項不產生未讀方塊亦不計入頂端 unseen 計數，且主欄無橫向捲動溢位。
2. `parent-child-fold-persist/v1`：點擊 `Collapse sub-agents (2)` 隱藏兩隻子項且不誤觸導航至父窗格，按鈕轉為 `Expand sub-agents (2)` 並顯示子項 `needs you` 警示；重新整理頁面後仍維持收合，再點展開可恢復顯示。
3. `parent-child-switcher-attention/v1`：點開切換窗格抽屜時，閒置父項 `main-task` 因底下有 `blocked` 子項 `mf2-cli`，整組家族提昇至 `Needs you` 區段，且不出現 `Ready · unseen` 區段。
4. `parent-child-pane-strip/v1`：開啟父窗格 `/pane/t1` 時頂端不渲染多餘的 `Panes` 同分頁膠囊列；開啟 `unpaned` 子窗格 `/pane/t2` 時頂端 `Panes` 膠囊列提供 `main-task` 膠囊並可一鍵切回 `/pane/t1`。
5. `parent-child-orphan-fallback/v1`：當父終端結束使 `parentPaneId` 省略時，孤兒子項退回頂層並恢復正常的未讀方塊與 `Ready · unseen` 分類。
