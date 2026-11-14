import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../intrinsic-value-calculator/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const model = vm.createContext({});
vm.runInContext(script.slice(0, script.indexOf('    function calculate()')), model);

function closeTo(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `Expected ${expected}, received ${actual}`);
}

test('a $10 annual cash flow at a 10% hurdle is worth $100 with a 10x terminal multiple', () => {
    for (const weight of [0, 0.5, 1]) {
        const result = model.calculateHybridIV(10, 0, 0, 0.1, 10, weight);
        closeTo(result.hybridIV, 100);
        closeTo(result.perpetuityIV, 100);
        closeTo(result.finiteIV, 100);
    }
});

// Captured from the manual calculator at commit 6a650fa, before the
// September auto-fill and net-cash changes. These are regression fixtures.
const historicalExample = [
    { weight: 0, values: ['$185.18', '$151.02', '$124.58', '$95.37'] },
    { weight: 0.5, values: ['$515.11', '$202.26', '$136.85', '$93.78'] },
    { weight: 1, values: ['$845.04', '$253.51', '$149.12', '$92.19'] },
];

for (const { weight, values } of historicalExample) {
    test(`matches the saved August example at ${weight * 100}% perpetuity weight`, () => {
        const cfPerShare = (2887 - 95) / 413;
        for (const [index, rate] of [8, 10, 12, 15].entries()) {
            const { hybridIV } = model.calculateHybridIV(cfPerShare, 0.05, -0.02, rate / 100, 15, weight);
            assert.equal(model.formatIV(hybridIV, cfPerShare), values[index]);
        }
    });
}

test('the 15-year model still works when the perpetuity cannot converge', () => {
    const finiteOnly = model.calculateHybridIV(10, 0.2, 0, 0.1, 15, 0);
    assert.equal(finiteOnly.perpetuityIV, Infinity);
    assert.ok(Number.isFinite(finiteOnly.hybridIV));
    assert.equal(finiteOnly.hybridIV, finiteOnly.finiteIV);

    for (const weight of [0.5, 1]) {
        const { hybridIV } = model.calculateHybridIV(10, 0.2, 0, 0.1, 15, weight);
        assert.equal(model.formatIV(hybridIV, 10), 'N/A (growth ≥ hurdle)');
    }
});

test('nonpositive earnings never display a positive valuation', () => {
    for (const earnings of [0, -10]) {
        const { hybridIV } = model.calculateHybridIV(earnings, 0.05, 0, 0.15, 15, 0);
        assert.equal(model.formatIV(hybridIV, earnings), 'N/A (neg. earnings)');
    }
});

// The page itself rejects a negative rate; see the buyback test below.
test('the per-share discount responds to the dilution rate in both directions', () => {
    const value = dilution => model.calculateHybridIV(10, 0.03, dilution, 0.15, 15, 0.5).hybridIV;
    assert.ok(value(0.02) < value(0));
    assert.ok(value(0) < value(-0.02));
});

test('doubling shares halves per-share value in either model and the blend', () => {
    for (const weight of [0, 0.5, 1]) {
        const original = model.calculateHybridIV(10, 0.03, 0, 0.15, 15, weight);
        const doubledShares = model.calculateHybridIV(5, 0.03, 0, 0.15, 15, weight);
        closeTo(doubledShares.hybridIV, original.hybridIV / 2);
    }
});

test("owners' earnings start from net income and swap reported SBC for its cash cost", () => {
    // With the reported expense as the stand-in cash cost, SBC is charged once.
    assert.equal(model.calculateOwnersEarnings(7787, 799, 799), 7787);
    assert.equal(model.calculateOwnersEarnings(7787, 799, 2000), 6586);
    assert.equal(model.calculateOwnersEarnings(-500, 100, 100), -500);
});

function createLookup(fetch) {
    const elements = new Map();
    const context = vm.createContext({
        fetch, AbortController, URLSearchParams, setTimeout, clearTimeout,
        calculate() {},
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, { value: '', textContent: '', disabled: false, classList: new Set() });
                return elements.get(id);
            },
        },
    });
    const start = script.indexOf('    // Ticker lookup supplies');
    const end = script.indexOf("    document.getElementById('fetch-btn').addEventListener");
    vm.runInContext(script.slice(start, end), context);
    context.document.getElementById('ticker').value = ' aapl ';
    return { context, elements };
}

const reportedFigures = {
    quote: [{ price: 75.84, marketCap: 75.84 * 413000000 }],
    'cash-flow-statement': [{ netIncome: 2673000000, stockBasedCompensation: 95000000, fiscalYear: '2025' }],
    'shares-float': [{ outstandingShares: 413000000 }],
    'balance-sheet-statement': [{ cashAndShortTermInvestments: 900000000, totalDebt: 1200000000 }],
};

function respond(url, overrides = {}) {
    const endpoint = new URL(url).pathname.split('/').pop();
    return { ok: true, json: async () => ({ ...reportedFigures, ...overrides })[endpoint] };
}

test('ticker lookup fills only reported figures and preserves manual assumptions', async () => {
    const requests = [];
    const { context, elements } = createLookup(async url => {
        requests.push(new URL(url));
        return respond(url);
    });
    for (const id of ['growth', 'dilution', 'termMult', 'discount-rate', 'blend-weight']) {
        context.document.getElementById(id).value = '7';
    }
    await context.fetchTickerData();
    assert.equal(elements.get('ticker').value, 'AAPL');
    for (const [id, expected] of Object.entries({ netIncome: 2673, gaapSbc: 95, shares: 413, price: 75.84, netCash: -300 })) {
        assert.equal(Number(elements.get(id).value), expected);
        assert.ok(elements.get(id).classList.has('auto-filled'));
    }
    for (const id of ['growth', 'dilution', 'termMult', 'discount-rate', 'blend-weight']) {
        assert.equal(elements.get(id).value, '7');
    }
    assert.equal(requests.length, 3);
    assert.equal(elements.get('sbc').value, '');
    assert.equal(elements.get('company-figures').open, false);
    assert.equal(elements.get('company-summary').textContent, 'Company figures: AAPL (FY2025)');
    assert.ok(requests.every(url => url.searchParams.get('symbol') === 'AAPL'));
    assert.match(elements.get('fetch-status').textContent, /Loaded AAPL/);
    assert.equal(elements.get('fetch-btn').disabled, false);
});

test('incomplete provider data never partially overwrites a previous company', async () => {
    const { context, elements } = createLookup(async url => respond(url, { quote: [{ price: 75.84 }], 'shares-float': [{ outstandingShares: null }] }));
    for (const id of ['netIncome', 'gaapSbc', 'sbc', 'shares', 'price']) context.document.getElementById(id).value = '123';
    await context.fetchTickerData();
    for (const id of ['netIncome', 'gaapSbc', 'sbc', 'shares', 'price']) assert.equal(elements.get(id).value, '123');
    assert.match(elements.get('fetch-status').textContent, /Incomplete data/);
    assert.equal(elements.get('fetch-btn').disabled, false);
});

test('provider failures leave manual entry available and preserve existing inputs', async () => {
    const { context, elements } = createLookup(async () => ({ ok: false }));
    context.document.getElementById('netIncome').value = '123';
    await context.fetchTickerData();
    assert.equal(elements.get('netIncome').value, '123');
    assert.match(elements.get('fetch-status').textContent, /Ticker lookup failed/);
    assert.equal(elements.get('fetch-btn').disabled, false);
});

test('cancelling a lookup prevents a late response from refilling cleared fields', async () => {
    const pending = [];
    const { context, elements } = createLookup(url => new Promise(resolve => pending.push(() => resolve(respond(url)))));
    const result = context.fetchTickerData();
    context.cancelTickerRequest();
    context.document.getElementById('netIncome').value = '';
    context.document.getElementById('fetch-status').textContent = '';
    for (const resolve of pending) resolve();
    await result;
    assert.equal(elements.get('netIncome').value, '');
    assert.equal(elements.get('fetch-status').textContent, '');
    assert.equal(elements.get('fetch-btn').disabled, false);
});

// Runs the page's calculate() against a minimal stand-in for the form.
function runCalculator(inputs) {
    const elements = new Map();
    const context = vm.createContext({
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, { value: '', innerText: '', className: '', disabled: false });
                return elements.get(id);
            },
        },
    });
    vm.runInContext(script.slice(0, script.indexOf('    // Ticker lookup supplies')), context);
    const defaults = {
        sbcRoute: 'cash', netIncome: '1000', gaapSbc: '100', sbc: '100', shares: '100', growth: '5',
        dilution: '', price: '', 'discount-rate': '15', termMult: '15', 'blend-weight': '0',
    };
    for (const [id, value] of Object.entries({ ...defaults, ...inputs })) context.document.getElementById(id).value = value;
    context.calculate();
    return id => elements.get(id);
}

test('SBC is charged by one route only: the cash-cost route holds the share count flat', () => {
    const cash = model.resolveOwnerCashFlow('cash', 1000, 100, 300, 0.05);
    assert.equal(cash.ownersEarnings, 800);
    assert.equal(cash.dilution, 0);

    const diluted = model.resolveOwnerCashFlow('dilution', 1000, 100, 300, 0.05);
    assert.equal(diluted.ownersEarnings, 1100);
    assert.equal(diluted.dilution, 0.05);
});

test('a dilution rate left in the form does not change the cash-cost route', () => {
    const flat = runCalculator({ sbc: '300' });
    const stale = runCalculator({ sbc: '300', dilution: '4' });
    assert.equal(stale('res-iv').innerText, flat('res-iv').innerText);
    assert.equal(stale('dilution').disabled, true);
    assert.equal(stale('sbc').disabled, false);
});

test('the dilution route ignores the cash cost and lowers value as dilution rises', () => {
    const value = dilution => runCalculator({ sbcRoute: 'dilution', sbc: '9999', dilution })('res-iv').innerText;
    const amount = text => Number(text.replace(/[$,]/g, ''));
    assert.ok(amount(value('0')) > amount(value('2')));
    assert.equal(runCalculator({ sbcRoute: 'dilution', dilution: '0' })('res-oe').innerText, '$1,100 M');
    assert.equal(runCalculator({ sbcRoute: 'dilution', dilution: '0' })('sbc').disabled, true);
});

test('buybacks are never free: a shrinking share count is rejected', () => {
    assert.equal(model.dilutionError('dilution', -0.02), "Dilution cannot be negative: owners' earnings already account for buybacks");
    assert.equal(model.dilutionError('dilution', 0), '');
    assert.equal(model.dilutionError('cash', -0.02), '');
    const result = runCalculator({ sbcRoute: 'dilution', dilution: '-2' });
    assert.equal(result('res-iv').innerText, '—');
    assert.match(result('multiple-badge').innerText, /Dilution cannot be negative/);
});

test("the price is placed against Burry's definitions without a verdict of our own", () => {
    const within = model.describeValuation(150, 15, 100, 220, 140, 100);
    assert.equal(within.badgeText, 'Trading 50% above IV15');
    assert.equal(within.rangeText,
        'Within the IV8 to IV10 intrinsic value range ($140.00 to $220.00). Price is 1.50x IV15; intrinsic value generally sits at 1.5x to 2.25x IV15');
    assert.deepEqual(Object.keys(within), ['badgeText', 'rangeText']);

    assert.equal(model.describeValuation(80, 15, 100, 220, 140, 100).badgeText, 'Trading 20% below IV15');
    assert.match(model.describeValuation(80, 15, 100, 220, 140, 100).rangeText, /^Below the IV8 to IV10/);
    assert.match(model.describeValuation(250, 8, 220, 220, 140, 100).rangeText, /^Above the IV8 to IV10.*Price is 2\.50x IV15/);
    assert.equal(model.describeValuation(NaN, 15, 100, 220, 140, 100).badgeText, 'Enter a stock price to compare');
    assert.equal(model.describeValuation(80, 15, NaN, 220, 140, 100).badgeText, 'Not enough data to compare');
    assert.equal(model.describeValuation(80, 15, -5, 220, 140, -5).badgeText, 'IV15 is negative');
});

test("nothing on the page is a rule Burry did not define", () => {
    assert.doesNotMatch(html, /Conservative Buy Target|0\.8&times;|Fair Value|Standard\)|Premium\)|IV15 \(Fat Pitch\)/);
    assert.doesNotMatch(script, /fat-pitch|expensive|danger|success/);
});

test('the page never labels a hurdle value as fair value', () => {
    const visibleText = html.replace(/<script>[\s\S]*<\/script>/, '').replace(/<style>[\s\S]*<\/style>/, '');
    assert.doesNotMatch(visibleText, /fair[- ]value/i);
    assert.doesNotMatch(script, /fair value/i);
});

test('the full calculation reports the price against IV15 and the intrinsic value range', () => {
    const result = runCalculator({ price: '150' });
    assert.equal(result('res-iv').innerText, '$116.50');
    assert.equal(result('multiple-badge').innerText, 'Trading 29% above IV15');
    assert.match(result('iv-range-note').innerText, /^Below the IV8 to IV10 intrinsic value range/);
});

test('net cash per share is added at every required return and net debt can make IV negative', () => {
    const plain = runCalculator({});
    const withCash = runCalculator({ netCash: '1500' });
    const amount = text => Number(text.replace(/[$,]/g, ''));
    assert.equal(withCash('res-netcash').innerText, '$15.00');
    for (const id of ['res-iv', 'val-iv8', 'val-iv10', 'val-iv12', 'val-iv15']) {
        closeTo(amount(withCash(id).innerText), amount(plain(id).innerText) + 15);
    }
    assert.equal(withCash('blend-breakdown').innerText, 'Perpetuity leg: $120.00 | Year-15 leg: $131.50');

    const indebted = runCalculator({ netCash: '-20000', price: '50' });
    assert.equal(indebted('res-netcash').innerText, '-$200.00');
    assert.equal(indebted('res-iv').innerText, '-$83.50');
    assert.equal(indebted('multiple-badge').innerText, 'IV15 is negative');
});

test('a blank net cash field means no adjustment', () => {
    assert.equal(runCalculator({ netCash: '' })('res-iv').innerText, runCalculator({ netCash: '0' })('res-iv').innerText);
    assert.equal(model.formatIV(100, 10), '$100.00');
    assert.equal(model.formatIV(100, 10, -130), '-$30.00');
});

test('share count falls back to the float endpoint when the quote has no market value', async () => {
    const requests = [];
    const { context, elements } = createLookup(async url => {
        requests.push(new URL(url).pathname.split('/').pop());
        return respond(url, { quote: [{ price: 75.84 }] });
    });
    await context.fetchTickerData();
    assert.deepEqual(requests, ['quote', 'cash-flow-statement', 'balance-sheet-statement', 'shares-float']);
    assert.equal(Number(elements.get('shares').value), 413);
});

test('an exhausted shared key tells the visitor to add their own', async () => {
    for (const reply of [
        { ok: false, status: 429 },
        { ok: true, json: async () => ({ 'Error Message': 'Limit Reach . Please upgrade your plan' }) },
    ]) {
        const { context, elements } = createLookup(async () => reply);
        context.document.getElementById('netIncome').value = '123';
        await context.fetchTickerData();
        assert.match(elements.get('fetch-status').textContent, /shared lookup key has reached its daily limit.*Add your own data key/);
        assert.equal(elements.get('netIncome').value, '123');
        assert.equal(elements.get('fetch-btn').disabled, false);
    }
});

test("a visitor's own key replaces the shared one and gets its own error wording", async () => {
    const keys = [];
    const { context, elements } = createLookup(async url => {
        keys.push(new URL(url).searchParams.get('apikey'));
        return { ok: false, status: 401 };
    });
    context.document.getElementById('api-key').value = ' my-key ';
    await context.fetchTickerData();
    assert.deepEqual([...new Set(keys)], ['my-key']);
    assert.match(elements.get('fetch-status').textContent, /Your data key was rejected/);
});

test('repeating a lookup reuses the earlier answer without new requests', async () => {
    let calls = 0;
    const { context, elements } = createLookup(async url => { calls++; return respond(url); });
    await context.fetchTickerData();
    elements.get('netIncome').value = '';
    await context.fetchTickerData();
    assert.equal(calls, 3);
    assert.equal(Number(elements.get('netIncome').value), 2673);
    assert.equal(elements.get('fetch-btn').disabled, false);
});

test('a missing balance sheet still loads the company and leaves net cash to the visitor', async () => {
    const { context, elements } = createLookup(async url =>
        url.includes('balance-sheet') ? { ok: false, status: 402 } : respond(url));
    context.document.getElementById('netCash').value = '999';
    await context.fetchTickerData();
    assert.equal(Number(elements.get('netIncome').value), 2673);
    assert.equal(elements.get('netCash').value, '');
    assert.match(elements.get('fetch-status').textContent, /Loaded AAPL \(FY2025\)\. Net cash was not available/);
    assert.equal(elements.get('company-figures').open, true);
});

test('Enter, blur and the button firing together send one lookup', async () => {
    let calls = 0;
    const { context } = createLookup(async url => { calls++; return respond(url); });
    await Promise.all([context.fetchTickerData(), context.fetchTickerData(), context.fetchTickerData()]);
    assert.equal(calls, 3);
});

test('a blank cash cost of SBC uses the reported expense', () => {
    const blank = runCalculator({ sbc: '' });
    assert.equal(blank('res-oe').innerText, '$1,000 M');
    assert.equal(blank('res-iv').innerText, runCalculator({ sbc: '100' })('res-iv').innerText);
    assert.equal(blank('sbc-group').hidden, false);
    assert.equal(blank('dilution-group').hidden, true);
    assert.equal(runCalculator({ sbcRoute: 'dilution', dilution: '1' })('sbc-group').hidden, true);
});

test('source links point at the page for the ticker in the form', () => {
    assert.equal(model.sourceUrl('netIncome', ' aapl '), 'https://stockanalysis.com/stocks/aapl/financials/');
    assert.equal(model.sourceUrl('gaapSbc', 'AAPL'), 'https://stockanalysis.com/stocks/aapl/financials/cash-flow-statement/');
    assert.equal(model.sourceUrl('netCash', 'AAPL'), 'https://stockanalysis.com/stocks/aapl/financials/balance-sheet/');
    assert.equal(model.sourceUrl('price', 'brk.b'), 'https://finance.yahoo.com/quote/BRK-B/');
    assert.equal(model.sourceUrl('shares', 'BRK-B'), 'https://stockanalysis.com/stocks/brk.b/statistics/');
    assert.equal(model.sourceUrl('growth', ''), 'https://stockanalysis.com/');
    assert.equal(model.sourceUrl('price', ''), 'https://finance.yahoo.com/');
    for (const field of html.matchAll(/class="source-link" data-field="(\w+)"/g)) {
        assert.ok(model.sourceUrl(field[1], 'AAPL').startsWith('https://'));
    }
});

test('every hover gives a definition, and every calculated field a formula', () => {
    const tooltips = [...html.matchAll(/<span class="tooltip"[^>]*>(.*?)<\/span><\/span>/g)].map(match => match[1]);
    assert.equal(tooltips.length, 18);
    for (const text of tooltips) {
        const definition = text.split('<code')[0];
        assert.ok(definition.length > 10 && definition.length < 260, definition);
    }
    assert.equal(tooltips.filter(text => text.includes('class="formula"')).length, 12);
});
