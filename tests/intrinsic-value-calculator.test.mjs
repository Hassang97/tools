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
    { weight: 0, values: ['$185.18', '$151.02', '$124.58', '$95.37'], buyTarget: '$76.30' },
    { weight: 0.5, values: ['$515.11', '$202.26', '$136.85', '$93.78'], buyTarget: '$75.02' },
    { weight: 1, values: ['$845.04', '$253.51', '$149.12', '$92.19'], buyTarget: '$73.75' },
];

for (const { weight, values, buyTarget } of historicalExample) {
    test(`matches the saved August example at ${weight * 100}% perpetuity weight`, () => {
        const cfPerShare = (2887 - 95) / 413;
        for (const [index, rate] of [8, 10, 12, 15].entries()) {
            const { hybridIV } = model.calculateHybridIV(cfPerShare, 0.05, -0.02, rate / 100, 15, weight);
            assert.equal(model.formatIV(hybridIV, cfPerShare), values[index]);
            if (rate === 15) {
                assert.equal(model.formatIV(hybridIV * 0.8, cfPerShare), buyTarget);
            }
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

test('dilution reduces value and buybacks increase it for the same earnings', () => {
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
    quote: [{ price: 75.84 }],
    'cash-flow-statement': [{ netCashProvidedByOperatingActivities: 2887000000, stockBasedCompensation: 95000000, fiscalYear: '2025' }],
    'shares-float': [{ outstandingShares: 413000000 }],
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
    for (const [id, expected] of Object.entries({ ocf: 2887, sbc: 95, shares: 413, price: 75.84 })) {
        assert.equal(Number(elements.get(id).value), expected);
        assert.ok(elements.get(id).classList.has('auto-filled'));
    }
    for (const id of ['growth', 'dilution', 'termMult', 'discount-rate', 'blend-weight']) {
        assert.equal(elements.get(id).value, '7');
    }
    assert.equal(requests.length, 3);
    assert.ok(requests.every(url => url.searchParams.get('symbol') === 'AAPL'));
    assert.match(elements.get('fetch-status').textContent, /Loaded AAPL/);
    assert.equal(elements.get('fetch-btn').disabled, false);
});

test('incomplete provider data never partially overwrites a previous company', async () => {
    const { context, elements } = createLookup(async url => respond(url, { 'shares-float': [{ outstandingShares: null }] }));
    for (const id of ['ocf', 'sbc', 'shares', 'price']) context.document.getElementById(id).value = '123';
    await context.fetchTickerData();
    for (const id of ['ocf', 'sbc', 'shares', 'price']) assert.equal(elements.get(id).value, '123');
    assert.match(elements.get('fetch-status').textContent, /Incomplete data/);
    assert.equal(elements.get('fetch-btn').disabled, false);
});

test('provider failures leave manual entry available and preserve existing inputs', async () => {
    const { context, elements } = createLookup(async () => ({ ok: false }));
    context.document.getElementById('ocf').value = '123';
    await context.fetchTickerData();
    assert.equal(elements.get('ocf').value, '123');
    assert.match(elements.get('fetch-status').textContent, /Ticker lookup failed/);
    assert.equal(elements.get('fetch-btn').disabled, false);
});

test('cancelling a lookup prevents a late response from refilling cleared fields', async () => {
    const pending = [];
    const { context, elements } = createLookup(url => new Promise(resolve => pending.push(() => resolve(respond(url)))));
    const result = context.fetchTickerData();
    context.cancelTickerRequest();
    context.document.getElementById('ocf').value = '';
    context.document.getElementById('fetch-status').textContent = '';
    for (const resolve of pending) resolve();
    await result;
    assert.equal(elements.get('ocf').value, '');
    assert.equal(elements.get('fetch-status').textContent, '');
    assert.equal(elements.get('fetch-btn').disabled, false);
});
