// ==UserScript==
// @name         🔥 1shop 出貨中控台（本機載入器 loader）
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  薄載入器。實際程式碼在 repo 的 src/1shop_ultimate.user.js，本檔只負責宣告權限並載入它。功能版號請看 repo 檔案內的 VERSION。
// @author       Tina + Claude
// @match        *://admin.1shop.tw/*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_addStyle
// @grant        GM_openInTab
// @noframes
// @require      file:///C:/dev/1shop-console/src/1shop_ultimate.user.js
// ==/UserScript==

// ============================================================
//  ⚠️ 本檔是「載入器」，不是主程式。請不要往這裡寫功能。
//
//  設計理由：
//  讓 repo 成為唯一權威。改完 src/1shop_ultimate.user.js 存檔後
//  重整瀏覽器即生效，不需要複製 3,600 行貼回 Tampermonkey。
//  這條路斷掉的話，「repo 是權威」就只是口號，版號漂移必然發生。
//
//  🚫 本檔的 @version 固定 1.0.0，不隨功能升版而動。
//     功能版號的唯一權威是 src/1shop_ultimate.user.js 內的 const VERSION。
//     唯一需要改本檔的時機：新增 @grant、改 @match、改檔案路徑。
//
//  📋 首次設定（三步，缺一不會動）：
//  1. 確認上面 @require 的路徑與你的實際 repo 位置一致
//     預設已填：file:///C:/dev/1shop-console/src/1shop_ultimate.user.js
//     ⚠️ Windows 路徑一律用正斜線 /，不是反斜線 \
//     ⚠️ file:// 後面是三條斜線
//     驗證技巧：把這段路徑貼進瀏覽器網址列按 Enter
//               → 看到程式碼 = 路徑對；下載檔案或 404 = 路徑錯
//  2. Chrome → 擴充功能 → Tampermonkey → 詳細資料 →
//     開啟「允許存取檔案網址 (Allow access to file URLs)」
//     👉 沒開這個，@require 會靜默失敗、後台完全不出現 FAB
//  3. Tampermonkey 設定 → 進階 → 外部資源更新間隔（Externals update interval）
//     設為「總是 / Always」
//     👉 Tampermonkey 會快取 @require 的內容。沒設這個的話，你改了檔案
//        卻看到舊行為，會誤以為程式有 bug。這是本方案最容易踩的坑。
//
//  🔍 驗收方式（設定完務必做）：
//  在 src 檔案的 VERSION 後面暫時加一個字（例如 'V11.54-x'），存檔 → 重整後台
//  → FAB 上顯示 V11.54-x 就代表通了。確認後把字改掉。
//  沒顯示變化 = 快取沒關掉，回去做第 3 步。
//
//  💡 排錯順序：
//  FAB 完全不出現 → 檢查第 2 步（檔案網址權限）與路徑打錯
//  FAB 出現但行為是舊的 → 檢查第 3 步（快取），或停用→啟用腳本強制重讀
//  Console 出現 require 相關錯誤 → 路徑錯，注意 file:// 後面是三條斜線
// ============================================================
