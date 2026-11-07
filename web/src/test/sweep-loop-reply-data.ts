// Original literals shared with the browser sweep. The unit tests keep the expects.

/** typeface-control.test.tsx L42–46 labels, L47 value, L58–61 stored choice. */
export const shippedTypefaceOptionLabels = ["System default", "Space Grotesk", "Aldrich", "IBM Plex Sans", "Geist", "Atkinson Hyperlegible Next"] as const;
export const typefaceDefaultValue = "atkinson";
export const typefaceGroteskValue = "grotesk";
export const typefaceGroteskStore = { font: "grotesk" } as const;

export const wrappedTableSource = [
  "我建議先處理這三題，理由都列在表格裡，你可以逐題看。",
  "",
  "| 題目 | 建議 | 信心 |",
  "|---|---|---|",
  "| 1. 要不要重問 Pro | 不重問。它的限制是這條管道打不開 GitHub，重送一樣讀不到。真的要它看全部內容，只能把檔案印進對話給它讀，但那就不算從 GitHub 用乾淨的視角看了 | 中 |",
  "| 2. 計畫要不要加 Pro 的三項驗收 | 要。① 和 ② 可以在這台機器用一個臨時、空白的使用者目錄實測，不動你現在的設定；③ 寫進 README，並實際走一次 | 高 |",
  "| 3. 其他照我上一則的建議 | 只支援原始碼安裝、README 最上面補一段 fork 說明、更新提示這次只寫說明不改程式 | 中 |",
  "",
  "你可以回「全照建議」，或挑題號調整。照建議的話，我會先做驗收 ① 和 ②，把結果拿回來，再寫 README。",
].join("\n");
// The screen as captured: the table's top has scrolled off, so the reply is clipped.
export const wrappedTablePainted = [
  "  │ 1. 要不要重問 Pro    │ GitHub，重送一樣讀不到。真的要它看全部內容，只能把檔案印進對話給它讀，但那就不算從    │ 中   │",
  "  │                      │ GitHub 用乾淨的視角看了                                                               │      │",
  "  ├──────────────────────┼───────────────────────────────────────────────────────────────────────────────────────┼──────┤",
  "  │ 2. 計畫要不要加 Pro  │ 要。① 和 ② 可以在這台機器用一個臨時、空白的使用者目錄實測，不動你現在的設定；③ 寫進   │ 高   │",
  "  │ 的三項驗收           │ README，並實際走一次                                                                  │      │",
  "  ├──────────────────────┼───────────────────────────────────────────────────────────────────────────────────────┼──────┤",
  "  │ 3.                   │ 只支援原始碼安裝、README 最上面補一段 fork 說明、更新提示這次只寫說明不改程式         │ 中   │",
  "  │ 其他照我上一則的建議 │                                                                                       │      │",
  "  └──────────────────────┴───────────────────────────────────────────────────────────────────────────────────────┴──────┘",
  "",
  "  你可以回「全照建議」，或挑題號調整。照建議的話，我會先做驗收 ① 和 ②，把結果拿回來，再寫 README。",
];
export const wrappedTableAfter = ["", "✻ Cogitated for 36s · done 12:11 PM"];
