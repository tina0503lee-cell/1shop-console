# D 註解與交付規範
<!-- 更新：2026-08-13 -->

> **適用場景**：寫註解、判斷註解好壞、標 TODO/FIXME/HACK、改 code 前後的標準動作。
> **不處理**：Claude 協作紀律（plan-first、禁刪 ★ 註解、交付閘門）已上移至 CLAUDE.md 常駐層，本檔不重複；平台行為（→ A 平台事實）
> **前置依賴**：無
> **共用參照**：術語與常數

---

## 前置紀律（本檔其餘內容之上的兩條）

### 一、事實已入 A 者，註解簡化為指向

`★ V11.XX` 標記**永不刪除**（版本血統證明）。但當某條解釋的完整版已寫進 `A 平台事實` 時，行內註解改寫成指向，不重複整段理由：

```js
// ❌ 兩份副本：改了 A 卻忘了改這裡，兩邊說法就會不一致
// ★ V11.54: 「更多批次功能」按鈕是 Vue 有勾選才渲染，0 勾選時不存在，
//            取消勾選後重繪需時間，一次性 findBtnByText 抓不到會靜默失敗...

// ✅ 指向唯一權威
// ★ V11.54: 改 waitFor 等 Vue 重繪，理由見 A 平台事實 P6/P7
```

判斷標準：**這條理由是「平台為什麼這樣」→ 指向 A；是「我這段 code 為什麼這樣寫」→ 留在註解。**

### 二、交付即存檔，不貼回 Tampermonkey

Tampermonkey 以 `@require file://` 載入 `src/1shop_ultimate.user.js`，改完存檔重整即生效。三個必要設定與排錯順序見 `tampermonkey_stub.user.js` 的檔頭註解。

⚠️ 最常見的假 bug：改了檔案卻看到舊行為 → 先懷疑 Tampermonkey 的**外部資源快取**，不要先懷疑程式。

---


## 0. 核心哲學:好註解的 3 黃金法則

### 🟡 法則 1:寫「為什麼」,不寫「做什麼」

程式碼會說「做什麼」(讀就懂),註解要說「為什麼這樣做」(讀不出來)。

```javascript
// ❌ 廢話註解:程式碼自己會說
i++; // i 加 1
total = price * quantity; // total 是 price 乘 quantity

// ✅ 有價值的註解:解釋為什麼
i++; // 跳過第 1 列(thead),從第 2 列開始才是訂單資料
total = price * quantity * 1.05; // ★ 含 5% 物流費,1shop 後台計算規則
```

### 🟡 法則 2:用「人話」寫,別用技術術語裝專業

寫給「會寫程式但不熟這個專案的人」看。

```javascript
// ❌ 技術術語堆砌(看不懂在攔什麼)
// 注入 page scope 並 hook HTMLFormElement.prototype.submit 進行 dispatchEvent

// ✅ 人話版(立刻知道目的)
// 攔下 1shop 想要 form.submit() 開印單分頁的動作,
// 改成派個訊號讓 Tampermonkey 在背景開分頁(使用者不被打擾)
```

### 🟡 法則 3:重要的事情用 emoji 凸顯,讓眼睛能掃讀

人類眼睛掃 emoji 比掃文字快 10 倍。在 1shop 專案我們用這套標準:

| Emoji | 意義 | 使用時機 |
|---|---|---|
| ⭐ 或 ★ | 重要 / 關鍵點 | 重要邏輯、不能輕易動的地方 |
| 🐛 | Bug 修正 | 修 bug 的 commit |
| 🎯 | 目標 / TODO | 待辦事項 |
| ⚠️ | 警告 | 容易踩雷的地方 |
| 💡 | 提示 / 技巧 | 巧妙的寫法、別人不知道的小技巧 |
| 🚫 | 禁止 | 「絕對不要這樣改」 |
| 📝 | 備註 | 一般說明 |
| 🔥 | 危險 | 改這裡要超小心 |
| ✅ | 確認 / 完成 | 已驗證的邏輯 |
| 🔗 | 關聯 | 跟其他地方有關 |

---

## 1. 6 種註解類型 + 範例

### 1.1 檔案級註解(整份檔案最上方)

```javascript
// ==UserScript==
// @name         🔥 1shop 出貨中控台 (V11.43 結束不展開)
// @namespace    http://tampermonkey.net/
// @version      11.43.0
// @description  V11.43 移除「一鍵全局批次執行結束後自動展開看板」:autoUX 結尾的 showKanbanModal() 呼叫已移除...
// @author       Tina + Claude
// @match        *://admin.1shop.tw/*
// ==/UserScript==
```

**新手記點**:`@description` 是這個檔案的「電梯簡報」,每次升版都要更新,讓拿到檔案的人看一眼就知道這版做了什麼。

---

### 1.2 區段級註解(分隔大區塊)

用 `// ====` 框起來,emoji + 區段名,序號標清楚順序。

```javascript
// ============================================================
//  ⓪ 全域常數 / 設定
// ============================================================
const VERSION = 'V11.43';
const LS = { ... };

// ============================================================
//  ① 通用工具函式
// ============================================================
const $  = (sel, root = document) => root.querySelector(sel);

// ============================================================
//  ⑦ 掃描引擎
// ============================================================
async function startScan() { ... }
```

**新手記點**:
- 區段標題用 ① ② ③ 標序,scrolling 時眼睛容易抓位置
- 區段內部相關函式集中,不要散落各處

---

### 1.3 函式級註解(每個函式上方,JSDoc 風格)

複雜函式必加,簡單一行函式可省略。

```javascript
/**
 * 重複單情境判定(A/B/C/D/E)
 *
 * 情境 A:純未付款(線上刷卡尚未付款 / 等待付款 / 待確認付款) → 不發信,移交確認中
 * 情境 B:兩筆皆貨到付款 / 超商取貨時付款 → 不發信,移交確認中(沿用 A 處理)
 * 情境 C:一筆貨到付款 + 一筆刷卡失敗 → 保留貨到付款,失敗筆寄信通知取消
 * 情境 D:一筆刷卡成功 + 一筆刷卡失敗 → 保留成功筆,失敗筆寄信通知取消
 * 情境 E:其他狀況 → 走預設處理
 *
 * @param {Array<Order>} orders - 同一顧客的多筆訂單
 * @returns {Object} { keep: Order, cancel: Order[] }
 */
function judgeDuplicateScenario(orders) {
  // ...
}
```

**新手記點**:
- 第一行:**一句話總結**(別人在 IDE hover 會先看這行)
- 中間段:詳細邏輯/情境列表
- `@param` / `@returns`:標型別,IDE 會提示

---

### 1.4 行內註解(行末 or 行上)

#### 短說明放行末

```javascript
const TIMEOUT = 25000;          // 25 秒,7-11 平台慢時夠用
const SLEEP_BETWEEN_PAGE = 1500; // 切分頁等 1.5 秒讓 1shop 渲染
```

#### 長說明放行上

```javascript
// ★ V11.42:waitFor 第 1 個參數是「檢查函式」,第 2 個是最大等待毫秒
// lastOpenBgTabTime 是全域變數,攔截器收到 window.open 會更新它
await waitFor(() => lastOpenBgTabTime > t0, TIMEOUT);
```

**新手記點**:
- 一行寫不完就放上面
- 別在每行都寫,看的人會煩

---

### 1.5 版本標記(★ V11.XX:)

**這是我們專案最重要的註解類型**。任何修改要標版本號,以後可追溯。

```javascript
// ★ V11.41:DUP KEEP 預設 rowMoveTab 從「已確認」改為「不移動」
// 原因:UI 顯示「已確認」但邏輯寫死跳過,讓使用者誤以為會移過去
order.rowMoveTab = '不移動';
```

```javascript
// ★ V11.42 新增:全域 modal killer
// 自動關閉 1shop 跳出的「無法另開視窗」警告
setInterval(() => {
  // ...
}, 300);
```

```javascript
// ★ V11.40 重構:刪除 runAutoPrintKiller 與 forceDownloadPDF
// 原因:背景分頁機制不再需要在「印單分頁內」做任何事
// (這裡保留註解是為了讓未來看到的人知道為什麼少了這兩個函式)
```

**新手記點**:
- ★ V11.XX 是這個專案的「血統證明」
- 改別人的 code 時順手標,讓未來能追溯到哪一版改的
- **不要刪別人的 ★ V11.XX 註解**,那是歷史資產

---

### 1.6 警告 / 技巧註解(⚠️ / 💡 / 🚫)

#### ⚠️ 警告 — 「這裡有雷,動之前看清楚」

```javascript
// ⚠️ 注意:這個 selector 不能改成 'button.submit',
// 1shop 同一頁有兩個 submit 按鈕(發信彈窗 + 商家備註彈窗),
// 必須用 '.modal-dialog button' 限定範圍才不會點錯
const btn = $('.modal-dialog button[type="submit"]');
```

#### 💡 技巧 — 「這裡的寫法有特別原因」

```javascript
// 💡 用 capture: true 是因為 1shop 自己也綁了 click handler,
// 我們要在 capture 階段搶先攔截才能 preventDefault
document.addEventListener('click', handler, true);
```

#### 🚫 禁止 — 「不要改這裡,改會壞」

```javascript
// 🚫 不要把這個 sleep 拿掉!
// 1shop 切分頁後,Vue 重新渲染需要時間,
// 沒等就掃 DOM 會抓到舊資料(實測掃描結果會少 30%)
await sleep(2500);
```

#### 🐛 Bug 修正 — 「改這行修了什麼」

```javascript
// 🐛 V11.41 修:之前 if (type === 'DUP' && o.dupRole === 'KEEP') continue
// 寫死跳過,完全沒看 rowMoveTab,使用者人工調整被無視
const tab = o.rowMoveTab || TYPE_DEFAULT_TAB[type];
```

---

## 2. 常見「壞註解」與改寫

### 壞 1:翻譯機

```javascript
// ❌ 註解只是把英文翻成中文
function getUserName() { // 取得使用者名稱
  return user.name;      // 回傳 user 的 name
}

// ✅ 註解寫程式碼不會說的事
function getUserName() {
  // ⚠️ user 物件可能是 null(尚未登入),呼叫端記得防呆
  return user?.name || '訪客';
}
```

### 壞 2:過時 / 跟程式碼不符

```javascript
// ❌ 註解說 10 秒,程式碼是 25 秒(改 code 沒改註解)
// 等 10 秒讓物流單載入
await sleep(25000);

// ✅ 註解跟著改,或直接拿掉「具體秒數」
// 等物流單分頁完全載入(7-11 平台慢時要久一點)
await sleep(25000);
```

**新手提醒**:改 code 時習慣性掃一下「這附近的註解還對嗎?」

### 壞 3:被註解掉的舊 code(垃圾)

```javascript
// ❌ 留垃圾在 code 裡,沒人敢刪
// closeBtn.click();
// await sleep(1000);
// showKanbanModal();
hideProgressBubble();

// ✅ 要嘛刪掉,要嘛標清楚為什麼留
// ★ V11.43 移除 showKanbanModal(),改為跑完維持縮小狀態
//   (這行刪掉,git history 可追溯)
hideProgressBubble();
```

**新手提醒**:被註解掉的 code 是味道(code smell)。要嘛確定不用→刪掉(git 會記得),要嘛留下要加說明。

### 壞 4:沒人看得懂的縮寫

```javascript
// ❌ 縮寫地獄
// 處理 DUP 的 RMT
o.rmt = '不移動';

// ✅ 全名 + 解釋
// DUP KEEP 預設不要移分頁(留給階段 C 物流自動分流)
// rowMoveTab = 訂單列的「移動目的地分頁」下拉的當前值
order.rowMoveTab = '不移動';
```

---

## 3. TODO / FIXME / HACK — 三種待處理標記

放在註解開頭,讓 IDE / grep 能搜出來。

| 標記 | 意義 | 範例 |
|---|---|---|
| `TODO:` | 還沒做、要做 | `// TODO: V11.44 加路徑 D 攔截 fetch 後 location.href` |
| `FIXME:` | 知道是 bug,還沒修 | `// FIXME: 全家分頁切換偶爾會抓到舊頁訂單,難重現` |
| `HACK:` | 暫時的醜寫法,以後要重構 | `// HACK: 用 setTimeout(0) 等 Vue render,未來找更好的方法` |

**新手記點**:
- 用 grep 一鍵搜全部 TODO:`grep -rn "TODO:" 1shop_ultimate.user.js`
- 別只標不做!定期把 TODO 清掉

---

## 4. 給新手的「註解 SOP」(改 code 時的標準動作)

### 改任何一行 code 之前:

```
1. ☐ 看這附近有沒有 ⚠️ / 🚫 註解?有就先讀完再動
2. ☐ 看有沒有 ★ V11.XX 註解?那是別人埋的線索
3. ☐ 看函式上方的 JSDoc?了解預期行為
```

### 改完 code 之後:

```
1. ☐ 加 ★ V11.XX 標記說明改了什麼
2. ☐ 確認附近的舊註解還對嗎?不對就改
3. ☐ 如果改的東西很巧妙,加 💡 解釋
4. ☐ 如果改的東西容易踩雷,加 ⚠️ 警告
5. ☐ 如果有沒做完的部分,加 TODO 標記
```

### 改完 code 之前(送出前):

```
1. ☐ 區段標題還對嗎?
2. ☐ 函式 JSDoc 還對嗎?
3. ☐ 有沒有被註解掉的舊 code 沒清?
```

---

## 5. 黃金範本:一段「好註解」長什麼樣

這是 V11.42 doPrintAction 的實際註解,可以當範本:

```javascript
// 最終列印按鈕 → window.open 被攔截器接管 → GM_openInTab 在背景開分頁
const finalBtn = await waitFor(() => findFinalPrintBtn(cfg.finalPrintBtn), 4000);
if (finalBtn) {
  log(`[${cfg.label}] 點擊最終列印按鈕「${finalBtn.textContent.trim()}」`);

  // ★ V11.42:改為等 v11-open-bg-tab 事件(動態等待,7-11 慢時不會搶跑)
  //   策略:點按鈕 → 等攔截器收到 window.open 派發事件(最多 25 秒)
  //   - 7-11 平台快時可能 2-3 秒就收到
  //   - 7-11 平台慢時可能要 10-20 秒,動態等待
  //   - 全家也走 window.open,所以同樣會等到
  //   - 宅配可能不走 window.open(看修法 4 的 click 攔截)
  //     如果還是沒收到 → 25 秒 timeout 自動繼續
  const t0 = Date.now();
  finalBtn.click();
  toast(`📂 ${cfg.label} 物流單分頁產生中,請稍候...`, 'info', 2500);

  const TIMEOUT = 25000;
  await waitFor(() => lastOpenBgTabTime > t0, TIMEOUT);

  // ...
}
```

**這段為什麼好?**
1. ✅ 有 ★ V11.XX 標記(可追溯)
2. ✅ 解釋「為什麼」用 waitFor 而非 sleep(策略說明)
3. ✅ 列出三家物流的差異情境(讓人理解邊角)
4. ✅ TIMEOUT 用 const 命名,不寫魔術數字
5. ✅ toast 訊息使用者看得到,加情境描述

---
## 7. 一頁速查卡(列印貼螢幕用)

```
┌────────────────────────────────────────────────────────────┐
│ 1shop 註解速查卡                                            │
├────────────────────────────────────────────────────────────┤
│ ⭐/★ 重要      🐛 修 bug      🎯 TODO       ⚠️ 警告      │
│ 💡 技巧        🚫 禁止        📝 備註        🔥 危險     │
│ ✅ 已驗證      🔗 關聯                                    │
├────────────────────────────────────────────────────────────┤
│ 寫註解 3 法則                                              │
│ 1. 寫「為什麼」,不寫「做什麼」                            │
│ 2. 用人話,不用技術術語                                    │
│ 3. 用 emoji 視覺分區                                       │
├────────────────────────────────────────────────────────────┤
│ 改 code SOP                                                │
│ 改之前:讀 ⚠️ / 🚫 / ★ V11.XX                            │
│ 改完後:加 ★ V11.XX、更新舊註解、加 💡/⚠️                │
│ 送出前:檢查 JSDoc、清掉被註解的舊 code                    │
├────────────────────────────────────────────────────────────┤
│ 三種待辦                                                   │
│ TODO:  還沒做                                              │
│ FIXME: 已知 bug 還沒修                                     │
│ HACK:  醜寫法以後重構                                      │
└────────────────────────────────────────────────────────────┘
```
