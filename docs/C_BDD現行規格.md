# C BDD 現行規格
<!-- 更新：2026-08-18 -->

> **適用場景**：要新增/修改功能前先看驗收條件；要寫測試、跑回歸、判斷「改完算不算過」時讀本檔。
> **不處理**：為什麼平台會這樣（→ A 平台事實）；UI 元件位置與流程圖（→ B UI 骨架）；歷史版本沿革（→ E 變更紀錄與待修）
> **前置依賴**：改動前應先讀 A 平台事實，避免對平台行為做錯假設
> **共用參照**：術語與常數

> **本檔為現行規格，非歷史紀錄。**
>
> **寫入紀律（最重要的一條）：行為變了就改寫既有 scenario，不在檔尾往下疊加新段落。**
> 原「V11.XX 新增」小節已改為功能式標題，版本歸屬一律查 E 變更紀錄與待修。
>
> 理由：這個檔案過去每一版都往下長（V11.45、V11.47-V11.54 都是加一段）。疊加的後果不是檔案變大而已 ——
> 是**被後續版本推翻的舊 scenario 還留在裡面當驗收標準**。過期的規格比沒有規格更危險，
> 因為它看起來一樣權威。拆檔解決不了這件事，只有「取代」能。
>
> 判斷：同一個行為的新舊版本 → **改寫原 scenario**。真正新增的行為 → 才加新 scenario。

---


## 0. 文件導讀

| Feature | 主題 |
|---|---|
| F1 | 浮動控制台(FAB)展示與設定持久化 |
| F2 | 大數據掃描與訂單分類 |
| F3 | 中控台看板 modal 展示與互動 |
| F4 | 訂單編輯(備註 / 移分頁 / 發信 / 分類調整) |
| F5 | 階段 A:寫商家備註 + 發信 |
| F6 | 階段 B:批次移分頁 |
| F7 | 階段 C:物流拋單與印單 |
| F8 | GM_openInTab 背景分頁機制 |
| F9 | 三路徑攔截器(form / window.open / a.click) |
| F10 | 警告 modal 自動關閉 |
| F11 | autoUX 流程(縮小/進度/結束狀態) |
| F12 | 跨頁續航 |
| F13 | 相同商品組合批次拋印(V11.44) |
| F14 | 看板購買商品欄顯示短標籤(V11.46) |

附錄:Done 定義、Commit 前 checklist、共用測試資料

---

## 1. 測試環境前置條件

### 1.1 必要環境

```gherkin
Background: 通用前置條件
  Given 使用 Chrome 瀏覽器(version ≥ 100)
  And 已安裝 Tampermonkey(version ≥ 4.18)
  And 已安裝 1shop 出貨中控台 V11.43 腳本
  And 腳本狀態為「已啟用」(綠燈)
  And 腳本的 @grant 權限「GM_openInTab」已生效
  And 使用者已登入 admin.1shop.tw
  And 當前頁面為 https://admin.1shop.tw/shop/order/all 或子分頁
```

### 1.2 健康檢查(每次開測試前跑)

```gherkin
Scenario: 環境健康檢查
  Given 開啟 1shop 訂單列表頁
  When 開啟 F12 Console
  Then 應該看到 "🚀 1shop 出貨中控台 V11.43 啟動"
  And 應該看到 "🛡️ V11.42 攔截器已注入(GM_openInTab 三路徑..."
  And 在 Console 輸入 typeof GM_openInTab 應回傳 "function"
  And 頁面右下角應該有「⚙️ 1shop 掃描控制台 V11.43」浮動框
```

---

## F1. 浮動控制台(FAB)展示與設定持久化

### F1.1 浮動控制台初始顯示

```gherkin
Feature: 浮動掃描控制台
  作為使用者
  我希望浮動控制台永遠在右下角且可拖曳
  以便隨時操作不被遮擋

Scenario: 浮動控制台初始顯示
  Given 1shop 訂單頁載入完成
  When 頁面 DOMContentLoaded 後 1.2 秒
  Then #v11-fab 元件應該存在
  And 應該在頁面右下角可見
  And 標題應該顯示 "⚙️ 1shop 掃描控制台 V11.43"
  And 應該包含「🤖 啟動大數據掃描」按鈕
  And 應該包含「📋 開啟看板」按鈕

Scenario: 浮動控制台收合與展開
  Given 浮動控制台展開狀態
  When 點擊 #v11-fab-toggle(➖ 按鈕)
  Then #v11-fab-body 應該隱藏
  And #v11-fab-toggle 文字應該變成 ➕
  When 再次點擊 #v11-fab-toggle
  Then #v11-fab-body 應該重新顯示
  And #v11-fab-toggle 文字應該變回 ➖

Scenario: 浮動控制台拖曳
  Given 浮動控制台在預設位置(右下角)
  When 按住 #v11-fab-drag 拖曳到頁面左上角
  Then 浮動控制台應該移到放開的位置
  And 重新整理頁面後位置應該保持在新位置
    (註:如未實作位置記憶可降為 Future Enhancement)
```

### F1.2 設定持久化

```gherkin
Scenario: 預購關鍵字持久化
  Given 使用者打開浮動控制台
  When 在 #v11-kws 輸入 "DK4-BK, 7DS-PK"
  And 點擊「🤖 啟動大數據掃描」(或失去焦點)
  Then localStorage 應存有 v11_preorder_kws = "DK4-BK, 7DS-PK"
  When 重新整理頁面
  Then #v11-kws 應該預填 "DK4-BK, 7DS-PK"

Scenario: 掃描頁數持久化
  Given 使用者打開浮動控制台
  When 將 #v11-pages 改為 3
  Then localStorage 應存有 v11_scan_pages = "3"
  When 重新整理頁面
  Then #v11-pages 預設值應為 3

Scenario: 預購歸類分頁持久化
  Given 預購歸類預設為「暫存」
  When 使用者切換 #v11-preorder-tab 為「其他」
  Then localStorage 應存有 v11_preorder_tab = "其他"
  And 後續掃描的所有 PREORDER 訂單,預設 rowMoveTab 應為「其他」
```

---

## F2. 大數據掃描與訂單分類

```gherkin
Feature: 大數據掃描
  作為使用者
  我希望點一個按鈕就把多頁訂單抓進來並自動分類
  以便不用一筆筆檢查

Scenario: 啟動大數據掃描(深潛 1 頁)
  Given 當前在「等待確認」分頁
  And 該頁有 N 筆訂單
  And #v11-pages 設定為 1
  When 點擊「🤖 啟動大數據掃描」
  Then 應該顯示 "🤖 開始掃描,深潛 1 頁..." toast
  And #v11-overlay 應該變成 display:flex(看板展開)
  And 訂單卡片區應該顯示「⏳ 掃描中,請勿關閉本頁籤...」
  And 抓取所有 N 筆訂單到 allOrders 陣列
  And 掃描完成後,訂單依 6 大類型分卡片顯示
  And 完成 toast 顯示 "🤖 掃描完成,共 N 筆訂單"

Scenario: 多頁深潛掃描
  Given #v11-pages 設定為 3
  When 點擊「🤖 啟動大數據掃描」
  Then 腳本應該先切回第 1 頁(用 angles-left 圖示按鈕)
  And 依序掃第 1、2、3 頁
  And 每頁切換等待 2.5 秒讓 DOM 穩定
  And 三頁訂單應該合併在 allOrders

Scenario Outline: 訂單自動分類
  Given 一筆訂單符合 <條件>
  When 掃描完成
  Then 該訂單的 type 欄位應為 <類型>
  And 預設 rowNote 應為 <備註>
  And 預設 rowMoveTab 應為 <分頁>
  And 預設 needEmail 應為 <發信>

  Examples:
    | 條件                          | 類型     | 備註            | 分頁    | 發信  |
    | SKU 含預購關鍵字               | PREORDER | 預購品處理中     | 暫存    | false |
    | 折抵金額 > 0                  | EXC      | 待折抵          | 確認中  | false |
    | 收件地址含「海外」            | OVERSEAS | 海外單          | 確認中  | false |
    | 付款狀態「等待付款」          | UNPAID   | 提醒付款        | 確認中  | true  |
    | 付款狀態「待確認付款」        | UNPAID   | 提醒付款        | 確認中  | true  |
    | 付款狀態「未付款」(帶天數徽章) | UNPAID   | 提醒付款        | 確認中  | true  |
    | 付款狀態「付款失敗」          | UNPAID   | 提醒付款        | 確認中  | true  |
    | 付款狀態「交易逾時」          | UNPAID   | 提醒付款        | 確認中  | true  |
    | 付款狀態「交易取消」          | UNPAID   | 提醒付款        | 確認中  | true  |
    | 付款狀態「已付款/交易成功」   | NORMAL   | (空)            | 不移動  | false |
    | 付款狀態「貨到付款」          | NORMAL   | (空)            | 不移動  | false |
    | 付款狀態「超商取貨時付款」    | NORMAL   | (空)            | 不移動  | false |
    | **付款狀態不在 P12 清單內**    | UNPAID   | 付款狀態待確認   | 確認中  | false |
    | 顧客有多筆訂單                | DUP      | (依 dupRole)    | (依)    | (依)  |

Scenario: 可出貨用白名單,未收錄狀態一律擋下
  Given 付款狀態只有「已付款/交易成功/貨到付款/超商取貨時付款」四種算可出貨
  When 掃到一筆付款狀態是 P12 清單以外的字串(例如平台新增的狀態)
  Then 該訂單的 type 應為 UNPAID 但 payUnknown 應為 true
  And 備註應為「付款狀態待確認」,needEmail 應為 false
  And 該訂單列應顯示「⚠️ 付款狀態未收錄,不出貨」標籤
  And 付款狀態欄應套用 v11-status-unknown 醒目樣式
  When 掃描結束
  Then 應彈出 alert 列出所有未收錄的狀態文字,要求回報補進 P12
  And 即使人工勾選發信,pickEmailTemplate 也應回傳 null 擋下
    註:成本不對稱 —— 黑名單漏一個是把貨寄給沒付錢的人,白名單漏一個只是多一筆人工

Scenario: 付款狀態判定只看 .status-name
  Given 付款狀態欄是 .status-name 加上天數/次數徽章(→ A 平台事實 P13)
  And 某筆訂單顯示為「未付款」+ 3 天徽章,payStatus 串接後是 "未付款 3"
  When 判定該筆的付款狀態
  Then 應比對 payStatusName("未付款")而非串接字串
  And 該筆應歸為 UNPAID 催繳,不得落到「未收錄」

Scenario Outline: 重複單的角色分流(dupRole)
  Given 一組同顧客的重複訂單,付款狀態組合為 <組合>
  When 掃描完成
  Then 各筆的 dupRole 應為 <角色>
  And 預設備註應為 <備註>,預設發信應為 <發信>

  **規則只有一條**:會成立的付款(已付款/交易成功/貨到付款/超商取貨時付款)
  「恰好 1 筆」→ 保留那筆並發信,其餘只寫備註並取消;
  其他一切(0 筆、或 2 筆以上會成立)→ 全部不發信,寫備註移確認中交客服。

  Examples:
    | 組合                        | 角色                        | 備註                          | 發信       |
    | 交易成功 + 付款失敗         | 成功筆 KEEP / 另一筆 CANCEL | (空) / 重複訂單 此筆取消      | true/false |
    | 貨到付款 + 付款失敗         | 貨到付款筆 KEEP / CANCEL    | (空) / 重複訂單 此筆取消      | true/false |
    | 貨到付款 + 等待付款         | 貨到付款筆 KEEP / CANCEL    | (空) / 重複訂單 此筆取消      | true/false |
    | 交易成功 + 未付款           | 成功筆 KEEP / CANCEL        | (空) / 重複訂單 此筆取消      | true/false |
    | 超商取貨時付款 + 交易取消   | 超商筆 KEEP / CANCEL        | (空) / 重複訂單 此筆取消      | true/false |
    | 兩筆皆貨到付款              | 全部 PENDING                | 重複訂單 幫關心               | false      |
    | 兩筆皆等待付款              | 全部 PENDING                | 重複訂單 幫關心               | false      |
    | 等待付款 + 付款失敗         | 全部 PENDING                | 重複訂單 幫關心               | false      |
    | 兩筆皆付款失敗              | 全部 PENDING                | 重複訂單 幫關心               | false      |
    | **兩筆皆交易成功(重複付款)** | 全部 PENDING                | 重複訂單 幫關心               | false      |
    | 未收錄狀態 + 交易成功       | 成功筆 KEEP / CANCEL        | (空) / 重複訂單 此筆取消      | true/false |

Scenario: 診斷字串與實際分流必須同源
  Given classifyDuplicateScenario 產生看板上的診斷字串
  And applyDupKeepOrCancel 決定實際的角色與發信
  Then 兩者都必須呼叫同一個 judgeDupGroup,不得各自重算
    註:V11.55 以前兩者各算一次,漂移出「看板寫【B】不發信、實際卻寄信」
      與「看板寫【E】重複未付款、實際兩筆都刷卡成功」兩種說一套做一套

Scenario: 重複付款(2 筆以上已成立)不得自動取消
  Given 同一顧客兩筆訂單付款狀態都是「交易成功」
  When 掃描完成
  Then 兩筆的 dupRole 都應為 PENDING
  And 都不應發信,都應移「確認中」
    註:錢已經收了兩筆,涉及退款。把訂單移到「已取消」不等於處理完,
      自動寄「已幫您取消」但錢沒退會造成客訴

Scenario: UNPAID_DUP 角色已退役
  Given V11.56 起沒有任何情境會指派 dupRole = 'UNPAID_DUP'
  Then 公版分支、看板標籤、NOTE_TEMPLATES.UNPAID_DUP 都應已移除

Scenario: 訂單分類優先序
  Given 一筆訂單同時符合「預購 + 未付款」
  When 掃描完成
  Then 該訂單的 type 應為 UNPAID(優先序高於 PREORDER)
    註:依 STRATEGY_ORDER = ['DUP', 'UNPAID', 'PREORDER', 'EXC', 'OVERSEAS', 'NORMAL']
```

---

## F3. 中控台看板 modal 展示與互動

```gherkin
Feature: 中控台看板 modal

Scenario: 看板展開時佈局正確
  Given 掃描完成,看板自動展開
  Then #v11-overlay 應該 display:flex
  And #v11-modal 應該在中央
  And 看板包含 6 個訂單分類卡片(順序:DUP → UNPAID → PREORDER → EXC → OVERSEAS → NORMAL)
  And 每張卡片標題包含分類名 + 訂單數(如 "🔴 重複異常單(3 筆)")
  And 訂單數為 0 的卡片應該收合或不顯示
  And 底部應該有「🌟 一鍵全局批次執行」按鈕(紅色,大字)
  And 底部應該有「🚀 自動分流當天出貨」「📧 異常單預設公版」按鈕

Scenario: 看板拖曳
  Given 看板已展開
  When 按住 #v11-modal-drag 拖曳
  Then 看板應該跟著滑鼠移動
  And 釋放後留在新位置

Scenario: 縮小視窗按鈕
  Given 看板已展開
  When 點擊 #v11-btn-close(縮小視窗)
  Then #v11-overlay 應該 display:none
  And 訂單資料應該保留在 allOrders(不被清空)
  When 點擊浮動控制台的「📋 開啟看板」
  Then 看板應該重新展開且訂單卡片內容相同
```

---

## F4. 訂單編輯(備註 / 移分頁 / 發信 / 分類調整)

```gherkin
Feature: 訂單列編輯

Scenario: 修改訂單備註
  Given 看板已展開,某筆 EXC 訂單預設備註為「待折抵」
  When 使用者在該列 .v11-row-note 輸入框改為「折抵客服處理中」
  Then 該輸入框值應變更
  And allOrders 中該訂單的 rowNote 應在執行前同步成新值
    (透過 saveRowInputsToData 函式)

Scenario: 修改移分頁目的地
  Given 看板已展開,某筆 PREORDER 訂單預設 rowMoveTab 為「暫存」
  When 使用者在該列 .v11-row-move-tab 下拉選「其他」
  Then 該訂單的 rowMoveTab 應變為「其他」
  When 執行階段 B 批次移分頁
  Then 該訂單應該被移到「其他」分頁,而非「暫存」

Scenario: 修改發信勾選
  Given 某筆 UNPAID 訂單 needEmail 預設為 true
  When 使用者取消勾選該列 .v11-row-email
  Then 該訂單的 needEmail 應變為 false
  When 執行階段 A
  Then 該訂單不應該被發信

Scenario: 勾選了發信但該類型沒有公版 — 擋下並出聲
  Given 某筆 NORMAL 訂單(或 DUP 取消筆)被人工勾選發信
  When 執行階段 A
  Then 不應該打開發信 modal
  And Toast 應顯示「🚫 <訂單 ID> 不發信(<原因>)」
  And Console 應留下 warn「[發信] <訂單 ID> 擋下:<原因>」
  And 該訂單「不算失敗」,仍會正常進入階段 B 移分頁
    註:pickEmailTemplate 回傳 null 即「這筆不該寄」的權威判定,呼叫端不得繞過

Scenario: 人工分類調整 — EXC 改為 NORMAL(V11.39 新增)
  Given 某筆 EXC 訂單,備註「待折抵」,rowMoveTab「確認中」
  When 使用者在該列 .v11-row-type 下拉選「🟢 可出貨一般單」
  Then 該訂單的 type 應變為 NORMAL
  And rowNote 應該「保留」為「待折抵」(★ 不被新類型覆蓋)
  And rowMoveTab 應該更新為 NORMAL 的預設「不移動」
  And needEmail 應該更新為 NORMAL 的預設 false
  And 該訂單應該從 EXC 卡片移到 NORMAL 卡片(重新 render 看板)
  And 該訂單列應該顯示 ✏️ 標記(代表已人工調整)
  And Toast 應該顯示 "✓ <訂單 ID> 已從 🔵 EXC 訂單 改為 🟢 可出貨一般單"

Scenario: 人工分類調整不持久
  Given 使用者已將某筆 EXC 訂單改成 NORMAL
  When 重新點擊「🤖 啟動大數據掃描」
  Then 該訂單應該恢復為 EXC(自動分類重跑)
```

---

## F5. 階段 A:寫商家備註 + 發信

```gherkin
Feature: 階段 A — 寫商家備註 + 發信

Scenario: 寫商家備註
  Given 某筆訂單 rowNote = "預購品處理中"
  When 執行階段 A 對該訂單
  Then 應該先執行 forceCloseAllModals 清掉上一筆的殘留 modal
  And 打開 1shop 該訂單的「商家備註」彈窗
  And 在 textarea#shop_note 寫入 "MM/DD 預購品處理中"(執行時才加日期前綴)
  And 點擊儲存按鈕
  And processNoteForOrder 應回傳 true

Scenario: 寫商家備註失敗
  Given 某筆訂單所有備註入口候選都打不開 shop_note
  Then processNoteForOrder 應回傳 false
  And Toast 應顯示「⚠️ <訂單 ID> 寫商家備註失敗 → 本筆不移分頁、不分流」
  And 該訂單應進入失敗清單,不進階段 B/C

Scenario: 發信給顧客
  Given 某筆訂單 needEmail = true 且 pickEmailTemplate 有回傳公版
  When 執行階段 A 對該訂單
  Then 應該打開 1shop 該訂單的「客戶通訊」面板
  And 在 input#subject(name="subject")寫入主旨
  And 在 textarea#body_code(name="body_code")寫入內文
    註:平台欄位名是 body_code 不是 body,見 A 平台事實 P10
  And {{order_number}} 應替換為訂單編號、{{product_name}} 應替換為商品名稱
  And 點擊 modal 內的「確認」送出
  And sendEmailForOrder 應回傳 true

Scenario Outline: 發信公版的取用來源
  Given 某筆訂單 needEmail = true,類型為 <類型>、dupRole 為 <角色>
  When 執行階段 A
  Then 應該使用 <公版> 發信

  Examples:
    | 類型   | 角色       | 公版                              |
    | DUP    | KEEP       | 重複單公版(popup 存檔值優先)      |
    | DUP    | CANCEL     | (不發信,擋下)                    |
    | DUP    | PENDING    | (不發信,擋下)                    |
    | DUP    | UNPAID_DUP | 未付款催繳公版                     |
    | UNPAID | -          | 未付款催繳公版                     |
    | NORMAL | -          | (不發信,擋下)                    |

Scenario: 卡片上的公版編輯框只在被改過時才覆寫
  Given DUP 卡片的公版編輯框內容與存檔公版完全一致(使用者沒動過)
  When 執行階段 A
  Then 應該由每筆訂單自己的 dupRole 決定公版
  When 使用者把該編輯框內容改成別的文字
  And 重新執行階段 A
  Then 該卡片內所有「會發信」的訂單都應改用編輯框的內容

Scenario: 公版 popup 存檔後真的生效
  Given 使用者點「📧 異常單預設公版」,改寫【未付款催繳】主旨後按儲存
  Then 值應寫入 v11_unpaid_subj
  And 看板應立即重繪,UNPAID 卡片的公版編輯框應顯示新主旨
  When 執行階段 A 對一筆 UNPAID 訂單
  Then 寄出的信主旨應為新主旨

Scenario: 發信失敗要出聲,而且擋住後續階段
  Given 某筆訂單發信時找不到主旨或內文輸入框
  Then Console 應印出該 modal 內所有輸入欄位的 id / name(診斷用)
  And Toast 應顯示「❌ <訂單 ID> 發信失敗:找不到輸入框」
  And 應執行 forceCloseAllModals 清掉殘留 modal
  And sendEmailForOrder 應回傳 false
  And 該訂單應進入失敗清單
  When 階段 A 全部跑完
  Then 應彈出 alert 列出所有失敗訂單與原因
  And 失敗訂單不應進入階段 B 移分頁
  And 失敗訂單不應進入階段 C 物流分流
  And 其餘成功訂單應照常完成
  And 完成 Toast 應顯示「成功 N 筆,失敗 M 筆」而非只報總數

Scenario: rowNote 空白時跳過備註
  Given 某筆 NORMAL 訂單 rowNote 為空白
  When 執行階段 A 對該訂單
  Then 應該跳過寫備註動作
  And Console log 應顯示「該訂單無備註,跳過」
```

---

## F6. 階段 B:批次移分頁

```gherkin
Feature: 階段 B — 批次移分頁

Scenario: 依使用者選擇移分頁(V11.41 修正)
  Given 訂單 A: type=DUP, dupRole=CANCEL, rowMoveTab="已取消"
  And 訂單 B: type=DUP, dupRole=KEEP, rowMoveTab="不移動"(預設)
  And 訂單 C: type=DUP, dupRole=KEEP, rowMoveTab="已取消"(使用者手動改)
  When 執行階段 B
  Then 訂單 A 應該被移到「已取消」分頁
  And 訂單 B 應該被跳過(留給階段 C 自動分流)
  And 訂單 C 應該被移到「已取消」分頁(★ V11.41 修對:不再被無視)
  And Console log 應分別顯示:
    """
    [移分頁]   A → 已取消
    [移分頁]   B → 不移動 (DUP 保留筆,留給階段 C 自動分流當天出貨),跳過
    [移分頁]   C → 已取消
    """

Scenario: NORMAL 訂單在階段 B 一律跳過
  Given 某筆 NORMAL 訂單 rowMoveTab = "已確認"(使用者改的)
  When 執行階段 B
  Then 該訂單應該跳過(NORMAL 整類在階段 B 不處理,留給階段 C 物流流程)
  And Console log 應顯示「NORMAL 區 N 筆 → 跳過(物流流程處理)」

Scenario: 移分頁批次操作
  Given 三筆訂單要移到「確認中」
  When 執行階段 B
  Then 應該用 select.form-control.me-1.select-inline + button.btn.btn-primary[更新]
    一次批次移動三筆,而非逐筆移動
```

---

## F7. 階段 C:物流拋單與印單

```gherkin
Feature: 階段 C — 物流拋單與印單(per Carrier)

Background:
  Given 階段 A、B 已完成
  And 訂單已分流到對應的「拋單後分頁」
    (7-11/全家 → 已確認, 宅配 → 處理中)

Scenario Outline: 物流拋單 + 印單(per Carrier)
  Given 當前處於 <初始分頁>
  And 該分頁有 N 筆 <物流商> 訂單待處理
  When 開始處理 <物流商>
  Then 腳本應該:
    1. 切到「<拋單後分頁>」分頁
    2. 找到 provider="<provider>" 的拋單區段
    3. 全選 thead checkbox(勾到 N 筆)
    4. 點擊「更多批次功能」→ <拋單按鈕關鍵字>
    5. <二次確認流程>
    6. 點擊印單按鈕 <印單按鈕關鍵字>
    7. 點擊最終列印按鈕「<最終列印按鈕>」
    8. 等待 v11-open-bg-tab 事件(最多 25 秒)
    9. 記錄「✅ 已觸發背景開頁,耗時 N 秒」
    10. 關閉列印彈窗
    11. 換下一家物流

  Examples:
    | 物流商 | 初始分頁     | 拋單後分頁 | provider  | 拋單按鈕      | 印單按鈕            | 最終列印按鈕         | 二次確認流程        |
    | 7-11   | 等待確認     | 已確認     | 統一金流  | 超商取貨+拋單 | 超商取貨+物流單列印 | 7-ELEVEN大宗B2C     | (無)                |
    | 全家   | 等待確認     | 已確認     | 1ship     | 超商取貨+拋單 | 超商取貨+物流單列印 | 全家大宗B2C         | (無)                |
    | 宅配   | 等待確認     | 處理中     | 新竹物流  | 宅配+拋單     | 物流單列印+API      | 宅配 (新竹物流 HCT) | 跳出確認彈窗→點確認 |

Scenario: 該物流分頁沒有可拋訂單時跳過
  Given 7-11 拋單區段全選後勾選 = 0 筆(已全部拋過)
  When 進入 7-11 拋印流程
  Then 應該 log "[7-11] ⏭ 找不到拋單按鈕(可能已拋過)"
  And 跳過拋單,直接走印單流程
  And 不應該 throw error

Scenario: 找不到拋單按鈕記錄詳細 log
  Given 找不到符合 cfg.throwBtnText 的拋單按鈕
  When 嘗試拋單
  Then Console 應該記錄:
    """
    [<物流>] ⏭ 找不到拋單按鈕「<關鍵字 join +>」於「<provider>」section
    """
  And 不影響後續其他物流的執行

### 最終列印按鈕可見性判斷 

Scenario: 最終列印按鈕文字部分比對(含後綴)
  Given 全家最終列印按鈕真實文字為「全家大宗B2C (1ship 物流服務)」
  And LOGISTICS.fami.finalPrintBtn 配置為「全家大宗B2C」
  When findFinalPrintBtn('全家大宗B2C') 在 modal 內搜尋
  Then 應該以 includes(部分比對)找到該按鈕
    (配置不需含完整後綴,1shop 後綴變動也不影響)

Scenario: 可見性判斷用 offsetParent 而非 getBoundingClientRect
  Given modal 內有一顆按鈕 class 僅「btn」,文字含目標關鍵字
  And 該按鈕在某些 modal 結構下 getBoundingClientRect().width 量到 0
  But 該按鈕實際可見(offsetParent !== null)
  When findFinalPrintBtn 檢查該按鈕可見性
  Then 應該用 offsetParent === null 判斷隱藏(更可靠)
  And 不應該因 getBoundingClientRect().width === 0 而誤判跳過
  And 全家「全家大宗B2C (1ship 物流服務)」應該被成功找到

Scenario: 三家物流最終列印按鈕都找得到
  Given 7-11 / 全家 / 宅配 各自的印單 modal
  When findFinalPrintBtn 用各自 finalPrintBtn 關鍵字搜尋
  Then 7-11 應找到「7-ELEVEN大宗B2C」
  And 全家應找到「全家大宗B2C (1ship 物流服務)」
  And 宅配應找到「宅配 (新竹物流 HCT)」

### 跨頁翻頁(50+ 筆多頁)

Scenario: 超過一頁時自動翻頁繼續拋印
  Given 某物流分頁有 50+ 筆訂單,分成第 1 頁、第 2 頁
  And 使用者人在第 1 頁
  When processOneCarrier 處理完第 1 頁的拋印
  Then 應該呼叫 findNextPageBtn 找到下一頁按鈕
  And 應該點擊翻到第 2 頁繼續拋印
  And Console 應顯示「[<物流>] 切到第 2 頁」
  And 不應該在第 1 頁就顯示「已是最後一頁,結束跨頁處理」

Scenario: findNextPageBtn 可見性用 offsetParent
  Given 分頁列的 angle-right 按鈕在第 1 頁時 disabled=false(還有下一頁)
  But 該按鈕 getBoundingClientRect().width 量到 0
  And offsetParent !== null(實際可見)
  When findNextPageBtn 檢查該按鈕
  Then 應該用 offsetParent 判斷而非 width,成功找到 angle-right
  And 回傳該下一頁按鈕(不誤判為最後一頁)

Scenario: 真正最後一頁才停止
  Given 使用者在最後一頁
  And angle-right 的父 li 有 .disabled class
  When findNextPageBtn 檢查
  Then 應該正確回傳 null(父 li disabled 是真的沒下一頁)
  And processOneCarrier 顯示「已是最後一頁,結束跨頁處理」

Scenario: 切回第 1 頁也用 offsetParent
  Given processOneCarrier 開始時要切回第 1 頁
  When findFirstPageBtn 找 angles-left 按鈕
  Then 應該用 offsetParent 判斷可見性(與 findNextPageBtn 一致)
  And 成功切回第 1 頁作為跨頁起點

### 拋印分批(超過 50 筆)

Scenario: thead 全選固定選前 50 筆的限制
  Given 某物流「已確認」分頁有 70 筆訂單
  And 1shop thead 全選固定只選前 50 筆(實測)
  And 已拋單訂單仍可被勾選(不會變 disabled)
  When 用「全選 → 排除已拋」策略(V11.49 舊法)
  Then 前 50 拋完後再全選還是同一批(都已拋過)
  And 第 51 筆之後永遠選不到(V11.49 缺陷)

Scenario: 改用 DOM 掃描分批拋印(V11.50)
  Given 某物流分頁有 70 筆未拋訂單,全部在 tbody DOM 內
  When processOneCarrier 拋印
  Then 應該直接掃 tbody 全部列(不用 thead 全選)
  And 用 getOrderIdFromRow 比對 thrownIds 排除已拋
  And 每批手動勾最多 BATCH_SIZE(50)筆
  And 第 1 批拋 50 筆 → 加入 thrownIds → 回第 1 頁
  And 第 2 批掃到剩餘 20 筆未拋 → 拋完
  And log「共拋 70 筆」= 實際訂單數

Scenario: 拋印不重複同一筆
  Given 已拋單訂單仍在列表且可勾選
  When 每輪重新掃 DOM
  Then 已在 thrownIds 的訂單應被排除
  And 不會重複拋同一筆

### 跨物流勾選殘留清除 

Scenario: uncheckAllRows 逐筆清不靠 thead
  Given 前一個物流拋完後,列表殘留一些已勾選的 checkbox
  And thead 全選只影響前 50 筆
  When 呼叫 uncheckAllRows
  Then 應該逐筆取消所有 checked 的 checkbox(不靠 thead)
  And 清完後 tbody 內不應有任何 checked 的 checkbox

Scenario: 勾選時已勾的訂單納入而非跳過
  Given 某批目標訂單中,有些 checkbox 因殘留已是 checked 狀態
  When processOneCarrier 勾選這批
  Then 已勾的訂單應納入 batchIds(不因 cb.checked 而跳過)
  And 未勾的訂單補勾
  And batchIds 數量 = 這批目標數(不會因殘留變 0)

Scenario: 勾選前驗證清乾淨
  Given uncheckAllRows 後仍有殘留 checked
  When 進入批次勾選前
  Then 應偵測殘留並再清一次
  And 確保這批只勾到目標訂單,不混入殘留

### 分批印單去重(方法 B)

Scenario: 每批印單後精準取消這批勾選
  Given 某物流分批拋印,第 1 批勾選並印了 50 筆
  And 拋單/印單後這 50 筆仍是勾選狀態(1shop 不自動取消)
  When 第 1 批印單完成
  Then 應該用 batchIds 重新掃 DOM,對照訂單號逐筆取消這 50 筆的勾選
  And log 顯示「本批印畢,已取消這批勾選 N 筆」
  And 進入第 2 批時列表無殘留勾選

Scenario: 第二批印單不重印第一批
  Given 第 1 批已印 50 筆並取消勾選
  When 第 2 批勾選新的 3 筆並印單
  Then 印單只印這 3 筆(不含第 1 批的 50 筆)
  And 不會產生重複的物流單標籤

Scenario: 印後訂單列被重整時安全略過
  Given 印單後 1shop 可能移走或重整已印的列
  When 用 batchIds 取消這批勾選
  Then 對得到的列取消勾選
  And 對不到的列略過(下批掃描時 thrownIds 也會排除,雙保險)

Scenario: 批次開始殘留清除重試到乾淨
  Given 批次開始時列表可能有殘留 checked
  When 執行殘留清除
  Then 應重試最多 3 輪直到無 checked
  And 不因單次清不乾淨而讓殘留污染這批

### 分批第 2 批按鈕消失修正 

Scenario: 「更多批次功能」按鈕需有勾選才顯示
  Given 1shop「更多批次功能」按鈕在「0 勾選」時不渲染
  And 只有勾選訂單後 Vue 才渲染該按鈕
  When 某批取消所有勾選後(V11.52 印後取消)
  Then 該按鈕會暫時消失
  And 下一批需重新勾選才會再出現

Scenario: 第 2 批找按鈕改 waitFor 等待重試
  Given 分批拋印,第 1 批印後已取消勾選(按鈕消失)
  And 第 2 批重新勾選 N 筆,Vue 重繪按鈕需時間
  When tryThrowAction / doPrintAction 要找「更多批次功能」
  Then 應該用 waitFor 等待重試(最多 4 秒),而非一次性查詢
  And 給 Vue 足夠時間渲染按鈕後再點擊

Scenario: 分批第 2 批拋印成功不再靜默跳過
  Given >50 筆需分 2 批(如 71 筆 = 50 + 21)
  When 執行第 2 批
  Then 第 2 批應該找到「更多批次功能」按鈕並成功拋單、印單
  And log 不再出現「找不到更多批次功能按鈕」
  And 不再有應處理的訂單因第 2 批失敗而殘留在等待確認

# 註:重複單跨頁配對(UNPAID 跨頁移分頁、DUP 跨頁)尚未實作 → 見 E 變更紀錄與待修 T7
```

---

## F8. GM_openInTab 背景分頁機制(V11.40 核心)

```gherkin
Feature: GM_openInTab 在背景開啟物流單分頁

Background:
  Given 腳本的 @grant GM_openInTab 已生效
  And typeof GM_openInTab === "function"

Scenario: 點擊最終列印按鈕時不搶焦點
  Given 使用者畫面停留在「處理中」訂單列表
  When 腳本點擊「宅配 (新竹物流 HCT)」最終列印按鈕
  Then 不應該有新分頁跳到使用者眼前
  And 使用者畫面 focus 應該保持在「處理中」分頁
  And 在 Chrome 分頁列右側應該多出一個新分頁(背景)
  And 該背景分頁的內容應該是宅配物流單

Scenario: 動態等待物流單分頁產生(V11.42 新增)
  Given 7-11 平台網路慢
  When 腳本點擊「7-ELEVEN大宗B2C」最終列印按鈕
  And 開始計時 t0
  Then 應該顯示「📂 7-11 物流單分頁產生中,請稍候...」toast
  And 應該執行 waitFor(() => lastOpenBgTabTime > t0, 25000)
  When 攔截器在 18 秒後收到 window.open 並 dispatchEvent
  Then 應該立刻繼續(不會傻等到 25 秒)
  And Console log 應顯示「[7-11] ✅ 已觸發背景開頁,耗時 18.3 秒」
  And Toast 應顯示「✅ 7-11 物流單已在背景分頁(18.3s)」

Scenario: 25 秒 timeout 也要繼續
  Given 物流商伺服器爆掉,window.open 完全沒被觸發
  When 點擊最終列印按鈕後 25 秒
  Then 應該 log "[<物流>] ⚠️ 25 秒內沒收到「背景開頁」事件..."
  And Toast 應顯示「ℹ️ <物流> 物流單請至新分頁查看」
  And 應該關閉列印彈窗繼續下一家(不卡死)

Scenario: GM_openInTab 不可用時 fallback
  Given typeof GM_openInTab !== "function"(@grant 沒生效)
  When 攔截到 window.open 並派發事件
  Then Sandbox 監聽器應該 console.warn "GM_openInTab 不可用,fallback 用 window.open(會搶焦點)"
  And 應該用原生 window.open(url, '_blank') 開新分頁
```

---

## F9. 三路徑攔截器

```gherkin
Feature: 三路徑攔截器(form / window.open / a.click)

Background:
  Given 攔截器已注入 page scope
  And window.__v11_dualTrackInstalled === true

Scenario: 路徑 A — form submit 攔截
  Given 1shop 有個 <form action="/print/xxx"> 想要 submit
  When 該 form 被 submit
  Then 攔截器應該偵測到 action URL 含 "print"
  And 應該 dispatchEvent('v11-open-bg-tab', { url: '/print/xxx' })
  And 應該 return(不執行原生 submit)
  And 不應該觸發頁面導航

Scenario: 路徑 B — window.open 攔截
  Given 1shop 想要 window.open('/handle/abc-uuid')
  When 該 window.open 被呼叫
  Then 攔截器應該偵測到 URL 含 "/handle/"
  And 應該 dispatchEvent('v11-open-bg-tab', { url: '/handle/abc-uuid' })
  And 應該 return null(阻止原生開新分頁)
  And Console log 應顯示 "[V11.42] 攔截 window.open → 背景分頁: /handle/..."

Scenario: 路徑 C — <a target="_blank"> click 攔截(V11.42 新增,救宅配)
  Given 1shop 渲染 <a href="https://hct.com.tw/label" target="_blank">列印</a>
  When 使用者(或腳本)點擊該 a tag
  Then 攔截器應該在 capture 階段攔到 click
  And 偵測到 a 的 target="_blank" 且 href 含 "label"
  And 應該 e.preventDefault() + e.stopImmediatePropagation()
  And 應該 dispatchEvent('v11-open-bg-tab', { url: 'https://hct.com.tw/label' })
  And Console log 應顯示 "[V11.42] 攔截 <a target='_blank'> click → 背景分頁: ..."

Scenario: 非物流相關 URL 不被攔截
  Given 1shop 想要 window.open('/help/faq')(不含印單關鍵字)
  When window.open 被呼叫
  Then 攔截器應該正常呼叫原生 _origOpen
  And 新分頁應該正常打開到使用者眼前
```

---

## F10. 警告 modal 自動關閉(V11.42 新增)

```gherkin
Feature: 自動關閉「無法另開視窗」警告

Background:
  Given 腳本啟動時已建立全域 setInterval(300ms)
  And Modal Killer 正在運作

Scenario: 1shop 跳警告 modal 時秒關
  Given 1shop 內部判定 window.open 被擋
  When 1shop 跳出 modal 含文字「無法另開視窗,瀏覽器阻擋了新分頁」
  Then 在 300ms 內 Modal Killer 應該偵測到
  And 應該尋找該 modal 內的關閉按鈕
    順序:.close → .modal-close → .btn-close → [aria-label*=關閉] → 找文字為 ×/✕/X 的元素
  And 點擊第一個找到的關閉按鈕
  And Console log 應顯示 "[V11.42] 自動關閉「無法另開視窗」警告 modal"
  And 該 modal 應該消失

Scenario: 找不到 X 按鈕時 fallback ESC
  Given Modal 含警告文字但沒有 X 按鈕
  When Modal Killer 偵測到該 modal
  Then 應該對 modal 派發 KeyboardEvent('keydown', { key: 'Escape' })
  And Console log 應顯示 "[V11.42] 找不到 X 按鈕,改派 ESC 關閉"

Scenario: 不影響其他 modal
  Given 頁面有其他 modal(例如商家備註編輯彈窗)
  When Modal Killer 掃描
  Then 應該只關閉文字含「無法另開視窗 / 瀏覽器阻擋了新分頁 / 阻擋彈出式視窗」的 modal
  And 其他 modal 不受影響
```

---

## F11. autoUX 流程(V11.42/V11.43 重要修法)

```gherkin
Feature: autoUX — 統一的執行 UX 包裝

Background:
  Given withAutoUX 函式包裝任何主要動作(全局批次/自動分流等)
  And 流程為:① 縮小看板 → ② 顯示進度泡泡 → ③ 執行動作 → ④ 收掉泡泡

Scenario: autoUX 開始時縮小看板
  Given 看板 modal 處於展開狀態
  When 使用者點擊「🌟 一鍵全局批次執行」(透過 withAutoUX 包裝)
  Then #v11-overlay 應該 display:none(看板縮小)
  And 應該顯示進度泡泡 "🚀 一鍵全局批次執行 執行中,請勿關閉視窗..."
  And Console log 應顯示 "[autoUX] ▶ 一鍵全局批次執行 開始"

Scenario: autoUX 動作執行中
  Given 進度泡泡正在顯示
  When 動作執行中(階段 A → B → C)
  Then 進度泡泡應該保持顯示
  And 各階段內可自由更新泡泡文字(例如 "📂 7-11 物流單分頁產生中...")
  And 動作中的 toast 通知正常彈出在右上角

Scenario: autoUX 動作完成後不重新掃描(V11.42 修法)
  Given 動作執行成功
  When 進入 autoUX 結尾階段
  Then 應該 log "[autoUX] 動作完成,需要更新看板請手動點「🤖 啟動大數據掃描」"
  And 不應該自動呼叫 startScan()
  And 不應該顯示「🔄 動作完成,重新掃描中...」進度泡泡

Scenario: autoUX 動作完成後不展開看板(V11.43 修法)
  Given 動作執行成功
  When 進入 autoUX 結尾階段
  Then hideProgressBubble() 應該被呼叫(關掉進度泡泡)
  And showKanbanModal() 應該 NOT 被呼叫(★ V11.43 移除)
  And 看板維持縮小狀態
  And 使用者畫面停留在原訂單列表
  And Toast 應顯示「✅ 一鍵全局批次執行 完成(中控台保持縮小,點浮動按鈕可展開看板)」

Scenario: autoUX 動作失敗仍需收尾
  Given 動作執行 throw exception
  When 進入 catch 區段
  Then errorOccurred 應為 true
  And Toast 應顯示「❌ 一鍵全局批次執行 執行失敗:<錯誤訊息>」
  And 仍要 hideProgressBubble()(不能卡住 UI)
  And 不應該顯示「完成」的 success toast
  And Console log 應顯示 "[autoUX] ◀ 一鍵全局批次執行 結束"
```

---

## F12. 跨頁續航

```gherkin
Feature: 跨頁續航(階段 C 切分頁後接續)

Scenario: 切到「已確認」分頁前儲存續航資料
  Given 階段 C 處理 7-11,需要切到「已確認」分頁
  When 切分頁前
  Then 應該存 localStorage:
    | key                    | 值          |
    | v11_resume_logistics   | "1"         |
    | v11_resume_payload     | { ... }     |
  And 點擊「已確認」分頁(觸發 1shop reload)

Scenario: reload 後自動續航
  Given 頁面 reload 後,腳本啟動
  When 腳本偵測到 localStorage.v11_resume_logistics === "1"
  Then 應該顯示 toast "🔄 偵測到上次未完成的物流流程,3 秒後繼續..."
  And 等待 3 秒(讓 1shop 渲染完成)
  And 從 v11_resume_payload 還原訂單資料
  And 接續執行 processOneCarrier 流程

Scenario: 全部流程完成清除續航旗標
  Given 階段 C 全部物流(7-11/全家/宅配)都完成
  When 進入 runLogisticsByGroup 結尾
  Then 應該 Storage.del(LS.RESUME_FLAG)
  And 應該 Storage.del(LS.RESUME_PAYLOAD)
  And Toast 應顯示 "✅ 所有物流拋印完成"
```

---

## F13. 相同商品組合批次拋印(V11.44 新增)

```gherkin
Feature: 一般單依商品組合過濾批次拋印
  作為出貨人員
  我希望能只挑「同一種商品組合」的一般單一鍵拋印
  以便針對特定商品(例如某個熱賣組合)集中出貨

Background:
  Given 已完成大數據掃描
  And NORMAL 卡片有多筆訂單
  And 每筆訂單在掃描時已產生 comboLabel(短格式 SKU*數量)

Scenario: comboLabel 短標籤產生
  Given 一筆訂單的購買商品 td[4] 含 .color-sku="DK4-BK" 與 .text-danger="2"
  When scrapeCurrentPage 解析該訂單
  Then 該訂單 product 應為完整名(含 [DK4-BK] 商品名稱)
  And 該訂單 comboLabel 應為短格式 "DK4-BK*2"
  And 多項商品時 comboLabel 用「+」串接,例如 "DK4-BK*2+7DS-PK*1"

Scenario: comboLabel 不影響既有 product
  Given V11.43 既有的分類比對依賴 o.product
  When V11.44 新增 comboLabel
  Then o.product 的值與格式應該完全不變
  And 自動分類結果應該與 V11.43 一致(comboLabel 是獨立新增欄位)

Scenario: NORMAL 區顯示商品組合下拉
  Given NORMAL 卡片有 5 筆訂單,其中:
    | 商品組合      | 筆數 |
    | DK4-BK*2      | 3    |
    | 7DS-PK*1      | 1    |
    | NIKE-AF1*1    | 1    |
  When renderKanban 渲染 NORMAL 卡片底部
  Then 應該出現 .v11-combo-select 下拉
  And 下拉應該只列「>1 筆」的組合(DK4-BK*2 那組)
  And 單筆組合(7DS-PK*1、NIKE-AF1*1)不應出現在下拉
  And 下拉第一個 option 應為「📦 全部商品組合」(value="all")
  And 組合 option 應顯示「[3筆] DK4-BK*2」格式
  And 組合 option 的 value 應為完整 product(非短標籤)

Scenario: 組合下拉只在 NORMAL 出現
  Given DUP / UNPAID / PREORDER / EXC / OVERSEAS 卡片
  When renderKanban 渲染這些卡片
  Then 這些卡片底部不應該有 .v11-combo-select
    (★ V11.44 決議:只 NORMAL 加,異常單通常不需組合拋印)

Scenario: 依組合過濾拋印
  Given NORMAL 卡片有 5 筆,其中 3 筆是「DK4-BK*2」組合
  And 使用者在 .v11-combo-select 選了「[3筆] DK4-BK*2」
  When 點擊「🚀 單獨執行本區拋單」
  Then getCheckedOrders('card', 'NORMAL', combo) 應該只回傳 product 完全等於該組合的訂單
  And 確認彈窗應顯示「📦 僅限商品組合:<product>」
  And purePrintByCarrier 應該只對這 3 筆執行拋印
  And 其他 2 筆不受影響

Scenario: 選「全部商品組合」時不過濾
  Given 使用者在 .v11-combo-select 維持「📦 全部商品組合」(value="all")
  When 點擊「🚀 單獨執行本區拋單」
  Then 應該對所有勾選的 NORMAL 訂單拋印(不依商品過濾)

Scenario: 找不到符合組合的訂單
  Given 使用者選了某組合,但該組合的訂單都被取消勾選
  When 點擊拋印
  Then getCheckedOrders 應回傳空陣列
  And Toast 應顯示「找不到符合「<product>」商品組合的勾選訂單」
  And 不應該執行任何拋印動作

Scenario: sticky footer 長清單吸附
  Given NORMAL 卡片有大量訂單,清單需要滾動
  When 使用者向下滾動卡片內容
  Then .v11-card-footer(含物流下拉、組合下拉、拋印按鈕)應該吸附在底部
  And 操作區不會被滾動內容蓋住或推出視窗

### 組合下拉連動物流篩選 

Scenario: 物流下拉改變時組合下拉即時重算筆數
  Given NORMAL 卡片有訂單,DK4-BK*2 組合全部 5 筆
  And 其中 7-11 物流 3 筆、全家物流 2 筆
  And 物流下拉預設「📦 全部物流自動分流」
  Then 組合下拉應顯示「[5筆] DK4-BK*2」
  When 使用者把物流下拉切換為「7-11 物流」
  Then 組合下拉應該即時重算,顯示「[3筆] DK4-BK*2」
  When 使用者把物流下拉切回「全部物流」
  Then 組合下拉應恢復顯示「[5筆] DK4-BK*2」

Scenario: 物流判斷依據與拋印分組一致
  Given orderMatchesCarrier(order, which) 用 LOGISTICS[which].shipTextMatch 比對 o.shipText
  When 計算某物流的組合筆數
  Then 應該與 runLogisticsByGroup 實際會拋的訂單一致
  And 「組合下拉顯示的筆數」必須等於「按拋印後實際處理的筆數」

Scenario: 重算後保留使用者原選組合
  Given 使用者已在組合下拉選了「DK4-BK*2」
  And 該組合在「全家」物流下也有 >1 筆
  When 使用者把物流下拉切換為「全家」
  Then 組合下拉重算後應該保留選取「DK4-BK*2」(因為新物流下仍存在)

Scenario: 重算後原選組合消失則跳回全部
  Given 使用者已在組合下拉選了「DK4-BK*2」
  And 該組合在「宅配」物流下只有 1 筆(不符 >1 筆條件,不會出現在選單)
  When 使用者把物流下拉切換為「宅配」
  Then 組合下拉重算後找不到「DK4-BK*2」
  And 應該自動跳回「📦 全部商品組合」(value="all")

Scenario: 物流篩選後組合過濾拋印一致
  Given 物流下拉選「7-11」,組合下拉選「[3筆] DK4-BK*2」
  When 點擊「🚀 單獨執行本區拋單」
  Then runLogisticsForCard('NORMAL', '711', combo) 應該只拋這 3 筆
  And 這 3 筆都必須同時符合「7-11 物流」+「DK4-BK*2 組合」

### 商品組合下拉透明統計 

Scenario: 下拉標題顯示可出貨總筆數
  Given NORMAL 可出貨 28 筆
  And 其中 >1 筆的組合共 4 組(7+5+4+4=20 筆)
  And 其餘 8 筆為單筆組合或無商品資訊
  When 產生商品組合下拉
  Then 第一個 option 應顯示「📦 全部商品組合 (共 28 筆)」(value="all")

Scenario: 底部說明列讓數字透明
  Given 下拉列出的組合加總(20)少於可出貨總數(28)
  When 產生商品組合下拉
  Then 底部應有 disabled 分隔線
  And 底部應有 disabled 說明「ℹ️ 已列 2 筆↑組合 20 筆,其餘 8 筆為單筆或無商品」
  And 這兩個說明列不可被選取(disabled)

Scenario: 無被隱藏筆數時不顯示說明
  Given 所有可出貨訂單都屬於 >1 筆的組合(listedCount == totalMatched)
  When 產生商品組合下拉
  Then restCount 為 0
  And 不顯示底部說明列(避免多餘)

Scenario: 統計數字依物流即時重算
  Given 組合下拉顯示「全部商品組合 (共 28 筆)」
  When 使用者把物流下拉切換為「7-11」
  Then 標題總數與說明列的筆數應重算為「只算 7-11 的可出貨訂單」

Scenario: 顯示下拉的判斷不受標題文字影響
  Given V11.53 標題含動態總數「(共 N 筆)」
  When 判斷是否顯示組合下拉
  Then 應用 regex 偵測是否含實際組合 option(value 非 all)
  And 不可用整串固定文字比對(否則標題變動就失效)

Scenario: 全部單筆組合時下拉不顯示
  Given NORMAL 訂單全部都是單筆組合(無任何 >1 筆組合)
  When 產生商品組合下拉
  Then hasRealCombo 為 false
  And 不顯示商品組合下拉
```

---

## F14. 看板購買商品欄顯示短標籤(V11.46 新增)

```gherkin
Feature: 看板「購買商品」欄顯示 comboLabel 短標籤
  作為出貨人員
  我希望購買商品欄顯示精簡的 SKU*數量 而非冗長的完整商品名
  以便快速掃讀每筆訂單的商品內容

Background:
  Given 已完成大數據掃描
  And 每筆訂單在掃描時已產生 comboLabel(短格式 SKU*數量)
  And 每筆訂單的 o.product 為完整名(含 [SKU] 商品全名)

Scenario: 購買商品欄顯示短標籤
  Given 一筆訂單 o.product = "[DK4-BK] 黑色滑鼠墊  /  [7DS-PK] 粉色鍵盤"
  And 該訂單 o.comboLabel = "DK4-BK*2+7DS-PK*1"
  When renderKanban 渲染該訂單的 td-product 欄
  Then td-product 顯示文字應為 "DK4-BK*2+7DS-PK*1"(短標籤)
  And td-product 的 title 屬性應為完整商品名(供 hover 查看)

Scenario: 短標籤適用於所有區塊
  Given DUP / UNPAID / PREORDER / EXC / OVERSEAS / NORMAL 各區都有訂單
  When renderKanban 渲染各區的訂單列
  Then 所有區塊的 td-product 都應顯示 comboLabel 短標籤
    (不限 NORMAL,全看板統一格式)

Scenario: comboLabel 缺失時 fallback
  Given 一筆訂單因無 SKU 結構,comboLabel 為空或 "無商品資訊"
  When renderKanban 渲染該訂單
  Then td-product 應 fallback 顯示 o.product(不會空白)
  And 若 product 也為空,顯示 "-"

Scenario: 顯示改變不影響資料層
  Given V11.46 把 td-product 顯示改為 comboLabel
  Then o.product 的值與格式應該完全不變
  And 自動分類比對(依 o.product)結果應與先前一致
  And 組合過濾(combo value = o.product)應正常運作
  And 組合下拉的 option value 仍為完整 product
```

---

## 附錄 A:Done 定義(Definition of Done)

每個 Feature 完成需符合以下標準:

```gherkin
Background: Done 標準
  Given 程式碼通過 node --check 語法檢查
  And Tampermonkey 編輯器標題乾淨(沒有 ● 未儲存標記)
  And Tampermonkey 儀表板顯示對應的 @version
  And F12 Console 啟動 log 顯示對應的 V 版本
  And 預期 toast 訊息正確出現
  And 預期 Console log 訊息正確出現
  And 不影響非目標物流商的執行(隔離性)
  And 不破壞既有 localStorage 狀態(向下相容)
```

---

## 附錄 B:Commit 前 checklist

```gherkin
Scenario: 升版前手動 checklist
  Given 已完成某個 Feature 的修改
  Then 在覆蓋 Tampermonkey 編輯器前應確認:
    ☐ 1. const VERSION = 'V11.XX' 有同步更新
    ☐ 2. Metadata @version 11.XX.0 有同步更新
    ☐ 3. Metadata @name 有同步更新(便於使用者辨識)
    ☐ 4. Metadata @description 有列出本次修改內容
    ☐ 5. node --check 通過語法檢查
    ☐ 5b. node tests/pay_status.test.js 全數通過(付款狀態 / 重複單分流回歸測試)
    ☐ 6. 重點修改點有 ★ V11.XX 註解
    ☐ 7. 沒留下未完成的 console.log 除錯訊息
    ☐ 8. 沒留下被註解掉的舊邏輯(除非有特別保留原因)
```

---

## 附錄 C:共用測試資料

### C.1 測試訂單樣本(可用於手動驗收)

| 樣本 | 訂單編號樣式 | 預期分類 | 用途 |
|---|---|---|---|
| 純預購 | DK4-BK 含 SKU | PREORDER | 測試預購關鍵字匹配 |
| 純未付款 | 付款狀態「等待付款」 | UNPAID | 測試 UNPAID 分類 |
| 折抵單 | 折抵金額 > 0 | EXC | 測試 EXC 分類 |
| 海外單 | 收件地含「Hong Kong」 | OVERSEAS | 測試 OVERSEAS 分類 |
| 重複單(KEEP) | 同顧客有 2 筆,其中 1 筆刷卡成功或貨到付款 | DUP KEEP | 測試 DUP 細分 + 保留筆發信 |
| 重複單(CANCEL) | 同上,同組的另一筆 | DUP CANCEL | 測試「取消筆只寫備註、不發信」閘門 |
| 重複單(PENDING) | 同顧客 2 筆**皆純未付款**,或 2 筆**皆貨到付款** | DUP PENDING | 測試「整組無成功筆時不硬選 KEEP」 |
| 重複單(UNPAID_DUP) | 同顧客 2 筆,一筆未付款 + 一筆刷卡失敗 | DUP UNPAID_DUP / PENDING | 測試情境 E 的催繳信分流 |
| 發信失敗筆 | 任一會發信的訂單,發信 modal 開啟後手動關掉 | (不變) | 測試失敗筆隔離:不移分頁、不分流、跑完彈 alert |
| 一般單 | 不符合上述條件 | NORMAL | 測試預設行為 |

### C.2 物流測試樣本

| 物流商 | 觸發方式 | 攔截路徑 | 預期日誌 |
|---|---|---|---|
| 7-11 | window.open | 路徑 B | `[V11.42] 攔截 window.open → 背景分頁` |
| 全家 | window.open | 路徑 B | `[V11.42] 攔截 window.open → 背景分頁` |
| 宅配 | a target=_blank | 路徑 C | `[V11.42] 攔截 <a target="_blank"> click → 背景分頁` |

---

## 附錄 D:故障排除(Troubleshooting)

| 症狀 | 可能原因 | 排查步驟 |
|---|---|---|
| Console 啟動 log 顯示舊版本 | Tampermonkey 編輯器內容未儲存 | 確認儀表板版本號 + 編輯器標題無 ● |
| Tampermonkey 儀表板顯示對的版本但 Console 還是舊版 | Tampermonkey 快取問題 | 切換腳本「啟用/停用」開關;或 chrome://extensions/ 重新載入 Tampermonkey |
| 物流單分頁跳到使用者眼前 | GM_openInTab 不可用 | 檢查 @grant 是否有 GM_openInTab;Console 跑 typeof GM_openInTab |
| 警告 modal 沒被自動關閉 | Modal 結構不符 Killer 的 selector | F12 找出該 modal 的 class 名稱;更新 Modal Killer 的 selector 清單 |
| 宅配印單沒觸發背景開頁 | 1shop 改用了第 4 種觸發方式 | F12 觀察 click 事件;考慮加路徑 D |
| 人工調整移分頁被忽略 | rowMoveTab 沒被儲存到 allOrders | 確認 saveRowInputsToData() 在執行階段 B 前有被呼叫 |
| 階段 C 切分頁後流程中斷 | localStorage RESUME_FLAG 未生效 | F12 Application 看 localStorage 是否存有 v11_resume_logistics |
