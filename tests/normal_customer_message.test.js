/**
 * V11.67 NORMAL 看板顧客留言提醒 —— 純邏輯回歸測試
 * 跑法: node tests/normal_customer_message.test.js
 *
 * 留言是人工提醒；本測試確認 parser、NORMAL 訂單欄位與共用 render helper
 * 都不會改寫原本的分類、付款或 duplicate 結果。
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', '1shop_ultimate.user.js'), 'utf8').replace(/\r\n/g, '\n');

function cutFunction(name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`cut MISS:${name}`);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`cut EOF:${name}`);
}

let pass = 0;
const failures = [];
function eq(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else failures.push(`${label}\n  得到 ${JSON.stringify(actual)}\n  應為 ${JSON.stringify(expected)}`);
}

const scrapeStart = src.indexOf('function scrapeCurrentPage(');
const scrapeEnd = src.indexOf('\n  /** ★ V11.39 找「最前面」分頁按鈕', scrapeStart);
if (scrapeStart < 0 || scrapeEnd < 0) throw new Error('cut MISS:scrapeCurrentPage');
eval(['parseCustomerMessage', 'formatCustomerMessageReminder', 'judgePreorder'].map(cutFunction).join('\n') + '\n' + src.slice(scrapeStart, scrapeEnd));

function messageRoot(text, exists = true) {
  const holder = { textContent: text };
  const icon = { closest: () => holder, parentElement: holder };
  return { querySelector: selector => (exists && selector === 'svg[data-icon="messages"]' ? icon : null) };
}

function emptyTd(text = '') {
  return { innerText: text, querySelector: () => null };
}

function scrapedNormalOrder(messageText, hasIcon = true) {
  const orderLink = { innerText: 'NORMAL-1' };
  const customerLink = { innerText: '測試顧客' };
  const holder = { textContent: messageText };
  const messageIcon = { closest: () => holder, parentElement: holder };
  const tds = [
    emptyTd(),
    { innerText: 'NORMAL-1', querySelector: selector => selector === 'a[href*="/shop/order/all/"]' ? orderLink : null },
    emptyTd('2026-10-22 09:30'),
    { innerText: '測試顧客', querySelector: selector => selector === 'a[href*="/shop/customer/all/"]' ? customerLink : null },
    emptyTd(), emptyTd('已付款'), emptyTd('7-11'), emptyTd('$100'), emptyTd(), emptyTd(),
  ];
  const tr = {
    tds,
    outerHTML: '<tr>mock</tr>',
    querySelector: selector => {
      if (selector === 'a[href*="/shop/order/all/"]') return orderLink;
      if (hasIcon && selector === 'svg[data-icon="messages"]') return messageIcon;
      return null;
    },
  };
  global.platformRows = () => [tr];
  global.$$ = (selector, root) => selector === 'td' && root === tr ? tds : [];
  global.warn = () => {};
  return scrapeCurrentPage({ temp: [], other: [] })[0];
}

const noMessage = scrapedNormalOrder('', false);
eq(formatCustomerMessageReminder(noMessage), '', 'NORMAL 無顧客留言不產生看板提醒');

const oneMessage = scrapedNormalOrder('顧客留言(1)');
eq([oneMessage.hasCustomerMessage, oneMessage.customerMessageCount, formatCustomerMessageReminder(oneMessage)],
  [true, 1, '⚠ 顧客留言 1 則'],
  'scrapeCurrentPage 的 NORMAL 訂單帶入 parser 欄位並顯示 1 則');

const twoMessages = scrapedNormalOrder('顧客留言(2)');
eq([twoMessages.hasCustomerMessage, twoMessages.customerMessageCount, formatCustomerMessageReminder(twoMessages)],
  [true, 2, '⚠ 顧客留言 2 則'],
  'scrapeCurrentPage 的 NORMAL 訂單帶入 parser 欄位並顯示 2 則');

const unknownCount = scrapedNormalOrder('顧客留言');
eq([unknownCount.hasCustomerMessage, unknownCount.customerMessageCount, formatCustomerMessageReminder(unknownCount)],
  [true, null, '⚠ 有顧客留言'],
  'NORMAL messages icon 數量未知時不顯示錯誤的 0 則');

const classificationBeforeReminder = { type: twoMessages.type, payStatus: twoMessages.payStatus, duplicateCount: twoMessages.duplicateCount, dupRole: twoMessages.dupRole };
formatCustomerMessageReminder(twoMessages);
eq({ type: twoMessages.type, payStatus: twoMessages.payStatus, duplicateCount: twoMessages.duplicateCount, dupRole: twoMessages.dupRole },
  classificationBeforeReminder,
  '顧客留言提醒不改變 NORMAL 分類、付款或 duplicate 結果');

if (failures.length) {
  console.error(`❌ ${failures.length} 項失敗 / ${pass + failures.length} 項`);
  failures.forEach(x => console.error(`\n${x}`));
  process.exit(1);
}
console.log(`✅ 全部通過(${pass} 項)`);
