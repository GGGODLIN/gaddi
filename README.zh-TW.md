# Gaddi

<p align="center">
  <img src="assets/social-card.png" alt="像素風的 Gaddi 狗站在喜馬拉雅山坡上看著羊群，旁邊寫著 Gaddi 和一句：your agent herd, from your phone." width="640">
</p>

<p align="center"><a href="./README.md">English</a> · <b>繁體中文</b></p>

Gaddi 把你終端機裡的 AI coding agent 搬到手機上。Claude Code、Codex 這些照樣在電腦上的 Herdr、tmux
或 zellij 裡跑，手機只負責告訴你哪一隻在等你，你點一下就能回它，不用在手機上硬敲終端機。

它跑在你自己的電腦上，透過你的 Tailscale 網路連到手機。沒有帳號、沒有雲端服務，也不上架 App
Store：手機打開網址，加到主畫面就能用。

> **注意：** Gaddi 是 [GGGODLIN 的 fork](https://github.com/GGGODLIN/gaddi)，原專案是 Altan Sarisin 的
> [ColliePWA](https://github.com/AltanS/collie)，不是 ColliePWA 官方專案。它從原始碼安裝、自己發版。
> `collie` 指令和 Herdr 外掛沿用上游的名字，所以指令和文件裡看到的還是 Collie。

<table>
  <tr>
    <td align="center" width="33%"><img src="assets/readme/zh-TW/dashboard.png" alt="總覽畫面：三個工作區裡有四個 agent，等你批准的那個排在最上面，每個底下都有一行在做什麼" width="240"><br><sub><b>需要你的排第一</b></sub></td>
    <td align="center" width="33%"><img src="assets/readme/zh-TW/approve.png" alt="總覽上方彈出的面板：Claude 要執行 bun test 的權限詢問，下面是 Yes 和 No 按鈕" width="240"><br><sub><b>在清單直接批准</b></sub></td>
    <td align="center" width="33%"><img src="assets/readme/zh-TW/keys.png" alt="pane 畫面：權限詢問變成按鈕，下方打開按鍵面板，有 Esc、Tab、Shift、Ctrl、Alt、方向鍵和 Ctrl+C" width="240"><br><sub><b>手機鍵盤沒有的按鍵</b></sub></td>
  </tr>
</table>

截圖裡的 agent 都是假資料。

## 能做什麼

- **需要你的 agent 排最上面。** 每個 pane 底下有一行字說它在幹嘛：在等你批准什麼，或你最後交代它的事。
- **不用點進 pane 就能批准。** 點一下卡住的那一列，權限詢問直接變成按鈕浮在總覽上。
- **agent 問你的東西都變成按鈕**：權限詢問、AskUserQuestion、plan 審核、選單。
- **手機鍵盤沒有的鍵**：Esc、Ctrl+C、Tab、方向鍵，還有你自己排的組合鍵。
- **在手機上開新工作**：開新的 agent、跑指令、開 worktree，哪台電腦都可以。
- **回頭看發生了什麼**：搜尋輸出、用 Chat 讀整段 session、看工作區的檔案和 diff，全部唯讀。
- **agent 停下來等你時推播通知。**

### iPhone 動態島

這個 fork 最大的加碼是一個 iPhone app，放在 [`ios/`](./ios/README.md)。它把 agent 的狀態放到動態島和鎖定畫面上，點一下就打開
Gaddi。可以自己 build，也可以側載每次發版附的 `.ipa`，兩種都是用你自己的 Apple ID 簽名，免費帳號就夠。中間不經過任何推播服務或第三方伺服器。

<table>
  <tr>
    <td align="center" width="62%">
      <img src="assets/fork/island.png" alt="動態島顯示 Gaddi 圖示和「1 等你」" width="400"><br>
      <sub><b>動態島</b>：有幾隻 agent 在等你</sub><br><br>
      <img src="assets/fork/island-expanded.png" alt="長按展開的動態島：pane「Migrate checkout to Stripe」、「在等你批准 Bash · bun test」，以及等你、完成、執行中的數量" width="400"><br>
      <sub><b>長按</b>：需要你的 pane、它在等什麼、各狀態的數量</sub>
    </td>
    <td align="center" width="38%">
      <img src="assets/fork/lock-screen.jpg" alt="iPhone 鎖定畫面，時鐘下方是同一張卡片" width="220"><br>
      <sub><b>鎖定畫面</b>：同一張卡片</sub>
    </td>
  </tr>
</table>

截圖裡的 agent 都是假資料。第二行「pane 在做什麼」預設不顯示，因為它可能一字不差地把你最新的 prompt 秀在動態島上；要開的話設
`ISLAND_SHOW_DETAIL = YES`。預設只顯示 pane 名稱和數量。

## 安裝前先看

需要一台 Mac 或 Linux（Windows 還是實驗性質，見英文版的 [Windows](./README.md#windows)）、[Bun](https://bun.sh)
1.3.14 以上、git，以及一個終端機多工器：[Herdr](https://herdr.dev)、tmux 或 zellij 擇一。手機和電腦要在同一個
[Tailscale](https://tailscale.com) tailnet 裡。Gaddi 是給一個人用的：一個操作者、一個 tailnet，不要拿去共用或公開。

**Gaddi 本質上就是一個遠端 shell。** 一個 API 呼叫就能把任意按鍵送進正在跑的終端機。拿到網址的人可以讀到 pane
裡的所有輸出（原始碼、密鑰、環境變數、agent 的輸出），也能用你的完整使用者權限執行任何指令。它沒有沙箱，也沒有指令白名單，因為那樣就沒辦法用了。請把這個網址當成
root 登入看待：只綁在你的 tailnet 上、設定 `COLLIE_TRUSTED_USER`、只配對你手上那支手機。跑起來之前，先讀
[`docs/security.md`](./docs/security.md)（英文），裡面有安全模型、防護層和裝置配對的細節。

> 🚫 **絕對不要對它用 `tailscale funnel`**：`funnel` 會把 port 開到公開網路上，`serve` 才是只限你自己的 tailnet。不管什麼情況都不要 funnel Gaddi。

## 安裝

Gaddi 從原始碼安裝。先把多工器開起來：`start` 會接上它找到正在跑的那一個，找不到就拒絕啟動。

```bash
git clone --single-branch https://github.com/GGGODLIN/gaddi.git ~/.local/share/collie &&
  cd ~/.local/share/collie && bash scripts/collie-ctl.sh build && bin/collie start
```

每一步都要前一步成功才會跑。如果 `~/.local/share/collie` 已經存在（例如裝過上游版），clone 會在那裡停下，不會蓋掉它；先把它移走再裝。`--single-branch`
只抓 `main`，之後更新也只跟 `main`。

`start` 之後的步驟和上游文件一樣，從 [`docs/install.md`](./docs/install.md) 的 *Then start it* 開始看（英文）。

`main` 只在發版或改文件時才會動，所以你裝到的一定是某個正式版本。日常開發在 `dev`，那裡沒有替別人的環境測過。

## 更新與回滾

`collie update` 和 app 裡的更新提示都跟著[這個 fork 的 releases](https://github.com/GGGODLIN/gaddi/releases)
走。更新會拉 `main`、重新 build、重新啟動：

```bash
cd ~/.local/share/collie && bin/collie update
```

要退回舊版，checkout 那個版本的 tag，再 build 和重啟：

```bash
cd ~/.local/share/collie && git fetch --tags && git checkout v1.14.0 &&
  bash scripts/collie-ctl.sh build && bin/collie restart
```

這樣 checkout 會停在那個版本（detached）。要回到最新版，切回 `main` 再更新；只 checkout `main` 只會換原始碼，正在跑的 Gaddi 不會變。

```bash
cd ~/.local/share/collie && git checkout main && bin/collie update
```

> **注意：** 1.14.0 以前裝的版本拉不到新的 `main`。把 `~/.local/share/collie` 移走重裝就好；設定、配對和推播訂閱都存在
> `~/.config` 和 `~/.local/state`，不在那個資料夾裡。

## 選配工具

有兩個功能會讀我自己寫的 Claude Code 工具的輸出。沒裝那些工具時這兩個功能就不出現，Gaddi 其他部分照常運作。

| 功能 | 需要 | 沒裝的話 |
| --- | --- | --- |
| pane 的一行描述改用 Claude 自己的 recap，畫面也會藏掉那個工具的按鈕列 | [cc-mod-waitwhat](https://github.com/GGGODLIN/cc-mod-waitwhat) | 描述改用正在等的批准，或你最新的 prompt |
| *Plain* 和 *Lost* 用白話重講一段 Claude session | [cc-sidecar-waitwhat](https://github.com/GGGODLIN/cc-sidecar-waitwhat)，寫在 `retell.toml` 裡（[Configure](./docs/configure.md#retell-a-claude-session)） | 不會出現這兩個選項 |
| agent 狀態顯示在 iPhone 動態島 | [`ios/`](./ios/README.md) 裡的 iPhone app，用你自己的 Apple ID build 或側載；Gaddi 和上游 Collie 都能接 | 沒有任何差別；Gaddi 設定裡填 app 位址的那一列只在 app 裡才看得到 |

pane 的那一行描述不管 app 設成什麼語言，都是中文（`在等你批准`、`你：`）。

## 其他文件

文件、部署方式、Windows、架構和開發說明都在[英文版 README](./README.md#documentation) 和 [`docs/`](./docs/)，目前只有英文。

## 致謝

Gaddi 建立在 Altan Sarisin 的 [ColliePWA](https://github.com/AltanS/collie) 之上，採用
[MIT 授權](./LICENSE)。這個 fork 比上游多了什麼，從 `1.14.0` 起都記在 [`CHANGELOG.md`](./CHANGELOG.md)。少數只在我自己的環境才有意義的改動列在
[`FORK.md`](./FORK.md)，每一條都寫了它需要什麼；沒有那些工具時，它們不會干擾你。
