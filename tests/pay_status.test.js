/**
 * 付款狀態判定 + 重複單分流 —— 純邏輯回歸測試
 *
 * 跑法(在 repo 根目錄):
 *     node tests/pay_status.test.js
 *
 * 為什麼需要這支測試:
 *   這兩組邏輯決定「哪些訂單會被拋單出貨」與「哪些客人會收到信」,是這支腳本最貴的地方。
 *   node --check 只驗語法,抓不到「行為錯但語法合法」的問題 ——
 *   V11.56 開發時就有一個 split(/\s+/) 被寫成 split(/s+/)(照字母 s 切),
 *   語法完全合法、node --check 通過,是這支測試抓到的。
 *
 * 做法:
 *   從 src/1shop_ultimate.user.js 用「字串標記」切出不依賴 DOM 的純函式,eval 後直接測。
 *   沒有測試框架、沒有相依套件,只要有 node 就能跑。
 *
 * ⚠️ 如果這支測試報「cut MISS」而不是斷言失敗:
 *   代表被切出來的函式改名或搬位置了,不是邏輯壞了。
 *   去下面 CUT_MARKS 把標記字串改成新的樣子即可。
 *
 * 對應文件:
 *   docs/A_平台事實.md  P12(金流狀態 11 種) / P13(欄位結構) / P14(一格三段 + 優先序理由)
 *   docs/C_BDD現行規格.md  F2 訂單自動分類 / 重複單的角色分流
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', '1shop_ultimate.user.js');

const CUT_MARKS = {
  predicates: {
    start: 'const PAY_STATUS = {',
    end: "function isCOD(order)         { return payGroup(order) === 'cod'; }",
  },
  judgeDupGroup: {
    start: 'function judgeDupGroup(all) {',
    end: '\n  }\n',
  },
};

const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

function cut(name) {
  const { start, end } = CUT_MARKS[name];
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`cut MISS(起點): ${name} —— 找不到「${start}」,請更新 CUT_MARKS`);
  const j = src.indexOf(end, i + start.length);
  if (j < 0) throw new Error(`cut MISS(終點): ${name} —— 請更新 CUT_MARKS`);
  return src.slice(i, j + end.length);
}

// eval 出待測函式(PAY_STATUS / payText / payHas / payGroup / isPayable /
// isRefunded / isDeadPay / isPendingPay / isKnownPayStatus / isCOD / judgeDupGroup)
eval(cut('predicates') + '\n' + cut('judgeDupGroup'));

let pass = 0;
const failures = [];
function eq(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
  } else {
    failures.push(`${label}\n      得到 ${JSON.stringify(actual)}\n      應為 ${JSON.stringify(expected)}`);
  }
}
/** 造一筆假訂單。payStatusRaw = 金流欄整格文字(→ P14 一格有三段) */
const O = (raw, id) => ({ id: id || raw, payStatusRaw: raw });

// ── A. 單一狀態的分組(→ A 平台事實 P12 的 11 種)──
console.log('=== A. 單一狀態分組 ===');
const GROUPS = {
  交易成功: 'paid', 已付款: 'paid',
  貨到付款: 'cod', 超商取貨時付款: 'cod',
  等待付款: 'pending', 待確認付款: 'pending', 未付款: 'pending',
  付款失敗: 'dead', 交易逾時: 'dead', 交易取消: 'dead',
  已退款: 'refunded',
};
for (const [text, want] of Object.entries(GROUPS)) {
  eq(payGroup(O(text)), want, `「${text}」應為 ${want}`);
  eq(isKnownPayStatus(O(text)), true, `「${text}」應為已收錄`);
}
eq(payGroup(O('神秘新狀態')), 'unknown', '沒見過的字串 → unknown');
eq(isKnownPayStatus(O('神秘新狀態')), false, '沒見過的字串 → 未收錄');
eq(isPayable(O('神秘新狀態')), false, '未收錄絕對不得算可出貨');
eq(isPayable(O('已退款')), false, '已退款不得算可出貨');
eq(isPayable(O('交易取消')), false, '交易取消不得算可出貨');

// ── B. 真實整格文字(→ P14:交易管道 + 金流狀態 + 附註 三段)──
// 這一組是 V11.56 精準比對會全滅、V11.57 才修好的形狀。
console.log('=== B. 真實整格文字 ===');
const REAL_CELLS = [
  ['LINE Pay ● 已付款 1 交易成功',                          'paid',     '截圖實例:LINE Pay 已付款+交易成功'],
  ['ATM轉帳(統一金流虛擬帳戶) ○ 等待付款 1 虛擬帳戶 已取號', 'pending',  '截圖實例:ATM 等待付款'],
  ['信用卡3期0利率 交易成功',                                'paid',     '信用卡分期(期數是變動的)'],
  ['信用卡6期0利率 交易成功',                                'paid',     '不同期數也要過'],
  ['信用卡24期0利率 交易成功',                               'paid',     '兩位數期數也要過'],
  ['信用卡 交易成功',                                        'paid',     '一般信用卡'],
  ['LINE Pay 神秘新狀態',                                    'unknown',  '管道認得但狀態沒見過 → 仍須擋下'],
];
for (const [raw, want, label] of REAL_CELLS) {
  eq(payGroup(O(raw)), want, `${label} → ${want}`);
}

// ── C. 優先序(這一組是 V11.57 的核心,順序錯了會直接出錯貨)──
console.log('=== C. 優先序 ===');
eq(payGroup(O('信用卡 交易成功 已退款')), 'refunded',
   '已退款必須贏過交易成功 —— 退款發生在交易成功之後,晚判就會誤出貨');
eq(isPayable(O('信用卡 交易成功 已退款')), false, '同上:不得可出貨');
eq(payGroup(O('貨到付款 等待付款')), 'cod',
   '貨到付款必須贏過等待付款 —— 貨到付款的本質就是還沒付,否則所有 COD 單都會被擋著並寄催繳信');
eq(isPayable(O('貨到付款 等待付款')), true, '同上:必須可出貨');
eq(payGroup(O('貨到付款 交易取消')), 'dead', '交易取消必須贏過貨到付款');
eq(payGroup(O('超商取貨時付款 等待付款')), 'cod', '超商取貨時付款同 COD 處理');
eq(payGroup(O('LINE Pay 已付款 已退款')), 'refunded', '已退款贏過已付款');

// ── D. 重複單分流矩陣(→ C BDD 現行規格 F2)──
// 規則只有一條:會成立的付款「恰好 1 筆」→ 保留那筆並發信;其他一切 → 全部交客服。
console.log('=== D. 重複單分流矩陣 ===');
const CASES = [
  [['交易成功', '付款失敗'],        'KEEP_ONE',    '交易成功'],
  [['貨到付款', '付款失敗'],        'KEEP_ONE',    '貨到付款'],
  [['貨到付款', '貨到付款'],        'ALL_PENDING', null],
  [['等待付款', '等待付款'],        'ALL_PENDING', null],
  [['貨到付款', '等待付款'],        'KEEP_ONE',    '貨到付款'],
  [['等待付款', '付款失敗'],        'ALL_PENDING', null],
  [['交易成功', '交易成功'],        'ALL_PENDING', null],   // 真的重複付款 → 涉及退款,不自動取消
  [['付款失敗', '付款失敗'],        'ALL_PENDING', null],
  [['交易成功', '未付款'],          'KEEP_ONE',    '交易成功'],
  [['超商取貨時付款', '交易取消'],  'KEEP_ONE',    '超商取貨時付款'],
  [['神秘新狀態', '交易成功'],      'KEEP_ONE',    '交易成功'],
  [['神秘新狀態', '神秘新狀態'],    'ALL_PENDING', null],
  // ★ V11.57:已退款筆不算成功筆
  [['交易成功', '已退款'],          'KEEP_ONE',    '交易成功'],
  [['已退款', '已退款'],            'ALL_PENDING', null],
  // ★ V11.57:真實整格文字也要走得通
  [['信用卡3期0利率 交易成功', '信用卡 付款失敗'], 'KEEP_ONE', '信用卡3期0利率 交易成功'],
  [['LINE Pay ● 已付款 1 交易成功', '信用卡 交易成功 已退款'], 'KEEP_ONE', 'LINE Pay ● 已付款 1 交易成功'],
];
for (const [texts, wantMode, wantKeep] of CASES) {
  const all = texts.map((t, i) => O(t, `ID${i}`));
  const judged = judgeDupGroup(all);
  eq(judged.mode, wantMode, `${texts.join(' + ')} → ${wantMode}`);
  eq(judged.keepId, wantKeep ? `ID${texts.indexOf(wantKeep)}` : null,
     `${texts.join(' + ')} 的保留筆`);
}

// ── E. 三筆以上 ──
console.log('=== E. 三筆以上 ===');
eq(judgeDupGroup([O('交易成功', 'a'), O('付款失敗', 'b'), O('交易逾時', 'c')]).mode,
   'KEEP_ONE', '三筆:1 成功 + 2 失敗 → 保留 1 筆');
eq(judgeDupGroup([O('交易成功', 'a'), O('交易成功', 'b'), O('付款失敗', 'c')]).mode,
   'ALL_PENDING', '三筆:2 筆成功 → 全交客服');
eq(judgeDupGroup([O('交易成功', 'a'), O('已退款', 'b'), O('已退款', 'c')]).mode,
   'KEEP_ONE', '三筆:1 成功 + 2 已退款 → 保留 1 筆');

// ── F. 舊資料相容(payStatusRaw 缺失時退回 payStatus)──
console.log('=== F. 舊資料相容 ===');
eq(payGroup({ id: 'x', payStatus: '未付款 3' }), 'pending', 'payStatusRaw 缺失時退回 payStatus');
eq(payGroup({ id: 'x' }), 'unknown', '完全沒有付款狀態 → unknown(擋下)');

// ── G. 預購單的分類閘門(★ V11.64 → E 檔 T34)──
//   classifyOrders 不純(吃 allOrders / Storage / DOM),切不出來直接測。
//   但 V11.64 給它加的閘門就是 isPayable,而 isPayable 是從原始檔切出來的真貨 ——
//   所以這一組測「付款分組 → 那筆預購單會不會留在預購分支」,
//   再加一條結構斷言,防止那個條件哪天被改回去而沒人發現。
console.log('=== G. 預購單的分類閘門(V11.64)===');
eq(src.includes('o.hasPreorder && isPayable(o)'), true,
   'classifyOrders 的預購分支必須要求付款已成立(條件被改回 o.hasPreorder 就會在這裡失敗)');
// true  = 留在預購分支:不寫備註、移暫存/其他、不出貨、不發信
// false = 往下掉:移「確認中」交人工(pending/dead 還會寄催繳信)
const PRE_GATE = {
  交易成功: true, 已付款: true,
  貨到付款: true, 超商取貨時付款: true,   // 錢是到貨才收,不該被當成未付款去催
  等待付款: false, 待確認付款: false, 未付款: false,
  付款失敗: false, 交易逾時: false, 交易取消: false,
  已退款: false,
  神秘新狀態: false,
};
for (const [text, stays] of Object.entries(PRE_GATE)) {
  eq(isPayable(O(text)), stays,
     `預購品＋「${text}」${stays ? '應留在預購分支' : '應落到未付款/確認中那條'}`);
}
// 最貴的那一條單獨再釘一次:落空的後果是把還沒到貨的東西寄給客人
eq(isPayable(O('信用卡 等待付款')), false,
   '預購品＋信用卡等待付款(2026-09-22 實例 DK46092240650)不得留在預購分支');
eq(isPayable(O('信用卡 已付款 1')), true,
   '預購品＋信用卡已付款(2026-09-22 實例 GN6092238126)應留在預購分支');

// ── H. EXC 未付款與 7-11 精準批次的結構防線(★ V11.65)──
//   classifyOrders / processOneCarrier 都碰 DOM 與平台流程，無法在此純邏輯檔安全模擬；
//   所以釘住兩個不可退化的入口：EXC 的未付款分支必須先於 EXC，7-11 必須啟用精準名單。
console.log('=== H. EXC 未付款與 7-11 精準批次(V11.65) ===');
const excUnpaidBranch = 'else if (o.isExc && !isPayable(o))';
const excPaidBranch = 'else if (o.isExc) {';
eq(src.includes(excUnpaidBranch), true,
   'EXC 未付款必須有獨立 UNPAID 分支，不能直接落進 EXC');
eq(src.indexOf(excUnpaidBranch) < src.indexOf(excPaidBranch), true,
   'EXC 未付款分支必須先於付款成立的 EXC 分支（→ P23）');
eq(src.includes('preciseBatching: true'), true,
   '7-11 設定必須啟用精準名單分批（→ P22b）');
eq(src.includes('targetIds.has(id)'), true,
   '7-11 每批必須以本輪目標訂單 id 篩選，不能再耗用混合列額度');
eq(src.includes('已停止且不自動重試;未驗證清單'), true,
   '精準 7-11 批找不到列印入口時必須停止並列出未驗證清單');

// ── 結果 ──
console.log('');
if (failures.length > 0) {
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log(`\n通過 ${pass} / 失敗 ${failures.length}`);
  process.exit(1);
}
console.log(`✅ 全部通過(${pass} 項)`);
