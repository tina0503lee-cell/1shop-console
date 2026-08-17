// ==UserScript==
// @name         🔥 1shop 出貨中控台 (V11.54 修分批第2批按鈕消失)
// @namespace    http://tampermonkey.net/
// @version      11.54.0
// @description  V11.54 修 63 筆跨頁測試發現的「分批第 2 批拋印失敗」:「更多批次功能」按鈕是 1shop「有勾選訂單才由 Vue 渲染」的,V11.52 每批印後取消勾選(按鈕消失),第 2 批重新勾選後 Vue 需時間重繪按鈕,原本一次性 findBtnByText 常抓不到 → 第 2 批拋單/印單靜默跳過(第 1 批成功、第 2 批失敗)。修法:tryThrowAction / doPrintAction 找「更多批次功能」改為 waitFor 等待重試(4 秒),給 Vue 渲染時間。基於 V11.53 商品組合下拉透明統計
// @author       Tina + Claude
// @match        *://admin.1shop.tw/*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_addStyle
// @grant        GM_openInTab
// @noframes
// ==/UserScript==

/* eslint-disable no-unused-vars */
(function () {
  'use strict';

  // ============================================================
  //  ⓪ 全域常數 / 設定
  // ============================================================
  const VERSION = 'V11.54';
  const LS = {
    PRE_KWS: 'v11_preorder_kws',          // 預購關鍵字
    SCAN_PAGES: 'v11_scan_pages',         // 深潛頁數
    BATCH_SUBJ: 'v11_batch_subj',         // 異常單公版主旨
    BATCH_BODY: 'v11_batch_body',         // 異常單公版內文
    RESUME_FLAG: 'v11_resume_logistics',  // 跨頁續航:刷新後要繼續跑物流
    RESUME_PAYLOAD: 'v11_resume_payload', // 跨頁續航攜帶資料
    LAST_KANBAN: 'v11_last_kanban_open',  // 上次是否開著看板
    PREORDER_TAB: 'v11_preorder_tab',     // 預購要移到哪個分頁(暫存 / 其他)
  };

  // ── F12 已校正的元素指紋 ──
  const FP = {
    // 信封 SVG path 完整指紋(對話定版,完全等價判定,不再用開頭匹配)
    ENVELOPE_PATH_FULL: 'M61.4 64C27.5 64 0 91.5 0 125.4 0 126.3 0 127.1 .1 128L0 128 0 384c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-256-.1 0c0-.9 .1-1.7 .1-2.6 0-33.9-27.5-61.4-61.4-61.4L61.4 64zM464 192.3L464 384c0 8.8-7.2 16-16 16L64 400c-8.8 0-16-7.2-16-16l0-191.7 154.8 117.4c31.4 23.9 74.9 23.9 106.4 0L464 192.3zM48 125.4C48 118 54 112 61.4 112l389.2 0c7.4 0 13.4 6 13.4 13.4 0 4.2-2 8.2-5.3 10.7L280.2 271.5c-14.3 10.8-34.1 10.8-48.4 0L53.3 136.1c-3.3-2.5-5.3-6.5-5.3-10.7z',
    EMAIL_SUBJECT: '#subject, input[name="subject"]',
    EMAIL_BODY: 'textarea#body, textarea[name="body"]',
    EMAIL_SUBMIT_SCOPE: '.modal-dialog button, .modal button', // 「確認」按鈕限定在 modal 內找
    EMAIL_SUBMIT_TEXT: '確認',
    NATIVE_UPDATE_TEXT: '更新',
  };

  // ── 物流配置(7-11 / 全家 / 宅配)──
  // 每一家的「拋單按鈕的兩個關鍵字」、「印單按鈕的兩個關鍵字」、「列印視窗最終選擇的按鈕關鍵字」
  // 與「拋單是否會跳出二次確認視窗(宅配 yes / 711+全家 no)」
  const LOGISTICS = {
    '711': {
      label: '7-11',
      provider: '統一金流',         // ★ V11.39:section header 文字(用於區分 7-11/全家 同名按鈕)
      // ★ V11.39:按鈕真實文字(不含 provider,從附圖看 1shop UI 結構)
      //   推測 7-11 / 全家 兩家按鈕文字都是「超商取貨(拋單)」「超商取貨(物流單列印)」
      //   靠父容器 section 上的 provider 文字來區分
      throwBtnText: ['超商取貨', '拋單'],
      printBtnText: ['超商取貨', '物流單列印'],
      todayAction: 'unipay_cvs_order_today',
      throwAction: 'unipay_cvs_order',
      printAction: 'unipay_cvs_print',
      finalPrintBtn: '7-ELEVEN大宗B2C',
      needsThrowConfirm: false,
      shipTextMatch: ['7-11', '7-ELEVEN', '統一', '711'],
      afterThrowTab: '已確認',
      tabGroup: 'cvs',
    },
    'fami': {
      label: '全家',
      provider: '1ship',            // section header 含「1ship」字樣(大小寫 case-insensitive)
      throwBtnText: ['超商取貨', '拋單'],
      printBtnText: ['超商取貨', '物流單列印'],
      todayAction: 'oneship_cvs_order_today',
      throwAction: 'oneship_cvs_order',
      printAction: 'oneship_cvs_print',
      finalPrintBtn: '全家大宗B2C',
      needsThrowConfirm: false,
      shipTextMatch: ['全家', 'FamilyMart', 'FAMI'],
      afterThrowTab: '已確認',
      tabGroup: 'cvs',
    },
    'home': {
      label: '宅配',
      provider: '新竹物流',
      // ★ V11.39 附圖實測:宅配按鈕文字是「宅配(拋單)」「物流單列印(API)」
      throwBtnText: ['宅配', '拋單'],
      printBtnText: ['物流單列印', 'API'],
      todayAction: 'hct_order_today',
      throwAction: 'hct_order',
      printAction: 'hct_print',
      finalPrintBtn: '宅配 (新竹物流 HCT)',  // ★ V11.39 附圖確認真實按鈕文字
      needsThrowConfirm: true,
      shipTextMatch: ['宅配', '新竹', 'HCT'],
      afterThrowTab: '處理中',
      tabGroup: 'hct',
    },
  };

  // ── 預設公版郵件(可被 localStorage 覆寫;對話定版)──
  const DEFAULT_EMAILS = {
    // 未付款催繳(支援 {{order_number}} {{product_name}} 動態變數)
    UNPAID: {
      subject: '電玩酒吧出貨通知',
      body: `Dear您好~這裡是GAME'NIR酒吧小編
已收到您的訂單【{{product_name}}】

出貨部門同事已列入排程中囉~不過您的訂單 {{order_number}} 尚未完成下訂流程QAQ
需要完成流程後,系統才會讓我們幫您安排出貨唷~

如果您需要確認訂單或是更改其它線上金流
可以到官方LINE直接留下問題並留言「客服夥伴來支援」後,等待真人小編優先來協助!謝謝您💕`,
    },
    // 重複單取消通知(較舊筆要寄出)
    DUP_CANCEL: {
      subject: '電玩酒吧系統通知',
      body: `電玩酒吧系統通知: 您好~ 為了避免重複付款，系統將幫您取消較先前下訂的訂單，只保留下訂成功的訂單唷~ :)`,
    },
    NORMAL: {
      subject: '電玩酒吧出貨通知',
      body: '您好,提醒您訂單狀態已更新!感謝您的購買!',
    },
  };

  // ── 商家備註公版(對話定版)──
  //   會自動在前面贅加 "MM/DD " 日期前綴
  const NOTE_TEMPLATES = {
    DUP_KEEP:    '',                      // 重複單較新筆(保留):備註空白
    DUP_CANCEL:  '重複訂單 此筆取消',     // 重複單較舊筆(取消)
    UNPAID:      '提醒付款',              // 單筆未付款
    UNPAID_DUP:  '提醒付款，重複訂單幫關心', // 多筆皆異常的未付款
    PREORDER:    '預購品處理中',
    EXC:         '待折抵',
    OVERSEAS:    '海外單',
  };

  // ── 訂單分類順序 ──
  const STRATEGY_ORDER = ['DUP', 'UNPAID', 'PREORDER', 'EXC', 'OVERSEAS', 'NORMAL'];
  const STRATEGY_NAMES = {
    'DUP': '🔴 重複異常單',
    'UNPAID': '🚨 未付款提醒單',
    'PREORDER': '🟡 預購品',
    'EXC': '🔵 EXC 訂單',
    'OVERSEAS': '✈️ 海外單',
    'NORMAL': '🟢 可出貨一般單',
  };

  // ============================================================
  //  ① 通用工具函式
  // ============================================================
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const log = (...args) => console.log('[1shop-v11]', ...args);
  const warn = (...args) => console.warn('[1shop-v11]', ...args);
  const err = (...args) => console.error('[1shop-v11]', ...args);

  /** 安全 localStorage */
  const Storage = {
    get(k, d = '') { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
    json(k, d = null) { try { return JSON.parse(localStorage.getItem(k) || ''); } catch { return d; } },
    setJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  /** 模糊文字按鈕搜尋:在指定 root 中找 textContent 包含所有 kws 的可見按鈕(case-insensitive) */
  function findBtnByText(kws, root = document) {
    const ks = Array.isArray(kws) ? kws : [kws];
    const ksLower = ks.map(k => String(k).toLowerCase());
    return $$('button, a, .btn, [role="button"]', root).find(b => {
      if (!b || b.getBoundingClientRect().width === 0) return false;
      const t = (b.textContent || '').trim().toLowerCase();
      return ksLower.every(k => t.includes(k));
    });
  }

  /** ★ V11.39 找列印視窗內的最終列印按鈕
   *   1shop 印單視窗會同時列出多個物流的按鈕,只啟用對應當前訂單的那顆
   *   必須:在可見 modal 內 + 未 disabled + 文字含 textKw
   *   排除:.btn-link(分頁切換)、含 .disabled / [disabled] 屬性 */
  function findFinalPrintBtn(textKw) {
    const kw = String(textKw).toLowerCase();
    const modals = $$('.modal.show .modal-dialog, .modal-dialog, .modal-content');
    for (const m of modals) {
      if (m.getBoundingClientRect().width === 0 || m.offsetParent === null) continue;
      const btns = m.querySelectorAll('button:not(.btn-link), .btn:not(.btn-link)');
      for (const b of btns) {
        if (b.disabled) continue;
        if (b.classList.contains('disabled')) continue;
        // ★ V11.47:可見性檢查從 getBoundingClientRect().width === 0 改用 offsetParent === null
        //   原因:全家「全家大宗B2C (1ship 物流服務)」按鈕 class 只有 btn,在某些 modal 結構下
        //         getBoundingClientRect().width 會量到 0(被擋掉),但 offsetParent 判斷得出它其實可見
        //   (offsetParent === null 才代表真的隱藏 display:none,是更可靠的可見性判斷)
        if (b.offsetParent === null) continue;
        const t = (b.textContent || '').trim().toLowerCase();
        if (t.includes(kw)) return b;
      }
    }
    return null;
  }

  /** ★ V11.39 找 modal 內真正的確認按鈕(只在可見 modal 內找 .btn-primary 文字 = 「確認/確定」)
   *  避免抓到頁面上的「等待確認」分頁按鈕(class="btn btn-link",在 modal 外) */
  function findModalConfirmBtn() {
    const exactTexts = ['確認', '確定', '送出', '提交', 'OK', 'Yes'];

    // 找所有可見的 modal 容器
    const modalSels = ['.modal.show .modal-dialog', '.modal-dialog', '.modal-content', '.el-dialog', '[role="dialog"]'];
    const modals = new Set();
    for (const sel of modalSels) {
      document.querySelectorAll(sel).forEach(m => {
        if (m.getBoundingClientRect().width > 0 && m.offsetParent !== null) modals.add(m);
      });
    }
    if (modals.size === 0) return null;

    // 第一輪:只在 modal 內找 .btn-primary 且文字「精準」= 確認/確定
    for (const modal of modals) {
      const btns = modal.querySelectorAll('button.btn-primary, .btn.btn-primary');
      for (const b of btns) {
        if (b.getBoundingClientRect().width === 0) continue;
        if (b.disabled) continue;
        const t = (b.textContent || '').trim();
        if (exactTexts.includes(t)) return b;
      }
    }
    // 第二輪:文字含「確認/確定」但不是「等待確認」「已確認」等分頁字樣
    for (const modal of modals) {
      const btns = modal.querySelectorAll('button.btn-primary, .btn.btn-primary');
      for (const b of btns) {
        if (b.getBoundingClientRect().width === 0 || b.disabled) continue;
        const t = (b.textContent || '').trim();
        if ((t.includes('確認') || t.includes('確定')) &&
            !/^(等待|已|未)/.test(t)) {
          return b;
        }
      }
    }
    // 第三輪 fallback:任何 modal 內可見的 .btn-primary
    for (const modal of modals) {
      const btn = modal.querySelector('button.btn-primary:not([disabled]), .btn.btn-primary:not([disabled])');
      if (btn && btn.getBoundingClientRect().width > 0) return btn;
    }
    return null;
  }

  /** ★ V11.39 物流按鈕雙重精準搜尋:
   *   1. 先找所有「按鈕文字含 actionKws 全部字串」的候選按鈕
   *   2. 若候選只 1 個 → 直接回傳
   *   3. 若候選 >1 個 → 用「最近 ancestor 區塊含 provider 文字」過濾
   *   4. 仍多個或都不符 → 回傳第一個候選(保險)
   *
   *   原因:1shop UI 是「provider 是 section header 純文字 label」+「按鈕文字不含 provider」
   *   範例 DOM:
   *     <div>
   *       新竹物流                    ← provider section header(文字節點/小標)
   *       <button>宅配(拋單)</button>  ← 按鈕文字不含「新竹物流」
   *       <button>物流單列印(API)</button>
   *     </div>
   */
  function findCarrierActionBtn(providerName, actionKws) {
    const ks = (Array.isArray(actionKws) ? actionKws : [actionKws]).map(s => String(s).toLowerCase());
    const provLower = String(providerName).toLowerCase();

    // 1) 找所有匹配按鈕文字的候選
    const candidates = $$('button, a, .btn, [role="button"]').filter(b => {
      if (!b || b.getBoundingClientRect().width === 0) return false;
      const t = (b.textContent || '').trim().toLowerCase();
      return ks.every(k => t.includes(k));
    });

    if (candidates.length === 0) return null;
    if (candidates.length === 1) {
      log(`[findCarrierActionBtn] 唯一候選,直接回傳: "${candidates[0].textContent.trim()}"`);
      return candidates[0];
    }

    log(`[findCarrierActionBtn] ${candidates.length} 個候選,用 provider「${providerName}」section 過濾`);

    // 2) 用 section header 過濾:走 ancestor 找含 providerName 的「短文字節點/兄弟」
    for (const btn of candidates) {
      let el = btn;
      let depth = 0;
      while (el && el !== document.body && depth < 8) {
        // 找前置兄弟們
        let sib = el.previousElementSibling;
        while (sib) {
          const sibText = (sib.textContent || '').trim();
          const sibLower = sibText.toLowerCase();
          // 條件:含 providerName + 文字夠短(像 label 而非整個區塊) + 不含其他按鈕
          if (sibLower.includes(provLower) &&
              sibText.length < providerName.length * 4 &&
              !sib.querySelector('button, .btn')) {
            log(`[findCarrierActionBtn] ✅ 「${btn.textContent.trim()}」屬於「${providerName}」section`);
            return btn;
          }
          sib = sib.previousElementSibling;
        }
        el = el.parentElement;
        depth++;
      }
    }

    // 3) 都找不到對應 section → 回傳第一個候選(保險)
    log(`[findCarrierActionBtn] ⚠️ 找不到「${providerName}」section 對應的按鈕,fallback 第一個候選`);
    return candidates[0];
  }

  /** 模糊文字按鈕全部搜尋 */
  function findAllBtnByText(kws, root = document) {
    const ks = Array.isArray(kws) ? kws : [kws];
    return $$('button, a, .btn, [role="button"]', root).filter(b => {
      if (!b || b.getBoundingClientRect().width === 0) return false;
      const t = (b.textContent || '').trim();
      return ks.every(k => t.includes(k));
    });
  }

  /** ★ V11.39:找訂單列表上方的「分頁切換按鈕」
   *  容器:<div class="me-auto scroll-x text-nowrap">
   *  按鈕:<button class="btn btn-link">「全部 / 等待確認 / 確認中 / 已確認 / 處理中 / 已完成 / 已取消 / 暫存 / 其他」</button>
   *  (「等待確認」等狀態按鈕內含 svg 圖示,文字部分有時前後有空白) */
  function findTabButtonByText(text) {
    const containers = $$('.scroll-x.text-nowrap, .me-auto.scroll-x');
    for (const tabContainer of containers) {
      const buttons = tabContainer.querySelectorAll('button.btn-link, button.btn.btn-link');
      for (const b of buttons) {
        if (!b || b.getBoundingClientRect().width === 0) continue;
        const t = (b.textContent || '').replace(/\s+/g, '').trim();
        if (t === text || t.includes(text)) return b;
      }
    }
    // fallback:全頁尋找
    return $$('button.btn-link, button.btn.btn-link').find(b => {
      if (!b || b.getBoundingClientRect().width === 0) return false;
      const t = (b.textContent || '').replace(/\s+/g, '').trim();
      return (t === text || t.includes(text));
    });
  }

  /** 等待元素出現(timeout 預設 5s)*/
  async function waitFor(predicate, timeout = 5000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const r = predicate();
        if (r) return r;
      } catch {}
      await sleep(interval);
    }
    return null;
  }

  /** 偵測「未付款」(排除貨到付款/超商取貨時付款)*/
  function isUnpaid(statusText) {
    if (!statusText) return false;
    if (statusText.includes('超商取貨時付款') || statusText.includes('貨到付款')) return false;
    return (statusText.includes('未付款')
      || statusText.includes('等待付款')
      || statusText.includes('待確認付款'))
      && !statusText.includes('交易成功');
  }

  /** 偵測「貨到付款 / 超商取貨時付款」*/
  function isCOD(statusText) {
    if (!statusText) return false;
    return statusText.includes('貨到付款') || statusText.includes('超商取貨時付款');
  }

  /** 偵測「刷卡失敗 / 交易失敗」*/
  function isCardFail(statusText) {
    if (!statusText) return false;
    return /失敗|fail/i.test(statusText) && !statusText.includes('交易成功');
  }

  /** 偵測「線上刷卡成功」*/
  function isCardSuccess(statusText) {
    if (!statusText) return false;
    return statusText.includes('交易成功') || (/(信用卡|刷卡|線上)/.test(statusText) && !isCardFail(statusText));
  }

  /** 從 1shop 列表行抓出訂單編號 */
  function getOrderIdFromRow(tr) {
    const a = tr.querySelector('a[href*="/shop/order/all/"]');
    if (!a) return '';
    return (a.innerText || '').trim();
  }

  /** Vue 重渲染後重新對焦該訂單列(關鍵防護)*/
  function getFreshRowById(orderId) {
    return $$('tbody tr').find(r => getOrderIdFromRow(r) === orderId);
  }

  /** 提取 tooltip 備註(hover 觸發)*/
  async function extractNoteTextAsync(iconEl) {
    if (!iconEl) return '';
    const container = iconEl.closest('span') || iconEl;
    let text = container.getAttribute('data-original-title')
            || container.getAttribute('title')
            || container.getAttribute('data-content') || '';
    if (text) return text.replace(/<[^>]*>?/gm, '').trim();

    container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    container.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true }));
    await sleep(150);

    const ariaId = container.getAttribute('aria-describedby');
    if (ariaId) {
      const popperEl = document.getElementById(ariaId);
      if (popperEl) text = (popperEl.innerText || '').trim();
    }
    if (!text) {
      const poppers = $$('.v-popper__popper, .tooltip, .popover');
      const visible = poppers.find(p => p.style.display !== 'none' && (p.innerText || '').trim() !== '');
      if (visible) text = visible.innerText.trim();
    }

    container.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    container.dispatchEvent(new MouseEvent('mouseout',   { bubbles: true }));
    await sleep(20);

    if (text) return text.replace(/<br\s*[\/]?>/gi, ' ').replace(/<[^>]*>?/gm, '').trim();
    return '';
  }

  // ============================================================
  //  ② 列印分頁刺客(Auto-Killer)
  //     當 1shop 開新分頁準備呼叫瀏覽器列印視窗時,
  //     在這個分頁攔截 window.print → 抓 PDF iframe / 連結 → fetch 強制下載 → 關閉分頁
  // ============================================================
  const url = location.href.toLowerCase();
  const isMain = url.includes('/shop/order/all') || /\/shop\/order\/?$/.test(url);
  // ★ V11.40 重構:移除 isPrintTab 判定與 runAutoPrintKiller 呼叫
  //   現在所有物流單分頁都用 GM_openInTab 在背景開啟,不會跳到使用者眼前,
  //   因此不需要在「印單分頁」內跑刺客模式去自動下載/關閉
  if (!isMain) {
    // 非主訂單頁,腳本不執行避免干擾
    return;
  }

  // ============================================================
  //  ★ V11.39 雙軌印單攔截器(對話 V10.5 定版策略)
  //     注入 inline script 到 page scope,攔截 HTMLFormElement.prototype.submit
  //     當 1shop 點印單按鈕(form submit / window.open)時:
  //       1. 偵測 URL 含 print/export/delivery/label/shipment//handle/
  //       2. 阻止原生開新分頁(不搶奪使用者畫面焦點)
  //       3. 派發 CustomEvent 'v11-open-bg-tab' 給 Tampermonkey sandbox
  //       4. Sandbox 監聽該 event → GM_openInTab(url, { active: false }) 在背景開啟分頁
  //     使用者畫面焦點永遠停留在原 1shop 訂單列表,所有物流單分頁在背景待命
  // ============================================================
  injectDualTrackPrintInterceptor();

  /**
   * ★ V11.40 重構:精簡攔截器 — 只做「攔截 + 派發事件」兩件事
   * 移除項目:
   *   - 所有 fetch / blob / a.download 背景下載邏輯
   *   - HTML 重組與 <base href> 注入
   *   - downloadShippingFile 函式整段
   *   - triggerFileDownload 函式
   *   - v11-print-downloaded / v11-print-window-opened 事件派發
   * 保留項目:
   *   - HTMLFormElement.prototype.submit hook(form submit 路徑也走背景)
   *   - window.open hook(主要路徑)
   */
  function injectDualTrackPrintInterceptor() {
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        if (window.__v11_dualTrackInstalled) return;
        window.__v11_dualTrackInstalled = true;

        // ────────────────────────────────────────────────────────
        // 共用判定:URL 是否為「物流單/印單相關」
        // ────────────────────────────────────────────────────────
        function isShippingUrl(u) {
          return /print|export|delivery|label|shipment|\\.pdf/i.test(u) ||
                 /\\/handle\\//.test(u);
        }

        // ────────────────────────────────────────────────────────
        // 共用動作:派發背景開分頁事件給 sandbox(由 sandbox 呼叫 GM_openInTab)
        // ────────────────────────────────────────────────────────
        function dispatchOpenBgTab(url) {
          try {
            document.dispatchEvent(new CustomEvent('v11-open-bg-tab', {
              detail: { url: String(url), time: Date.now() }
            }));
          } catch (e) {
            console.warn('[V11.40] 派發 v11-open-bg-tab 失敗', e);
          }
        }

        // ────────────────────────────────────────────────────────
        // 路徑 A:HTMLFormElement.prototype.submit
        //   1shop 部分印單會用 form submit 開新分頁
        //   攔截後:從 form 推導 URL → 派發背景開分頁事件 → 不呼叫原生 submit
        // ────────────────────────────────────────────────────────
        const _origSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function() {
          const actionUrl = (this.action || '').toLowerCase();
          const actionVal = (this.querySelector('[name="action"]')?.value || '').toLowerCase();
          const allVals = Array.from(this.querySelectorAll('input,select,textarea'))
                               .map(el => (el.value || '').toLowerCase()).join('|');
          const isPrintAction = /print|delivery|export|label|shipment|物流單/.test(
            actionUrl + '|' + actionVal + '|' + allVals
          );

          if (isPrintAction) {
            console.log('[V11.40] 攔截 form submit → 背景分頁:', this.action);
            // 把 form 序列化成 query string,直接用 URL 開背景分頁
            // 注意:form POST 不能簡單轉 GET,所以這條路徑可能不完美
            // 但實測 1shop 主要走 window.open 路徑(下方),form submit 較少
            const formAction = this.action || location.href;
            dispatchOpenBgTab(formAction);
            return; // 阻止原生 submit,不在當前分頁導航
          }

          // 非印單動作,正常放行
          return _origSubmit.call(this);
        };

        // ────────────────────────────────────────────────────────
        // 路徑 B:window.open(主要路徑,7-11/全家/部分宅配走這條)
        //   攔截後:派發背景開分頁事件 → return null 阻止原生新分頁
        // ────────────────────────────────────────────────────────
        const _origOpen = window.open;
        window.open = function(url, target, features) {
          const u = String(url || '');
          if (isShippingUrl(u)) {
            console.log('[V11.42] 攔截 window.open → 背景分頁:', u);
            dispatchOpenBgTab(u);
            return null; // 阻止原生開新分頁 → 使用者畫面焦點不被搶
          }
          // 非物流相關,正常開分頁
          return _origOpen.call(window, url, target, features);
        };

        // ────────────────────────────────────────────────────────
        // 路徑 C:<a target="_blank"> click 事件(★ V11.42 新增,處理宅配)
        //   宅配「宅配 (新竹物流 HCT)」按鈕產生的新分頁,不走 JS window.open,
        //   而是 1shop 直接渲染 <a href="..." target="_blank"> 讓瀏覽器原生開新分頁。
        //   攔截方法:全頁面 click capture 階段,看點到的 a tag 是否符合條件
        document.addEventListener('click', (e) => {
          const a = e.target.closest('a');
          if (!a) return;
          const href = a.getAttribute('href') || a.href || '';
          const target = a.getAttribute('target');
          if (!isShippingUrl(href)) return;
          if (target !== '_blank' && target !== 'new') return;

          // 是物流單相關的新分頁連結 → 阻止原生 + 派發背景開分頁事件
          console.log('[V11.42] 攔截 <a target="_blank"> click → 背景分頁:', href);
          dispatchOpenBgTab(href);
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }, true);  // capture 階段,搶在頁面其他 handler 之前

        console.log('[V11.42] GM_openInTab 攔截器已注入 page scope ✅ (三路徑:form/window.open/a.click)');
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
    log('🛡️ V11.42 攔截器已注入(GM_openInTab 三路徑:form submit / window.open / a target=_blank click)');
  }

  // ★ V11.40 重構:刪除 runAutoPrintKiller 與 forceDownloadPDF
  //   原因:背景分頁機制不再需要在「印單分頁內」做任何事
  //   (1shop/物流商分頁開啟後會自己處理顯示與下載,使用者要看時手動切過去即可)


// 暫存 Part 2 程式碼,稍後 append 到主檔
  // ============================================================
  //  ③ UI 樣式注入(GM_addStyle)
  // ============================================================
  GM_addStyle(`
    /* 主中控台 */
    .v11-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 99990;
      display: none; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box; overflow: auto; }
    .v11-modal { background: #f8f9fa; width: 96%; max-width: 1400px; min-width: 600px;
      height: 90vh; min-height: 500px; border-radius: 12px; padding: 18px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.4); display: flex; flex-direction: column;
      position: relative; resize: both; overflow: hidden; box-sizing: border-box;
      font-family: -apple-system, "Segoe UI", "Noto Sans TC", sans-serif; }
    .v11-modal-header { border-bottom: 2px solid #e1e8ed; padding-bottom: 10px; margin-bottom: 12px;
      display: flex; justify-content: space-between; align-items: center; cursor: grab; user-select: none; flex-shrink: 0; }
    .v11-modal-header:active { cursor: grabbing; }
    .v11-modal-header h2 { margin: 0; color: #2c3e50; font-size: 18px; pointer-events: none; }

    .v11-cards { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; min-height: 0;
      display: flex; flex-direction: column; gap: 22px; padding-right: 8px; margin-bottom: 12px; }
    .v11-cards::-webkit-scrollbar { width: 10px; }
    .v11-cards::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 6px; }

    .v11-card { background: #fff; border-radius: 10px; box-shadow: 0 4px 14px rgba(0,0,0,0.08);
      border-top: 5px solid #34495e; display: flex; flex-direction: column; width: 100%; }
    .v11-card[data-type="DUP"]      { border-top-color: #e74c3c; }
    .v11-card[data-type="UNPAID"]   { border-top-color: #f39c12; }
    .v11-card[data-type="PREORDER"] { border-top-color: #f1c40f; }
    .v11-card[data-type="EXC"]      { border-top-color: #3498db; }
    .v11-card[data-type="OVERSEAS"] { border-top-color: #9b59b6; }
    .v11-card[data-type="NORMAL"]   { border-top-color: #27ae60; }

    .v11-card-header { padding: 12px 16px; background: #fdfdfd; border-bottom: 1px solid #eee;
      display: flex; justify-content: space-between; align-items: center; font-size: 16px; font-weight: bold; color: #2c3e50; }
    .v11-card-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
    .v11-email-setup { background: #f4f6f8; padding: 12px; border-radius: 8px; border: 1px dashed #dcdde1;
      display: flex; flex-direction: column; gap: 6px; }
    .v11-email-setup label { font-size: 12px; color: #7f8c8d; font-weight: bold; }
    .v11-email-setup input, .v11-email-setup textarea { width: 100%; padding: 6px 8px;
      border: 1px solid #ccc; border-radius: 4px; font-size: 13px; box-sizing: border-box; font-family: inherit; }

    .v11-table-wrap { width: 100%; overflow-x: auto; border: 1px solid #eee; border-radius: 6px; }
    .v11-table { width: 100%; min-width: 1100px; border-collapse: collapse; font-size: 13px; }
    .v11-table th, .v11-table td { border: 1px solid #e0e0e0; padding: 8px; text-align: center; vertical-align: middle; }
    .v11-table th { background: #f1f2f6; color: #2f3542; position: sticky; top: 0; z-index: 2; }
    .v11-table td.tdleft { text-align: left; line-height: 1.5; }
    .v11-sort { cursor: pointer; margin-left: 4px; color: #7f8c8d; user-select: none; }
    .v11-status-paid   { color: #27ae60; font-weight: bold; }
    .v11-status-unpaid { color: #e74c3c; font-weight: bold; }
    .v11-status-cod    { color: #8e44ad; font-weight: bold; }
    .v11-status-fail   { color: #c0392b; font-weight: bold; }

    /* ★ V11.44:card-footer 改 sticky 吸附底部 — 長清單滾動時操作區(物流/組合下拉+按鈕)不會被滾走 */
    .v11-card-footer { padding: 12px 16px; background: #fafafa; border-top: 1px solid #eee;
      display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap;
      position: sticky; bottom: -1px; z-index: 10; }

    .v11-modal-footer { display: flex; flex-direction: column; padding-top: 12px;
      border-top: 2px solid #e1e8ed; gap: 10px; flex-shrink: 0; }
    .v11-btn { padding: 8px 14px; border: none; border-radius: 6px; cursor: pointer;
      font-weight: bold; font-size: 13px; transition: 0.15s; color: #fff; white-space: nowrap;
      display: inline-flex; align-items: center; justify-content: center; }
    .v11-btn:hover { opacity: 0.85; transform: translateY(-1px); }
    .v11-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .v11-select { padding: 8px; border-radius: 6px; border: 1px solid #bdc3c7;
      font-size: 13px; font-weight: bold; color: #2c3e50; background: #fff; cursor: pointer; }

    /* 懸浮控制台 */
    .v11-fab { position: fixed; bottom: 25px; right: 25px; background: #fff;
      border-radius: 12px; box-shadow: 0 8px 25px rgba(0,0,0,0.2); z-index: 99998;
      border: 2px solid #e67e22; width: 280px; display: flex; flex-direction: column; overflow: hidden; }
    .v11-fab-handle { background: #e67e22; color: #fff; padding: 10px 14px; cursor: grab;
      display: flex; justify-content: space-between; align-items: center;
      font-size: 14px; font-weight: bold; user-select: none; }
    .v11-fab-handle:active { cursor: grabbing; }
    .v11-fab-toggle { background: transparent; border: none; color: #fff; cursor: pointer;
      font-size: 18px; padding: 0; margin: 0; line-height: 1; }
    .v11-fab-body { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .v11-fab-label { font-size: 12px; color: #7f8c8d; font-weight: bold; }
    .v11-fab-input { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;
      font-size: 13px; box-sizing: border-box; }
    .v11-fab-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .v11-fab-btn { background: #e67e22; color: #fff; padding: 11px; border-radius: 8px;
      font-size: 15px; font-weight: bold; cursor: pointer; border: none; width: 100%; transition: 0.15s; }
    .v11-fab-btn:hover { background: #d35400; transform: translateY(-2px); }
    .v11-fab-btn.secondary { background: #34495e; }
    .v11-fab-btn.secondary:hover { background: #2c3e50; }

    /* 內嵌資訊條 */
    .v11-note-box { margin-top: 6px; padding: 6px 8px; background: #fff3cd;
      border-left: 4px solid #ffc107; font-size: 12px; color: #856404; border-radius: 4px;
      word-break: break-all; line-height: 1.4; }
    .v11-diag-box { margin-top: 6px; padding: 6px 8px; background: #f8d7da;
      border-left: 4px solid #c0392b; font-size: 12px; color: #c0392b; border-radius: 4px; font-weight: bold; }
    .v11-diag-box.ok { background: #d4edda; border-left-color: #28a745; color: #155724; }
    .v11-tag { display: inline-block; padding: 2px 6px; margin: 2px 2px 0 0;
      font-size: 11px; border-radius: 4px; font-weight: bold; }
    .v11-tag-dup    { background: #e74c3c; color: #fff; }
    .v11-tag-unpaid { background: #f39c12; color: #fff; }
    .v11-tag-pre    { background: #f1c40f; color: #333; }
    .v11-tag-exc    { background: #3498db; color: #fff; }
    .v11-tag-os     { background: #9b59b6; color: #fff; }
    .v11-history-tag { margin-top: 6px; padding: 4px 8px; font-size: 12px;
      background: #e74c3c; color: #fff; border-radius: 4px; display: inline-block; font-weight: bold; }
    .v11-history-tag a { color: #fff; text-decoration: underline; margin: 0 3px; }

    /* Toast 通知 */
    .v11-toast { position: fixed; top: 20px; right: 20px; z-index: 100000;
      padding: 12px 20px; background: #2c3e50; color: #fff; border-radius: 6px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3); font-size: 14px; font-weight: bold;
      transition: opacity 0.3s; max-width: 360px; }
    .v11-toast.success { background: #27ae60; }
    .v11-toast.error   { background: #c0392b; }
    .v11-toast.warn    { background: #f39c12; }

    /* 公版設定 popup */
    .v11-email-popup { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: #fff; padding: 24px; border-radius: 12px;
      box-shadow: 0 15px 50px rgba(0,0,0,0.5); z-index: 100001;
      display: none; flex-direction: column; width: 500px; max-width: 90vw; border: 2px solid #8e44ad; }
    .v11-email-popup h3 { margin-top: 0; color: #8e44ad; }
    .v11-email-popup input, .v11-email-popup textarea { width: 100%; padding: 10px;
      font-size: 13px; margin-bottom: 8px; border: 1px solid #ccc; border-radius: 4px;
      box-sizing: border-box; font-family: inherit; }

    /* ★ 9 欄表格新樣式 ★ */
    .v11-table { min-width: 1200px; }
    .v11-table th { padding: 10px 8px; font-size: 13px; }
    .v11-table td { padding: 10px 8px; font-size: 13px; vertical-align: middle; }
    .v11-table .th-select { text-align: center; }
    .v11-table .th-select div { margin-bottom: 4px; }
    .v11-table input.v11-chk-exec, .v11-table input.v11-chk-all { transform: scale(1.3); cursor: pointer; }

    /* 訂單資訊欄 */
    .v11-table .td-info { text-align: left; vertical-align: top; padding: 12px 10px; line-height: 1.55; }
    .v11-table .td-info .cust-name { color: #555; font-size: 13px; margin-bottom: 2px; }
    .v11-table .td-info .ord-id { display: block; font-size: 15px; font-weight: bold;
      color: #2c3e50; text-decoration: none; margin-bottom: 4px; }
    .v11-table .td-info .ord-id:hover { color: #2980b9; }
    .v11-table .td-info .phone-link { display: inline-block; font-size: 12px;
      color: #2980b9; text-decoration: none; margin-bottom: 4px; }
    .v11-table .td-info .phone-link:hover { text-decoration: underline; }

    /* 老顧客標籤 */
    .v11-loyal-tag { display: inline-block; margin-top: 4px; padding: 3px 10px;
      background: #3498db; color: #fff; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .v11-loyal-tag b { background: #1f6391; padding: 1px 6px; margin-left: 4px;
      border-radius: 3px; font-weight: bold; }

    /* 顧客備註 / 商家備註 */
    .v11-note-box { margin-top: 6px; padding: 8px 10px; background: #fff8d6;
      border-left: 4px solid #f0c419; border-radius: 4px;
      display: flex; gap: 6px; align-items: flex-start;
      font-size: 12px; color: #6e5300; line-height: 1.4; word-break: break-all; }
    .v11-note-box .note-icon { flex-shrink: 0; font-size: 14px; }
    .v11-note-box.note-merchant { background: #fff3cd; border-left-color: #ffc107; color: #856404; }

    /* 反查結果框 */
    .v11-scanback-box { margin-top: 6px; padding: 8px 10px; border-radius: 4px;
      font-size: 12px; line-height: 1.4; }
    .v11-scanback-box.sb-ok   { background: #d4edda; border-left: 4px solid #28a745; color: #155724; }
    .v11-scanback-box.sb-warn { background: #fff3cd; border-left: 4px solid #ffc107; color: #856404; }

    /* 狀態欄 */
    .v11-table .td-status { font-weight: bold; line-height: 1.5; font-size: 13px; padding: 12px 8px; }

    /* 商品欄 */
    .v11-table .td-product { text-align: left; line-height: 1.5; padding: 12px 10px;
      font-size: 12px; color: #444; }

    /* 物流 badge */
    .ship-badge { display: inline-block; padding: 4px 10px; background: #ecf0f1;
      color: #2c3e50; border-radius: 4px; font-size: 12px; font-weight: bold; }

    /* 金額 */
    .v11-table .td-amount { color: #e67e22; font-weight: bold; font-size: 14px; }

    /* 日期 */
    .v11-table .td-date { color: #7f8c8d; font-size: 12px; white-space: nowrap; }

    /* ★ V11.39:每筆訂單的「發信」勾選欄 */
    .v11-table .td-rowemail { text-align: center; vertical-align: middle; }
    .v11-table .v11-chk-email { transform: scale(1.3); cursor: pointer; }
    .v11-table .v11-chk-email-all { transform: scale(1.1); cursor: pointer; margin-top: 4px; }

    /* 個別修改備註輸入框 */
    .v11-row-note { width: 100%; padding: 6px 8px; border: 1px solid #d0d7de;
      border-radius: 4px; font-size: 12px; box-sizing: border-box; }
    .v11-row-note:focus { outline: none; border-color: #3498db; box-shadow: 0 0 0 2px rgba(52,152,219,0.2); }

    /* 移動分頁下拉 */
    .v11-row-move { width: 100%; padding: 6px 8px; border: 1px solid #d0d7de;
      border-radius: 4px; font-size: 12px; cursor: pointer; background: #fff;
      box-sizing: border-box; }
    .v11-row-move:focus { outline: none; border-color: #3498db; }
    /* ★ V11.39:人工調整分類下拉(橘色強調) */
    .v11-row-type { width: 100%; padding: 6px 8px; border: 1px solid #f39c12;
      border-radius: 4px; font-size: 12px; cursor: pointer; background: #fff8e7;
      box-sizing: border-box; }
    .v11-row-type:focus { outline: none; border-color: #e67e22; box-shadow: 0 0 0 2px rgba(243,156,18,0.2); }

    /* 排序鈕 */
    .v11-sort { display: inline-block; margin-left: 4px; padding: 2px 6px;
      background: #3498db; color: #fff; border-radius: 3px; font-size: 11px;
      cursor: pointer; user-select: none; }
    .v11-sort:hover { background: #2980b9; }

    /* 列印時隱藏 UI */
    @media print { .v11-fab, .v11-overlay, .v11-toast { display: none !important; } }
  `);

  // ============================================================
  //  ④ Toast 通知
  // ============================================================
  function toast(msg, type = 'info', duration = 3000) {
    const old = $('.v11-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = `v11-toast ${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  // ============================================================
  //  ⑤ UI 注入(主中控台 + 懸浮控制台)
  // ============================================================
  function injectUI() {
    if ($('#v11-overlay')) return;

    const savedKws = Storage.get(LS.PRE_KWS, '');
    const savedPages = Storage.get(LS.SCAN_PAGES, '1');
    const savedPreorderTab = Storage.get(LS.PREORDER_TAB, '暫存');

    const html = `
      <div class="v11-overlay" id="v11-overlay">
        <div class="v11-modal" id="v11-modal">
          <div class="v11-modal-header" id="v11-modal-drag">
            <h2>📦 1shop 出貨中控台 ${VERSION}(集大成版)</h2>
            <button class="v11-btn" style="background:#95a5a6;" id="v11-btn-close">縮小視窗</button>
          </div>
          <div class="v11-cards" id="v11-cards-container">
            <div style="text-align:center; padding:40px; color:#95a5a6;">
              👈 請先在右下角「掃描控制台」啟動掃描
            </div>
          </div>
          <div class="v11-modal-footer">
            <button class="v11-btn" id="v11-btn-global"
              style="background:#e74c3c; padding:14px; font-size:16px;">
              🌟 一鍵全局批次執行(自動處理「所有卡片」備註/發信/歸類移動 ➡️ 續航自動拋單印單)
            </button>
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center;">
              <div style="display:flex; gap:8px;">
                <button class="v11-btn" style="background:#e67e22;" id="v11-btn-only-logistics">
                  🚀 自動分流當天出貨
                </button>
                <button class="v11-btn" style="background:#8e44ad;" id="v11-btn-edit-email">
                  📧 異常單預設公版
                </button>
              </div>
              <span style="font-size:12px; color:#27ae60; font-weight:bold;">
                ✅ 已實裝「動態活體追蹤器」,徹底解決 Vue.js 渲染導致的發信失敗!
              </span>
            </div>
          </div>
          <div class="v11-email-popup" id="v11-email-popup">
            <h3>⚙️ 異常單預設公版設定</h3>
            <label>主旨</label>
            <input id="v11-bsubj" type="text">
            <label>內文</label>
            <textarea id="v11-bbody" rows="6"></textarea>
            <div style="display:flex; justify-content:flex-end; gap:8px;">
              <button class="v11-btn" style="background:#95a5a6;" id="v11-bcancel">取消</button>
              <button class="v11-btn" style="background:#27ae60;" id="v11-bsave">儲存</button>
            </div>
          </div>
        </div>
      </div>

      <div class="v11-fab" id="v11-fab">
        <div class="v11-fab-handle" id="v11-fab-drag">
          <span>⚙️ 1shop 掃描控制台 ${VERSION}</span>
          <button class="v11-fab-toggle" id="v11-fab-toggle">➖</button>
        </div>
        <div class="v11-fab-body" id="v11-fab-body">
          <div class="v11-fab-label">預購關鍵字(逗號分隔)</div>
          <input id="v11-kws" class="v11-fab-input"
            placeholder="例如:DK4-BK, 7DS-PK, 預購" value="${savedKws.replace(/"/g, '&quot;')}">
          <div class="v11-fab-row">
            <div class="v11-fab-label">掃描深潛頁數:</div>
            <input id="v11-pages" class="v11-fab-input"
              type="number" min="1" max="10" value="${savedPages}"
              style="width:70px; text-align:center;">
          </div>
          <div class="v11-fab-row">
            <div class="v11-fab-label">預購歸類目的地:</div>
            <select id="v11-preorder-tab" class="v11-fab-input" style="width:auto; flex:1; cursor:pointer;">
              <option value="暫存" ${savedPreorderTab === '暫存' ? 'selected' : ''}>暫存</option>
              <option value="其他" ${savedPreorderTab === '其他' ? 'selected' : ''}>其他</option>
            </select>
          </div>
          <button class="v11-fab-btn" id="v11-btn-scan">🤖 啟動大數據掃描</button>
          <button class="v11-fab-btn" id="v11-btn-open-kanban" style="background:#27ae60;color:#fff;font-weight:bold;">📋 開啟看板</button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);

    bindUIEvents();
    initDrag('v11-modal', 'v11-modal-drag');
    initDrag('v11-fab', 'v11-fab-drag');
    checkAndResumeLogisticsFlow();

    log('UI 注入完成');
  }

  // ── 拖曳:獨立綁定,避免 UI 重繪後失效 ──
  function initDrag(targetId, handleId) {
    const el = document.getElementById(targetId);
    const handle = document.getElementById(handleId);
    if (!el || !handle) return;
    let dragging = false, ox = 0, oy = 0;

    handle.addEventListener('mousedown', (e) => {
      // 點到內部按鈕不要觸發拖曳
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      dragging = true;
      const r = el.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      el.style.left = (e.clientX - ox) + 'px';
      el.style.top  = (e.clientY - oy) + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      // 主 modal 在 overlay 內,要解除 transform 置中
      if (targetId === 'v11-modal') el.style.transform = 'none';
    });

    document.addEventListener('mouseup', () => { dragging = false; });
  }

  // ── 綁定 UI 事件 ──
  function bindUIEvents() {
    $('#v11-btn-close').onclick = () => {
      $('#v11-overlay').style.display = 'none';
      Storage.set(LS.LAST_KANBAN, '0');
    };

    $('#v11-fab-toggle').onclick = (e) => {
      const body = $('#v11-fab-body');
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'flex' : 'none';
      e.target.innerText = hidden ? '➖' : '➕';
    };

    // ★ V11.39:「📋 開啟看板」強化邏輯
    //   1. 永遠可用:點下保證 modal 開啟
    //   2. 如果看板尚無資料,自動觸發掃描
    //   3. 如果已有資料,純粹 display:flex 保留所有變動
    $('#v11-btn-open-kanban').onclick = () => {
      const overlay = $('#v11-overlay');
      if (!overlay) return;
      const hasData = $$('.v11-card').length > 0;
      overlay.style.display = 'flex';
      Storage.set(LS.LAST_KANBAN, '1');
      if (!hasData) {
        toast('看板尚未掃描,自動觸發掃描中...', 'info', 2000);
        startScan();
      } else {
        toast('看板已開啟(保留之前所有變動)', 'info', 1500);
      }
    };

    $('#v11-btn-scan').onclick = startScan;
    $('#v11-btn-global').onclick = () =>
      withAutoUX('🌟 一鍵全局批次執行', () => runFullPipeline('global'));
    $('#v11-btn-only-logistics').onclick = () =>
      withAutoUX('🚀 自動分流當天出貨', () => runLogisticsOnly());

    // 預購歸類目的地下拉:即時寫入 localStorage
    const preTabSel = $('#v11-preorder-tab');
    if (preTabSel) {
      preTabSel.onchange = (e) => {
        Storage.set(LS.PREORDER_TAB, e.target.value);
        toast(`📦 預購歸類目的地已切換為「${e.target.value}」`, 'info', 2000);
      };
    }

    $('#v11-btn-edit-email').onclick = () => {
      const p = $('#v11-email-popup');
      $('#v11-bsubj').value = Storage.get(LS.BATCH_SUBJ, DEFAULT_EMAILS.DUP_CANCEL.subject);
      $('#v11-bbody').value = Storage.get(LS.BATCH_BODY, DEFAULT_EMAILS.DUP_CANCEL.body);
      p.style.display = 'flex';
    };
    $('#v11-bcancel').onclick = () => { $('#v11-email-popup').style.display = 'none'; };
    $('#v11-bsave').onclick = () => {
      Storage.set(LS.BATCH_SUBJ, $('#v11-bsubj').value);
      Storage.set(LS.BATCH_BODY, $('#v11-bbody').value);
      $('#v11-email-popup').style.display = 'none';
      toast('公版郵件已儲存', 'success');
    };
  }

  // ============================================================
  //  ⑥ 全域訂單資料
  // ============================================================
  let allOrders = [];        // 掃描後的訂單陣列
  let currentSort = { col: 'date', dir: -1 };

  // ────────────────────────────────────────────────────────────
  // ★ V11.40 跨 sandbox 通訊:Page scope 攔截器派發 'v11-open-bg-tab' 事件
  //   Sandbox 監聽該事件 → 呼叫 GM_openInTab(url, { active: false }) 在背景開啟分頁
  //   options:
  //     active: false  → 新分頁不會搶焦點,使用者畫面停留在原訂單列表
  //     insert: true   → 新分頁緊鄰當前分頁,方便找
  //     setParent: true → 關閉新分頁時自動回到原分頁
  // ────────────────────────────────────────────────────────────
  // ★ V11.42:紀錄最後一次「攔到背景分頁開啟」的時間
  //   doPrintAction 點最終列印按鈕後用 waitFor 等這個 timestamp 更新,代表分頁真的有出來
  //   解決 7-11 印單慢時固定 sleep(3000) 不夠的問題
  let lastOpenBgTabTime = 0;
  let lastOpenBgTabUrl = '';

  document.addEventListener('v11-open-bg-tab', (e) => {
    const url = e?.detail?.url;
    if (!url) return;
    lastOpenBgTabTime = e?.detail?.time || Date.now();
    lastOpenBgTabUrl = url;
    try {
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(url, { active: false, insert: true, setParent: true });
        console.log('[1shop-v11] [印單] 已在背景分頁開啟:', url.slice(0, 100));
      } else {
        // Fallback:GM_openInTab 不可用(@grant 沒加或老版 Tampermonkey)→ 原生新分頁
        console.warn('[1shop-v11] GM_openInTab 不可用,fallback 用 window.open(會搶焦點)');
        window.open(url, '_blank');
      }
    } catch (err) {
      console.error('[1shop-v11] [印單] GM_openInTab 失敗', err);
    }
  });

  // ★ V11.42:全域 modal killer — 自動關閉 1shop 跳出的「無法另開視窗」警告
  //   原因:V11.40+ 攔截 window.open 後 return null,1shop 內部判定彈窗被擋,
  //         會跳「⚠️ 警告 無法另開視窗,瀏覽器阻擋了新分頁」modal。
  //   作法:setInterval 300ms 偵測,文字含「無法另開視窗 / 瀏覽器阻擋了新分頁」就秒關
  //   關閉策略:① 找右上角的 X(.close / .modal-close / [aria-label]) ② fallback 找 ESC 鍵
  setInterval(() => {
    // 掃描所有可能是 modal 的元素
    const modals = document.querySelectorAll('.modal, .modal-content, .v-dialog, [role="dialog"], [class*="popup" i]');
    for (const modal of modals) {
      if (!modal || modal.getBoundingClientRect().width === 0) continue;
      const text = (modal.textContent || '');
      if (!/無法另開視窗|瀏覽器阻擋了新分頁|阻擋彈出式視窗/.test(text)) continue;

      // 找關閉按鈕(右上角的 X)
      const closeBtn =
        modal.querySelector('.close, .modal-close, .btn-close, [aria-label*="關閉" i], [aria-label*="close" i]') ||
        Array.from(modal.querySelectorAll('button, span, a, i, svg')).find(el => {
          const t = (el.textContent || '').trim();
          return t === '×' || t === '✕' || t === '✖' || t === 'X' || t === 'x';
        });

      if (closeBtn) {
        console.log('[V11.42] 自動關閉「無法另開視窗」警告 modal');
        closeBtn.click();
      } else {
        // Fallback:派發 ESC 鍵
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        console.log('[V11.42] 找不到 X 按鈕,改派 ESC 關閉');
      }
    }
  }, 300);

  // ============================================================
  //  ⑦ 掃描引擎
  // ============================================================
  // ★ V11.42 移除「僅測試備註抓取」獨立按鈕和函式(除錯用途已完成,不再需要)

  async function startScan() {
    const kws = $('#v11-kws').value.trim();
    const pages = parseInt($('#v11-pages').value || '1', 10);
    Storage.set(LS.PRE_KWS, kws);
    Storage.set(LS.SCAN_PAGES, String(pages));

    toast(`🤖 開始掃描,深潛 ${pages} 頁...`, 'info', 2500);
    $('#v11-overlay').style.display = 'flex';
    $('#v11-cards-container').innerHTML =
      '<div style="text-align:center; padding:40px; color:#3498db;">⏳ 掃描中,請勿關閉本頁籤...</div>';

    try {
      allOrders = [];
      const preKws = kws.split(/[,,]/).map(s => s.trim()).filter(Boolean);

      // ★ V11.39 關鍵:多頁掃描前,先切回第 1 頁(用 angles-left 圖示按鈕)
      //   原因:如果上次操作後停在第 2 頁,depth=2 設定下程式還是會跑「第 1/2、2/2」標題,
      //   但實際只掃了「目前頁」+「下一頁」,丟失真正的第 1 頁訂單
      if (pages > 1) {
        const firstPageBtn = await findFirstPageBtn();
        if (firstPageBtn) {
          log(`[掃描] 多頁掃描,先切回第 1 頁(用 angles-left 圖示)`);
          firstPageBtn.click();
          await sleep(2500);
        }
      }

      // 深潛多頁:掃描完當前頁 → 抓備註 → 點下一頁 → ...
      for (let p = 1; p <= pages; p++) {
        toast(`📄 掃描第 ${p}/${pages} 頁...`, 'info', 1500);
        log(`[掃描] ▶ 開始掃描第 ${p}/${pages} 頁`);
        await sleep(800);
        const pageOrders = scrapeCurrentPage(preKws, p);
        log(`[掃描] 第 ${p} 頁抓到 ${pageOrders.length} 筆訂單`);

        // ★ 立即 hover 抓備註內文(必須在頁面切換前完成,否則 DOM 會消失)
        const noteCount = pageOrders.filter(o => o.hasCustomerNote || o.hasMerchantNote).length;
        if (noteCount > 0) {
          toast(`🔍 抓取 ${noteCount} 筆備註內文中...`, 'info', 1500);
          await fetchNotesFromHover(pageOrders);
        }

        allOrders.push(...pageOrders);

        if (p < pages) {
          const next = findNextPageBtn();
          if (!next) {
            warn(`[掃描] ⚠️ 第 ${p} 頁找不到「下一頁」按鈕,終止深潛(可能已是最後一頁)`);
            toast(`已掃完所有頁(共 ${p} 頁),沒有更多頁可掃`, 'warn', 3500);
            break;
          }
          log(`[掃描] 點擊下一頁按鈕,等待 Vue 重新渲染...`);
          next.click();
          await sleep(2500); // ★ V11.39 拉長到 2.5 秒等 Vue 完整重渲染
        }
      }
      log(`[掃描] 多頁掃描完成,共 ${allOrders.length} 筆`);

      // 反查同電話歷史 + 重複單偵測
      await detectDuplicates();

      // 分類
      classifyOrders(preKws);

      renderKanban();
      toast(`✅ 掃描完成:共 ${allOrders.length} 筆`, 'success', 3000);
    } catch (e) {
      err('掃描失敗', e);
      toast('掃描失敗:' + e.message, 'error', 4000);
    }
  }

  /** 抓取當前頁訂單資料(基於 1shop 真實 DOM 結構,V11.39 精準 td 索引版)
   *  td[0]=選取 / td[1]=訂單號+確認狀態 / td[2]=日期 / td[3]=客戶+電話+老顧客
   *  td[4]=商品 / td[5]=付款 / td[6]=物流 / td[7]=金額 / td[8]=備註圖示 / td[9]=操作
   */
  function scrapeCurrentPage(preKws, pageNum = 1) {
    const rows = $$('tbody tr').filter(r => r.querySelector('a[href*="/shop/order/all/"]'));
    return rows.map(tr => {
      const tds = $$('td', tr);

      // ══════════════════════════════════════
      // td[1]:訂單編號 + 確認狀態(等待確認等)
      // ══════════════════════════════════════
      const orderLink = tds[1]?.querySelector('a[href*="/shop/order/all/"]');
      const id = (orderLink?.innerText || '').trim();
      const confirmStatus = (tds[1]?.querySelector('.badge')?.innerText || '').trim();

      // ══════════════════════════════════════
      // td[2]:日期
      // ══════════════════════════════════════
      const dateRaw = (tds[2]?.innerText || '').trim();
      const dateMatch = dateRaw.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\s+\d{1,2}:\d{1,2}(:\d{1,2})?)/);
      const date = dateMatch ? new Date(dateMatch[1].replace(/-/g, '/')).getTime() : Date.now();

      // ══════════════════════════════════════
      // td[3]:客戶名 + 電話 + 老顧客標籤
      // ══════════════════════════════════════
      const custTd = tds[3];
      let customer = '', phone = '', loyaltyCount = 0;

      if (custTd) {
        // 客戶名:a[href*="/shop/customer/all/"] 內的文字(去除 SVG)
        const custLink = custTd.querySelector('a[href*="/shop/customer/all/"]');
        if (custLink) {
          // 直接取 innerText,因為 SVG 不會貢獻文字
          customer = (custLink.innerText || '').replace(/\s+/g, ' ').trim();
        }

        // 電話:a[href^="tel:"] 的 href 屬性
        const phoneLink = custTd.querySelector('a[href^="tel:"]');
        if (phoneLink) {
          const m = (phoneLink.getAttribute('href') || '').match(/tel:([\d\-+]+)/);
          if (m) phone = m[1].replace(/\D/g, '');
          if (!phone) phone = (phoneLink.innerText || '').replace(/\D/g, '');
        }

        // 老顧客標籤:.order-label .label-info 內找「老顧客」
        const loyaltyLabel = custTd.querySelector('.order-label .label-info, .order-label .label');
        if (loyaltyLabel && /老顧客/.test(loyaltyLabel.innerText || '')) {
          const badge = loyaltyLabel.querySelector('.badge');
          loyaltyCount = parseInt((badge?.innerText || '0').trim(), 10) || 1;
        }
      }

      // ★ V11.39:抓取網頁原生 .order-label 所有標籤(老顧客/重複/海外...)
      //   目的:讓中控台直接顯示 1shop 後台上看到的「原生標籤」圖示
      const orderLabelText = (custTd?.querySelector('.order-label')?.innerText || '').trim();
      const webLoyaltyLabel  = orderLabelText.includes('老顧客');
      const webDupLabel      = orderLabelText.includes('重複');
      const webOverseasLabel = orderLabelText.includes('海外');

      // ══════════════════════════════════════
      // td[4]:購買商品(用 .product-name + .color-sku)
      // ══════════════════════════════════════
      let product = '';
      // ★ V11.44:comboLabel = 短格式商品組合標籤(SKU*數量),供 NORMAL 區組合過濾選單顯示
      //   原因:product 是完整名(含 [SKU] 名稱),選單顯示太長;comboLabel 只取 SKU+數量,簡潔
      //   設計:product 維持原邏輯不動(避免影響既有分類比對),comboLabel 另外獨立產生
      let comboLabelArr = [];
      if (tds[4]) {
        const productNames = $$('.product-name', tds[4]);
        const skus = $$('.color-sku', tds[4]);
        const textDangers = $$('.text-danger', tds[4]); // ★ V11.44:數量通常放在 .text-danger
        if (productNames.length > 0) {
          // 多項商品用「 / 」分隔
          product = productNames.map((p, i) => {
            const sku = skus[i] ? (skus[i].innerText || '').trim() : '';
            const name = (p.innerText || '').trim();
            // ★ V11.44:同步組短標籤,優先用 SKU,沒有就用商品名;數量取對應的 .text-danger
            const qty = textDangers[i] ? ((textDangers[i].innerText || '').replace(/\D/g, '') || '1') : '1';
            const shortName = sku || name;
            if (shortName) comboLabelArr.push(`${shortName}*${qty}`);
            return sku ? `[${sku}] ${name}` : name;
          }).join('  /  ');
        } else {
          // 沒有 .product-name 結構,取整段文字(若為空 td 則維持空)
          product = (tds[4].innerText || '').trim();
          // ★ V11.44:無結構時,comboLabel 取前 15 字當代表
          if (product) comboLabelArr.push(product.substring(0, 15));
        }
      }
      // ★ V11.44:多項商品用「+」串接,例如「DK4-BK*2+7DS-PK*1」
      const comboLabel = comboLabelArr.join('+') || '無商品資訊';

      // ══════════════════════════════════════
      // td[5]:付款狀態(.status-name + .badge-circle + .badge-times)
      // ══════════════════════════════════════
      let payStatus = '';
      const payTd = tds[5];
      if (payTd) {
        const statusName = (payTd.querySelector('.status-name')?.innerText || '').trim();
        const badge = (payTd.querySelector('.badge-circle')?.innerText || '').trim();
        const badgeTimes = (payTd.querySelector('.badge-times')?.innerText || '').trim();
        const parts = [statusName, badge];
        if (badgeTimes && badgeTimes !== '0') parts.push(badgeTimes);
        payStatus = parts.filter(Boolean).join(' ');
      }

      // ══════════════════════════════════════
      // td[6]:物流狀態
      // ══════════════════════════════════════
      let shipText = '';
      const shipTd = tds[6];
      if (shipTd) {
        const sn = (shipTd.querySelector('.status-name')?.innerText || '').trim();
        shipText = sn || (shipTd.innerText || '').trim();
      }
      // 從物流文字中提取簡短代號(7-11 / 全家 / 宅配)
      let shipShort = '-';
      if (/7-11|7-ELEVEN|統一/.test(shipText)) shipShort = '7-11';
      else if (/全家|FamilyMart/.test(shipText)) shipShort = '全家';
      else if (/宅配|新竹|HCT/.test(shipText)) shipShort = '宅配';

      // ══════════════════════════════════════
      // td[7]:金額
      // ══════════════════════════════════════
      const amountRaw = (tds[7]?.innerText || '').trim();
      const amount = amountRaw.replace(/[^\d]/g, '') || '0';

      // ══════════════════════════════════════
      // td[8]:備註圖示(顧客/商家)
      //   data-prefix="fas"(實心)= 有備註
      //   data-prefix="far"(空心)= 無備註
      // ══════════════════════════════════════
      let hasCustomerNote = false, hasMerchantNote = false;
      const noteTd = tds[8];
      if (noteTd) {
        // 顧客備註圖示(message-exclamation):實心 fas 表示有
        const custIcon = noteTd.querySelector('.fa-message-exclamation');
        hasCustomerNote = custIcon
          ? (custIcon.getAttribute('data-prefix') === 'fas' || custIcon.classList.contains('text-warning'))
          : false;
        // 商家備註圖示(message-lines):實心 fas 表示有
        const merchIcon = noteTd.querySelector('.fa-message-lines');
        hasMerchantNote = merchIcon
          ? (merchIcon.getAttribute('data-prefix') === 'fas' || merchIcon.classList.contains('text-warning'))
          : false;
      }
      // 備註內容只有 hover 才會載入(v-popper),掃描階段標「有/無」即可
      const customerNote = hasCustomerNote ? '【有顧客備註,請點開訂單查看】' : '';
      const merchantNote = hasMerchantNote ? '【有商家備註,請點開訂單查看】' : '';

      // ══════════════════════════════════════
      // 衍生屬性
      // ══════════════════════════════════════
      const allText = `${customer} ${phone} ${product} ${shipText} ${payStatus}`;
      const hasPreorder = preKws.some(k => k && (product.includes(k) || allText.includes(k)));
      const isExc = /EXC/i.test(id);
      const isOverseas = /香港|澳門|新加坡|馬來西亞|海外|Hong\s*Kong|Singapore/i.test(custTd?.innerText || '');

      // 🐛 Debug:若關鍵欄位抓不到,印出 outerHTML 供校正
      if (!id || !customer) {
        warn(`[掃描異常] id="${id}" customer="${customer}" 抓取不完整,outerHTML:`);
        console.log(tr.outerHTML);
      }

      return {
        id, phone, customer, amount, payStatus, shipText, shipShort, date,
        hasPreorder, isExc, isOverseas,
        product, customerNote, merchantNote,
        comboLabel,           // ★ V11.44:短格式商品組合標籤,供 NORMAL 區組合過濾選單顯示
        hasCustomerNote, hasMerchantNote,
        loyaltyCount,         // 1shop 原生「老顧客」標籤的數字
        // ★ V11.39:網頁原生 .order-label 標籤
        webLoyaltyLabel, webDupLabel, webOverseasLabel,
        duplicateCount: 1,    // 本次掃描內同電話筆數(detectDuplicates 計算)
        scanbackOK: false,
        scanbackReason: '',
        rowNote: '',
        rowMoveTab: '',
        confirmStatus,        // 「等待確認」之類訂單狀態
        rawText: allText,
        type: 'NORMAL',
        needEmail: false,
        diagnostic: '',
        relatedOrders: [],
        scanPage: pageNum,    // ★ V11.39:訂單在第幾頁掃到(用於跨頁執行)
      };
    });
  }

  /** ★ V11.39 找「最前面」分頁按鈕(用 angles-left 圖示) */
  async function findFirstPageBtn() {
    const icons = document.querySelectorAll('svg[data-icon="angles-left"]');
    for (const icon of icons) {
      const btn = icon.closest('button, a');
      if (!btn || btn.disabled) continue;
      if (btn.offsetParent === null) continue;  // ★ V11.48:width→offsetParent
      const parentLi = btn.closest('li, .page-item');
      if (parentLi && parentLi.classList.contains('disabled')) continue;
      const inPagination = btn.closest('.pagination, [class*="pagination" i]');
      if (!inPagination) continue;
      return btn;
    }
    return null;
  }

  /** ★ V11.39 切到指定分頁(從第 1 頁開始逐頁點下一頁) */
  async function gotoPage(targetPage) {
    if (!targetPage || targetPage < 1) return;
    // 先切回第 1 頁
    const firstBtn = await findFirstPageBtn();
    if (firstBtn) {
      firstBtn.click();
      await sleep(2500);
    }
    // 從 1 點到 targetPage
    for (let p = 1; p < targetPage; p++) {
      const next = findNextPageBtn();
      if (!next) {
        warn(`[gotoPage] 切到第 ${targetPage} 頁失敗,找不到下一頁按鈕(目前在第 ${p} 頁)`);
        return;
      }
      next.click();
      await sleep(2500);
    }
    log(`[gotoPage] 已切到第 ${targetPage} 頁`);
  }

  /** ★ V11.39 全選當前頁所有訂單 — 找 thead 全選 checkbox,或逐筆勾選 tbody 內 cb */
  async function selectAllOnCurrentPage() {
    // 方法 1:點 thead 內的全選 checkbox
    const masterCb = document.querySelector('thead input[type="checkbox"]:not(:checked)');
    if (masterCb && masterCb.getBoundingClientRect().width > 0) {
      masterCb.click();
      await sleep(800);
      const checkedNow = document.querySelectorAll('tbody tr input[type="checkbox"]:checked').length;
      log(`[全選] 用 thead 全選,已勾選 ${checkedNow} 筆`);
      return checkedNow;
    }
    // 方法 2:逐筆勾選 tbody 內所有 cb
    const rows = document.querySelectorAll('tbody tr');
    let n = 0;
    for (const tr of rows) {
      const cb = tr.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) { cb.click(); n++; await sleep(40); }
    }
    log(`[全選] 逐筆勾選 ${n} 筆`);
    await sleep(800);
    return n;
  }

  /** ★ V11.39 跨頁逐頁執行 — 對 orders 依 scanPage 分組,逐頁切換並執行 callback */
  async function foreachOrderAcrossPages(orders, callback) {
    if (!orders || orders.length === 0) return;
    // 1. 依 scanPage 分組
    const byPage = {};
    for (const o of orders) {
      const p = o.scanPage || 1;
      (byPage[p] = byPage[p] || []).push(o);
    }
    const pageNums = Object.keys(byPage).map(Number).sort((a, b) => a - b);
    log(`[跨頁] 訂單分佈:${pageNums.map(p => `第${p}頁(${byPage[p].length})`).join(', ')}`);

    // 2. 逐頁處理
    for (let i = 0; i < pageNums.length; i++) {
      const p = pageNums[i];
      await gotoPage(p);
      await sleep(1500);
      log(`[跨頁] ▶ 處理第 ${p} 頁 ${byPage[p].length} 筆`);
      await callback(byPage[p], p);
      log(`[跨頁] ✔ 第 ${p} 頁處理完`);
    }
  }

  function findNextPageBtn() {
    // ★ V11.39 加上 SVG data-icon 偵測 + 修正 li 的 disabled 判斷
    // 1shop 後台 DOM:
    //   <li class="page-item disabled"><button><svg data-icon="angle-right"/></button></li>
    //   注意:disabled 在 LI 上面,不是 BUTTON 上;BUTTON 本身 disabled=false 但實際不可點
    const nextIcons = [
      'svg[data-icon="angle-right"]',
      'svg[data-icon="chevron-right"]',
      'svg[data-icon="arrow-right"]',
      'svg[data-icon="caret-right"]',
    ];
    for (const sel of nextIcons) {
      const icons = document.querySelectorAll(sel);
      for (const icon of icons) {
        const di = icon.getAttribute('data-icon');
        if (di && di.startsWith('angles')) continue; // 排除 angles-* 雙箭頭

        const btn = icon.closest('button, a');
        if (!btn) continue;
        // ★ V11.48:可見性檢查 width===0 → offsetParent===null(延續 V11.47 修法)
        //   原因:1shop 分頁列的 angle-right 按鈕 getBoundingClientRect().width 會量到 0
        //         導致跨頁翻頁被誤判「已是最後一頁」,只處理第一頁就結束。
        //   實測(使用者 Console):angle-right 的父 li disabled=false、offsetParent 判斷得出可見
        if (btn.offsetParent === null) continue;

        // ★ V11.39 關鍵修正:檢查父 li / span 是否有 disabled class 或 aria-disabled
        const parentLi = btn.closest('li, .page-item, [class*="page-item"]');
        if (parentLi) {
          if (parentLi.classList.contains('disabled')) {
            log(`[掃描] angle-right 按鈕的父 li 有 .disabled,跳過(已是最後一頁)`);
            continue;
          }
          if (parentLi.getAttribute('aria-disabled') === 'true') continue;
        }
        if (btn.disabled || btn.classList.contains('disabled')) continue;
        if (btn.closest('[aria-disabled="true"]')) continue;

        // 必須在 pagination 容器內
        const inPagination = btn.closest('.pagination, [class*="pagination" i], nav[aria-label*="age" i]');
        if (!inPagination) continue;

        log(`[掃描] 找到下一頁按鈕(SVG data-icon="${di}")`);
        return btn;
      }
    }

    // (1) 文字含「下一頁」「Next」「»」「›」「>」的可見可用按鈕
    const textVariants = ['下一頁', 'Next', '»', '›'];
    for (const kw of textVariants) {
      const btn = $$('button, a, .page-link, [role="button"]').find(b => {
        if (!b || b.disabled || b.classList.contains('disabled')) return false;
        if (b.offsetParent === null) return false;  // ★ V11.48:width→offsetParent
        const parent = b.closest('.disabled, [aria-disabled="true"]');
        if (parent) return false;
        const t = (b.textContent || '').trim();
        return t === kw || t.includes(kw);
      });
      if (btn) { log(`[掃描] 找到下一頁按鈕(文字「${kw}」):「${btn.textContent.trim().slice(0,20)}」`); return btn; }
    }

    // (2) aria-label / class 含 next/Next
    const labelSelectors = [
      'button[aria-label*="next" i]:not([disabled])',
      'a[aria-label*="next" i]:not(.disabled)',
      '.page-link[aria-label*="next" i]',
      '.page-item.next:not(.disabled) a',
      '.page-item:not(.disabled) [aria-label*="next" i]',
      'li.next:not(.disabled) a',
      '[class*="pagination" i] [class*="next" i]:not(.disabled)',
    ];
    for (const sel of labelSelectors) {
      const btn = $(sel);
      // ★ V11.48:width>0 → offsetParent!==null
      if (btn && btn.offsetParent !== null && !btn.closest('.disabled')) {
        log(`[掃描] 找到下一頁按鈕(selector「${sel}」)`);
        return btn;
      }
    }

    // (3) Bootstrap pagination:找 active 頁碼,點它的下一個非 disabled 兄弟
    //   active 變體:.active / .is-active / .current / [aria-current="page"]
    const activeSels = [
      '.pagination .page-item.active',
      '.pagination .active',
      '[class*="pagination" i] .active',
      '[class*="pagination" i] .is-active',
      '[class*="pagination" i] [aria-current="page"]',
    ];
    let activePage = null;
    for (const sel of activeSels) {
      activePage = $(sel);
      if (activePage) break;
    }
    if (activePage) {
      let nextSib = activePage.nextElementSibling;
      while (nextSib) {
        // 跳過 disabled 的兄弟(可能是分隔符)
        if (nextSib.classList.contains('disabled') || nextSib.getAttribute('aria-disabled') === 'true') {
          nextSib = nextSib.nextElementSibling;
          continue;
        }
        const link = nextSib.querySelector('a, button, .page-link') || nextSib;
        if (link && link.offsetParent !== null) {  // ★ V11.48:width>0 → offsetParent!==null
          log(`[掃描] 找到下一頁按鈕(active 頁碼「${activePage.textContent.trim()}」的下一個兄弟)`);
          return link;
        }
        nextSib = nextSib.nextElementSibling;
      }
    }

    // (4) 找不到 → log 出整個分頁列的結構,幫助診斷
    const paginationContainer = $('.pagination, [class*="pagination" i], nav[aria-label*="age" i]');
    if (paginationContainer) {
      log(`[掃描] ⚠️ 找不到「下一頁」按鈕,但有分頁容器:${paginationContainer.outerHTML.slice(0, 800)}`);
    } else {
      log(`[掃描] ⚠️ 找不到任何分頁按鈕容器(可能只有一頁,或分頁元件結構特殊)`);
    }
    return null;
  }

  // ============================================================
  //  ⑦-B 備註內文抓取(hover v-popper)
  //     對每筆「圖示為實心 fas(有備註)」的訂單,
  //     hover 顧客/商家備註圖示 → 等 v-popper popup 出現 → 抓取文字 → 寫回 order
  // ============================================================
  /** ★ V11.39 終極版:完全照搬已驗證 100% 成功的診斷腳本邏輯
   *    1. 直接 page-wide 找 `.fa-message-*[data-prefix="fas"]` 圖示(不再走 order → tr → td 多層路徑)
   *    2. 每筆 icon 自行 closest('tr') 對應到 order
   *    3. hoverAndGetPopperText 用最精簡邏輯:4 個事件 + 100ms 一拍 × 15 拍
   */
  async function fetchNotesFromHover(orders) {
    // ★ 跟診斷腳本一樣:直接從 page 找所有實心備註圖示
    const customerIcons = Array.from(document.querySelectorAll('.fa-message-exclamation[data-prefix="fas"]'));
    const merchantIcons = Array.from(document.querySelectorAll('.fa-message-lines[data-prefix="fas"]'));

    log(`[備註] 顧客備註圖示 ${customerIcons.length} 個、商家備註圖示 ${merchantIcons.length} 個`);

    let done = 0, success = 0;
    const total = customerIcons.length + merchantIcons.length;
    if (total === 0) return;

    // 處理顧客備註
    for (const icon of customerIcons) {
      const tr = icon.closest('tr');
      const orderId = tr?.querySelector('a[href*="/shop/order/all/"]')?.innerText?.trim();
      const o = orders.find(x => x.id === orderId);

      const text = await hoverAndGetPopperText(icon);
      if (o) {
        if (text) {
          o.customerNote = text;
          success++;
        } else {
          o.customerNote = `【有顧客備註,請點開 ${orderId} 查看】`;
        }
      }
      done++;
      if (done % 3 === 0) toast(`🔍 備註抓取 ${done}/${total}(成功 ${success})`, 'info', 600);
    }

    // 處理商家備註
    for (const icon of merchantIcons) {
      const tr = icon.closest('tr');
      const orderId = tr?.querySelector('a[href*="/shop/order/all/"]')?.innerText?.trim();
      const o = orders.find(x => x.id === orderId);

      const text = await hoverAndGetPopperText(icon);
      if (o) {
        if (text) {
          o.merchantNote = text;
          success++;
        } else {
          o.merchantNote = `【有商家備註,請點開 ${orderId} 查看】`;
        }
      }
      done++;
      if (done % 3 === 0) toast(`🔍 備註抓取 ${done}/${total}(成功 ${success})`, 'info', 600);
    }

    log(`✅ 備註抓取完成:${done}/${total} 筆,成功取得內文:${success} 筆`);
  }

  /** ★ V11.39:用 unsafeWindow 構造事件,讓事件 view 指向真實 page window
   *  (Tampermonkey sandbox 的 window 跟 page 的 window 不同,Vue Floating UI 會檢查 view)
   */
  async function hoverAndGetPopperText(icon) {
    if (!icon) return '';

    // ★ 關鍵:用 page 真實的 window(unsafeWindow),不是 Tampermonkey sandbox 的 window
    const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    const container = icon.closest('span') || icon;
    const rect = container.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // 派 4 個 hover 事件(用 page 的 W.MouseEvent / W.PointerEvent 建構子,事件 view = W)
    ['mouseenter', 'mouseover', 'pointerenter', 'pointerover'].forEach(type => {
      try {
        const Ctor = type.startsWith('pointer') ? W.PointerEvent : W.MouseEvent;
        const init = { bubbles: true, cancelable: true, view: W, clientX: cx, clientY: cy };
        if (Ctor === W.PointerEvent) { init.pointerType = 'mouse'; init.isPrimary = true; }
        container.dispatchEvent(new Ctor(type, init));
      } catch {}
    });

    // 等候 popper:每 100ms 一拍,最多 15 拍 = 1.5 秒
    let captured = '';
    for (let i = 0; i < 15; i++) {
      await sleep(100);
      const shownPoppers = $$('.v-popper__popper--shown');
      for (const p of shownPoppers) {
        const inner = p.querySelector('.v-popper__inner');
        const v = (inner ? inner.innerText : p.innerText || '').trim();
        if (v && v !== '顧客' && v !== '商家' && v.length > 1) {
          captured = v;
          break;
        }
      }
      if (captured) break;
    }

    // mouseleave(同樣用 W 建構子)
    ['mouseleave', 'mouseout', 'pointerleave', 'pointerout'].forEach(type => {
      try {
        const Ctor = type.startsWith('pointer') ? W.PointerEvent : W.MouseEvent;
        const init = { bubbles: true, cancelable: true, view: W, clientX: cx, clientY: cy };
        if (Ctor === W.PointerEvent) { init.pointerType = 'mouse'; init.isPrimary = true; }
        container.dispatchEvent(new Ctor(type, init));
      } catch {}
    });
    await sleep(200);

    captured = captured.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (captured === '顧客' || captured === '商家') return '';
    return captured;
  }

  /** 反查同電話歷史 + 偵測重複單 + 老顧客標記 */
  async function detectDuplicates() {
    // 同一電話出現多筆
    const phoneMap = {};
    allOrders.forEach(o => {
      if (!o.phone) return;
      (phoneMap[o.phone] = phoneMap[o.phone] || []).push(o);
    });

    Object.values(phoneMap).forEach(group => {
      if (group.length >= 2) {
        // 同電話多筆 → 標記為重複,並彼此互為 relatedOrders
        group.forEach(o => {
          o.relatedOrders = group.filter(x => x.id !== o.id).map(x => ({
            id: x.id, payStatus: x.payStatus, amount: x.amount,
          }));
          // 老顧客標記:同電話含自己共 N 筆
          o.loyaltyCount = group.length;
          o.scanbackOK = false;
          o.scanbackReason = `本批掃描內同電話共 ${group.length} 筆`;
        });
      } else {
        // 同電話只有 1 筆 → 顯示反查正常(若需精準歷史比對,後續可串 1shop 反查 API)
        group.forEach(o => {
          o.loyaltyCount = 1;
          o.scanbackOK = true;
          o.scanbackReason = '本批掃描內無重複,僅 1 筆';
        });
      }
    });
  }

  /** 分類訂單 */
  function classifyOrders(preKws) {
    allOrders.forEach(o => {
      // 優先順序:重複 > 預購 > EXC > 海外 > 未付款 > 一般
      if (o.relatedOrders.length > 0) {
        o.type = 'DUP';
        o.diagnostic = classifyDuplicateScenario(o);
        // 「留新砍舊」分流:只 KEEP 筆勾發信
        applyDupKeepOrCancel(o);
      } else if (o.hasPreorder) {
        o.type = 'PREORDER';
        o.rowNote = NOTE_TEMPLATES.PREORDER;     // ★ 不含日期
        o.rowMoveTab = Storage.get(LS.PREORDER_TAB, '暫存');
        o.needEmail = false;
      } else if (o.isExc) {
        o.type = 'EXC';
        o.rowNote = NOTE_TEMPLATES.EXC;          // ★ 不含日期
        o.rowMoveTab = '確認中';
        o.needEmail = false;
      } else if (o.isOverseas) {
        o.type = 'OVERSEAS';
        o.rowNote = NOTE_TEMPLATES.OVERSEAS;     // ★ 不含日期
        o.rowMoveTab = '確認中';
        o.needEmail = false;
      } else if (isUnpaid(o.payStatus)) {
        o.type = 'UNPAID';
        o.rowNote = NOTE_TEMPLATES.UNPAID;       // ★ 不含日期(自動化執行時加)
        o.rowMoveTab = '確認中';
        o.needEmail = true;
      } else {
        o.type = 'NORMAL';
        o.rowNote = '';
        o.rowMoveTab = '不移動';   // ★ V11.39:NORMAL 預設不移動分頁(物流拋單流程內部會自動處理狀態)
        o.needEmail = false;
      }
    });
  }

  /** ★ V11.39 人工改分類時,只套用新類型的「發信預設 + 移分頁目的地」,保留原備註文字
   *  使用者明確需求:備註保留(例如 EXC 仍寫「待折抵」),但發信/移分頁走新類型規則
   */
  function applyTypeDefaultsKeepNote(o, newType) {
    switch (newType) {
      case 'DUP':
        o.needEmail = true;
        o.rowMoveTab = '確認中';     // DUP CANCEL 預設,KEEP 由 applyDupKeepOrCancel 改寫
        break;
      case 'PREORDER':
        o.needEmail = false;
        o.rowMoveTab = Storage.get(LS.PREORDER_TAB, '暫存');
        break;
      case 'EXC':
        o.needEmail = false;
        o.rowMoveTab = '確認中';
        break;
      case 'OVERSEAS':
        o.needEmail = false;
        o.rowMoveTab = '確認中';
        break;
      case 'UNPAID':
        o.needEmail = true;
        o.rowMoveTab = '確認中';
        break;
      case 'NORMAL':
        o.needEmail = false;
        o.rowMoveTab = '不移動';
        break;
    }
  }

  /** ★ V11.39 人工調整單筆訂單的分類(只影響當次掃描,重新掃描後恢復自動分類)
   *   1. 更新 o.type
   *   2. 用 applyTypeDefaultsKeepNote 套用新類型的發信預設 + 移分頁目的地(保留原備註)
   *   3. 標記 o.manuallyReclassified = true 給看板顯示「✏️ 已調整」
   *   4. 重新 render 看板,訂單從原卡片消失加到新卡片
   */
  function reclassifyOrder(orderId, newType) {
    const o = allOrders.find(x => x.id === orderId);
    if (!o) {
      warn(`[人工分類] 找不到訂單 ${orderId}`);
      return;
    }
    const oldType = o.type;
    if (oldType === newType) return;

    if (!o.originalType) o.originalType = oldType;   // 記住第一次自動分類的結果(供顯示)
    o.type = newType;
    o.manuallyReclassified = true;

    // 套用新類型的發信預設 + 移分頁目的地(保留原備註)
    applyTypeDefaultsKeepNote(o, newType);

    log(`[人工分類] ${orderId}: ${STRATEGY_NAMES[oldType] || oldType} → ${STRATEGY_NAMES[newType] || newType}(備註「${o.rowNote}」保留)`);
    toast(`✓ ${o.id} 已從 ${STRATEGY_NAMES[oldType] || oldType} 改為 ${STRATEGY_NAMES[newType] || newType}`, 'info', 2200);

    // 重新 render 看板(分組變了)
    if (typeof renderKanban === 'function') {
      renderKanban();
    } else if (typeof refreshOverlay === 'function') {
      refreshOverlay();
    }
  }

  /** MM/DD 日期格式(對話定版格式)*/
  function formatMMDD(d) {
    return `${(d.getMonth() + 1)}/${d.getDate()}`;
  }

  /** 「留新砍舊」分流(V11.39 簡化版):
   *  ★ 規則
   *    - 找該電話群組中「明顯成功」的訂單(已付款 / 貨到付款 / 刷卡成功)
   *    - 若僅有 1 筆成功 → 那筆 = KEEP(發信);其餘 = CANCEL(不發信)
   *    - 若多筆成功 → 取訂單編號最新(字典序最大)= KEEP;其餘 = CANCEL
   *    - 若沒有任何明顯成功筆 → 取訂單編號最新 = KEEP;其餘 = CANCEL(防呆預設,仍只發保留筆)
   *  ★ 備註(rowNote)
   *    - KEEP:空白
   *    - CANCEL:`重複訂單 此筆取消`(★ 不含日期前贅,自動化執行時才動態加 MM/DD)
   */
  function applyDupKeepOrCancel(order /*, todayMMDD 已不需要 */) {
    const all = [order, ...order.relatedOrders.map(r => allOrders.find(o => o.id === r.id)).filter(Boolean)];
    if (all.length < 2) return;

    // 找「明顯成功」的訂單
    const successOnes = all.filter(o =>
      isCardSuccess(o.payStatus) ||
      isCOD(o.payStatus) ||
      /已付款|付款成功|交易成功|完成/.test(o.payStatus || '')
    );

    let keepOne;
    if (successOnes.length === 1) {
      keepOne = successOnes[0];
    } else if (successOnes.length > 1) {
      keepOne = [...successOnes].sort((a, b) => (a.id > b.id ? -1 : 1))[0];
    } else {
      // 沒有明顯成功筆 → 用 ID 字典序最大當保留(防呆)
      keepOne = [...all].sort((a, b) => (a.id > b.id ? -1 : 1))[0];
    }

    if (order.id === keepOne.id) {
      // 保留筆 → 發信通知客戶
      order.dupRole = 'KEEP';
      order.needEmail = true;
      order.rowNote = '';           // ★ 保留筆備註空白
      // ★ V11.41:預設「不移動」,保留筆留在等待確認分頁讓階段 C 自動分流當天出貨
      //   若使用者人工把這欄改成別的(如已取消/確認中),會在階段 B 真的執行移動
      order.rowMoveTab = '不移動';
    } else {
      // 取消筆 → 只寫備註,不發信
      order.dupRole = 'CANCEL';
      order.needEmail = false;
      order.rowNote = NOTE_TEMPLATES.DUP_CANCEL; // ★ 「重複訂單 此筆取消」(無日期)
      order.rowMoveTab = '已取消';
    }
  }

  /** 重複單情境判定(A/B/C/D/E)
   *  A:純未付款(線上刷卡尚未付款 / 等待付款 / 待確認付款) → 不發信,移交確認中
   *  B:兩筆皆貨到付款 / 超商取貨時付款 → 不發信,移交確認中(沿用 A 處理)
   *  C:一筆貨到付款 + 一筆刷卡失敗 → 保留貨到付款,失敗筆寄信通知取消
   *  D:一筆刷卡成功 + 一筆刷卡失敗 → 保留成功筆,失敗筆寄信通知取消
   *  E:純重複未付款 → 寄催繳信並移交確認中
   */
  function classifyDuplicateScenario(order) {
    const all = [order, ...order.relatedOrders.map(r => allOrders.find(o => o.id === r.id) || r)];
    const codCount    = all.filter(o => isCOD(o.payStatus)).length;
    const pureUnpaid  = all.filter(o => isUnpaid(o.payStatus) && !isCOD(o.payStatus)).length;
    const failCount   = all.filter(o => isCardFail(o.payStatus)).length;
    const succCount   = all.filter(o => isCardSuccess(o.payStatus)).length;

    // 情境 B:全部都是貨到付款 / 超商取貨時付款
    if (codCount === all.length) return '【B】兩筆皆貨到付款 → 不發信,移交確認中由客服判斷';
    // 情境 A:全部都是純未付款(線上刷卡尚未付款)
    if (pureUnpaid === all.length) return '【A】兩筆皆純未付款 → 不發信,移交確認中由客服判斷';
    // 情境 C:貨到付款 + 刷卡失敗
    if (codCount >= 1 && failCount >= 1) return '【C】保留貨到付款,刷卡失敗筆寄信通知取消';
    // 情境 D:刷卡成功 + 刷卡失敗
    if (succCount >= 1 && failCount >= 1) return '【D】保留刷卡成功,失敗筆寄信通知取消';
    // 情境 E:其他重複未付款狀況 → 預設催繳
    return '【E】重複未付款 → 寄催繳信並移交確認中';
  }

  // ============================================================
  //  ⑧ 看板渲染(9 欄表格,符合期望介面)
  //     欄位:選取 / 訂單資訊(含透視) / 狀態 / 購買商品 / 物流 / 金額 / 日期 / 個別修改備註 / 移動分頁
  // ============================================================

  // ★ V11.45:產生「商品組合」下拉的 <option> 字串(供 render 初次產生 + 物流下拉 onchange 即時重算共用)
  //   which:物流過濾('all' = 全部物流;'711'/'fami'/'home' = 只算該物流的訂單)
  //   規則:只列「>1 筆」的組合、依筆數多到少排序;value 存完整 product、顯示用短 comboLabel
  //   ★ V11.53:加透明統計 — 標題顯示總筆數,底部 disabled 說明列出「已列 N 筆/其餘 M 筆」
  //     原因:下拉只列「>1筆」組合,加總 ≠ 可出貨總數,易被誤會漏算;補說明讓數字透明(不改過濾行為)
  function buildComboOptions(normalOrders, which = 'all') {
    const productCounts = {};
    const productLabels = {};
    let totalMatched = 0;   // ★ V11.53:符合該物流的可出貨總筆數(含無商品、含單筆組合)
    normalOrders.forEach(o => {
      if (!orderMatchesCarrier(o, which)) return;  // ★ V11.45:依物流過濾後才計數
      totalMatched++;                              // ★ V11.53:先計入總數(在 !p 過濾之前)
      const p = (o.product || '').trim();
      if (!p) return;
      productCounts[p] = (productCounts[p] || 0) + 1;
      if (!productLabels[p]) productLabels[p] = o.comboLabel || p;
    });
    const comboList = Object.entries(productCounts)
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]);
    const optionsHtml = comboList.map(([pName, count]) =>
      `<option value="${escapeAttr(pName)}">[${count}筆] ${escapeHTML(productLabels[pName])}</option>`
    ).join('');

    // ★ V11.53:透明統計 — 已列出的筆數(只算 >1 筆組合)vs 其餘(單筆/無商品)
    const listedCount = comboList.reduce((sum, [, count]) => sum + count, 0);
    const restCount = totalMatched - listedCount;
    const headLabel = `📦 全部商品組合 (共 ${totalMatched} 筆)`;
    // 底部說明列(disabled,不可選,純提示);只有「有被隱藏的筆數」時才顯示,避免多餘
    const note = restCount > 0
      ? `<option disabled>──────────</option>` +
        `<option disabled>ℹ️ 已列 2 筆↑組合 ${listedCount} 筆,其餘 ${restCount} 筆為單筆或無商品</option>`
      : '';
    return `<option value="all">${escapeHTML(headLabel)}</option>${optionsHtml}${note}`;
  }

  function renderKanban() {
    const container = $('#v11-cards-container');
    if (!container) return;

    // 先把 UI 上使用者輸入的 rowNote / rowMoveTab 暫存回 allOrders,再重渲染
    saveRowInputsToData();

    container.innerHTML = '';

    if (allOrders.length === 0) {
      container.innerHTML =
        '<div style="text-align:center; padding:40px; color:#95a5a6;">本頁掃描無訂單,請調整深潛頁數後重試</div>';
      return;
    }

    STRATEGY_ORDER.forEach(type => {
      const orders = allOrders.filter(o => o.type === type);
      if (orders.length === 0) return;

      const showEmailSetup = (type === 'DUP' || type === 'UNPAID');
      const defSubj = type === 'DUP' ? DEFAULT_EMAILS.DUP_CANCEL.subject :
                      type === 'UNPAID' ? DEFAULT_EMAILS.UNPAID.subject :
                      DEFAULT_EMAILS.NORMAL.subject;
      const defBody = type === 'DUP' ? DEFAULT_EMAILS.DUP_CANCEL.body :
                      type === 'UNPAID' ? DEFAULT_EMAILS.UNPAID.body :
                      DEFAULT_EMAILS.NORMAL.body;

      const emailHTML = showEmailSetup ? `
        <div class="v11-email-setup" data-card-type="${type}">
          <label>📧 此區發信公版(可即時編輯)</label>
          <input class="v11-card-subj" type="text" value="${escapeAttr(defSubj)}">
          <textarea class="v11-card-body" rows="3">${escapeHTML(defBody)}</textarea>
        </div>` : '';

      // 各類型對應的「移動分頁」預設值
      const defaultMoveTab =
        (type === 'NORMAL')   ? '已確認' :
        (type === 'PREORDER') ? Storage.get(LS.PREORDER_TAB, '暫存') :
                                '確認中';

      let tbody = '';
      orders.forEach(o => {
        // ── 日期顯示 ──
        const dateDisp = new Date(o.date).toLocaleString('zh-TW', {
          hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });

        // ── 連結 ──
        const phoneLink = o.phone ? `https://admin.1shop.tw/shop/order/all?search=${o.phone}` : '#';
        const orderLink = `https://admin.1shop.tw/shop/order/all/${o.id}`;

        // ── 狀態色 ──
        const statusCls = isUnpaid(o.payStatus) ? 'v11-status-unpaid'
                        : isCOD(o.payStatus) ? 'v11-status-cod'
                        : isCardFail(o.payStatus) ? 'v11-status-fail'
                        : 'v11-status-paid';

        // ── 「老顧客」標籤(同電話 ≥ 2 筆才顯示)──
        const loyalTagHtml = (o.loyaltyCount && o.loyaltyCount >= 2)
          ? `<span class="v11-loyal-tag">老顧客 <b>${o.loyaltyCount}</b></span>` : '';

        // ★ V11.39 網頁原生標籤(1shop 後台直接顯示的)圖示,所有訂單(含 NORMAL)都顯示
        let webLabelsHtml = '';
        if (o.webLoyaltyLabel)  webLabelsHtml += `<span class="v11-web-label" style="background:#8e44ad;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;margin-right:4px;display:inline-block;margin-top:2px;">✨ 老顧客</span>`;
        if (o.webDupLabel)      webLabelsHtml += `<span class="v11-web-label" style="background:#e74c3c;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;margin-right:4px;display:inline-block;margin-top:2px;">🔁 重複</span>`;
        if (o.webOverseasLabel) webLabelsHtml += `<span class="v11-web-label" style="background:#16a085;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;margin-right:4px;display:inline-block;margin-top:2px;">✈️ 海外</span>`;
        if (webLabelsHtml) webLabelsHtml = `<div class="v11-web-labels-row">${webLabelsHtml}</div>`;

        // ── 同電話的其他訂單連結(若有)──
        const relatedHtml = (o.relatedOrders && o.relatedOrders.length > 0)
          ? `<div class="v11-history-tag">🔁 同電話另 ${o.relatedOrders.length} 筆:` +
            o.relatedOrders.map(r =>
              `<a href="https://admin.1shop.tw/shop/order/all?search=${r.id}" target="_blank">${r.id}</a>`
            ).join('、') + `</div>` : '';

        // ── 顧客備註 / 商家備註 ──
        const customerNoteHtml = o.customerNote
          ? `<div class="v11-note-box note-customer">
               <span class="note-icon">⚠️</span>
               <span><b>顧客備註:</b>${escapeHTML(o.customerNote)}</span>
             </div>` : '';
        const merchantNoteHtml = o.merchantNote
          ? `<div class="v11-note-box note-merchant">
               <span class="note-icon">⚠️</span>
               <span><b>商家備註:</b>${escapeHTML(o.merchantNote)}</span>
             </div>` : '';

        // ── 反查結果框(綠色 OK / 紅色 NG)──
        const scanbackHtml = o.scanbackReason
          ? `<div class="v11-scanback-box ${o.scanbackOK ? 'sb-ok' : 'sb-warn'}">
               <div>🔍 <b>反查結果:</b>${escapeHTML(o.scanbackReason)}</div>
               <div>💡 <b>原因:</b>${o.scanbackOK ? '歷史訂單已完成' : '請人工確認'}</div>
             </div>` : '';

        // ── 診斷文字(重複單情境)──
        const diagHtml = o.diagnostic
          ? `<div class="v11-diag-box">${escapeHTML(o.diagnostic)}</div>` : '';

        // ── 其他標籤(預購/EXC/海外/重複單角色)──
        let extraTags = '';
        if (o.hasPreorder) extraTags += `<span class="v11-tag v11-tag-pre">🟡 預購</span>`;
        if (o.isExc)       extraTags += `<span class="v11-tag v11-tag-exc">🔵 EXC</span>`;
        if (o.isOverseas)  extraTags += `<span class="v11-tag v11-tag-os">✈️ 海外</span>`;
        // 重複單「留新砍舊」角色標籤(V11.39:KEEP 發信、CANCEL 不發信)
        if (o.dupRole === 'KEEP')       extraTags += `<span class="v11-tag" style="background:#27ae60;color:#fff;">✅ 保留(發信通知)</span>`;
        if (o.dupRole === 'CANCEL')     extraTags += `<span class="v11-tag" style="background:#c0392b;color:#fff;">❌ 取消(只備註)</span>`;
        if (o.dupRole === 'PENDING')    extraTags += `<span class="v11-tag" style="background:#f39c12;color:#fff;">⏸ 待客服判斷</span>`;
        if (o.dupRole === 'UNPAID_DUP') extraTags += `<span class="v11-tag" style="background:#e67e22;color:#fff;">💰 重複未付款</span>`;

        // ── 移動分頁下拉(若使用者已選擇就保留)──
        const moveTab = o.rowMoveTab || defaultMoveTab;
        const moveOptions = ['不移動', '已確認', '確認中', '已取消', '暫存', '其他']
          .map(v => `<option value="${v}" ${v === moveTab ? 'selected' : ''}>${v}</option>`).join('');

        // ── 個別修改備註 ──
        const noteVal = escapeAttr(o.rowNote || '');

        tbody += `
          <tr data-order-id="${o.id}">
            <td class="td-select">
              <input type="checkbox" class="v11-chk-exec" data-id="${o.id}" checked>
            </td>
            <td class="td-info">
              <div class="cust-name">${escapeHTML(o.customer || '-')}</div>
              <a href="${orderLink}" target="_blank" class="ord-id">${escapeHTML(o.id)}</a>
              <a href="${phoneLink}" target="_blank" class="phone-link">🔍 反查: ${escapeHTML(o.phone || '-')}</a>
              ${webLabelsHtml}
              ${loyalTagHtml}
              ${extraTags ? `<div>${extraTags}</div>` : ''}
              ${customerNoteHtml}
              ${merchantNoteHtml}
              ${scanbackHtml}
              ${relatedHtml}
              ${diagHtml}
            </td>
            <td class="td-status ${statusCls}">${escapeHTML(o.payStatus || '-')}</td>
            <!-- ★ V11.46:購買商品欄改顯示 comboLabel(SKU*數量,如「DK4-BK*2」),
                 完整商品名移到 title 屬性(滑鼠 hover 可見);o.product 本身不動,
                 仍供分類比對與組合過濾使用 -->
            <td class="td-product" title="${escapeAttr(o.product || '')}">${escapeHTML(o.comboLabel || o.product || '-')}</td>
            <td class="td-ship"><span class="ship-badge">${escapeHTML(o.shipText || '-')}</span></td>
            <td class="td-amount">$${o.amount}</td>
            <td class="td-date">${dateDisp}</td>
            <td class="td-rowemail">
              <input type="checkbox" class="v11-chk-email" data-id="${o.id}" ${o.needEmail ? 'checked' : ''}
                title="勾選後在執行階段會對這筆寄出 Email">
            </td>
            <td class="td-rownote">
              <input type="text" class="v11-row-note" data-id="${o.id}" value="${noteVal}" placeholder="">
            </td>
            <td class="td-rowmove">
              <select class="v11-row-move" data-id="${o.id}">${moveOptions}</select>
            </td>
            <td class="td-rowtype">
              ${(() => {
                const types = ['DUP','UNPAID','PREORDER','EXC','OVERSEAS','NORMAL'];
                const opts = types.map(t =>
                  `<option value="${t}" ${o.type === t ? 'selected' : ''}>${STRATEGY_NAMES[t] || t}</option>`
                ).join('');
                const mark = o.manuallyReclassified
                  ? `<span title="人工已調整,原為 ${STRATEGY_NAMES[o.originalType] || o.originalType}" style="color:#e67e22;margin-right:2px">✏️</span>`
                  : '';
                return `${mark}<select class="v11-row-type" data-id="${o.id}" title="改變後該訂單會移到對應卡片;備註保留,發信/移分頁套用新類型預設">${opts}</select>`;
              })()}
            </td>
          </tr>`;
      });

      // 卡片底部:NORMAL 顯示物流下拉,其他顯示單區執行按鈕
      // ★ V11.44:NORMAL 區新增「商品組合」過濾下拉
      //   用途:出貨人員可只挑「同一種商品組合」的訂單一鍵拋印(例如只印「DK4-BK*2」那批)
      //   設計:option value 存完整 product(供精準過濾),顯示用短 comboLabel(簡潔)
      //         只列出「>1 筆」的組合(單筆沒有批次需求),依筆數多到少排序
      // ★ V11.45:options 改用 buildComboOptions 產生(初次預設算「全部物流」),
      //   物流下拉改變時會即時重算(見 bindKanbanEvents)
      let comboSelectHtml = '';
      if (type === 'NORMAL') {
        const comboOpts = buildComboOptions(orders, 'all');
        // ★ V11.53:只有「至少有一組 >1 筆」時才顯示下拉。
        //   原本用整串文字比對(!== 固定字串),但 V11.53 標題含動態總數、又可能有說明列,
        //   比對會失效 → 改判斷是否含實際組合 option(帶 value= 且非 all/非 disabled)。
        const hasRealCombo = /<option value="(?!all")/.test(comboOpts);
        if (hasRealCombo) {
          comboSelectHtml = `
            <select class="v11-select v11-combo-select" style="max-width:320px;" title="只挑選此商品組合的訂單拋印">
              ${comboOpts}
            </select>`;
        }
      }

      const footerHtml = (type === 'NORMAL') ? `
        <select class="v11-select v11-logistics-select">
          <option value="all">📦 全部物流自動分流</option>
          <option value="711">7-11 物流</option>
          <option value="fami">全家 物流</option>
          <option value="home">宅配 物流</option>
        </select>
        ${comboSelectHtml}
        <button class="v11-btn v11-btn-card-logistics" style="background:#27ae60;" data-type="${type}">
          🚀 單獨執行本區拋單
        </button>` : `
        <button class="v11-btn v11-btn-card-exec" style="background:#34495e;" data-type="${type}">
          🚀 單獨執行本區動作(備註+發信+移分頁)
        </button>`;

      const cardHtml = `
        <div class="v11-card" data-type="${type}">
          <div class="v11-card-header">
            <span>${STRATEGY_NAMES[type]} <span style="font-weight:normal; color:#7f8c8d;">共 ${orders.length} 筆</span></span>
          </div>
          <div class="v11-card-body">
            ${emailHTML}
            <div class="v11-table-wrap">
              <table class="v11-table">
                <thead>
                  <tr>
                    <th class="th-select" width="4%">
                      <div>選取</div>
                      <input type="checkbox" class="v11-chk-all" data-type="${type}" checked title="本卡片全選/取消執行">
                    </th>
                    <th width="20%">訂單資訊 (含透視)</th>
                    <th width="7%">狀態</th>
                    <th width="11%">購買商品</th>
                    <th width="6%">物流 <span class="v11-sort" data-col="shipText">⇅</span></th>
                    <th width="6%">金額 <span class="v11-sort" data-col="amount">⇅</span></th>
                    <th width="8%">日期 <span class="v11-sort" data-col="date">⇅</span></th>
                    <th width="5%">
                      <div>📧 發信</div>
                      <input type="checkbox" class="v11-chk-email-all" data-type="${type}" title="本卡片全選/取消發信">
                    </th>
                    <th width="12%">個別修改備註</th>
                    <th width="9%">移動分頁</th>
                    <th width="8%">分類 <span title="人工調整分類,只影響當次掃描" style="cursor:help">ℹ️</span></th>
                  </tr>
                </thead>
                <tbody>${tbody}</tbody>
              </table>
            </div>
          </div>
          <div class="v11-card-footer">${footerHtml}</div>
        </div>`;
      container.insertAdjacentHTML('beforeend', cardHtml);
    });

    bindKanbanEvents();
  }

  /** 把 UI 上輸入的 rowNote / rowMoveTab / needEmail 寫回 allOrders(重渲染前先暫存)*/
  function saveRowInputsToData() {
    $$('.v11-row-note').forEach(inp => {
      const o = allOrders.find(x => x.id === inp.dataset.id);
      if (o) o.rowNote = inp.value;
    });
    $$('.v11-row-move').forEach(sel => {
      const o = allOrders.find(x => x.id === sel.dataset.id);
      if (o) o.rowMoveTab = sel.value;
    });
    $$('.v11-chk-email').forEach(cb => {
      const o = allOrders.find(x => x.id === cb.dataset.id);
      if (o) o.needEmail = cb.checked;
    });
  }

  function bindKanbanEvents() {
    // 全選「執行」
    $$('.v11-chk-all').forEach(cb => {
      cb.onchange = () => {
        const card = cb.closest('.v11-card');
        $$('.v11-chk-exec', card).forEach(x => { x.checked = cb.checked; });
      };
    });

    // ★ V11.39 全選「發信」
    $$('.v11-chk-email-all').forEach(cb => {
      cb.onchange = () => {
        const card = cb.closest('.v11-card');
        $$('.v11-chk-email', card).forEach(x => {
          x.checked = cb.checked;
          const o = allOrders.find(y => y.id === x.dataset.id);
          if (o) o.needEmail = cb.checked;
        });
      };
    });

    // 排序(時間 / 金額 / 物流)
    $$('.v11-sort').forEach(s => {
      s.onclick = () => {
        const col = s.dataset.col;
        if (currentSort.col === col) currentSort.dir = -currentSort.dir;
        else { currentSort.col = col; currentSort.dir = -1; }
        allOrders.sort((a, b) => {
          let va = a[col], vb = b[col];
          if (col === 'amount') { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; }
          if (va < vb) return -1 * currentSort.dir;
          if (va > vb) return  1 * currentSort.dir;
          return 0;
        });
        renderKanban();
      };
    });

    // 即時把使用者輸入的 rowNote / rowMoveTab / 發信勾選 寫回 data
    $$('.v11-row-note').forEach(inp => {
      inp.oninput = () => {
        const o = allOrders.find(x => x.id === inp.dataset.id);
        if (o) o.rowNote = inp.value;
      };
    });
    $$('.v11-row-move').forEach(sel => {
      sel.onchange = () => {
        const o = allOrders.find(x => x.id === sel.dataset.id);
        if (o) o.rowMoveTab = sel.value;
      };
    });

    // ★ V11.39:人工調整分類下拉
    $$('.v11-row-type').forEach(sel => {
      sel.onchange = () => {
        const newType = sel.value;
        const orderId = sel.dataset.id;
        // 先把當前 UI 上的所有 row 輸入暫存(避免 renderKanban 後丟失使用者編輯的備註/移分頁/發信)
        if (typeof saveRowInputsToData === 'function') saveRowInputsToData();
        reclassifyOrder(orderId, newType);
      };
    });
    // ★ V11.39 每筆「發信」checkbox 即時寫回 o.needEmail
    $$('.v11-chk-email').forEach(cb => {
      cb.onchange = () => {
        const o = allOrders.find(x => x.id === cb.dataset.id);
        if (o) o.needEmail = cb.checked;
      };
    });

    // 單區執行(非物流)
    $$('.v11-btn-card-exec').forEach(b => {
      b.onclick = () => withAutoUX(
        `📝 ${STRATEGY_NAMES[b.dataset.type] || b.dataset.type} 單區執行`,
        () => runFullPipeline('card', b.dataset.type)
      );
    });
    // 單區執行(物流)
    $$('.v11-btn-card-logistics').forEach(b => {
      b.onclick = () => {
        const card = b.closest('.v11-card');
        const which = $('.v11-logistics-select', card).value;
        // ★ V11.44:提取商品組合過濾值(沒有組合選單時預設 'all')
        const comboEl = $('.v11-combo-select', card);
        const combo = comboEl ? comboEl.value : 'all';
        withAutoUX(
          `🚚 ${STRATEGY_NAMES[b.dataset.type] || b.dataset.type} 物流拋印`,
          () => runLogisticsForCard(b.dataset.type, which, combo)
        );
      };
    });

    // ★ V11.45:物流下拉改變時,即時重算「商品組合」下拉的筆數(只算該物流的訂單)
    //   例如:DK4-BK*2 全部 5 筆(7-11 有 3 筆),選「7-11」後組合下拉會變「[3筆] DK4-BK*2」
    $$('.v11-logistics-select').forEach(sel => {
      sel.onchange = () => {
        const card = sel.closest('.v11-card');
        const comboEl = $('.v11-combo-select', card);
        if (!comboEl) return;  // 該卡片沒有組合下拉(沒有 >1 筆的組合)就不用重算

        const which = sel.value;
        const normalOrders = allOrders.filter(o => o.type === 'NORMAL');
        const prevValue = comboEl.value;  // 記住使用者原本選的組合,重算後盡量保留

        comboEl.innerHTML = buildComboOptions(normalOrders, which);

        // 若原本選的組合在新物流下還存在,保留選取;否則跳回「全部商品組合」
        const stillExists = Array.from(comboEl.options).some(opt => opt.value === prevValue);
        comboEl.value = stillExists ? prevValue : 'all';
      };
    });
  }

  // ── HTML escape ──
  function escapeHTML(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
  }
  function escapeAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

  // ============================================================
  //  ⑨ 核心執行管線:全局 / 單區 / 只物流
  // ============================================================

  /** 取得本次要處理的訂單清單 */
  // ★ V11.44:combo 參數 — 只挑指定商品組合的訂單('all' = 不過濾)
  //   過濾用 o.product(完整名),跟選單 option value 一致(value 存的就是完整 product)
  function getCheckedOrders(scope, type, combo = 'all') {
    let orders;
    if (scope === 'global') {
      // 所有卡片中有勾選的
      const ids = $$('.v11-chk-exec:checked').map(c => c.dataset.id);
      orders = allOrders.filter(o => ids.includes(o.id));
    } else {
      // 指定 type 卡片內的勾選
      const card = $(`.v11-card[data-type="${type}"]`);
      if (!card) return [];
      const ids = $$('.v11-chk-exec:checked', card).map(c => c.dataset.id);
      orders = allOrders.filter(o => ids.includes(o.id) && o.type === type);
    }
    // ★ V11.44:組合過濾(放最後,scope/type 篩完再依商品精準濾)
    if (combo && combo !== 'all') {
      orders = orders.filter(o => (o.product || '').trim() === combo);
    }
    return orders;
  }

  // ★ V11.45:判斷一筆訂單是否屬於指定物流('all' 一律 true)
  //   用 LOGISTICS[key].shipTextMatch 比對 o.shipText,跟拋印分組(runLogisticsByGroup)
  //   完全同一套邏輯,確保「組合下拉顯示的筆數」與「實際會拋的筆數」一致
  function orderMatchesCarrier(order, which) {
    if (!which || which === 'all') return true;
    const cfg = LOGISTICS[which];
    if (!cfg) return true;
    return cfg.shipTextMatch.some(k => (order.shipText || '').includes(k));
  }

  /** 取得各卡片即時編輯的公版主旨/內文 */
  function getCardEmailTemplate(type) {
    const card = $(`.v11-card[data-type="${type}"]`);
    if (!card) return null;
    // ★ V11.39 修正:'.v11-card-body' 在 CSS 也是卡片內容容器 div 的 class
    //   不限定為 textarea 會抓到 div(沒有 .value),導致 body 變 undefined → 發信內文空白
    const subjEl = $('input.v11-card-subj', card);
    const bodyEl = $('textarea.v11-card-body', card);
    if (!subjEl || !bodyEl) return null;
    const subj = subjEl.value || '';
    const body = bodyEl.value || '';
    if (!subj.trim() && !body.trim()) return null;
    return { subject: subj, body };
  }

  /** 依訂單的 dupRole / type 選對應公版(對話定版,V11.39 邏輯反轉)
   *  - DUP + dupRole='KEEP'        → DUP_CANCEL 公版(★ 發信給保留筆客戶,通知「另一筆重複單已取消」)
   *  - DUP + dupRole='CANCEL'      → null(★ 取消筆只寫備註,不發信)
   *  - DUP + dupRole='UNPAID_DUP'  → UNPAID 公版(因為情境 E:全部都異常,視為未付款)
   *  - DUP + dupRole='PENDING'     → null(不發信)
   *  - UNPAID                       → UNPAID 公版
   *  - 其他                          → null(不發信)
   */
  function pickEmailTemplate(order, type) {
    if (type === 'DUP') {
      if (order.dupRole === 'KEEP')       return DEFAULT_EMAILS.DUP_CANCEL; // ★ 寄給保留筆
      if (order.dupRole === 'UNPAID_DUP') return DEFAULT_EMAILS.UNPAID;
      return null; // CANCEL / PENDING 不發信
    }
    if (type === 'UNPAID') return DEFAULT_EMAILS.UNPAID;
    return null;
  }

  /**
   * 全流程管線:
   * 1. 寫備註(各卡片內勾選的訂單)
   * 2. 發信(勾選 needEmail 的訂單)
   * 3. 批次移動分頁(整批一次操作)
   * 4. 物流拋印(NORMAL 卡片 → 7-11 → 全家 → 宅配)
   * 5. 自動點擊原生「更新」按鈕
   */
  // ============================================================
  //  🌟 V11.39 全域 UX 包裝:任何「執行類」動作都自動
  //     ① 縮小主 modal(避免擋住 1shop 操作 UI、避免 z-index 衝突)
  //     ② 動作執行中右下角顯示輕量進度泡泡
  //     ③ 動作完成後自動重新掃描當前頁
  //     ④ 掃描完成後自動展開 modal,看板已更新
  // ============================================================
  let _progressBubble = null;
  function showProgressBubble(text) {
    if (!_progressBubble) {
      _progressBubble = document.createElement('div');
      _progressBubble.id = 'v11-progress-bubble';
      _progressBubble.style.cssText = `
        position: fixed; bottom: 80px; right: 20px;
        background: linear-gradient(135deg, #e74c3c, #c0392b);
        color: #fff; padding: 12px 18px; border-radius: 24px;
        font-weight: bold; font-size: 14px; z-index: 99999999;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        max-width: 360px; pointer-events: none;
        animation: v11-pulse 1.5s ease-in-out infinite;
      `;
      // 加 pulse 動畫
      if (!document.getElementById('v11-pulse-style')) {
        const s = document.createElement('style');
        s.id = 'v11-pulse-style';
        s.textContent = `@keyframes v11-pulse { 0%,100% {opacity:1} 50% {opacity:0.7} }`;
        document.head.appendChild(s);
      }
      document.body.appendChild(_progressBubble);
    }
    _progressBubble.textContent = text;
    _progressBubble.style.display = 'block';
  }
  function hideProgressBubble() {
    if (_progressBubble) _progressBubble.style.display = 'none';
  }

  function hideKanbanModal() {
    const m = $('#v11-overlay');
    if (m) m.style.display = 'none';
  }
  function showKanbanModal() {
    const m = $('#v11-overlay');
    if (m) m.style.display = 'flex';
  }

  /** 包裝任何執行類動作:縮小 modal → 執行 → 自動重新掃描 → 展開 modal */
  async function withAutoUX(actionName, fn) {
    log(`[autoUX] ▶ ${actionName} 開始`);
    let originalScanPages, errorOccurred = false;
    try {
      // ① 縮小 modal
      hideKanbanModal();
      showProgressBubble(`🚀 ${actionName} 執行中,請勿關閉視窗...`);

      // 執行實際動作
      await fn();
      log(`[autoUX] ✔ ${actionName} 動作執行完畢`);
    } catch (e) {
      errorOccurred = true;
      warn(`[autoUX] ${actionName} 失敗:`, e);
      toast(`❌ ${actionName} 執行失敗:${e?.message || e}`, 'error', 5000);
    }

    // ★ V11.42 移除「動作完成自動重新掃描」(改為提示使用者手動掃)
    //   原因:每次跑完都自動掃可能抓到不穩定 DOM,且使用者已養成跑完手動掃的習慣
    log('[autoUX] 動作完成,需要更新看板請手動點「🤖 啟動大數據掃描」');

    // ④ 收掉泡泡(★ V11.43 移除「自動展開看板」,結束後維持縮小狀態讓使用者不被打斷)
    hideProgressBubble();
    // showKanbanModal();  ← V11.43 移除,使用者要看時自己點浮動按鈕展開

    if (!errorOccurred) {
      toast(`✅ ${actionName} 完成(中控台保持縮小,點浮動按鈕可展開看板)`, 'success', 3500);
    }
    log(`[autoUX] ◀ ${actionName} 結束`);
  }

  async function runFullPipeline(scope, type) {
    // ★ V11.39:執行前先同步 UI 上的 rowNote / rowMoveTab / 發信勾選 → 資料層
    saveRowInputsToData();

    const orders = getCheckedOrders(scope, type);
    if (orders.length === 0) {
      toast('沒有勾選任何訂單', 'warn');
      return;
    }
    if (!confirm(`即將處理 ${orders.length} 筆訂單,確認繼續嗎?`)) return;

    toast(`🚀 開始處理 ${orders.length} 筆訂單...`, 'info', 2000);

    // 依類型分組
    const byType = {};
    orders.forEach(o => { (byType[o.type] = byType[o.type] || []).push(o); });

    // ── 階段 A:寫備註 + 發信(★ V11.39 改為跨頁執行:依 scanPage 分組逐頁處理)──
    for (const [t, group] of Object.entries(byType)) {
      const cardOverrideTpl = getCardEmailTemplate(t);

      // 依 scanPage 分組逐頁執行
      await foreachOrderAcrossPages(group, async (pageOrders, pageNum) => {
        log(`[階段 A] ${t} 區第 ${pageNum} 頁 ${pageOrders.length} 筆`);
        for (const o of pageOrders) {
          toast(`📝 [${STRATEGY_NAMES[t]}] 處理 ${o.id}(第 ${pageNum} 頁)...`, 'info', 1200);

          // 1) 寫備註
          await processNoteForOrder(o, t);

          // 2) 依 needEmail 發信
          if (o.needEmail) {
            const tpl = cardOverrideTpl || pickEmailTemplate(o, t);
            if (tpl) {
              await sendEmailForOrder(o, tpl.subject, tpl.body);
            } else {
              warn(`[發信] ${o.id} 沒有可用公版,跳過`);
            }
          }
          await sleep(400);
        }
      });
    }

    // ── 階段 B:批次移動分頁 ──
    await batchMoveOrdersByType(byType);

    // ── 階段 C-1:DUP 保留筆「只點當天出貨按鈕」(不拋印、不切分頁)──
    // ★ V11.39:重複單保留筆只需要點綠/紅按鈕讓訂單分流到對應分頁,不做後續拋印
    const dupKeepOrders = (byType.DUP || []).filter(o => o.dupRole === 'KEEP');
    if (dupKeepOrders.length > 0) {
      toast(`🚀 DUP 保留筆 ${dupKeepOrders.length} 筆 → 自動分流當天出貨(僅點按鈕)`, 'info', 2800);
      log(`[階段 C-1] DUP 保留筆 ${dupKeepOrders.length} 筆,只跑 autoSplitForToday(不拋印、不切分頁)`);
      await sleep(800);
      await autoSplitForToday(dupKeepOrders);
      await sleep(2000);
    }

    // ── 階段 C-2:NORMAL 區「自動分流當天出貨 + 切分頁拋印」(完整流程)──
    if (byType.NORMAL && byType.NORMAL.length > 0) {
      const card = $('.v11-card[data-type="NORMAL"]');
      const which = (card && $('.v11-logistics-select', card)?.value) || 'all';
      const whichLabel = which === 'all' ? '全部(依物流自動分流)' : which;
      toast(`🚀 NORMAL 區 ${byType.NORMAL.length} 筆 → 自動分流當天出貨 [${whichLabel}]`, 'info', 2500);
      log(`[階段 C-2] NORMAL ${byType.NORMAL.length} 筆,跑完整 runLogisticsByGroup(分流+切分頁+拋印)`);
      await sleep(800);
      await runLogisticsByGroup(byType.NORMAL, which);
    }

    // ── 階段 D:自動點擊原生「更新」按鈕 ──
    await clickNativeUpdate();

    toast(`✅ 全流程完成!共處理 ${orders.length} 筆`, 'success', 5000);
  }

  /** 只跑物流(假設備註/發信已處理完)*/
  /** ★ V11.39「🚀 自動分流當天出貨」:純分流模式
   *   只做:勾選 NORMAL 訂單 → 點網頁原生「超商當天出貨」(綠)+「宅配當天出貨」(紅)
   *   不做:切分頁、拋印、PDF 下載、點原生更新
   *   分流完訂單會被 1shop 自動移到對應分頁(7-11/全家→已確認、宅配→處理中)
   */
  async function runLogisticsOnly() {
    const orders = getCheckedOrders('global').filter(o => o.type === 'NORMAL');
    if (orders.length === 0) {
      toast('一般單區塊無勾選訂單', 'warn');
      return;
    }
    if (!confirm(`即將執行「自動分流當天出貨」,共 ${orders.length} 筆,確認?\n\n📝 純分流模式:只點綠/紅當天出貨按鈕,不切分頁、不拋印`)) return;
    await autoSplitForToday(orders);
    toast('✅ 自動分流當天出貨完成', 'success', 4000);
  }

  /** ★ V11.39 本區物流拋印:純拋印模式
   *   只做:勾選該物流訂單 → 更多批次功能 → 物流單列印 → 最終列印按鈕 → 下載
   *   不做:自動分流當天出貨、切換分頁、點原生「更新」按鈕
   *   假設訂單已經在當前分頁可見(否則 processOneCarrier 內 uncheckAllRows 後重新勾會找不到)
   */
  // ★ V11.44:combo 參數 — 只拋印指定商品組合的訂單
  async function runLogisticsForCard(type, which, combo = 'all') {
    const orders = getCheckedOrders('card', type, combo);
    if (orders.length === 0) {
      // ★ V11.44:有指定組合卻找不到時,給更明確的提示
      const msg = (combo && combo !== 'all')
        ? `找不到符合「${combo}」商品組合的勾選訂單`
        : '本區無勾選訂單';
      toast(msg, 'warn', 3000);
      return;
    }
    const comboNote = (combo && combo !== 'all') ? `\n📦 僅限商品組合:${combo}` : '';
    if (!confirm(`即將對本區 ${orders.length} 筆執行【${which}】物流拋印,確認?\n\n📝 純拋印模式:不分流、不切分頁、不更新${comboNote}`)) return;
    await purePrintByCarrier(orders, which);
    toast('✅ 本區物流拋印完成', 'success', 4000);
  }

  /** 純拋印:不分流、不切分頁、不點原生更新
   *  直接在當前分頁對勾選訂單按物流分組逐家做「更多批次功能 → 物流單列印 → 下載」
   */
  async function purePrintByCarrier(orders, which = 'all') {
    if (orders.length === 0) return;

    const carriers = which === 'all' ? ['711', 'fami', 'home'] : [which];

    for (const key of carriers) {
      const cfg = LOGISTICS[key];
      if (!cfg) { warn(`[純拋印] 不支援的物流商 key:「${key}」`); continue; }

      const group = orders.filter(o => cfg.shipTextMatch.some(k => o.shipText.includes(k)));
      if (group.length === 0) {
        log(`[純拋印] 【${cfg.label}】無訂單,跳過`);
        continue;
      }

      // 不切分頁,直接在當前分頁做拋印
      forceCloseAllModals();
      await sleep(500);

      toast(`🚚 ${cfg.label} 印單中(${group.length} 筆)`, 'info', 2000);
      log(`[純拋印] 處理 ${cfg.label} ${group.length} 筆(當前分頁直接執行)`);
      await processOneCarrier(cfg, group);

      // ★ V11.40:不再等 PDF 下載完成(已改用背景分頁),只給短緩衝讓 toast 顯示完
      toast(`📂 ${cfg.label} 物流單已在背景分頁,切換下一家...`, 'info', 1500);
      await sleep(1500);
    }

    log(`[純拋印] 所有家完成`);
  }

  // ============================================================
  //  ⑩ 寫商家備註
  //     操作邏輯:在訂單列上找備註圖示 → 點開彈出視窗 → 寫入文字 → 儲存
  //     ⚠️ 寫完後 Vue 會重新渲染該行 → 後續動作必須用 getFreshRowById 重新對焦
  // ============================================================
  /** ★ V11.39 對話 V10.8 定版策略
   *   1. 嘗試多種候選入口(商家備註圖示 → 客戶名稱連結 → 舊版 .icon-note)
   *   2. 點擊後等候 textarea#shop_note 出現作為「成功打開 modal」的訊號
   *   3. 找儲存按鈕(.modal-footer .btn-primary)寫入並儲存
   *   4. 失敗自動關 modal 試下一個候選
   */
  async function processNoteForOrder(order, type) {
    const tr = getFreshRowById(order.id);
    if (!tr) { warn('找不到訂單列', order.id); return false; }

    const rawNote = (order.rowNote || '').trim();
    if (!rawNote) {
      log(`[備註] ${order.id} 備註空白,跳過寫入`);
      return true;
    }

    const today = formatMMDD(new Date());
    const noteText = `${today} ${rawNote}`;

    // ★ 多種「打開商家備註 modal」候選入口
    const candidates = [];

    // 候選 1:當前 1shop UI 商家備註圖示(.fa-message-lines)的外層 span(內含「商家」文字)
    const merchIcons = Array.from(tr.querySelectorAll('.fa-message-lines'));
    for (const icon of merchIcons) {
      const span = icon.closest('span, button, a');
      if (span && (span.textContent || '').includes('商家')) {
        candidates.push({ el: span, label: 'fa-message-lines+商家' });
      }
    }

    // 候選 2:對話 V10.8 舊版 .icon-note 含「商家」文字
    for (const el of tr.querySelectorAll('.icon-note')) {
      if ((el.textContent || '').includes('商家')) {
        candidates.push({ el, label: 'icon-note+商家' });
      }
    }

    // 候選 3:客戶名稱連結(備援,有時點客戶會彈出含 shop_note 的 modal)
    const customerLink = tr.querySelector('a[href*="/shop/customer/all/"]');
    if (customerLink) candidates.push({ el: customerLink, label: 'customer-link' });

    log(`[備註] ${order.id} 嘗試 ${candidates.length} 個候選入口`);

    for (const { el, label } of candidates) {
      try {
        el.click();
        await sleep(800);

        // 等 #shop_note 出現(成功打開 modal 的訊號)
        const textArea = await waitFor(() => {
          const ta = document.querySelector('#shop_note')
                  || document.querySelector('textarea[name="shop_note"]');
          return (ta && ta.offsetParent !== null) ? ta : null;
        }, 2500);

        if (!textArea) {
          log(`[備註] 候選「${label}」沒彈出 shop_note,試下一個`);
          closeAnyModal();
          await sleep(300);
          continue;
        }

        log(`[備註] 候選「${label}」成功打開 shop_note modal`);

        // 寫入備註(累加)
        const oldNote = (textArea.value || '').trim();
        const newNoteText = oldNote ? `${oldNote}\n${noteText}` : noteText;
        setNativeValue(textArea, newNoteText);
        await sleep(300);

        // 找儲存按鈕(V10.8 規格:modal-footer .btn-primary,fallback 找「儲存」/「確認」)
        const modal = textArea.closest('.modal-dialog') || textArea.closest('.modal') || document.body;
        const saveBtn = modal.querySelector('.modal-footer .btn-primary')
                     || modal.querySelector('.btn-primary')
                     || findBtnByText(['儲存'], modal)
                     || findBtnByText(['儲存']);
        if (saveBtn) {
          saveBtn.click();
          await sleep(1500);
          return true;
        }
        warn('[備註] 找不到儲存按鈕', order.id);
        closeAnyModal();
        return false;
      } catch (e) {
        warn('[備註] 候選嘗試失敗', label, e);
        closeAnyModal();
        await sleep(300);
      }
    }

    warn('[備註] 所有候選都失敗', order.id);
    return false;
  }

  /** ★ V11.39 找信封按鈕(發信用)— 從 F12 診斷確認:
   *  - td[2] 有一個 <svg data-icon="envelope" class="text-success">(綠色客戶 email 圖示,沒 button 父)
   *  - td[3] 第 2 個 <button><svg data-icon="envelope"></button>(真正的發信按鈕)
   *  所以必須用 querySelectorAll 逐一檢查 closest button,避開 td[2] 那個無 button 的 svg */
  function findEnvelopeBtn(freshRow) {
    if (!freshRow) return null;

    // 方法 1:所有 envelope SVG,挑有 closest button/a 的
    const envSvgs = freshRow.querySelectorAll('svg[data-icon="envelope"], svg[data-icon^="envelope"]');
    for (const svg of envSvgs) {
      const btn = svg.closest('button, a');
      if (btn) return btn;
    }

    // 方法 2:.fa-envelope class
    const envIcons = freshRow.querySelectorAll('.fa-envelope, .fas.fa-envelope, .fa-envelope-open, .far.fa-envelope, i.fa-envelope');
    for (const icon of envIcons) {
      const btn = icon.closest('button, a');
      if (btn) return btn;
    }

    // 方法 3:SVG path 完整指紋(舊邏輯保留為 fallback)
    const paths = freshRow.querySelectorAll('path');
    for (const p of paths) {
      if (p.getAttribute('d') === FP.ENVELOPE_PATH_FULL) {
        const btn = p.closest('button, a');
        if (btn) return btn;
      }
    }

    // 方法 4:title / aria-label 含「信」「mail」「Email」
    const allBtns = freshRow.querySelectorAll('button, a');
    for (const b of allBtns) {
      const title = ((b.getAttribute('title') || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
      if (/信|mail|email/.test(title)) return b;
    }

    return null;
  }

  /** 觸發 native input setter,讓 Vue 偵測到變更
   *  ★ V11.39:用 el.constructor.prototype 直接拿 setter(不受 sandbox window 影響)
   */
  function setNativeValue(el, value) {
    const proto = el && el.constructor ? el.constructor.prototype : null;
    const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ============================================================
  //  ⑪ 發送 Email(對話定版邏輯)
  //     1. getFreshRowById 重新對焦(Vue 重渲染防護)
  //     2. 用 SVG path 完整指紋等價判定鎖定信封按鈕
  //     3. 等待 #subject 與 textarea#body 出現
  //     4. native setter 寫入,dispatchEvent('input')觸發 Vue
  //     5. 在 .modal-dialog button / .modal button 範圍內找含「確認」字的提交按鈕
  // ============================================================
  async function sendEmailForOrder(order, subject, body) {
    // ★ V11.39 型別防呆:避免 undefined.replace() 炸掉整個 pipeline
    subject = (typeof subject === 'string') ? subject : '';
    body    = (typeof body === 'string') ? body : '';
    if (!subject && !body) {
      warn('[發信] subject + body 都空白,跳過', order.id);
      return false;
    }

    const freshRow = getFreshRowById(order.id);
    if (!freshRow) { warn('[發信] 找不到訂單列', order.id); return false; }

    // ★ V11.39 多種 fallback 找信封按鈕(避免 Font Awesome 版本升級造成 SVG path 變動)
    const envelopeBtn = findEnvelopeBtn(freshRow);
    if (!envelopeBtn) {
      warn('[發信] 找不到信封按鈕', order.id);
      // 診斷:列出 row 內所有可點按鈕的特徵
      const allBtns = freshRow.querySelectorAll('button, a');
      log(`[發信診斷] ${order.id} row 內 ${allBtns.length} 個按鈕:`);
      allBtns.forEach((b, i) => {
        if (i >= 6) return; // 只列前 6 個
        const t = (b.textContent || '').trim().slice(0, 20);
        const ttl = b.getAttribute('title') || b.getAttribute('aria-label') || '';
        const svg = b.querySelector('svg');
        const di = svg?.getAttribute('data-icon') || '';
        log(`  [${i+1}] text="${t}" title="${ttl}" data-icon="${di}"`);
      });
      return false;
    }

    envelopeBtn.click();
    await sleep(800);

    // 等待主旨輸入框出現
    const subjEl = await waitFor(() => $(FP.EMAIL_SUBJECT), 2500);
    const bodyEl = await waitFor(() => $(FP.EMAIL_BODY), 800);
    if (!subjEl || !bodyEl) {
      warn('[發信] 找不到 Email 主旨/內文輸入框', order.id);
      closeAnyModal();
      return false;
    }

    // ★ 對話定版動態變數渲染
    //   {{order_number}} → 訂單編號
    //   {{product_name}} → 商品名稱(優先用 order.product,fallback 用第一行)
    const productName = (order.product || '').split(/\s+\/\s+/)[0] || '您的訂單';
    const realSubject = subject
      .replace(/\{\{order_number\}\}/g, order.id)
      .replace(/\{\{product_name\}\}/g, productName);
    const realBody = body
      .replace(/\{\{order_number\}\}/g, order.id)
      .replace(/\{\{product_name\}\}/g, productName);

    setNativeValue(subjEl, realSubject);
    await sleep(200);
    setNativeValue(bodyEl, realBody);
    await sleep(300);

    // ★ 對話定版:確認按鈕「限定」在 .modal-dialog button / .modal button 範圍內找
    //   (避免抓到頁面其他「確認」按鈕)
    const modalButtons = $$(FP.EMAIL_SUBMIT_SCOPE);
    const sendBtn = modalButtons.find(b =>
      b.getAttribute('type') === 'submit' &&
      (b.textContent || '').includes(FP.EMAIL_SUBMIT_TEXT) &&
      b.getBoundingClientRect().width > 0
    );

    if (!sendBtn) {
      warn('[發信] 在 modal 內找不到「確認」發送按鈕', order.id);
      closeAnyModal();
      return false;
    }

    log(`[發信] ${order.id} 點擊「確認」送出`);
    sendBtn.click();
    await sleep(1200); // 對話定版:1200ms 讓 modal 關閉並完成請求
    return true;
  }

  function closeAnyModal() {
    const closeBtn = findBtnByText('關閉') || findBtnByText('Cancel') || findBtnByText('取消');
    if (closeBtn) closeBtn.click();
  }

  // ============================================================
  //  ⑫ 批次移動分頁
  //     邏輯:把要移動到同一分頁的訂單收齊 → 在列表中勾選 → 用頂部批次選單一次性移動
  // ============================================================
  async function batchMoveOrdersByType(byType) {
    log(`[移分頁] 收到 byType,類型:${Object.keys(byType).join(',')}`);

    // ★ V11.39 關鍵:先切回「等待確認」分頁(訂單在那裡才能勾選/批次操作)
    //   如果跑階段 A 有切換過分頁(例如進入訂單詳情後又被踢回來),需要明確切回
    const activeTab = $$('.scroll-x.text-nowrap button.btn-link.active, button.btn-link.active')[0];
    const activeName = (activeTab?.textContent || '').replace(/\s+/g, '').trim();
    log(`[移分頁] 當前 active 分頁:「${activeName}」`);
    if (!activeName.includes('等待確認')) {
      const waitingTabBtn = findTabButtonByText('等待確認');
      if (waitingTabBtn) {
        log(`[移分頁] 切回「等待確認」分頁(訂單在那裡才能勾選)`);
        waitingTabBtn.click();
        await sleep(3000);
      }
    }

    const preorderTab = Storage.get(LS.PREORDER_TAB, '暫存');
    const TYPE_DEFAULT_TAB = {
      'DUP':      '確認中',
      'UNPAID':   '確認中',
      'PREORDER': preorderTab,
      'EXC':      '確認中',
      'OVERSEAS': '確認中',
    };

    // 1) 把所有非 NORMAL 訂單,依「實際要去的分頁」重新分組
    //    ★ V11.41 修法:一律以使用者在 UI 上選的 rowMoveTab 為準
    //      - rowMoveTab 是「不移動」或空 → 跳過(留給階段 C 物流自動分流)
    //      - rowMoveTab 有指定分頁 → 不論訂單原本是什麼類型(包含 DUP KEEP),都按使用者選擇移動
    //    這樣使用者人工調整下拉就會真的生效,UI 跟實際行為一致
    const tabGroups = {};
    for (const [type, group] of Object.entries(byType)) {
      if (type === 'NORMAL') { log(`[移分頁] ${type} 區 ${group.length} 筆 → 跳過(物流流程處理)`); continue; }
      log(`[移分頁] ${type} 區 ${group.length} 筆`);
      for (const o of group) {
        const tab = o.rowMoveTab || TYPE_DEFAULT_TAB[type];
        if (!tab || tab === '不移動') {
          // 跳過原因:① 使用者明確選「不移動」 或 ② DUP KEEP 預設值(留給階段 C 自動分流)
          const reason = (type === 'DUP' && o.dupRole === 'KEEP')
            ? ' (DUP 保留筆,留給階段 C 自動分流當天出貨)'
            : '';
          log(`[移分頁]   ${o.id} → 不移動${reason},跳過`);
          continue;
        }
        log(`[移分頁]   ${o.id} → ${tab}`);
        (tabGroups[tab] = tabGroups[tab] || []).push(o);
      }
    }

    const tabSummary = Object.entries(tabGroups).map(([k, v]) => `${k}(${v.length})`).join(', ');
    log(`[移分頁] tabGroups: ${tabSummary || '(空)'}`);

    if (Object.keys(tabGroups).length === 0) {
      log(`[移分頁] 沒有要移動的訂單,跳過階段 B`);
      return;
    }

    // 2) 對每個目標分頁執行一次批次移動
    for (const [tab, orders] of Object.entries(tabGroups)) {
      if (!orders || orders.length === 0) continue;
      toast(`📂 批次移動 ${orders.length} 筆 → ${tab}`, 'info', 1500);
      log(`[移分頁] ▶ 開始移動 ${orders.length} 筆到「${tab}」`);

      // 2-1) 強力關閉殘留 modal,取消所有勾選
      forceCloseAllModals();
      await sleep(500);
      uncheckAllRows();
      await sleep(400);

      // 2-2) 勾選這批訂單
      let checkedCount = 0;
      for (const o of orders) {
        const tr = getFreshRowById(o.id);
        const cb = tr?.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) { cb.click(); checkedCount++; await sleep(50); }
      }
      log(`[移分頁]   勾選 ${checkedCount}/${orders.length} 筆`);

      // 2-3) ★ V11.39 改用 waitFor 等批次狀態下拉出現(動態顯示,可能要等 1-2 秒)
      //   1shop 真實 UI:勾選訂單後,工具列才動態顯示 3 個 select(訂單狀態/金流狀態/物流狀態)
      //   我們要找的是「訂單狀態」這一個(選項含「等待確認/確認中」)
      const statusSelect = await waitFor(() => {
        const selects = $$('select').filter(s => s.getBoundingClientRect().width > 0 && !s.disabled);
        return selects.find(s =>
          s.options && s.options.length > 0 &&
          Array.from(s.options).some(o => /訂單狀態不更動|等待確認|確認中/.test(o.textContent || ''))
        );
      }, 5000);

      if (!statusSelect) {
        warn('[移分頁] ❌ 等 5 秒後仍找不到批次狀態下拉(勾選未觸發工具列?)');
        // 診斷:列出頁面所有 select
        const allSelects = $$('select').filter(s => s.getBoundingClientRect().width > 0);
        log(`[移分頁診斷] 頁面可見 select 共 ${allSelects.length} 個:`);
        allSelects.slice(0, 8).forEach((s, i) => {
          const opts = Array.from(s.options || []).slice(0, 3).map(o => `"${(o.textContent || '').trim()}"`).join(',');
          log(`  [${i+1}] class="${s.className.slice(0,80)}" 前3選項=${opts}`);
        });
        continue;
      }
      log(`[移分頁]   找到批次狀態下拉(class="${statusSelect.className.slice(0,60)}")`);

      // 2-4) 在下拉中找到「tab」對應的 option(用 textContent 比對)
      const targetOption = Array.from(statusSelect.options).find(o =>
        (o.textContent || '').trim() === tab
      );
      if (!targetOption) {
        warn(`[移分頁] ❌ 下拉選單裡找不到「${tab}」選項`);
        continue;
      }
      log(`[移分頁]   下拉選「${tab}」 (value="${targetOption.value}")`);
      setNativeValue(statusSelect, targetOption.value);
      await sleep(500);

      // 2-5) 找「更新」按鈕並點擊
      const updateBtn = $$('button.btn.btn-primary, button.btn-primary').find(b => {
        if (b.getBoundingClientRect().width === 0) return false;
        return (b.textContent || '').trim().includes('更新');
      });
      if (!updateBtn) {
        warn('[移分頁] ❌ 找不到「更新」按鈕');
        continue;
      }
      log(`[移分頁]   點「更新」按鈕`);
      updateBtn.click();
      await sleep(2000); // 等系統處理

      // 2-6) 若有確認彈窗,點確定
      const confirmBtn = findBtnByText('確定') || findBtnByText('確認');
      if (confirmBtn && confirmBtn.getBoundingClientRect().width > 0) {
        log(`[移分頁]   點確認彈窗`);
        confirmBtn.click();
        await sleep(1500);
      }

      // 2-7) 關閉結果視窗(若有)
      const closeBtn = findBtnByText('關閉');
      if (closeBtn && closeBtn.getBoundingClientRect().width > 0) {
        closeBtn.click();
        await sleep(500);
      }

      log(`[移分頁] ✔ 「${tab}」批次移動完成`);
    }
  }

  function uncheckAllRows() {
    // ★ V11.51:不靠 thead 全選來取消(thead 只影響前 50 筆,會留殘留勾選)
    //   直接逐筆取消所有已勾選的 checkbox,確保清乾淨
    $$('tbody tr input[type="checkbox"]:checked').forEach(cb => cb.click());
  }

  // ============================================================
  //  ⑬ 物流拋單與印單(三家完整 9 步驟自動化)
  // ============================================================

  /** 對一組訂單執行物流拋印,which: 'all' / '711' / 'fami' / 'home' */
  /** ★ V11.39 完整重寫:正確流程
   *    階段 1:在「等待確認」分頁,把訂單分組勾選後點對應的「當天出貨」快捷按鈕
   *           7-11 + 全家 訂單 → 點「超商當天出貨」(綠色)→ 訂單跑到「已確認」分頁
   *           宅配 訂單       → 點「宅配當天出貨」(紅色)→ 訂單跑到「處理中」分頁
   *
   *    階段 2:逐家依分頁拋印
   *           切到「已確認」→ 7-11 拋單印單 → 等 PDF 下載
   *           還在「已確認」→ 全家 拋單印單 → 等 PDF 下載
   *           切到「處理中」→ 宅配 拋單印單 → 等 PDF 下載
   */
  async function runLogisticsByGroup(orders, which = 'all') {
    if (orders.length === 0) return;

    Storage.set(LS.RESUME_FLAG, '1');
    Storage.setJson(LS.RESUME_PAYLOAD, { which, ids: orders.map(o => o.id), stage: 'start' });

    // ─────────────────────────────────────
    // 階段 1:自動分流當天出貨
    // ─────────────────────────────────────
    await autoSplitForToday(orders);
    await sleep(3000); // 等系統處理 + Vue 重渲染

    // ─────────────────────────────────────
    // 階段 2:逐家依分頁拋印
    // ─────────────────────────────────────
    const carriers = which === 'all' ? ['711', 'fami', 'home'] : [which];

    for (const key of carriers) {
      const cfg = LOGISTICS[key];
      const group = orders.filter(o => cfg.shipTextMatch.some(k => o.shipText.includes(k)));
      if (group.length === 0) {
        log(`【${cfg.label}】無訂單,跳過`);
        continue;
      }

      // ★ V11.39:每一家開始前先強力關 modal(避免上一家殘留)
      forceCloseAllModals();
      await sleep(800);

      // 切換到該家物流的目標分頁(若當前已在目標分頁就不切)
      if (cfg.afterThrowTab) {
        const tabBtn = findTabButtonByText(cfg.afterThrowTab);
        if (tabBtn) {
          const isActive = tabBtn.classList.contains('active');
          if (isActive) {
            log(`[${cfg.label}] 已在「${cfg.afterThrowTab}」分頁,不需切換`);
          } else {
            toast(`📂 切換到「${cfg.afterThrowTab}」分頁(處理 ${cfg.label})`, 'info', 1500);
            log(`[${cfg.label}] 點擊切換到「${cfg.afterThrowTab}」分頁`);
            tabBtn.click();
            await sleep(3000); // ★ V11.39 拉長為 3 秒,等分頁 Vue 完整重渲染

            // ★ V11.39 驗證:切換後當前 active 分頁是否是目標分頁
            const activeTab = $$('.scroll-x.text-nowrap button.btn-link.active, .me-auto.scroll-x button.btn-link.active')[0];
            const activeName = (activeTab?.textContent || '').replace(/\s+/g, '').trim();
            log(`[${cfg.label}] 切換後當前 active 分頁:「${activeName}」`);
            if (!activeName.includes(cfg.afterThrowTab)) {
              warn(`[${cfg.label}] ⚠️ 切換失敗,當前仍在「${activeName}」,跳過該家物流`);
              toast(`⚠️ [${cfg.label}] 切換分頁失敗,跳過`, 'warn', 3000);
              continue;
            }
          }
        } else {
          warn(`[${cfg.label}] 找不到「${cfg.afterThrowTab}」分頁按鈕`);
        }
      }

      // 在分頁印單
      toast(`🚚 ${cfg.label} 印單中(${group.length} 筆)`, 'info', 2000);
      await processOneCarrier(cfg, group);

      // ★ V11.40:不再等 PDF 下載完成(已改用背景分頁),只給短緩衝讓 toast 顯示完
      toast(`📂 ${cfg.label} 物流單已在背景分頁,切換下一家...`, 'info', 1500);
      await sleep(1500);
    }

    Storage.del(LS.RESUME_FLAG);
    Storage.del(LS.RESUME_PAYLOAD);
    toast(`✅ 所有物流拋印完成`, 'success', 3000);
  }

  /** 階段 1:自動分流當天出貨
   *  把訂單分成 cvs (7-11+全家) 與 hct (宅配) 兩大組,
   *  逐組勾選並點對應的「當天出貨」快捷按鈕(網頁原生按鈕)
   *  優先呼叫 unsafeWindow.bulk_action(),fallback 用模擬點擊
   */
  /** ★ V11.39 診斷:列出頁面所有含「出貨」字樣的可見按鈕 */
  function diagShipBtns() {
    log('[診斷] 頁面所有含「出貨」字樣的可見按鈕:');
    const all = document.querySelectorAll('button, .btn, a.btn, [role="button"]');
    let n = 0;
    for (const b of all) {
      if (b.getBoundingClientRect().width === 0) continue;
      const t = (b.textContent || '').trim();
      if (t.includes('出貨') || t.includes('當天') || t.includes('當日')) {
        n++;
        log(`  [${n}] "${t.slice(0, 40)}" class="${b.className.slice(0, 60)}" disabled=${b.disabled}`);
      }
    }
    if (n === 0) log('  (沒有任何含「出貨/當天/當日」字樣的按鈕,可能不在「等待確認」分頁或 UI 結構不同)');
  }

  async function autoSplitForToday(orders) {
    toast(`🎯 開始自動分流當天出貨,共 ${orders.length} 筆`, 'info', 2500);
    await sleep(1000);

    // ★ V11.39 關鍵修法:先切回「等待確認」分頁
    //   1shop 「當天出貨」綠/紅按鈕只在「等待確認」分頁出現,
    //   階段 B 把 DUP CANCEL 移到「已取消」後 1shop 自動跳分頁,當前已不在「等待確認」
    const waitingTabBtn = findTabButtonByText('等待確認');
    if (waitingTabBtn) {
      const isActive = waitingTabBtn.classList.contains('active');
      if (!isActive) {
        log(`[autoSplit] 切回「等待確認」分頁(綠/紅按鈕只在此分頁)`);
        toast(`📂 切回「等待確認」分頁`, 'info', 1500);
        waitingTabBtn.click();
        await sleep(3000); // 等 Vue 重渲染
      } else {
        log(`[autoSplit] 已在「等待確認」分頁`);
      }
    } else {
      warn(`[autoSplit] ⚠️ 找不到「等待確認」分頁按鈕,在當前分頁繼續`);
    }

    // cvs (7-11+全家) 訂單
    const cvsOrders = orders.filter(o =>
      LOGISTICS['711'].shipTextMatch.some(k => o.shipText.includes(k)) ||
      LOGISTICS['fami'].shipTextMatch.some(k => o.shipText.includes(k))
    );
    // hct (宅配) 訂單
    const hctOrders = orders.filter(o =>
      LOGISTICS['home'].shipTextMatch.some(k => o.shipText.includes(k))
    );
    log(`[autoSplit] 分組:cvs ${cvsOrders.length} 筆 / hct ${hctOrders.length} 筆`);

    const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // ─ A. 處理超商 cvs 組(7-11+全家)─
    if (cvsOrders.length > 0) {
      toast(`🟢 超商當天出貨 ${cvsOrders.length} 筆(7-11/全家)`, 'info', 2000);
      uncheckAllRows();
      await sleep(400);

      // ★ V11.39:勾選時拉長間隔到 100ms,讓 Vue reactive 完整同步
      let checkedCvs = 0;
      for (const o of cvsOrders) {
        const tr = getFreshRowById(o.id);
        if (!tr) { warn(`[autoSplit] cvs 找不到訂單列 ${o.id}(可能不在當前分頁)`); continue; }
        const cb = tr.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) { cb.click(); checkedCvs++; await sleep(100); }
      }
      log(`[autoSplit] cvs 勾選 ${checkedCvs}/${cvsOrders.length} 筆`);

      if (checkedCvs === 0) {
        warn(`[autoSplit] cvs 沒勾到任何訂單,跳過此組(可能訂單已不在「等待確認」分頁)`);
      } else {
        // ★ V11.39:勾選後等 1.5 秒讓 1shop 工具列「當天出貨」按鈕渲染出來
        await sleep(1500);

        // ★ V11.39:用 waitFor 最多等 3.5 秒讓按鈕出現
        const greenBtn = await waitFor(() =>
          findBtnByText(['超商', '當天出貨']) || findBtnByText(['超商', '出貨']),
          3500
        );
        if (greenBtn) {
          log(`👉 點「超商當天出貨」按鈕(綠色):「${greenBtn.textContent.trim()}」`);
          greenBtn.click();
          await sleep(2000);
          const cb = await waitFor(() => findModalConfirmBtn(), 2500);
          if (cb) { log(`點確認彈窗:「${cb.textContent.trim()}」`); cb.click(); await sleep(1500); }
        } else if (typeof W.bulk_action === 'function') {
          log('找不到「超商當天出貨」按鈕,fallback 呼叫 bulk_action');
          try { W.bulk_action('unipay_cvs_order_today'); } catch (e) { warn(e); }
          await sleep(2000);
        } else {
          warn('找不到「超商當天出貨」按鈕,也沒 bulk_action 函式');
          diagShipBtns();
        }
        await sleep(2500);
      }
    }

    // ─ B. 處理宅配 hct 組 ─
    if (hctOrders.length > 0) {
      toast(`🔴 宅配當天出貨 ${hctOrders.length} 筆`, 'info', 2000);
      uncheckAllRows();
      await sleep(400);

      let checkedHct = 0;
      for (const o of hctOrders) {
        const tr = getFreshRowById(o.id);
        if (!tr) { warn(`[autoSplit] hct 找不到訂單列 ${o.id}(可能不在當前分頁)`); continue; }
        const cb = tr.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) { cb.click(); checkedHct++; await sleep(100); }
      }
      log(`[autoSplit] hct 勾選 ${checkedHct}/${hctOrders.length} 筆`);

      if (checkedHct === 0) {
        warn(`[autoSplit] hct 沒勾到任何訂單,跳過此組`);
      } else {
        await sleep(1500);

        const redBtn = await waitFor(() =>
          findBtnByText(['宅配', '當天出貨']) || findBtnByText(['宅配', '出貨']),
          3500
        );
        if (redBtn) {
          log(`👉 點「宅配當天出貨」按鈕(紅色):「${redBtn.textContent.trim()}」`);
          redBtn.click();
          await sleep(2000);
          const cb = await waitFor(() => findModalConfirmBtn(), 2500);
          if (cb) { log(`點確認彈窗:「${cb.textContent.trim()}」`); cb.click(); await sleep(1500); }
        } else if (typeof W.bulk_action === 'function') {
          log('找不到「宅配當天出貨」按鈕,fallback 呼叫 bulk_action');
          try { W.bulk_action('hct_order_today'); } catch (e) { warn(e); }
          await sleep(2000);
        } else {
          warn('找不到「宅配當天出貨」按鈕,也沒 bulk_action 函式');
          diagShipBtns();
        }
        await sleep(2500);
      }
    }

    toast(`✅ 自動分流完成`, 'success', 2000);
  }

  /** ★ V11.39 簡化版:只做「印單」流程
   *  理由:「自動分流當天出貨」已經 = 分流 + 拋單(bulk_action 'unipay_cvs_order_today'/'hct_order_today'),
   *       訂單已從「等待確認」跑到對應分頁,**不需要再拋單**
   *       重複拋單對 7-11/全家 容忍(彈正常結果視窗),但對宅配會卡死(找不到關閉按鈕)
   *  新流程:
   *    1) 取消勾選 → 勾該家訂單
   *    2) 強力關閉殘留 modal(避免上一家留下的 modal 擋路)
   *    3) 點「更多批次功能」→「物流單列印」
   *    4) 列印視窗最終按鈕 → 觸發 PDF 下載
   *    5) 關閉列印視窗
   */
  async function processOneCarrier(cfg, group) {
    // ★ V11.39 需求 B:不再依「中控台勾選的 group」處理,改為:
    //   1. 切到該物流對應分頁(7-11/全家→已確認 / 宅配→處理中)
    //   2. 從該分頁第 1 頁開始,逐頁:全選當前頁所有訂單 → 拋單(自適應)→ 印單 → 等 PDF → 下一頁
    //   3. 直到沒有更多頁(找不到下一頁按鈕)

    // 0) 強力關閉殘留 modal
    forceCloseAllModals();
    await sleep(500);

    // 1) 切到該物流對應分頁
    if (cfg.afterThrowTab) {
      const tabBtn = findTabButtonByText(cfg.afterThrowTab);
      if (tabBtn && !tabBtn.classList.contains('active')) {
        log(`[${cfg.label}] 切換到「${cfg.afterThrowTab}」分頁`);
        toast(`📂 切換到「${cfg.afterThrowTab}」分頁(處理 ${cfg.label})`, 'info', 1500);
        tabBtn.click();
        await sleep(3000);
      } else {
        log(`[${cfg.label}] 已在「${cfg.afterThrowTab}」分頁`);
      }
    }

    // 2) 切回該分頁的第 1 頁
    const firstBtn = await findFirstPageBtn();
    if (firstBtn) {
      log(`[${cfg.label}] 切回第 1 頁`);
      firstBtn.click();
      await sleep(2500);
    }

    // 3) 從第 1 頁逐頁處理
    // ★ V11.49 重構:「記住已拋 id 排除」策略
    //   背景:已拋單的訂單在 1shop「已確認」分頁仍可被勾選(使用者實測確認),
    //         若用「全選→拋」會重複拋同一批,且拋完頁面重整會讓 findNextPageBtn 失效。
    //   新做法:
    //     - 維護 thrownIds Set 記住這輪已經拋過的訂單
    //     - 每次全選當前頁 → 排除 thrownIds → 只勾「還沒拋過的」→ 拋印 → 加入 thrownIds
    //     - 全選後若「沒有任何新 id」→ 該頁處理完,嘗試翻頁
    //     - 翻頁失敗才真正結束
    // ★ V11.50 修正:改用「直接掃 DOM 全部列 + id 排除」取代 thead 全選
    //   原因(使用者實測確認):1shop 的 thead 全選「固定只選前 50 筆」,
    //   前 50 拋完後再全選還是那 50 筆(已在 thrownIds),newRows 永遠 0 → 第 51 筆之後選不到。
    //   新做法:不碰 thead 全選,直接掃 tbody 全部列(DOM 內有完整列,實測 70/222 列都在),
    //           用 getOrderIdFromRow 比對 thrownIds 排除已拋,每批手動勾最多 BATCH_SIZE 筆。
    const BATCH_SIZE = 50;           // 每批最多勾 50 筆(對齊 1shop 全選上限,實測 50 可成功)
    const MAX_ROUNDS = 60;           // 防呆:最多 60 輪
    let roundCount = 0;
    let pageCount = 1;
    const thrownIds = new Set();     // ★ V11.49:記住這輪已拋過的訂單 id

    while (roundCount < MAX_ROUNDS) {
      roundCount++;

      // 3-1) 重新抓當前所有列(拋單後頁面會重整,每輪都要重抓)
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      if (rows.length === 0) {
        log(`[${cfg.label}] 當前頁無訂單,結束`);
        break;
      }

      // 3-2) ★ V11.50:直接掃全部列,挑「有 checkbox 且還沒拋過」的(不靠 thead 全選)
      const unthrownRows = rows.filter(tr => {
        const id = getOrderIdFromRow(tr);
        if (!id || thrownIds.has(id)) return false;
        return !!tr.querySelector('input[type="checkbox"]');
      });
      log(`[${cfg.label}] 第 ${pageCount} 頁 ${rows.length} 列,未拋過 ${unthrownRows.length} 筆(累計已拋 ${thrownIds.size})`);

      // 3-3) 本頁沒有未拋的了 → 嘗試翻下一頁(多頁情境),沒有下一頁就結束
      if (unthrownRows.length === 0) {
        const next = findNextPageBtn();
        if (!next) {
          log(`[${cfg.label}] 已無未拋訂單,結束跨頁處理`);
          break;
        }
        log(`[${cfg.label}] 本頁已全部拋過,切到第 ${pageCount + 1} 頁`);
        next.click();
        pageCount++;
        await sleep(3000);
        continue;
      }

      // 3-4) 取這批(最多 BATCH_SIZE 筆),逐筆手動勾(不用 thead 全選)
      const batch = unthrownRows.slice(0, BATCH_SIZE);
      // ★ V11.52:殘留清除改為「重試到乾淨」(最多 3 輪)
      //   原因:單次逐筆點 :checked 常清不乾淨(實測 50 筆只清掉 20),殘留會被下批印單重印。
      //   有了 3-7b 的印後精準取消,這裡通常已乾淨,但保留重試作為雙保險。
      for (let clr = 0; clr < 3; clr++) {
        const leftover = $$('tbody tr input[type="checkbox"]:checked');
        if (leftover.length === 0) break;
        if (clr === 0) log(`[${cfg.label}] 清除殘留勾選 ${leftover.length} 筆`);
        leftover.forEach(cb => cb.click());
        await sleep(400);
      }
      const batchIds = [];
      for (const tr of batch) {
        const cb = tr.querySelector('input[type="checkbox"]');
        const id = getOrderIdFromRow(tr);
        if (!cb || !id) continue;
        // ★ V11.51:確保這筆最終是「已勾選」 — 若還沒勾才點(已勾就直接算數,不跳過)
        //   原因:V11.50 用「!cb.checked 才勾+才計數」,遇到殘留已勾的訂單會被跳過不計,
        //         導致「掃到 N 筆未拋卻勾 0 筆」誤觸發防呆結束。改為「未勾就補勾,已勾就納入這批」。
        if (!cb.checked) {
          cb.click();
          await sleep(40);
        }
        batchIds.push(id);
      }
      log(`[${cfg.label}] 本批目標 ${batchIds.length} 筆(已確保勾選)`);
      await sleep(800);

      // 3-4b) 防呆:這批目標為 0(理論上不會,unthrownRows 已 >0)→ 結束以免無限迴圈
      if (batchIds.length === 0) {
        warn(`[${cfg.label}] 本批目標為 0,結束以免卡住`);
        break;
      }

      // 3-5) 拋單(找不到拋單按鈕代表已拋過,自動跳過)
      const throwOK = await tryThrowAction(cfg);
      log(`[${cfg.label}] 本批拋單階段 ${throwOK ? '✅' : '⏭ 跳過(已拋過或不適用)'}`);
      await sleep(800);

      // 3-6) 印單
      await doPrintAction(cfg);

      // 3-7) ★ V11.49:把這批加入已拋 Set(不論拋單成敗都記,避免重複嘗試)
      batchIds.forEach(id => thrownIds.add(id));

      // 3-7b) ★ V11.52:印單後,用 batchIds 精準取消「這批」的勾選
      //   根因:拋單/印單完成後,這批訂單仍是勾選狀態(1shop 不會自動取消),
      //         若不取消,下一批的印單會把「這批 + 新批」全部一起重印(重複印單 bug)。
      //   做法:重新掃 DOM,對照 batchIds 逐筆取消勾選(精準,不誤傷別批)。
      //         印單後 1shop 頁面可能重整,對不到的列就略過(下一批掃描時 thrownIds 也會排除,雙保險)。
      const batchIdSet = new Set(batchIds);
      let uncheckedThisBatch = 0;
      for (const tr of $$('tbody tr')) {
        const id = getOrderIdFromRow(tr);
        if (!id || !batchIdSet.has(id)) continue;
        const cb = tr.querySelector('input[type="checkbox"]');
        if (cb && cb.checked) {
          cb.click();
          uncheckedThisBatch++;
          await sleep(30);
        }
      }
      log(`[${cfg.label}] 本批印畢,已取消這批勾選 ${uncheckedThisBatch} 筆(避免下批重複印)`);
      await sleep(500);

      // 3-8) 回第 1 頁重新評估(拋完頁面已重整,回第 1 頁最穩)
      await sleep(1500);
      const firstBtnAgain = await findFirstPageBtn();
      if (firstBtnAgain) {
        firstBtnAgain.click();
        pageCount = 1;
        await sleep(2500);
      }
    }

    toast(`✅ ${cfg.label} 跨頁拋印完成(共拋 ${thrownIds.size} 筆)`, 'success', 3000);
    log(`[${cfg.label}] 跨頁拋印完成,共拋 ${thrownIds.size} 筆`);
  }

  /** 拋單階段:點「更多批次功能」→ 點該物流的拋單按鈕 → (宅配)確認 → 關閉結果
   *  ★ V11.39:用 cfg.throwBtnText 嚴格 AND 匹配,絕不會點到別家物流的拋單按鈕
   *  若找不到拋單按鈕,代表訂單已拋過,回傳 false,讓上層繼續做印單 */
  async function tryThrowAction(cfg) {
    // ★ V11.54:「更多批次功能」按鈕是「有勾選才由 Vue 渲染」的。
    //   第 2 批開始時,V11.52 剛取消前批勾選(按鈕消失),重新勾選這批後 Vue 需要時間重繪按鈕,
    //   原本一次性 findBtnByText 常抓不到 → 分批的第 2 批拋單靜默失敗。改為 waitFor 等待重試。
    const moreBtn = await waitFor(() => findBtnByText('更多批次'), 4000);
    if (!moreBtn) {
      warn(`[${cfg.label}] 找不到「更多批次功能」按鈕(拋單階段,已等待重試)`);
      return false;
    }
    log(`[${cfg.label}] 點「更多批次功能」(拋單)`);
    moreBtn.click();
    await sleep(700);

    // ★ V11.39 雙重精準:按鈕文字 + section header 過濾
    const throwBtn = findCarrierActionBtn(cfg.provider, cfg.throwBtnText);
    if (!throwBtn) {
      log(`[${cfg.label}] ⏭ 找不到拋單按鈕「${cfg.throwBtnText.join('+')}」於「${cfg.provider}」section(可能已拋過)`);
      forceCloseAllModals();
      await sleep(500);
      return false;
    }
    log(`[${cfg.label}] 點拋單按鈕「${throwBtn.textContent.trim()}」`);
    throwBtn.click();
    await sleep(1500);

    // 宅配需要確認彈窗
    // ★ V11.39:用 findModalConfirmBtn 精準鎖定 modal 內的 btn-primary「確認」按鈕
    //   避免抓到頁面上的「等待確認」分頁按鈕(class="btn btn-link")造成切換分頁失敗
    if (cfg.needsThrowConfirm) {
      const confirmBtn = await waitFor(() => findModalConfirmBtn(), 3500);
      if (confirmBtn) {
        log(`[${cfg.label}] 點 modal 內確認按鈕「${confirmBtn.textContent.trim()}」 (class="${confirmBtn.className.slice(0, 60)}")`);
        confirmBtn.click();
        await sleep(2000);
      } else {
        warn(`[${cfg.label}] ⚠️ 找不到 modal 內的確認按鈕`);
      }
    }

    // 結果視窗點關閉(只在 modal 內找,避免抓錯)
    const closeBtn = await waitFor(() => {
      // 優先找 modal 內的關閉按鈕
      const modals = document.querySelectorAll('.modal.show .modal-dialog, .modal-dialog, .modal-content');
      for (const m of modals) {
        if (m.getBoundingClientRect().width === 0) continue;
        const btns = m.querySelectorAll('button, .btn');
        for (const b of btns) {
          if (b.getBoundingClientRect().width === 0 || b.disabled) continue;
          const t = (b.textContent || '').trim();
          if (t === '關閉' || t === '關閉視窗' || t === '完成') return b;
        }
      }
      return null;
    }, 4000);
    if (closeBtn) {
      log(`[${cfg.label}] 點 modal 內關閉按鈕「${closeBtn.textContent.trim()}」`);
      closeBtn.click();
      await sleep(800);
    } else {
      log(`[${cfg.label}] 結果視窗沒出現關閉按鈕(可能已自動關閉)`);
      forceCloseAllModals();
      await sleep(500);
    }
    return true;
  }

  /** 印單階段:點「更多批次功能」→ 點該物流的印單按鈕 → 點最終列印按鈕(觸發 PDF)
   *  ★ V11.39:用 cfg.printBtnText 嚴格 AND 匹配,絕不會點到別家物流的印單按鈕 */
  async function doPrintAction(cfg) {
    // ★ V11.54:同 tryThrowAction — 按鈕需有勾選才渲染,改 waitFor 等待重試
    const moreBtn = await waitFor(() => findBtnByText('更多批次'), 4000);
    if (!moreBtn) {
      warn(`[${cfg.label}] 找不到「更多批次功能」按鈕(印單階段,已等待重試)`);
      return false;
    }
    log(`[${cfg.label}] 點「更多批次功能」(印單)`);
    moreBtn.click();
    await sleep(700);

    const printBtn = findCarrierActionBtn(cfg.provider, cfg.printBtnText);
    if (!printBtn) {
      warn(`[${cfg.label}] 找不到印單按鈕「${cfg.printBtnText.join('+')}」於「${cfg.provider}」section`);
      forceCloseAllModals();
      return false;
    }
    log(`[${cfg.label}] 點印單按鈕「${printBtn.textContent.trim()}」`);
    printBtn.click();
    await sleep(1500);

    // 最終列印按鈕 → window.open 被攔截器接管 → GM_openInTab 在背景開分頁
    const finalBtn = await waitFor(() => findFinalPrintBtn(cfg.finalPrintBtn), 4000);
    if (finalBtn) {
      log(`[${cfg.label}] 點擊最終列印按鈕「${finalBtn.textContent.trim()}」 (class="${finalBtn.className.slice(0,60)}")`);

      // ★ V11.42:改為等 v11-open-bg-tab 事件(動態等待,7-11 慢時不會搶跑)
      //   策略:點按鈕 → 等攔截器收到 window.open 派發事件(最多 25 秒)
      //   - 7-11 平台快時可能 2-3 秒就收到
      //   - 7-11 平台慢時可能要 10-20 秒,動態等待
      //   - 全家也走 window.open,所以同樣會等到
      //   - 宅配可能不走 window.open(看修法 4 的 click 攔截),如果還是沒收到 → 25 秒 timeout 自動繼續
      const t0 = Date.now();
      finalBtn.click();
      toast(`📂 ${cfg.label} 物流單分頁產生中,請稍候...`, 'info', 2500);

      const TIMEOUT = 25000;
      await waitFor(() => lastOpenBgTabTime > t0, TIMEOUT);

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      if (lastOpenBgTabTime > t0) {
        log(`[${cfg.label}] ✅ 已觸發背景開頁,耗時 ${elapsed} 秒,URL=${lastOpenBgTabUrl.slice(0, 80)}`);
        toast(`✅ ${cfg.label} 物流單已在背景分頁(${elapsed}s)`, 'success', 2000);
      } else {
        log(`[${cfg.label}] ⚠️ ${TIMEOUT/1000} 秒內沒收到「背景開頁」事件 — 1shop 可能用非 window.open 觸發(宅配可能如此),物流單應已在新分頁,請手動查看`);
        toast(`ℹ️ ${cfg.label} 物流單請至新分頁查看`, 'info', 2500);
      }

      // 關閉列印彈窗,讓主畫面回到訂單列表
      const closeBtn = findBtnByText('關閉');
      if (closeBtn && closeBtn.getBoundingClientRect().width > 0) {
        closeBtn.click();
        await sleep(500);
      }
    } else {
      warn(`[${cfg.label}] 找不到 modal 內可用的最終列印按鈕「${cfg.finalPrintBtn}」`);
      forceCloseAllModals();
    }
    return true;
  }

  /** ★ V11.39 強力關閉所有殘留 modal(ESC + 點所有可見的「關閉/取消」按鈕)*/
  function forceCloseAllModals() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
      }));
    } catch {}
    // ★ V11.39:只在「真正的 modal 容器」內找關閉/取消按鈕,避免誤點訂單列上的「取消訂單」「關閉訂單」按鈕
    const modals = document.querySelectorAll('.modal.show, .modal-dialog, .modal-content, .el-dialog, [role="dialog"]');
    modals.forEach(m => {
      if (m.getBoundingClientRect().width === 0 || m.offsetParent === null) return;
      m.querySelectorAll('button, .btn').forEach(b => {
        const t = (b.textContent || '').trim();
        if (/^(關閉|取消|Cancel|Close|×)$/.test(t) && b.getBoundingClientRect().width > 0) {
          try { b.click(); } catch {}
        }
      });
    });
    // 點 modal backdrop
    $$('.modal-backdrop, .v-modal-backdrop').forEach(el => {
      try { el.click(); } catch {}
    });
  }

  // ============================================================
  //  ⑭ 自動點擊原生「更新」按鈕
  // ============================================================
  async function clickNativeUpdate() {
    await sleep(800);
    const updateBtn = $$('button.btn-primary, button').find(b => {
      const t = (b.textContent || '').trim();
      return t === FP.NATIVE_UPDATE_TEXT && b.getBoundingClientRect().width > 0;
    });
    if (!updateBtn) {
      // ★ V11.39:這通常是正常情況(階段 B 已經點過更新),不是 bug,降為 info
      log('原生「更新」按鈕當前不可見,可能已被階段 B 點擊或頁面已 reload');
      return false;
    }

    Storage.set(LS.LAST_KANBAN, '1');
    log('🔄 點擊原生更新按鈕');
    updateBtn.click();
    return true;
  }

  // ============================================================
  //  ⑮ 跨頁續航:檢查 localStorage 旗標
  // ============================================================
  function checkAndResumeLogisticsFlow() {
    // 若上次關閉前看板是開的,reload 後自動恢復
    if (Storage.get(LS.LAST_KANBAN) === '1') {
      setTimeout(() => {
        const overlay = $('#v11-overlay');
        if (overlay) overlay.style.display = 'flex';
      }, 1500);
    }

    // 若有未完成的物流續航旗標(目前 V11 同頁完成,保留 hook 供未來擴充)
    if (Storage.get(LS.RESUME_FLAG) === '1') {
      const payload = Storage.json(LS.RESUME_PAYLOAD);
      if (payload) {
        toast(`🔄 偵測到上次未完成的物流流程,${payload.which}/${payload.ids?.length || 0} 筆`, 'warn', 4000);
        // 清除旗標,避免無限循環
        Storage.del(LS.RESUME_FLAG);
        Storage.del(LS.RESUME_PAYLOAD);
      }
    }
  }

  // ============================================================
  //  ⑯ UI 自癒守護(每 3 秒檢查 UI 是否仍存在)
  // ============================================================
  function uiSelfHealing() {
    setInterval(() => {
      if (!$('#v11-fab') || !$('#v11-overlay')) {
        warn('UI 消失,重新注入');
        injectUI();
      }
    }, 3000);
  }

  // ============================================================
  //  ⑰ 啟動
  // ============================================================
  function boot() {
    // ★ V11.40 強烈版本標識(讓使用者一眼確認 Tampermonkey 跑的是最新版)
    console.log('%c🚀 1shop 出貨中控台 ' + VERSION + ' 啟動', 'background:#27ae60;color:#fff;padding:6px 14px;font-size:16px;font-weight:bold;border-radius:4px;');
    console.log('%c⚙️ V11.40 重構流程:全選 → 拋單 → 物流單列印 → 最終列印按鈕 → GM_openInTab 在背景開分頁(不搶焦點)', 'color:#2980b9;font-weight:bold;');
    log(`🚀 1shop 出貨中控台 ${VERSION} 啟動`);
    injectUI();
    uiSelfHealing();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 1200);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200));
    window.addEventListener('load',             () => setTimeout(boot, 1200));
  }

})();