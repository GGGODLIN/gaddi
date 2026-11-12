# Collie 網頁補丁回歸測試

這套使用 TesterArmy 保護 fork 的網頁補丁。案例預期取自 FORK.md、CHANGELOG.md 與 ADR，不是實跑後反填答案。原 Playwright suite、設定與依賴保留。`npm test` 執行本目錄註冊的 `.e2e.ts`；每案各自回報，不把失敗標成預期失敗或跳過。連續 sweep 的來源衝突另列於逐批紀錄，案例通過不代表已裁定那些衝突。

- [本次行為契約](/web/e2e/tester-army/contract.md)
- [上游介面更新契約 v2](/web/e2e/tester-army/contracts/upstream-1.17-adaptation.v2.md)與[同步後重跑結果](/web/e2e/tester-army/runs/upstream-sync-1.17.2.md)：保留原快照；Dashboard／needs-you／Files／Chat 與 Terminal 前置按核准方案更新。
- [來源與涵蓋表](/web/e2e/tester-army/coverage.md)
- [首案快照](/web/e2e/tester-army/contracts/palette-stage-and-send.v1.md)
- [核心案例](/web/e2e/tester-army/contracts/web-core-batch.v1.md)、[標題目前版本](/web/e2e/tester-army/contracts/title-dash.v3.md)
- [共用資料案例](/web/e2e/tester-army/contracts/data-backed-web.v1.md)、[補充案例](/web/e2e/tester-army/contracts/supplemental-web.v1.md)
- [首次實跑紀錄](/web/e2e/tester-army/runs/first-web-run.md)
- [本次整批結果](/web/e2e/tester-army/runs/baseline-2026-10-04.md)、[建案失敗](/web/e2e/tester-army/runs/setup-failures.md)、[錯預期控制](/web/e2e/tester-army/runs/negative-control.md)
- [另分支找錯與修補試跑](/web/e2e/tester-army/runs/sweep-2026-10-04.md)：新增六案與原 26 案獨立實跑通過；產品只修無 mux 時品牌不可見。這是一次有限試跑，不是原契約的期待改版。
- [連續批次找錯紀錄](/web/e2e/tester-army/runs/sweep-loop-2026-10-04.md)：按人寫來源的候選流程逐批測、修、獨立驗證；各項通過與未驗分開記，不能當全產品零 bug 保證。
- [herdr-core 父子 Agent 契約](/web/e2e/tester-army/contracts/parent-child-agents.v1.md)與[實跑紀錄](/web/e2e/tester-army/runs/parent-child-agents-2026-11-12.md)：保護 ADR 9014 與 ADR 9004 的五個父子樹狀、收合記憶、未讀降噪與孤兒保底案例。
- 後續結果保存於 runs/，原失敗與成功證據不覆寫。

## 測試邊界

真 Chromium 載入 Collie 的正式網頁 build。命令選取、composer、reply-action 都用真產品；bridge、terminal 及其他 API 用 repo 既有 fixture。禁止任何請求離開隔離 loopback origin，Vite 的 API proxy 指向沒有 bridge 的 port 9，service worker 阻擋。

精確斷言保護 palette 只填文字、bar 直接送、清單分類／排序／開啟時固定、wait-what 隱藏、description 顯示，以及核定的帳號切換／權限回答／Full reply 分支。不使用 agent.*、模型或 cache。依涵蓋表區分網頁觀察與 backend 未驗，不因 API stub 成功就宣稱 terminal 成功。

Typeface 出廠值的來源仍有衝突：CLAUDE／原單測是 Aldrich，configure.md 寫 Space Grotesk。該案的 Aldrich 斷言只保存本輪觀察，不作未拍板的產品判斷標準。如果未來只在該斷言失敗，就先核來源，不直接改產品或 expected。三個字型選項與選擇保存仍有共同來源。

## 合併上游後重跑

先從當前 checkout 建一份新的網頁 build，不能拿首次試跑的舊副本宣稱 merge 後通過。`<new-build>` 是本輪專用的絕對路徑，位於忽略的輸出目錄，不是 live `web/dist`。

```bash
cd web
npm run build -- --outDir <new-build> --emptyOutDir
cd e2e/tester-army
COLLIE_E2E_DIST=<new-build> COLLIE_E2E_RUN_ID=<unique-run-id> npm test
```

CLI 自動取可用 loopback port，啟停測試 server，輸出保存在 `.e2e/<unique-run-id>/`。每輪另存 report、network-evidence、截圖與 trace；不要覆寫舊 run-id。核對 network-evidence 的實際 build-info，不能只看 checkout SHA。

## 依賴與本次本機限制

本目錄的 package.json 釘 e2e 0.16.0、@e2e-dev/web 0.11.2、playwright 1.63.0，以及既有 SDK 樹已解析的 zod 4.6.5。版本來源是本輪已安裝套件的 package.json。試跑復用本 session 已審、已安裝的 SDK，沒有重新下載／安裝這兩個未滿七天的版本，沒有升級舊 suite。

本機忽略的 node_modules 暫時指向既有 Linux SDK 目錄；因此這次在 macOS 另以 ESBUILD_BINARY_PATH 指向已滿七天的原生 esbuild 0.28.2。該暫存位置記在本輪本機收據，不寫進可提交文件。重跑此依賴形態時要帶同一環境變數，不能假設跨平台的 node_modules 可直接使用。

型別分兩條。`cd web && bun run typecheck` 不含本目錄；app 與舊 Playwright 案例仍保留型別檢查。本目錄另用 web 的 tsc，型別根只指向 web 既有的 `@types`（含 `node:fs` 與 `import.meta.dirname`），不新增型別套件。CI 在 web install 之後才對本目錄 `bun install --frozen-lockfile`，再執行 `cd web && bunx tsc --noEmit -p e2e/tester-army/tsconfig.json`。普通 build 不安裝本目錄。

`bun.lock` 鎖的是上述直接依賴與當時已審的 transitive 版本，給 CI 的 frozen install 用。這份 lock 沒有經過乾淨 clone 安裝驗證。全新安裝仍須遵守 repo 的七天限制，不能為了跑測試放寬；兩個 SDK 版本都在 2026-10-02 發布，2026-10-04 尚不能新裝。原 suite 的依賴安裝與 lockfiles 不變。

## 未驗證

涵蓋表的剩餘分支、真 bridge／Herdr terminal、原生 iOS、tablet、Safari、LLM、cache replay，以及實際合併上游後的回歸結果都未驗證。故意錯 expected 的負向控制已另跑，不能把它算正常案例通過或產品失效測試。這套提供可重跑的前端保護，不代表 fork 每個分支都已覆蓋。首次 baseline 只有測試修改，沒有可部署的產品效果。另分支 sweep 有 header 修補，但本次隔離試跑明示不部署 active Collie。
