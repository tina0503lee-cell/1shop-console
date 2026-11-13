/**
 * V11.66 已到貨預購出貨 —— 純邏輯與批次隔離回歸測試
 * 跑法: node tests/preorder_release.test.js
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

global.preorderReleaseView = { candidates: null, selectedKeys: new Set(), sort: { col: null, dir: -1 } };
global.FLOW_MODE = { NORMAL: 'NORMAL', PREORDER_RELEASE: 'PREORDER_RELEASE' };
global.currentFlowMode = global.FLOW_MODE.PREORDER_RELEASE;
eval([
  'parseKws', 'judgePreorder', 'parseCustomerMessage', 'formatCustomerMessageReminder', 'getReleaseCandidates',
  'releaseKey', 'applyReleaseAuthorization', 'clearReleaseAuthorization',
  'groupReleaseOrdersBySource', 'isStrictBatchComplete', 'validateSplitResult',
  'classifyStrictCarrierOutcome', 'releaseBlockingReason', 'rowMatchesCarrier',
  'filterCarrierBatchRows', 'collectStrictDestinationMatches',
  'releaseCandidatePreviewReason', 'escapeHTML', 'escapeAttr', 'syncFlowModeActionVisibility', 'savePreorderReleaseViewSelections', 'sortPreorderReleaseView', 'setPreorderReleaseViewSelection', 'renderPreorderReleaseCandidates',
].map(cutFunction).join('\n'));
global.payGroup = order => order.payGroup || 'paid';

// ── A. 關鍵字完全相符與候選授權 ──
eq(parseKws('DK4Pro\n7DS-PK'), ['DK4Pro', '7DS-PK'], '換行關鍵字');
eq(judgePreorder('[DK4Pro] 商品 A', ['DK4'], []), null, 'SKU 不得包含比對');
eq(judgePreorder('[DK4Pro] 商品 A', ['DK4Pro'], []), { kw: 'DK4Pro', tab: '暫存' }, 'SKU 完全相符');

const candidate = { id: 'A', hasPreorder: true, sourceTab: '暫存', relatedOrders: [{ id: 'B' }] };
const nonCandidateDup = { id: 'B', hasPreorder: false, sourceTab: '暫存', relatedOrders: [{ id: 'A' }] };
eq(getReleaseCandidates([candidate, nonCandidateDup]).map(o => o.id), ['A'], '候選只取關鍵字命中');
eq(candidate.relatedOrders.map(o => o.id), ['B'], 'duplicate 關係來自完整掃描集合,候選篩選不破壞');

applyReleaseAuthorization([candidate, nonCandidateDup], new Set(['A']));
eq([candidate.preorderReleased, nonCandidateDup.preorderReleased], [false, false], '舊式純 ID 不再能取得 release flag');
applyReleaseAuthorization([candidate, nonCandidateDup], new Set([releaseKey('暫存', 'A')]));
eq([candidate.preorderReleased, nonCandidateDup.preorderReleased], [true, false], '只有勾選的來源＋ID 取得 release flag');
applyReleaseAuthorization([candidate, nonCandidateDup], new Set());
eq([candidate.preorderReleased, nonCandidateDup.preorderReleased], [false, false], '新批次空集合會清掉舊 release flag');

const sameIdDifferentSources = [
  { id: 'SAME', sourceTab: '暫存' },
  { id: 'SAME', sourceTab: '其他' },
];
applyReleaseAuthorization(sameIdDifferentSources, new Set([releaseKey('暫存', 'SAME')]));
eq(sameIdDifferentSources.map(o => o.preorderReleased), [true, false], '同 ID 不同來源只授權實際勾選列');
applyReleaseAuthorization(sameIdDifferentSources, new Set([releaseKey('暫存', 'SAME'), releaseKey('其他', 'SAME')]));
eq(sameIdDifferentSources.map(o => o.preorderReleased), [true, true], '兩列都勾時各自具備明確授權鍵,執行層另行 fail closed');

// 候選看板預設全選；人工取消後只以執行當下仍勾選的 key 授權。
const candidateContainer = { innerHTML: '' };
const candidateRunButton = { onclick: null };
const globalRunButton = { hidden: false };
global.$ = selector => selector === '#v11-cards-container' ? candidateContainer : (selector === '#v11-btn-run-preorder-release' ? candidateRunButton : (selector === '#v11-btn-global' ? globalRunButton : null));
let renderedReleaseCheckboxes = [];
let renderedReleaseAllCheckboxes = [];
global.$$ = selector => selector === '.v11-release-check' ? renderedReleaseCheckboxes : (selector === '.v11-release-check-all' ? renderedReleaseAllCheckboxes : []);
const renderCandidates = [
  { id: 'CHECKED', sourceTab: '暫存', customer: '測試顧客', phone: '0912345678', product: '完整商品 A', comboLabel: 'SKU-A*2', shipText: '7-11', payStatus: '已付款', amount: 100, date: '2026-11-12T09:30:00+08:00', relatedOrders: [{ id: 'RELATED' }], customerNote: '請小心包裝', merchantNote: '倉庫優先', hasCustomerMessage: true, customerMessageCount: 2, type: 'NORMAL' },
  { id: 'CANCELLED', sourceTab: '其他', product: '商品 B', shipText: '全家', payStatus: '等待付款', amount: 20, date: '2026-11-10T09:30:00+08:00', relatedOrders: [], customerNote: '', merchantNote: '', hasCustomerMessage: false, type: 'UNPAID', payGroup: 'pending' },
];
const renderClassificationBefore = renderCandidates.map(o => ({ type: o.type, payStatus: o.payStatus, relatedOrders: o.relatedOrders }));
renderedReleaseCheckboxes = renderCandidates.map(o => ({ checked: true, dataset: { key: releaseKey(o.sourceTab, o.id) } }));
renderedReleaseAllCheckboxes = [{ checked: true, onchange: null }];
renderPreorderReleaseCandidates(renderCandidates);
eq((candidateContainer.innerHTML.match(/class="v11-release-check"[^>]* checked/g) || []).length, 2, 'release candidate render 預設全部 checked');
eq(candidateContainer.innerHTML.includes('class="v11-release-check-all"'), true, '候選表頭實際 render 全選 checkbox');
eq(candidateContainer.innerHTML.includes('預設全選，可取消例外'), true, '候選看板文案與預設全選一致');
eq(candidateContainer.innerHTML.includes('class="td-info"') && candidateContainer.innerHTML.includes('class="td-status v11-status-paid"') && candidateContainer.innerHTML.includes('class="td-product"'), true, '候選列實際 render 使用 NORMAL 主要 td class');
eq(candidateContainer.innerHTML.includes('data-key="暫存::CHECKED"') && candidateContainer.innerHTML.includes('data-key="其他::CANCELLED"'), true, '候選 checkbox 保留 sourceTab::orderId 授權鍵');
eq(candidateContainer.innerHTML.includes('來源：暫存') && candidateContainer.innerHTML.includes('來源：其他'), true, '來源顯示在訂單資訊欄');
eq(!candidateContainer.innerHTML.includes('目前可進正常出貨') && candidateContainer.innerHTML.includes('暫不可出貨：付款未成立'), true, '正常 eligible 不顯示 gate，blocked reason 保留');
eq(!candidateContainer.innerHTML.includes('僅為目前掃描預覽；執行前仍會重新掃描與安全重檢。') && candidateContainer.innerHTML.includes('執行時會重新掃描並安全重檢'), true, '重檢說明只保留一份 footer 全局提示');
eq(candidateContainer.innerHTML.includes('note-customer') && candidateContainer.innerHTML.includes('請小心包裝') && candidateContainer.innerHTML.includes('note-merchant') && candidateContainer.innerHTML.includes('倉庫優先'), true, '顧客與商家備註使用 NORMAL note-box 樣式');
eq(candidateContainer.innerHTML.includes('⚠ 顧客留言 2 則') && candidateContainer.innerHTML.includes('SKU-A*2') && candidateContainer.innerHTML.includes('class="ship-badge">7-11</span>'), true, '留言、SKU 與物流實際使用 NORMAL 呈現');
eq(renderCandidates.map(o => ({ type: o.type, payStatus: o.payStatus, relatedOrders: o.relatedOrders })), renderClassificationBefore, '候選 UI render 不改變 classification、payment 或 duplicate 資料');
eq([globalRunButton.hidden, candidateRunButton.hidden], [true, false], 'PREORDER_RELEASE 模式只顯示 release execute button');
global.currentFlowMode = global.FLOW_MODE.NORMAL;
syncFlowModeActionVisibility();
eq([globalRunButton.hidden, candidateRunButton.hidden], [false, true], 'NORMAL 模式顯示 global execute 並隱藏 release execute');
global.currentFlowMode = global.FLOW_MODE.PREORDER_RELEASE;
syncFlowModeActionVisibility();
eq([globalRunButton.hidden, candidateRunButton.hidden], [true, false], '模式切回 PREORDER_RELEASE 可正確恢復 visibility');

// 排序只重排預購 view；不重建 allOrders，也必須保留 source key 與取消勾選狀態。
renderedReleaseAllCheckboxes[0].checked = false;
renderedReleaseAllCheckboxes[0].onchange();
eq([...global.preorderReleaseView.selectedKeys], [], '表頭取消全選會移除本次 candidates 的所有 key');
eq(!candidateContainer.innerHTML.includes('data-key="暫存::CHECKED" checked') && !candidateContainer.innerHTML.includes('data-key="其他::CANCELLED" checked'), true, '取消全選後 renderer HTML 全部未勾選');
renderedReleaseAllCheckboxes[0].checked = true;
renderedReleaseAllCheckboxes[0].onchange();
eq([...global.preorderReleaseView.selectedKeys].sort(), ['其他::CANCELLED', '暫存::CHECKED'], '表頭全選使用既有 selectedKeys 加入所有 candidate key');
renderedReleaseCheckboxes[1].checked = false;
renderedReleaseCheckboxes[1].onchange();
eq(global.preorderReleaseView.selectedKeys.has('暫存::CHECKED') && !global.preorderReleaseView.selectedKeys.has('其他::CANCELLED'), true, '全選後仍可個別取消');
sortPreorderReleaseView('shipText');
eq(global.preorderReleaseView.candidates.map(o => o.id), ['CANCELLED', 'CHECKED'], '物流排序首次點擊沿用 NORMAL 降冪規則');
eq(candidateContainer.innerHTML.indexOf('CANCELLED') < candidateContainer.innerHTML.indexOf('CHECKED'), true, '物流排序實際重排 renderer HTML');
eq(global.preorderReleaseView.selectedKeys.has('暫存::CHECKED') && !global.preorderReleaseView.selectedKeys.has('其他::CANCELLED'), true, '物流排序保留取消勾選與 sourceTab::orderId');
sortPreorderReleaseView('amount');
eq(global.preorderReleaseView.candidates.map(o => o.id), ['CHECKED', 'CANCELLED'], '金額排序採數值而非字串，首次點擊降冪');
sortPreorderReleaseView('amount');
eq(global.preorderReleaseView.candidates.map(o => o.id), ['CANCELLED', 'CHECKED'], '再次點擊金額排序切換升冪');
sortPreorderReleaseView('date');
eq(global.preorderReleaseView.candidates.map(o => o.id), ['CHECKED', 'CANCELLED'], '日期排序首次點擊沿用 NORMAL 降冪規則');
eq(candidateContainer.innerHTML.includes('data-preorder-sort="shipText"') && candidateContainer.innerHTML.includes('data-preorder-sort="amount"') && candidateContainer.innerHTML.includes('data-preorder-sort="date"'), true, '三個排序控制實際 render 在 PREORDER_RELEASE 表頭');
eq(candidateContainer.innerHTML.includes('data-key="暫存::CHECKED" checked') && !candidateContainer.innerHTML.includes('data-key="其他::CANCELLED" checked'), true, '多次排序後 checkbox HTML 仍保留人工取消狀態');

const renderedCheckboxes = renderCandidates.map(o => ({ checked: true, dataset: { key: releaseKey(o.sourceTab, o.id) } }));
renderedCheckboxes[1].checked = false;
const selectedAfterCancel = renderedCheckboxes.filter(cb => cb.checked).map(cb => cb.dataset.key);
applyReleaseAuthorization(renderCandidates, new Set(selectedAfterCancel));
eq([selectedAfterCancel, renderCandidates.map(o => o.preorderReleased)],
  [['暫存::CHECKED'], [true, false]],
  '人工取消後該來源＋ID 不進 releaseKeys');

renderedCheckboxes.forEach(cb => { cb.checked = false; });
const selectedAfterCancelAll = renderedCheckboxes.filter(cb => cb.checked).map(cb => cb.dataset.key);
applyReleaseAuthorization(renderCandidates, new Set(selectedAfterCancelAll));
eq([selectedAfterCancelAll, renderCandidates.map(o => o.preorderReleased)], [[], [false, false]], '全部取消勾選會形成空執行集合');

// ── B. 安全分類結果不可被 release 越權 ──
eq(releaseBlockingReason({ preorderReleased: true, type: 'NORMAL' }), '', 'release + 已付款 NORMAL 可出貨');
eq(releaseBlockingReason({ preorderReleased: true, type: 'UNPAID' }), '付款未成立', 'release + 未付款仍阻擋');
eq(releaseBlockingReason({ preorderReleased: true, type: 'UNPAID', payRefunded: true }), '已退款／不得出貨', 'release + 已退款仍阻擋');
eq(releaseBlockingReason({ preorderReleased: true, type: 'UNPAID', payUnknown: true }), '付款狀態未知', 'release + 未知付款仍阻擋');
eq(releaseBlockingReason({ preorderReleased: true, type: 'DUP', dupRole: 'KEEP', rowMoveTab: '不移動' }), '', 'release + DUP KEEP 可進物流');
eq(releaseBlockingReason({ preorderReleased: true, type: 'DUP', dupRole: 'CANCEL' }), '重複訂單 CANCEL／不得自動出貨', 'DUP CANCEL 原規則不變');
eq(releaseBlockingReason({ preorderReleased: true, type: 'DUP', dupRole: 'PENDING' }), '重複訂單 PENDING／不得自動出貨', 'DUP PENDING 原規則不變');
eq(releaseBlockingReason({ preorderReleased: true, type: 'UNPAID' }) !== '', true, '預設已勾選但安全檢查失敗仍不得進物流');
eq(src.includes('o.hasPreorder && !o.preorderReleased && isPayable(o)'), true, 'classifyOrders 同時處理 release 攔截點');
eq(src.includes('order.hasPreorder && !order.preorderReleased'), true, 'applyDupKeepOrCancel 同時處理 release 攔截點');

// ── C. 來源分組、多頁集合與顧客留言 ──
const grouped = groupReleaseOrdersBySource([
  { id: 'T1', sourceTab: '暫存', scanPage: 1 }, { id: 'T2', sourceTab: '暫存', scanPage: 2 },
  { id: 'O1', sourceTab: '其他', scanPage: 3 },
]);
eq(grouped.暫存.map(o => o.id), ['T1', 'T2'], '暫存跨頁訂單不遺漏');
eq(grouped.其他.map(o => o.id), ['O1'], '其他來源獨立分組');

function messageRoot(text, exists = true) {
  const holder = { textContent: text };
  const icon = { closest: () => holder, parentElement: holder };
  return { querySelector: sel => (exists && sel === 'svg[data-icon="messages"]' ? icon : null) };
}
eq(parseCustomerMessage(messageRoot('顧客留言(2)')), { hasCustomerMessage: true, customerMessageCount: 2 }, '顧客留言(2) → true / 2');
eq(parseCustomerMessage(messageRoot('顧客留言')), { hasCustomerMessage: true, customerMessageCount: null }, '有圖示但數量解析失敗 → true / unknown');
eq(parseCustomerMessage(messageRoot('', false)), { hasCustomerMessage: false, customerMessageCount: 0 }, '無留言標記 → false / 0');
eq(formatCustomerMessageReminder({ hasCustomerMessage: true, customerMessageCount: 2 }), '⚠ 顧客留言 2 則', 'PREORDER_RELEASE 共用 formatter 顯示已解析數量');
eq(formatCustomerMessageReminder({ hasCustomerMessage: true, customerMessageCount: null }), '⚠ 有顧客留言', 'PREORDER_RELEASE 共用 formatter 不把未知數量顯示為 0 則');
eq(cutFunction('parseCustomerMessage').includes('data-v-'), false, '新留言 selector 不依賴 data-v-*');

// ── D. 三家嚴格 batch allowlist 與 NORMAL 相容性 ──
global.$$ = (_selector, tr) => tr.tds;
global.getOrderIdFromRow = tr => tr.id;
function row(id, ship) {
  return {
    id,
    tds: Array.from({ length: 7 }, (_, i) => i === 6 ? { innerText: ship, textContent: ship } : {}),
    querySelector: sel => sel === 'input[type="checkbox"]' ? {} : null,
  };
}
const configs = {
  '7-11': { shipTextMatch: ['7-11'] },
  '全家': { shipTextMatch: ['全家'] },
  '宅配': { shipTextMatch: ['宅配'] },
};
for (const [label, cfg] of Object.entries(configs)) {
  const rows = [row('BATCH', label), row('OUTSIDE', label), row('WRONG-CARRIER', '別家物流')];
  eq(filterCarrierBatchRows(rows, cfg, new Set(), new Set(['BATCH', 'WRONG-CARRIER']), true).map(r => r.id), ['BATCH'], `${label}:嚴格模式同時做 ID＋carrier 過濾`);
  eq(filterCarrierBatchRows(rows, cfg, new Set(), null, false).map(r => r.id), ['BATCH', 'OUTSIDE', 'WRONG-CARRIER'], `${label}:NORMAL 未啟用白名單時維持 V11.65 整頁策略`);
}

// 目的分頁預檢的純配對函式:同時要求 ID 與 carrier。
const destinationCfg = { shipTextMatch: ['7-11'] };
const destinationEntry = [{ order: { id: 'D1', sourceTab: '暫存' }, cfg: destinationCfg }];
let matched = new Set(), mismatched = new Set();
collectStrictDestinationMatches(destinationEntry, [row('D1', '7-11')], matched, mismatched);
eq([...matched], ['暫存::D1'], '目的頁 ID 正確＋carrier 正確 → pass');
matched = new Set(); mismatched = new Set();
collectStrictDestinationMatches(destinationEntry, [row('D1', '全家')], matched, mismatched);
eq([[...matched], [...mismatched]], [[], ['暫存::D1']], '目的頁 ID 正確但 carrier 錯誤 → fail');
matched = new Set(); mismatched = new Set();
collectStrictDestinationMatches(destinationEntry, [row('OTHER', '7-11')], matched, mismatched);
eq([[...matched], [...mismatched]], [[], []], '目的頁沒有 target ID → fail');
matched = new Set(); mismatched = new Set();
collectStrictDestinationMatches(destinationEntry, [row('OUTSIDE', '全家'), row('D1', '7-11')], matched, mismatched);
eq([...matched], ['暫存::D1'], '同頁其他 carrier／其他批次不影響正確 target');

// strict throw／print 完成矩陣。
eq(classifyStrictCarrierOutcome('ok', 'ok').completed, true, 'throw ok + print ok → completed');
eq(classifyStrictCarrierOutcome('ok', 'no-batch-btn').completed, false, 'throw ok + print no-batch-btn → fail');
eq(classifyStrictCarrierOutcome('no-throw-btn', 'no-batch-btn').completed, false, 'throw no-throw-btn + print no-batch-btn → fail');
eq(classifyStrictCarrierOutcome('no-batch-btn', 'ok').completed, false, 'throw fail + print ok → fail');
eq(classifyStrictCarrierOutcome('no-batch-btn', 'no-print-btn').completed, false, 'throw fail + print fail → fail');
eq(classifyStrictCarrierOutcome('ok', 'no-bg-tab'), { completed: false, reason: '標籤／物流單未完成' }, '標籤未完成 → fail');

// 第一層分流集合必須完整、互斥且沒有額外 key。
const expectedSplit = [{ id: 'A', sourceTab: '暫存' }, { id: 'B', sourceTab: '暫存' }];
eq(validateSplitResult(expectedSplit, { success: ['暫存::A'], failed: [{ key: '暫存::B' }], notFound: [] }).ok, true, '分流三集合完整覆蓋 expected');
eq(validateSplitResult(expectedSplit, { success: ['暫存::A'], failed: [], notFound: [] }).ok, false, '分流結果遺漏 B → fail');
eq(validateSplitResult(expectedSplit, { success: ['暫存::A', '暫存::B'], failed: [{ key: '暫存::B' }], notFound: [] }).ok, false, '同一 key 同時 success/failed → fail');
eq(validateSplitResult(expectedSplit, { success: ['暫存::A', '暫存::B', '暫存::C'], failed: [], notFound: [] }).ok, false, '分流結果有額外 key → fail');

eq(isStrictBatchComplete(['A', 'B'], ['A', 'B'], []), true, '全部本批 ID 完成才成功');
eq(isStrictBatchComplete(['A', 'B'], ['A'], []), false, '任一 ID 找不到不得宣告完成');
eq(isStrictBatchComplete(['A'], ['A'], [{ id: 'A', reason: 'no-label' }]), false, '印單／標籤問題不得宣告完成');

// 實際執行 resetPreorderReleaseSession,確認成功／失敗共用的 finally 會使授權失效。
const resetHarness = new Function('clearReleaseAuthorization', 'syncFlowModeActionVisibility', 'resetSource', `
  const FLOW_MODE = { NORMAL: 'NORMAL', PREORDER_RELEASE: 'PREORDER_RELEASE' };
  let allOrders = [{ id: 'R1', preorderReleased: true }];
  let releaseKeys = new Set(['暫存::R1']);
  let currentFlowMode = FLOW_MODE.PREORDER_RELEASE;
  let preorderReleaseView = { candidates: [{ id: 'R1', sourceTab: '暫存' }], selectedKeys: new Set(['暫存::R1']), sort: { col: 'date', dir: -1 } };
  const boxes = [{ checked: true }];
  const $$ = () => boxes;
  eval(resetSource);
  resetPreorderReleaseSession();
  return { released: allOrders[0].preorderReleased, keyCount: releaseKeys.size, mode: currentFlowMode, checked: boxes[0].checked };
`);
eq(resetHarness(clearReleaseAuthorization, () => {}, cutFunction('resetPreorderReleaseSession')),
  { released: false, keyCount: 0, mode: 'NORMAL', checked: false },
  '完成或失敗後清除 release flag／keys／mode／checkbox');

if (failures.length) {
  console.error(`❌ ${failures.length} 項失敗 / ${pass + failures.length} 項`);
  failures.forEach(x => console.error('\n' + x));
  process.exit(1);
}
console.log(`✅ 全部通過(${pass} 項)`);
