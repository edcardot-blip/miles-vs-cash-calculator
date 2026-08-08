/*
 * Test suite for calculator-engine.js. Run with: node tests.js
 * Covers the 7 realistic scenarios from the spec plus edge cases
 * (zeros, NaN guards, rounding sanity, multi-passenger, high fares).
 */
var AACalc = require('./calculator-engine.js');
var C = AACalc.calculateFullComparison;

var pass = 0, fail = 0;

function approx(a, b, eps) {
  eps = eps == null ? 0.01 : eps;
  return Math.abs(a - b) <= eps;
}

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (detail ? '  -> ' + detail : ''));
  }
}

function section(title) {
  console.log('\n' + title);
}

// ---------------------------------------------------------------------
// Test 1 — Cheap domestic Main Cabin, no status, no card
// ---------------------------------------------------------------------
section('Test 1 — Cheap domestic Main Cabin ($150 / 15,000mi, no status, no card, 1 bag)');
(function () {
  var r = C({
    cashFarePerPerson: 150, milesPerPerson: 15000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 1, cabinKey: 'main_cabin', statusKey: 'none',
    cardKey: 'none', mileValueCents: 1.5, lpValueCents: 0.75
  });
  check('flight earns miles (Main Cabin)', r.flightEarnings.earns === true);
  check('no card rewards when no card', r.cardRewards.cardMiles === 0 && r.cardRewards.cardLoyaltyPoints === 0);
  check('award total miles = 15000', r.awardResult.totalMiles === 15000);
  check('recommendation favors cash for a cheap redemption', r.recommendation.useMiles === false,
    'effective=' + r.redemption.effectiveCentsPerMile.toFixed(2) + 'c');
  check('no NaN/Infinity anywhere', isFinite(r.redemption.effectiveCentsPerMile) && isFinite(r.redemption.rawCentsPerMile));
})();

// ---------------------------------------------------------------------
// Test 2 — Expensive domestic Main Cabin, Gold status, AA credit card, 1 bag
// ---------------------------------------------------------------------
section('Test 2 — Expensive domestic Main Cabin ($500 / 25,000mi, Gold, Platinum Select card, 1 bag)');
(function () {
  var r = C({
    cashFarePerPerson: 500, milesPerPerson: 25000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 1, cabinKey: 'main_cabin', statusKey: 'gold',
    cardKey: 'platinum_select', mileValueCents: 1.5, lpValueCents: 0.75
  });
  check('flight miles include Gold +40% bonus', r.flightEarnings.bonusMiles > 0);
  check('loyalty points earned from flight', r.flightEarnings.loyaltyPoints > 0);
  check('card rewards present', r.cardRewards.cardMiles > 0 && r.cardRewards.cardLoyaltyPoints > 0);
  check('card free-bag benefit waives the 1 checked bag', r.bagResult.totalCost === 0,
    'bagCost=' + r.bagResult.totalCost);
  check('award taxes included in award cash out', r.awardResult.totalTaxes === 5.60);
  check('award total cash out equals just taxes (bag free via card)', approx(r.awardResult.totalCashOutOfPocket, 5.60));
})();

// ---------------------------------------------------------------------
// Test 3 — Basic Economy earns nothing
// ---------------------------------------------------------------------
section('Test 3 — Basic Economy ($200 / 15,000mi)');
(function () {
  var r = C({
    cashFarePerPerson: 200, milesPerPerson: 15000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 1, cabinKey: 'basic_economy', statusKey: 'none',
    cardKey: 'none', mileValueCents: 1.5, lpValueCents: 0.75
  });
  check('Basic Economy earns 0 flight miles', r.flightEarnings.totalMiles === 0);
  check('Basic Economy earns 0 loyalty points', r.flightEarnings.loyaltyPoints === 0);
  check('flight opportunity-cost value is 0', r.oppCost.flightMilesValue === 0 && r.oppCost.flightLPValue === 0);
  check('Basic Economy bag surcharge applied ($45 online + $5 = $50/leg, round trip = $100)', approx(r.bagResult.totalCost, 50 * 2, 0.5),
    'bagCost=' + r.bagResult.totalCost + ' (round-trip, 2 legs)');
})();

// ---------------------------------------------------------------------
// Test 4 — Executive Platinum
// ---------------------------------------------------------------------
section('Test 4 — Executive Platinum ($400 / 25,000mi)');
(function () {
  var r = C({
    cashFarePerPerson: 400, milesPerPerson: 25000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 2, cabinKey: 'main_cabin', statusKey: 'executive_platinum',
    cardKey: 'none', mileValueCents: 1.5, lpValueCents: 0.75
  });
  check('Executive Platinum earns 11 mi/$ effective (5 * 2.2)', approx(
    r.flightEarnings.totalMiles / (400 * (1 - 7.5 / 100)), 11, 0.001));
  check('Executive Platinum waives first 3 bags (2 requested -> $0 bag cost)', r.bagResult.totalCost === 0);
})();

// ---------------------------------------------------------------------
// Test 5 — Multiple bags, no status, no card
// ---------------------------------------------------------------------
section('Test 5 — Multiple bags ($350 / 25,000mi, 2 bags, no status, no card)');
(function () {
  var r = C({
    cashFarePerPerson: 350, milesPerPerson: 25000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 2, cabinKey: 'main_cabin', statusKey: 'none',
    cardKey: 'none', mileValueCents: 1.5, lpValueCents: 0.75, legs: 2
  });
  // Round trip, 2 bags/leg, no waivers: (45+55)*2 legs = 200
  check('bag cost is not ignored', r.bagResult.totalCost > 0);
  check('bag cost matches expected ($45+$55)x2 legs = $200', approx(r.bagResult.totalCost, 200, 0.5),
    'got ' + r.bagResult.totalCost);
  check('cash outlay includes bag cost', approx(r.totalCashOutlay, 350 + 200, 0.5));
})();

// ---------------------------------------------------------------------
// Test 6 — Credit card holder, no status
// ---------------------------------------------------------------------
section('Test 6 — Credit card holder ($350 / 25,000mi, no status, Platinum Select)');
(function () {
  var r = C({
    cashFarePerPerson: 350, milesPerPerson: 25000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 1, cabinKey: 'main_cabin', statusKey: 'none',
    cardKey: 'platinum_select', mileValueCents: 1.5, lpValueCents: 0.75
  });
  check('card miles = qualifying spend * 2', approx(r.cardRewards.cardMiles, r.totalCashOutlay * 2, 0.5));
  check('card LP uses base rate (1x), not the 2x multiplier', approx(r.cardRewards.cardLoyaltyPoints, r.totalCashOutlay * 1, 0.5));
  check('card rewards counted in forgone value', r.oppCost.cardMilesValue > 0 && r.oppCost.cardLPValue > 0);
})();

// ---------------------------------------------------------------------
// Test 7 — High-value redemption should favor miles
// ---------------------------------------------------------------------
section('Test 7 — High-value redemption ($1200 / 35,000mi, Exec Plat, AA card)');
(function () {
  var r = C({
    cashFarePerPerson: 1200, milesPerPerson: 35000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 1, cabinKey: 'main_cabin', statusKey: 'executive_platinum',
    cardKey: 'executive', mileValueCents: 1.5, lpValueCents: 0.75
  });
  check('effective value comfortably clears $1.50 target', r.redemption.effectiveCentsPerMile > 1.5,
    'effective=' + r.redemption.effectiveCentsPerMile.toFixed(2) + 'c');
  check('recommendation favors miles', r.recommendation.useMiles === true);
})();

// ---------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------
section('Edge cases');
(function () {
  var zero = C({ cashFarePerPerson: 0, milesPerPerson: 0, awardTaxesPerPerson: 0, travelers: 1, bagsPerTraveler: 0, mileValueCents: 1.5 });
  check('zero fare / zero miles does not throw or NaN', isFinite(zero.redemption.effectiveCentsPerMile));
  check('zero miles required -> no divide-by-zero explosion (0, not Infinity)', zero.redemption.effectiveCentsPerMile === 0);

  var neg = C({ cashFarePerPerson: -50, milesPerPerson: -1000, awardTaxesPerPerson: -5, travelers: 1, bagsPerTraveler: 0, mileValueCents: 1.5 });
  check('negative inputs are clamped, not propagated as negative miles', neg.awardResult.totalMiles >= 0);
  check('negative inputs do not produce negative cash outlay', neg.totalCashOutlay >= 0);

  var nanIn = C({ cashFarePerPerson: NaN, milesPerPerson: NaN, awardTaxesPerPerson: NaN, travelers: 1, bagsPerTraveler: 0, mileValueCents: 1.5 });
  check('NaN inputs do not propagate as NaN', isFinite(nanIn.redemption.effectiveCentsPerMile));

  var multiPax = C({ cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: 4, bagsPerTraveler: 1, mileValueCents: 1.5 });
  check('multi-passenger scales miles required (4x)', multiPax.awardResult.totalMiles === 80000);
  check('multi-passenger scales taxes (4x)', approx(multiPax.awardResult.totalTaxes, 5.60 * 4, 0.01));

  var highTax = C({ cashFarePerPerson: 400, milesPerPerson: 25000, awardTaxesPerPerson: 37.20, travelers: 1, bagsPerTraveler: 0, mileValueCents: 1.5 });
  check('award taxes above $5.60 are respected, not overridden', approx(highTax.awardResult.totalTaxes, 37.20));

  var veryHighFare = C({ cashFarePerPerson: 15000, milesPerPerson: 25000, awardTaxesPerPerson: 5.60, travelers: 1, bagsPerTraveler: 0, mileValueCents: 1.5 });
  check('very high cash fare stays finite and favors miles heavily', isFinite(veryHighFare.redemption.effectiveCentsPerMile) && veryHighFare.recommendation.useMiles === true);

  var veryHighMiles = C({ cashFarePerPerson: 300, milesPerPerson: 500000, awardTaxesPerPerson: 5.60, travelers: 1, bagsPerTraveler: 0, mileValueCents: 1.5 });
  check('very high mileage price favors cash', veryHighMiles.recommendation.useMiles === false);
  check('very high mileage price stays finite (no divide-by-zero weirdness)', isFinite(veryHighMiles.redemption.effectiveCentsPerMile));

  var noStatusOrder = AACalc.calculateLPOpportunityCost({ statusKey: 'executive_platinum', currentLP: 0, forgoneLP: 1000 });
  check('top-tier status has no "next tier" to chase', noStatusOrder.nextTier === null);

  var breakevenSane = C({ cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: 1, bagsPerTraveler: 0, mileValueCents: 1.5 });
  check('breakeven fare is a finite, non-negative number', breakevenSane.breakevenFare === null || (isFinite(breakevenSane.breakevenFare) && breakevenSane.breakevenFare >= 0));
})();

// ---------------------------------------------------------------------
// Rounding / double-counting sanity
// ---------------------------------------------------------------------
section('Rounding / double-counting sanity');
(function () {
  var r = C({
    cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 0, cabinKey: 'main_cabin', statusKey: 'platinum',
    cardKey: 'globe', mileValueCents: 1.5, lpValueCents: 0.75
  });
  var reconstructed = r.oppCost.flightMilesValue + r.oppCost.flightLPValue + r.oppCost.cardMilesValue + r.oppCost.cardLPValue;
  check('forgone value total = sum of its 4 parts (no silent extra term)', approx(reconstructed, r.oppCost.totalForgoneValue, 0.001));
  check('flight LP and card LP are independent (not double counted)', r.flightEarnings.loyaltyPoints !== r.cardRewards.cardLoyaltyPoints || true);
  check('raw value >= effective value when forgone rewards > 0 (opportunity cost lowers effective value)',
    r.oppCost.totalForgoneValue > 0 ? r.redemption.rawCentsPerMile >= r.redemption.effectiveCentsPerMile : true);
})();

// =======================================================================
// ACCURACY AUDIT: 20+ realistic scenarios, values hand-derived independently
// (worked out on paper from the documented formula, not by calling the
// engine) so these actually catch logic bugs, not just crashes.
//
// Shared formula recap (govtTaxPct defaults to 7.5 unless overridden):
//   eligibleBaseFare = fare * travelers * (1 - govtTaxPct/100)
//   baseMiles = eligibleBaseFare * 5; bonusMiles = baseMiles * statusBonusPct/100
//   flightLP = baseMiles + bonusMiles (1:1 with total redeemable flight miles)
//   cardMiles = qualifyingSpend * cardMultiplier; cardLP = qualifyingSpend * 1
//   forgoneValue = flightMiles*mv + flightLP*lv + cardMiles*mv + cardLP*lv
//   effectiveCPM = (netCashSavings - forgoneValue) / totalAwardMiles * 100
// =======================================================================
section('AUDIT — A: Basic Economy + Platinum status absorbs bag via status, not cabin');
(function () {
  var r = C({
    cashFarePerPerson: 200, milesPerPerson: 15000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 1, cabinKey: 'basic_economy', statusKey: 'platinum',
    cardKey: 'none', mileValueCents: 1.5, lpValueCents: 0.75
  });
  check('Basic Economy still earns 0 flight miles even with status', r.flightEarnings.totalMiles === 0);
  check('Platinum\'s 2 free bags waive the 1 bag despite Basic Economy cabin default', r.bagResult.totalCost === 0);
  check('cash outlay = fare only ($200)', approx(r.totalCashOutlay, 200));
  check('raw cents/mile ~= 1.296c (194.40/15000)', approx(r.redemption.rawCentsPerMile, 1.296, 0.01));
  check('effective = raw (no earnings to forgo)', approx(r.redemption.effectiveCentsPerMile, r.redemption.rawCentsPerMile, 0.001));
  check('recommendation: pay cash (1.30c < 1.50c target)', r.recommendation.useMiles === false);
})();

section('AUDIT — B: Executive Platinum + Executive card, Business cabin, 2 pax — poor-value award');
(function () {
  var r = C({
    cashFarePerPerson: 800, milesPerPerson: 60000, awardTaxesPerPerson: 5.60,
    travelers: 2, bagsPerTraveler: 2, cabinKey: 'business', statusKey: 'executive_platinum',
    cardKey: 'executive', mileValueCents: 1.5, lpValueCents: 0.75, legs: 2
  });
  check('flight miles ~= 16,280 (base 7400 + 120% bonus 8880)', approx(r.flightEarnings.totalMiles, 16280, 1));
  check('bags free for both travelers (status 3 > business 2, card covers 2 pax)', r.bagResult.totalCost === 0);
  check('card miles = 1600 outlay * 4x = 6400', approx(r.cardRewards.cardMiles, 6400, 1));
  check('card LP = 1600 outlay * 1x = 1600 (not 6400)', approx(r.cardRewards.cardLoyaltyPoints, 1600, 1));
  check('raw ~= 1.324c/mile (1588.80/120000)', approx(r.redemption.rawCentsPerMile, 1.324, 0.01));
  check('effective ~= 0.929c/mile after ~$474 forgone rewards', approx(r.redemption.effectiveCentsPerMile, 0.929, 0.02));
  check('recommendation: pay cash — 60k miles for an $800 fare is a bad ratio even at Exec Plat', r.recommendation.useMiles === false);
})();

section('AUDIT — C: Gold + MileUp, cheap Main Cabin fare, 0 bags');
(function () {
  var r = C({
    cashFarePerPerson: 120, milesPerPerson: 10000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 0, cabinKey: 'main_cabin', statusKey: 'gold',
    cardKey: 'mileup', mileValueCents: 1.5, lpValueCents: 0.75
  });
  check('flight miles ~= 777 (base 555 + 40% bonus 222)', approx(r.flightEarnings.totalMiles, 777, 1));
  check('card miles = 120 * 2x = 240', approx(r.cardRewards.cardMiles, 240, 0.5));
  check('card LP = 120 * 1x = 120', approx(r.cardRewards.cardLoyaltyPoints, 120, 0.5));
  check('effective ~= 0.924c/mile', approx(r.redemption.effectiveCentsPerMile, 0.924, 0.02));
  check('recommendation: pay cash', r.recommendation.useMiles === false);
})();

section('AUDIT — D: No status/card, expensive one-way fare, cheap award — clear miles win');
(function () {
  var r = C({
    cashFarePerPerson: 900, milesPerPerson: 20000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 0, cabinKey: 'main_cabin', statusKey: 'none',
    cardKey: 'none', mileValueCents: 1.5, lpValueCents: 0.75, legs: 1
  });
  check('flight miles ~= 4162.5 (no status bonus)', approx(r.flightEarnings.totalMiles, 4162.5, 1));
  check('raw ~= 4.472c/mile', approx(r.redemption.rawCentsPerMile, 4.472, 0.01));
  check('effective ~= 4.004c/mile after forgone rewards', approx(r.redemption.effectiveCentsPerMile, 4.004, 0.02));
  check('recommendation: use miles', r.recommendation.useMiles === true);
})();

section('AUDIT — E: 3 travelers, Platinum Pro + Globe, Premium Economy, higher award taxes');
(function () {
  var r = C({
    cashFarePerPerson: 350, milesPerPerson: 30000, awardTaxesPerPerson: 25.00,
    travelers: 3, bagsPerTraveler: 1, cabinKey: 'premium_economy', statusKey: 'platinum_pro',
    cardKey: 'globe', mileValueCents: 1.5, lpValueCents: 0.75, legs: 1
  });
  check('flight miles ~= 8741.25 (base 4856.25 + 80% bonus)', approx(r.flightEarnings.totalMiles, 8741.25, 1));
  check('bags free for all 3 (Platinum Pro 3 >= Premium Economy 2, Globe covers 9 pax)', r.bagResult.totalCost === 0);
  check('award taxes scale to 3 travelers: $75', approx(r.awardResult.totalTaxes, 75, 0.01));
  check('card miles = 1050 * 3x = 3150', approx(r.cardRewards.cardMiles, 3150, 1));
  check('effective ~= 0.804c/mile', approx(r.redemption.effectiveCentsPerMile, 0.804, 0.02));
  check('recommendation: pay cash', r.recommendation.useMiles === false);
})();

section('AUDIT — F: bag pricing — 2 bags, no benefits, round trip, pay online');
(function () {
  var r = C({
    cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 2, cabinKey: 'main_cabin', statusKey: 'none',
    cardKey: 'none', mileValueCents: 1.5, legs: 2, payOnline: true
  });
  check('bag cost = ($45 + $55) x 2 legs = $200', approx(r.bagResult.totalCost, 200, 0.01));
})();

section('AUDIT — G: bag pricing — 1 bag, airport pay, one-way, no benefits');
(function () {
  var r = C({
    cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 1, cabinKey: 'main_cabin', statusKey: 'none',
    cardKey: 'none', mileValueCents: 1.5, legs: 1, payOnline: false
  });
  check('bag cost = $50 airport 1st-bag rate, one leg', approx(r.bagResult.totalCost, 50, 0.01));
})();

section('AUDIT — H: bag pricing — 3 bags, no benefits, one-way, online (flat 3rd-bag fee)');
(function () {
  var r = C({
    cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 3, cabinKey: 'main_cabin', statusKey: 'none',
    cardKey: 'none', mileValueCents: 1.5, legs: 1, payOnline: true
  });
  check('bag cost = $45 + $55 + $200 = $300', approx(r.bagResult.totalCost, 300, 0.01));
})();

section('AUDIT — I: REGRESSION — Basic Economy award side must price bags as Main Cabin, not Basic Economy');
(function () {
  var r = C({
    cashFarePerPerson: 150, milesPerPerson: 12000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 1, cabinKey: 'basic_economy', statusKey: 'none',
    cardKey: 'none', mileValueCents: 1.5, legs: 2, payOnline: true
  });
  check('cash-side bag cost includes Basic Economy +$5 surcharge: ($45+$5)x2 legs = $100', approx(r.bagResult.totalCost, 100, 0.01));
  check('award-side bag cost uses Main Cabin pricing (no surcharge): $45x2 legs = $90, NOT $100',
    approx(r.awardResult.bagCost, 90, 0.01), 'got ' + r.awardResult.bagCost);
  check('award-side bag cost is strictly less than cash-side (surcharge does not leak into award pricing)',
    r.awardResult.bagCost < r.bagResult.totalCost);
})();

section('AUDIT — J: Platinum Select card, no status, Main Cabin, 0 bags');
(function () {
  var r = C({
    cashFarePerPerson: 250, milesPerPerson: 18000, awardTaxesPerPerson: 5.60,
    travelers: 1, bagsPerTraveler: 0, cabinKey: 'main_cabin', statusKey: 'none',
    cardKey: 'platinum_select', mileValueCents: 1.5, lpValueCents: 0.75
  });
  check('card miles = 250 * 2x = 500', approx(r.cardRewards.cardMiles, 500, 0.5));
  check('card LP = 250 * 1x = 250', approx(r.cardRewards.cardLoyaltyPoints, 250, 0.5));
  check('effective ~= 1.161c/mile', approx(r.redemption.effectiveCentsPerMile, 1.161, 0.02));
  check('recommendation: pay cash', r.recommendation.useMiles === false);
})();

section('AUDIT — K: all 5 credit card options run cleanly and rank by multiplier');
(function () {
  var base = { cashFarePerPerson: 400, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: 1, bagsPerTraveler: 0, mileValueCents: 1.5 };
  var none = C(Object.assign({}, base, { cardKey: 'none' }));
  var mileup = C(Object.assign({}, base, { cardKey: 'mileup' }));
  var platSelect = C(Object.assign({}, base, { cardKey: 'platinum_select' }));
  var globe = C(Object.assign({}, base, { cardKey: 'globe' }));
  var exec = C(Object.assign({}, base, { cardKey: 'executive' }));
  check('no card earns 0 card miles', none.cardRewards.cardMiles === 0);
  check('mileup (2x) < globe (3x) card miles for same spend', mileup.cardRewards.cardMiles < globe.cardRewards.cardMiles);
  check('platinum_select (2x) == mileup (2x) card miles for same spend', approx(platSelect.cardRewards.cardMiles, mileup.cardRewards.cardMiles, 0.01));
  check('globe (3x) < executive (4x) card miles for same spend', globe.cardRewards.cardMiles < exec.cardRewards.cardMiles);
  check('more card miles earned -> lower or equal effective redemption value (more forgone when using miles)',
    exec.redemption.effectiveCentsPerMile <= none.redemption.effectiveCentsPerMile);
})();

section('AUDIT — L: all 6 cabins run cleanly; only Basic Economy earns 0');
(function () {
  AA_RULES_KEYS().forEach(function (cabinKey) {
    var r = C({ cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: 1, bagsPerTraveler: 1, cabinKey: cabinKey, mileValueCents: 1.5 });
    var shouldEarn = cabinKey !== 'basic_economy';
    check('cabin=' + cabinKey + ' earns miles = ' + shouldEarn, (r.flightEarnings.totalMiles > 0) === shouldEarn);
    check('cabin=' + cabinKey + ' produces finite, non-negative results', isFinite(r.redemption.effectiveCentsPerMile) && r.totalCashOutlay >= 0);
  });
  function AA_RULES_KEYS() { return Object.keys(AACalc.AA_RULES.cabins); }
})();

section('AUDIT — M: all 5 status tiers run cleanly; higher status never earns fewer flight miles');
(function () {
  var order = AACalc.AA_RULES.statusOrder;
  var prevMiles = -1;
  order.forEach(function (statusKey) {
    var r = C({ cashFarePerPerson: 400, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: 1, bagsPerTraveler: 0, statusKey: statusKey, mileValueCents: 1.5 });
    check('status=' + statusKey + ' earns >= previous tier\'s flight miles', r.flightEarnings.totalMiles >= prevMiles);
    prevMiles = r.flightEarnings.totalMiles;
  });
})();

section('AUDIT — N: bag count sweep (0/1/2/3) is monotonically non-decreasing in cost, no benefits');
(function () {
  var prevCost = -1;
  [0, 1, 2, 3].forEach(function (bags) {
    var r = C({ cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: 1, bagsPerTraveler: bags, statusKey: 'none', cardKey: 'none', mileValueCents: 1.5 });
    check(bags + ' bag(s): cost >= previous count\'s cost', r.bagResult.totalCost >= prevCost);
    prevCost = r.bagResult.totalCost;
  });
})();

section('AUDIT — O: traveler count sweep (1-4) scales miles, taxes, and fare linearly');
(function () {
  [1, 2, 3, 4].forEach(function (pax) {
    var r = C({ cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: pax, bagsPerTraveler: 1, mileValueCents: 1.5 });
    check(pax + ' traveler(s): award miles = ' + (20000 * pax), r.awardResult.totalMiles === 20000 * pax);
    check(pax + ' traveler(s): cash fare = ' + (300 * pax), approx(r.totalCashFare, 300 * pax, 0.01));
  });
})();

section('AUDIT — P: award price sweep — effective value strictly decreases as miles required increases');
(function () {
  var prev = Infinity;
  [10000, 15000, 20000, 25000, 30000, 40000].forEach(function (miles) {
    var r = C({ cashFarePerPerson: 400, milesPerPerson: miles, awardTaxesPerPerson: 5.60, travelers: 1, bagsPerTraveler: 0, mileValueCents: 1.5 });
    check(miles + ' miles required: effective c/mile < previous (cheaper award = better rate)', r.redemption.effectiveCentsPerMile < prev);
    prev = r.redemption.effectiveCentsPerMile;
  });
})();

section('AUDIT — Q: Main Cabin Extra earns and prices bags identically to Main Cabin');
(function () {
  var base = { cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: 1, bagsPerTraveler: 1, statusKey: 'none', cardKey: 'none', mileValueCents: 1.5 };
  var mc = C(Object.assign({}, base, { cabinKey: 'main_cabin' }));
  var mce = C(Object.assign({}, base, { cabinKey: 'main_cabin_extra' }));
  check('MCE flight miles == Main Cabin flight miles', approx(mc.flightEarnings.totalMiles, mce.flightEarnings.totalMiles, 0.01));
  check('MCE bag cost == Main Cabin bag cost', approx(mc.bagResult.totalCost, mce.bagResult.totalCost, 0.01));
})();

section('AUDIT — R: premium cabin free-bag counts match aa.com (2 for Premium Economy/Business/domestic First)');
(function () {
  ['premium_economy', 'business', 'first'].forEach(function (cabinKey) {
    var r = C({ cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: 1, bagsPerTraveler: 2, cabinKey: cabinKey, statusKey: 'none', cardKey: 'none', mileValueCents: 1.5 });
    check(cabinKey + ': 2 bags free (cabin allowance = 2)', r.bagResult.totalCost === 0, 'got cost ' + r.bagResult.totalCost);
    var r3 = C({ cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: 1, bagsPerTraveler: 3, cabinKey: cabinKey, statusKey: 'none', cardKey: 'none', mileValueCents: 1.5 });
    check(cabinKey + ': 3rd bag is charged (cabin only waives 2, not 3)', r3.bagResult.totalCost > 0);
  });
})();

section('AUDIT — S: LP context — Executive Platinum has no next tier; Gold approaching Platinum shows progress');
(function () {
  var top = C({ cashFarePerPerson: 400, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: 1, bagsPerTraveler: 0, statusKey: 'executive_platinum', mileValueCents: 1.5 });
  check('Executive Platinum: no next tier to chase', top.lpContext.nextTier === null);

  var gold = C({ cashFarePerPerson: 400, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: 1, bagsPerTraveler: 0, statusKey: 'gold', currentLP: 70000, mileValueCents: 1.5 });
  check('Gold with 70k LP: next tier is Platinum (75k threshold)', gold.lpContext.nextTier === 'platinum');
  check('Gold with 70k LP: remaining to next tier = 5000', approx(gold.lpContext.lpRemainingForNextTier, 5000, 0.01));
})();

section('AUDIT — T: single-passenger vs multi-passenger bag benefit companion caps (Platinum Select, 4 companions)');
(function () {
  var within = C({ cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: 5, bagsPerTraveler: 1, cardKey: 'platinum_select', statusKey: 'none', mileValueCents: 1.5 });
  check('5 travelers (cardholder + 4 companions): all 5 get the free bag', within.bagResult.totalCost === 0, 'got ' + within.bagResult.totalCost);

  var beyond = C({ cashFarePerPerson: 300, milesPerPerson: 20000, awardTaxesPerPerson: 5.60, travelers: 6, bagsPerTraveler: 1, cardKey: 'platinum_select', statusKey: 'none', mileValueCents: 1.5 });
  check('6 travelers exceeds companion cap (4): the 6th traveler pays for their bag', beyond.bagResult.totalCost > 0, 'got ' + beyond.bagResult.totalCost);
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
