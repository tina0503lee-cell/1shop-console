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
 *   docs/A_平台事實.md  P12(付款狀態 10 種) / P13(狀態欄結構)
 *   docs/C_BDD現行規格.md  F2 訂單自動分類 / 重複單的角色分流
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', '1shop_ultimate.user.js');

const CUT_MARKS = {
  predicates: {
    start: 'const PAY_STATUS = {',
    end: "function isCOD(order)         { return payIs(order, ['貨到付款', '超商取貨時付款']); }",
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

// eval 出待測函式(PAY_STATUS / payName / payIs / isPayable / isPendingPay /
// isDeadPay / isKnownPayStatus / isCOD / judgeDupGroup)
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
/** 造一筆假訂單。payStatusName 是判定用的乾淨狀態名(→ P13) */
const O = (name, id) => ({ id: id || name, payStatusName: name });

// ── A. 付款狀態分組(→ A 平台事實 P12 的 10 種 + 未收錄)──
console.log('=== A. 付款狀態分組 ===');
const GROUPS = {
  已付款: 'payable', 交易成功: 'payable', 貨到付款: 'payable', 超商取貨時付款: 'payable',
  等待付款: 'pending', 待確認付款: 'pending', 未付款: 'pending',
  付款失敗: 'dead', 交易逾時: 'dead', 交易取消: 'dead',
};
for (const [name, want] of Object.entries(GROUPS)) {
  const o = O(name);
  const got = isPayable(o) ? 'payable' : isPendingPay(o) ? 'pending' : isDeadPay(o) ? 'dead' : 'unknown';
  eq(got, want, `「${name}」應為 ${want}`);
  eq(isKnownPayStatus(o), true, `「${name}」應為已收錄`);
}
eq(isKnownPayStatus(O('神秘新狀態')), false, '沒見過的字串 → 未收錄');
eq(isPayable(O('神秘新狀態')), false, '未收錄絕對不得算可出貨');
eq(isCOD(O('貨到付款')), true, '貨到付款 → COD');
eq(isCOD(O('超商取貨時付款')), true, '超商取貨時付款 → COD');
eq(isCOD(O('交易成功')), false, '交易成功 不是 COD');

// ── B. 徽章污染(→ A 平台事實 P13)──
// 付款狀態欄是 .status-name + 天數/次數徽章,腳本會串成 "未付款 3"。
// 判定必須看得懂這種字串,否則會誤報成「未收錄」把該催繳的單擋住。
console.log('=== B. 徽章污染 ===');
eq(isPendingPay({ id: 'x', payStatus: '未付款 3' }), true, 'payStatusName 缺失時 "未付款 3" 仍判為 pending');
eq(isPendingPay({ id: 'x', payStatusName: '未付款', payStatus: '未付款 3' }), true, '有 payStatusName 時正常');
eq(isKnownPayStatus({ id: 'x', payStatus: '未付款 3' }), true, '"未付款 3" 不該被誤判成未收錄');

// ── C. 重複單分流矩陣(→ C BDD 現行規格 F2)──
// 規則只有一條:會成立的付款「恰好 1 筆」→ 保留那筆並發信;其他一切 → 全部交客服。
console.log('=== C. 重複單分流矩陣 ===');
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
];
for (const [names, wantMode, wantKeep] of CASES) {
  const all = names.map((nm, i) => O(nm, `ID${i}_${nm}`));
  const judged = judgeDupGroup(all);
  eq(judged.mode, wantMode, `${names.join(' + ')} → ${wantMode}`);
  eq(judged.keepId, wantKeep ? `ID${names.indexOf(wantKeep)}_${wantKeep}` : null,
     `${names.join(' + ')} 的保留筆`);
}

// ── D. 三筆以上 ──
console.log('=== D. 三筆以上 ===');
eq(judgeDupGroup([O('交易成功', 'a'), O('付款失敗', 'b'), O('交易逾時', 'c')]).mode,
   'KEEP_ONE', '三筆:1 成功 + 2 失敗 → 保留 1 筆');
eq(judgeDupGroup([O('交易成功', 'a'), O('交易成功', 'b'), O('付款失敗', 'c')]).mode,
   'ALL_PENDING', '三筆:2 筆成功 → 全交客服');

// ── 結果 ──
console.log('');
if (failures.length > 0) {
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log(`\n通過 ${pass} / 失敗 ${failures.length}`);
  process.exit(1);
}
console.log(`✅ 全部通過(${pass} 項)`);
