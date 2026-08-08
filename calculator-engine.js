/*
 * American Airlines / AAdvantage — Cash vs. Miles calculation engine.
 *
 * Pure functions + a config object. No DOM access here, so this file can be
 * loaded as a <script> in the browser (exposes `window.AACalc`) or required
 * from Node for testing (exposes `module.exports`).
 *
 * Rules last verified: 2026-08-08. See AA_RULES.meta.sources for citations.
 * Architecture note: every rules lookup goes through AA_RULES so the engine
 * can be extended to other airlines/programs later without touching the math.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  } else {
    root.AACalc = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // 1. CONFIG — every AA/AAdvantage rule lives here. Nothing below this
  //    block should contain a hardcoded AA-specific number.
  // ---------------------------------------------------------------------

  var AA_RULES = {
    airline: 'AA',
    meta: {
      lastVerified: '2026-08-08',
      notes: 'Figures below were verified directly against live aa.com and ' +
        'creditcards.aa.com pages (fetched in-browser, not just search summaries) ' +
        'during an accuracy audit on 2026-08-08. Every number in this config was ' +
        'either matched to an exact aa.com statement or, where aa.com does not ' +
        'publish an exact figure (e.g. the government-tax share of a fare), left ' +
        'as an explicitly-labeled, user-adjustable estimate — see assumedGovtTaxPctOfFare.',
      sources: [
        'aa.com/i18n/aadvantage-program/aadvantage-terms-and-conditions.html (Effective March 1, 2026, updated Jan 13, 2026) — Base Miles vs. Bonus Miles definitions, LP eligibility rules, flight earning formula',
        'aa.com/web/i18n/aadvantage-program/discover/loyalty-points-status.html — confirms 5 base mi/$, 40/60/80/120% status bonuses apply to both miles AND Loyalty Points, 1:1 mile-to-LP ratio',
        'aa.com/web/i18n/aadvantage-program/earn-miles/american-airlines-flights.html — status bonus percentages',
        'aa.com/i18n/travel-info/experience/seats/basic-economy.html — verbatim: "AAdvantage miles earn based on ticket price (base fare plus carrier-imposed fees; excludes government-imposed taxes and fees)"; Basic Economy $0 miles/LP for tickets bought on/after Dec 17, 2025 12:00am CT; loses complimentary seat selection for elites on tickets bought on/after May 18, 2026',
        'aa.com/i18n/travel-info/baggage/checked-baggage-policy.html — confirms $45/$50 (1st bag online/airport), $55/$60 (2nd bag online/airport), +$5 Basic Economy surcharge, per-person-per-direction; confirms free-bag counts: Gold 1, Platinum 2, Platinum Pro/Exec Platinum 3, Premium Economy 2, domestic Business 2, domestic First 2 (Flagship First/Business Plus international products get 3, not modeled), credit cardholders 1',
        'creditcards.aa.com — MileUp (2x AA purchases, $0 fee, no bag benefit), Platinum Select (2x, $99 fee, 1 free bag + 4 companions), Globe (3x, $350 fee, 1 free bag + 8 companions), Executive (4x, $595 fee rising to $695 on 8/23/2026, 1 free bag + 8 companions) — all confirmed verbatim on each card\'s live page',
        'aa.com — AAdvantage credit card terms and conditions (updated March 1, 2024, still current) — verbatim: "Eligible AAdvantage miles include the base miles earned on purchases, and do not include any bonus miles or accelerators" — confirms card Loyalty Points accrue at the base 1x rate only, not the category multiplier',
        'aa.com/web/i18n/aadvantage-program/use-miles/american-airlines-flights.html — award taxes/fees start around $5.60/person; varies by itinerary, always user-editable in this calculator'
      ]
    },

    // How AAdvantage miles + Loyalty Points are earned on AA-marketed/operated
    // flights. Revenue-based: earned on the ticket's base fare, not distance.
    // (Distance-based earning applies to *partner*-operated flights; that path
    // is stubbed below for future work, not implemented in v1.)
    earning: {
      baseMilesPerDollar: 5,      // base AAdvantage miles per $1 of base fare
      lpPerRedeemableMile: 1,     // Loyalty Points per redeemable mile earned on a flight
                                   // (includes the elite status bonus — elite bonus miles
                                   // are NOT "promotional" miles, so they DO count toward LP;
                                   // this differs from sign-up/promo bonuses, which don't)
      assumedGovtTaxPctOfFare: 7.5, // rough estimate of the government-tax portion of a
                                   // domestic fare that AA excludes from mileage earning
                                   // (adjustable in Advanced mode; not an official AA figure)
      partnerFlights: {
        supported: false,
        note: 'Partner-operated (oneworld, etc.) flights earn miles based on distance ' +
          'and the partner’s own fare-class earning chart, not this revenue-based model. ' +
          'Not yet implemented — v1 covers AA-marketed/operated flights only.'
      }
    },

    // Fare/cabin distinctions that matter for this calculator: whether the
    // fare earns AAdvantage miles/LPs at all, and how many checked bags come
    // free with the cabin itself (separate from status- or card-based bags).
    cabins: {
      basic_economy: {
        label: 'Basic Economy',
        group: 'economy',
        earnsMiles: false,
        freeCheckedBags: 0,
        bagSurchargePerBag: 5, // added to 1st/2nd bag fee vs. Main Cabin
        notes: [
          'Tickets purchased on or after Dec 17, 2025 earn $0 AAdvantage miles and $0 Loyalty Points.',
          'Since May 18, 2026, elite members also lose complimentary seat selection and upgrade eligibility on Basic Economy.',
          'No free changes or cancellations; boards in the last group.'
        ]
      },
      main_cabin: {
        label: 'Main Cabin',
        group: 'economy',
        earnsMiles: true,
        freeCheckedBags: 0,
        bagSurchargePerBag: 0,
        notes: []
      },
      main_cabin_extra: {
        label: 'Main Cabin Extra',
        group: 'economy',
        earnsMiles: true,
        freeCheckedBags: 0,
        bagSurchargePerBag: 0,
        notes: ['Extra legroom / boarding perks — earning and bag pricing match Main Cabin.']
      },
      premium_economy: {
        label: 'Premium Economy',
        group: 'premium',
        earnsMiles: true,
        freeCheckedBags: 2,
        bagSurchargePerBag: 0,
        notes: ['Confirmed on aa.com checked-bag policy: "Confirmed Premium Economy customers" get the first 2 checked bags free.']
      },
      business: {
        label: 'Business',
        group: 'premium',
        earnsMiles: true,
        freeCheckedBags: 2,
        bagSurchargePerBag: 0,
        notes: ['Confirmed on aa.com checked-bag policy: "Confirmed Business customers" get the first 2 checked bags free (domestic Business — not the international Flagship® Business Plus product, which gets 3).']
      },
      first: {
        label: 'First',
        group: 'premium',
        earnsMiles: true,
        freeCheckedBags: 2,
        bagSurchargePerBag: 0,
        notes: ['Confirmed on aa.com checked-bag policy: "Confirmed Domestic First customers" get the first 2 checked bags free (domestic First — not the international Flagship® First product, which gets 3). This calculator is domestic-scoped, so Flagship First isn\'t represented separately.']
      }
    },
    cabinOrder: ['basic_economy', 'main_cabin', 'main_cabin_extra', 'premium_economy', 'business', 'first'],

    // AAdvantage elite tiers. bonusPct is added on top of the 5 mi/$ base
    // rate (e.g. Gold = 5 * 1.40 = 7 mi/$). lpThreshold = Loyalty Points
    // needed in the program year (Mar 1 – last day of Feb) to earn that tier.
    status: {
      none: { label: 'AAdvantage Member (no status)', bonusPct: 0, lpThreshold: 0, freeCheckedBags: 0 },
      gold: { label: 'Gold', bonusPct: 40, lpThreshold: 40000, freeCheckedBags: 1 },
      platinum: { label: 'Platinum', bonusPct: 60, lpThreshold: 75000, freeCheckedBags: 2 },
      platinum_pro: { label: 'Platinum Pro', bonusPct: 80, lpThreshold: 125000, freeCheckedBags: 3 },
      executive_platinum: { label: 'Executive Platinum', bonusPct: 120, lpThreshold: 200000, freeCheckedBags: 3 }
    },
    statusOrder: ['none', 'gold', 'platinum', 'platinum_pro', 'executive_platinum'],

    // Consumer AAdvantage credit cards currently issued (Citi only — Barclays
    // Aviator Red closed to new applicants and existing cardholders were
    // converted to Citi cards in April 2026, so it isn't offered as a live
    // option here).
    creditCards: {
      none: { label: 'No AAdvantage credit card', earnMultiplierAA: 0, annualFee: 0, freeCheckedBags: 0, companionBags: 0, lpBaseRate: 0 },
      mileup: { label: 'AAdvantage MileUp ($0 annual fee)', earnMultiplierAA: 2, annualFee: 0, freeCheckedBags: 0, companionBags: 0, lpBaseRate: 1,
        notes: ['No checked-bag benefit on this card.'] },
      platinum_select: { label: 'AAdvantage Platinum Select', earnMultiplierAA: 2, annualFee: 99, freeCheckedBags: 1, companionBags: 4, lpBaseRate: 1,
        notes: ['First checked bag free for cardholder + up to 4 companions on the same reservation, domestic itineraries.'] },
      globe: { label: 'AAdvantage Globe', earnMultiplierAA: 3, annualFee: 350, freeCheckedBags: 1, companionBags: 8, lpBaseRate: 1,
        notes: ['First checked bag free for cardholder + up to 8 companions on the same reservation, domestic itineraries.'] },
      executive: { label: 'AAdvantage Executive', earnMultiplierAA: 4, annualFee: 595, freeCheckedBags: 1, companionBags: 8, lpBaseRate: 1,
        notes: ['First checked bag free for cardholder + up to 8 companions. Annual fee rises to $695 for cards opened on/after Aug 23, 2026.'] }
    },
    // Loyalty Points from card spend only count at the card's BASE rate (1
    // point per $1), not the accelerated category multiplier — confirmed on
    // aa.com/creditcards.aa.com card pages and Citi's own miles-vs-LP page.
    // Sign-up bonuses and other promotional miles never count toward LP.

    // Domestic checked-bag pricing (tickets purchased on/after May 18, 2026).
    // Scope: US, Puerto Rico, USVI, Canada, Caribbean (ex. Cuba/Haiti),
    // Mexico, Central America (ex. Panama), Guyana. International regions
    // are not modeled in v1 — the engine is structured so a `region` key
    // can be added later without changing the calling code.
    baggage: {
      region: 'domestic_us',
      mainCabin: { first: { online: 45, airport: 50 }, second: { online: 55, airport: 60 } },
      thirdAndBeyondFlat: 200,
      regions: {
        // future: 'international_atlantic', 'international_pacific', etc.
      }
    },

    // Award taxes/carrier-imposed fees. American states domestic awards start
    // around $5.60/person — that floor is largely a government-set security/
    // segment fee, not something AA controls, and international/partner
    // awards (especially British Airways/Iberia) can run far higher due to
    // foreign taxes and partner fuel surcharges.
    awardFees: {
      domesticFloorPerPerson: 5.60,
      note: 'Enter the actual taxes/fees shown at checkout for your itinerary — ' +
        '$5.60 is only the typical U.S. domestic floor, not a guarantee.'
    }
  };

  // ---------------------------------------------------------------------
  // 2. HELPERS
  // ---------------------------------------------------------------------

  function n(x, fallback) {
    var v = Number(x);
    return Number.isFinite(v) ? v : (fallback || 0);
  }
  function clampNonNeg(x) { return Math.max(0, x); }

  // ---------------------------------------------------------------------
  // 3. CALCULATION ENGINE
  // ---------------------------------------------------------------------

  /**
   * Miles + Loyalty Points earned by paying cash for the flight(s).
   * @param {number} totalBaseFare - combined base fare for all travelers,
   *   already excluding the government-tax portion (see assumedGovtTaxPctOfFare).
   * @param {string} cabinKey - key into AA_RULES.cabins
   * @param {string} statusKey - key into AA_RULES.status
   */
  function calculateAAFlightEarnings(totalBaseFare, cabinKey, statusKey) {
    var cabin = AA_RULES.cabins[cabinKey] || AA_RULES.cabins.main_cabin;
    var status = AA_RULES.status[statusKey] || AA_RULES.status.none;
    var fare = clampNonNeg(n(totalBaseFare));

    if (!cabin.earnsMiles) {
      return { baseMiles: 0, bonusMiles: 0, totalMiles: 0, loyaltyPoints: 0, earns: false };
    }
    var baseMiles = fare * AA_RULES.earning.baseMilesPerDollar;
    var bonusMiles = baseMiles * (status.bonusPct / 100);
    var totalMiles = baseMiles + bonusMiles;
    var loyaltyPoints = totalMiles * AA_RULES.earning.lpPerRedeemableMile;
    return {
      baseMiles: baseMiles,
      bonusMiles: bonusMiles,
      totalMiles: totalMiles,
      loyaltyPoints: loyaltyPoints,
      earns: true
    };
  }

  /**
   * Miles + Loyalty Points earned by putting the purchase on an AAdvantage
   * credit card. Distinct from flight earnings — this is the card issuer's
   * reward, not American's.
   * @param {number} qualifyingSpend - total amount charged to the card
   *   (fare + taxes + bags; the full cash outlay, since cards earn on dollars
   *   charged, unlike AA's flight-mile rule which excludes government tax)
   * @param {string} cardKey - key into AA_RULES.creditCards
   */
  function calculateCardRewards(qualifyingSpend, cardKey) {
    var card = AA_RULES.creditCards[cardKey] || AA_RULES.creditCards.none;
    var spend = clampNonNeg(n(qualifyingSpend));
    var cardMiles = spend * card.earnMultiplierAA;
    var cardLoyaltyPoints = spend * card.lpBaseRate;
    return { cardMiles: cardMiles, cardLoyaltyPoints: cardLoyaltyPoints, card: card };
  }

  /**
   * Cash cost of checked bags for the whole party, applying whichever free-bag
   * benefit (cabin, elite status, or credit card) is largest per traveler.
   * Benefits do not stack — the traveler gets the single best allowance.
   * @param {object} p
   * @param {number} p.bagsPerTraveler
   * @param {number} p.travelers
   * @param {string} p.cabinKey
   * @param {string} p.statusKey
   * @param {string} p.cardKey
   * @param {boolean} p.payOnline
   * @param {number} p.legs - 1 for one-way, 2 for round-trip (bag fees apply per direction)
   */
  function calculateBagCost(p) {
    var cabin = AA_RULES.cabins[p.cabinKey] || AA_RULES.cabins.main_cabin;
    var status = AA_RULES.status[p.statusKey] || AA_RULES.status.none;
    var card = AA_RULES.creditCards[p.cardKey] || AA_RULES.creditCards.none;
    var bagsPerTraveler = Math.max(0, Math.round(n(p.bagsPerTraveler)));
    var travelers = Math.max(1, Math.round(n(p.travelers, 1)));
    var legs = p.legs === 1 ? 1 : 2;
    var payOnline = p.payOnline !== false;
    var pricing = AA_RULES.baggage.mainCabin;

    var cardCoversTravelers = card.freeCheckedBags > 0 ? (1 + card.companionBags) : 0;

    function bagFee(index) {
      var fee;
      if (index === 1) fee = payOnline ? pricing.first.online : pricing.first.airport;
      else if (index === 2) fee = payOnline ? pricing.second.online : pricing.second.airport;
      else fee = AA_RULES.baggage.thirdAndBeyondFlat;
      if (cabin.bagSurchargePerBag && index <= 2) fee += cabin.bagSurchargePerBag;
      return fee;
    }

    var perTraveler = [];
    var totalCost = 0;
    for (var t = 0; t < travelers; t++) {
      var cardFreeForThisTraveler = t < cardCoversTravelers ? card.freeCheckedBags : 0;
      var freeAllowance = Math.max(cabin.freeCheckedBags, status.freeCheckedBags, cardFreeForThisTraveler);
      var travelerCostPerLeg = 0;
      for (var b = 1; b <= bagsPerTraveler; b++) {
        if (b <= freeAllowance) continue;
        travelerCostPerLeg += bagFee(b);
      }
      var travelerCost = travelerCostPerLeg * legs;
      perTraveler.push({ freeAllowance: freeAllowance, costPerLeg: travelerCostPerLeg, total: travelerCost });
      totalCost += travelerCost;
    }

    return { totalCost: totalCost, perTraveler: perTraveler, legs: legs };
  }

  /**
   * Total real-world cost of the award alternative: miles + taxes/fees + bags.
   * Bag benefits (status/card) apply to award tickets exactly as they do to
   * cash tickets, since they're tied to the traveler's status/card, not the
   * fare paid. Pass bagParams with cabinKey already resolved for awards (see
   * calculateFullComparison — Basic Economy has no award equivalent, so the
   * caller substitutes 'main_cabin' before calling this).
   */
  function calculateAwardCost(p) {
    var travelers = Math.max(1, Math.round(n(p.travelers, 1)));
    var milesPerPerson = clampNonNeg(n(p.milesPerPerson));
    var taxesPerPerson = clampNonNeg(n(p.awardTaxesPerPerson));
    var totalMiles = milesPerPerson * travelers;
    var totalTaxes = taxesPerPerson * travelers;
    var bagResult = calculateBagCost(p.bagParams);
    var totalCashOutOfPocket = totalTaxes + bagResult.totalCost;
    return {
      totalMiles: totalMiles,
      totalTaxes: totalTaxes,
      bagCost: bagResult.totalCost,
      bagDetail: bagResult,
      totalCashOutOfPocket: totalCashOutOfPocket
    };
  }

  /**
   * Dollar value of everything forgone by paying with miles instead of cash:
   * the flight miles/LPs and card miles/LPs you would have earned had you paid cash.
   * @param {object} p
   * @param {object} p.flightEarnings - result of calculateAAFlightEarnings
   * @param {object} p.cardRewards - result of calculateCardRewards
   * @param {number} p.mileValueCents - user's personal ¢/mile valuation
   * @param {number} p.lpValueCents - user's personal ¢/Loyalty-Point valuation
   */
  function calculateCashOpportunityCost(p) {
    var mv = n(p.mileValueCents) / 100;
    var lv = n(p.lpValueCents) / 100;
    var flightMilesValue = p.flightEarnings.totalMiles * mv;
    var flightLPValue = p.flightEarnings.loyaltyPoints * lv;
    var cardMilesValue = p.cardRewards.cardMiles * mv;
    var cardLPValue = p.cardRewards.cardLoyaltyPoints * lv;
    var totalForgoneValue = flightMilesValue + flightLPValue + cardMilesValue + cardLPValue;
    return {
      flightMilesValue: flightMilesValue,
      flightLPValue: flightLPValue,
      cardMilesValue: cardMilesValue,
      cardLPValue: cardLPValue,
      totalForgoneValue: totalForgoneValue
    };
  }

  /**
   * Contextualizes forgone Loyalty Points against the traveler's progress
   * toward their next elite tier. Purely informational — does not change
   * the dollar math, which is driven by the user's own lpValueCents input.
   */
  function calculateLPOpportunityCost(p) {
    var statusKey = p.statusKey || 'none';
    var currentLP = clampNonNeg(n(p.currentLP));
    var forgoneLP = clampNonNeg(n(p.forgoneLP));
    var order = AA_RULES.statusOrder;
    var idx = order.indexOf(statusKey);
    var nextKey = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
    if (!nextKey) {
      return { nextTier: null, message: 'Already at the top AAdvantage tier — no further status to chase.' };
    }
    var nextThreshold = AA_RULES.status[nextKey].lpThreshold;
    var progressBefore = Math.min(1, currentLP / nextThreshold);
    var progressAfter = Math.min(1, (currentLP + forgoneLP) / nextThreshold);
    var remaining = clampNonNeg(nextThreshold - currentLP);
    return {
      nextTier: nextKey,
      nextTierLabel: AA_RULES.status[nextKey].label,
      nextThreshold: nextThreshold,
      progressBefore: progressBefore,
      progressAfter: progressAfter,
      lpRemainingForNextTier: remaining,
      closesGapPct: nextThreshold > 0 ? (forgoneLP / nextThreshold) * 100 : 0
    };
  }

  /**
   * The core redemption-value math. Returns both the "raw" value (ignoring
   * forgone rewards — the naive cash-minus-taxes-divided-by-miles number)
   * and the "effective" value (netting out what paying cash would have earned).
   */
  function calculateRedemptionValue(p) {
    var totalMiles = clampNonNeg(n(p.totalMiles));
    var cashTotal = clampNonNeg(n(p.cashTotal));
    var awardCashOut = clampNonNeg(n(p.awardCashOut));
    var forgoneValue = clampNonNeg(n(p.forgoneValue));

    var netCashSavings = cashTotal - awardCashOut;
    var rawCentsPerMile = totalMiles > 0 ? (netCashSavings / totalMiles) * 100 : 0;

    var effectiveDollarValue = netCashSavings - forgoneValue;
    var effectiveCentsPerMile = totalMiles > 0 ? (effectiveDollarValue / totalMiles) * 100 : 0;

    return {
      netCashSavings: netCashSavings,
      rawCentsPerMile: rawCentsPerMile,
      effectiveDollarValue: effectiveDollarValue,
      effectiveCentsPerMile: effectiveCentsPerMile
    };
  }

  /**
   * Final pay-cash-vs-use-miles verdict plus the pieces needed to explain it
   * in plain English.
   */
  function calculateRecommendation(p) {
    var effectiveCentsPerMile = n(p.effectiveCentsPerMile);
    var mileValueCents = n(p.mileValueCents);
    var diffCents = effectiveCentsPerMile - mileValueCents;
    var useMiles = diffCents >= 0 && p.totalMiles > 0;

    return {
      useMiles: useMiles,
      headline: useMiles ? 'Use miles' : 'Pay cash',
      effectiveCentsPerMile: effectiveCentsPerMile,
      mileValueCents: mileValueCents,
      diffCents: diffCents
    };
  }

  /**
   * Numerically solves for the cash fare (per traveler) at which the
   * recommendation flips, holding every other input fixed. Reuses the real
   * pipeline (via `evaluateFareScenario`, injected by the caller) rather than
   * re-deriving the algebra, so it can never drift out of sync with the main
   * calculation.
   * @param {function(number):number} evaluateEffectiveCentsAtFare
   * @param {number} mileValueCents
   */
  function calculateBreakevenFare(evaluateEffectiveCentsAtFare, mileValueCents) {
    var y0 = evaluateEffectiveCentsAtFare(0);
    var y1 = evaluateEffectiveCentsAtFare(1000);
    var slope = (y1 - y0) / 1000;
    if (Math.abs(slope) < 1e-9) return null; // effective value doesn't move with fare (e.g. 0 miles)
    var fare = (mileValueCents - y0) / slope;
    return fare > 0 ? fare : 0;
  }

  /**
   * Orchestrates every piece above into one full cash-vs-miles comparison.
   * This is the single entry point the UI (and the test suite) should call —
   * it exists so the composition order lives in one place, not duplicated
   * between the UI and tests.
   *
   * @param {object} inputs
   * @param {number} inputs.cashFarePerPerson
   * @param {number} inputs.milesPerPerson
   * @param {number} inputs.awardTaxesPerPerson
   * @param {number} [inputs.travelers=1]
   * @param {number} [inputs.bagsPerTraveler=0]
   * @param {boolean} [inputs.payOnline=true]
   * @param {number} [inputs.legs=2] - 1 = one-way, 2 = round-trip
   * @param {string} [inputs.cabinKey='main_cabin']
   * @param {string} [inputs.statusKey='none']
   * @param {string} [inputs.cardKey='none']
   * @param {number} inputs.mileValueCents
   * @param {number} [inputs.lpValueCents=0]
   * @param {number} [inputs.govtTaxPct] - overrides AA_RULES.earning.assumedGovtTaxPctOfFare
   * @param {number} [inputs.currentLP=0]
   */
  function calculateFullComparison(inputs) {
    var cabinKey = inputs.cabinKey || 'main_cabin';
    var statusKey = inputs.statusKey || 'none';
    var cardKey = inputs.cardKey || 'none';
    var travelers = Math.max(1, Math.round(n(inputs.travelers, 1)));
    var bagsPerTraveler = clampNonNeg(Math.round(n(inputs.bagsPerTraveler)));
    var payOnline = inputs.payOnline !== false;
    var legs = inputs.legs === 1 ? 1 : 2;
    var mileValueCents = n(inputs.mileValueCents);
    var lpValueCents = n(inputs.lpValueCents);
    var govtTaxPct = inputs.govtTaxPct != null ? n(inputs.govtTaxPct) : AA_RULES.earning.assumedGovtTaxPctOfFare;
    var awardTaxesPerPerson = clampNonNeg(n(inputs.awardTaxesPerPerson, AA_RULES.awardFees.domesticFloorPerPerson));
    var milesPerPerson = clampNonNeg(n(inputs.milesPerPerson));

    var bagParams = {
      bagsPerTraveler: bagsPerTraveler,
      travelers: travelers,
      cabinKey: cabinKey,
      statusKey: statusKey,
      cardKey: cardKey,
      payOnline: payOnline,
      legs: legs
    };
    // Basic Economy is a cash-fare restriction, not an award category — American
    // has no "Basic Economy award." A MileSAAver-type economy award redemption
    // is serviced like a standard Main Cabin ticket (normal bag allowance, no
    // Basic Economy surcharge), even when the cash alternative being compared
    // against is Basic Economy. So the award side always prices bags as if the
    // cabin were Main Cabin when the selected fare is Basic Economy.
    var awardBagParams = cabinKey === 'basic_economy'
      ? Object.assign({}, bagParams, { cabinKey: 'main_cabin' })
      : bagParams;

    function core(cashFarePerPerson) {
      var fare = clampNonNeg(n(cashFarePerPerson));
      var eligibleBaseFare = fare * travelers * (1 - govtTaxPct / 100);
      var flightEarnings = calculateAAFlightEarnings(eligibleBaseFare, cabinKey, statusKey);
      var bagResult = calculateBagCost(bagParams);
      var totalCashFare = fare * travelers;
      var totalCashOutlay = totalCashFare + bagResult.totalCost;
      var cardRewards = calculateCardRewards(totalCashOutlay, cardKey);
      var awardResult = calculateAwardCost({
        travelers: travelers,
        milesPerPerson: milesPerPerson,
        awardTaxesPerPerson: awardTaxesPerPerson,
        bagParams: awardBagParams
      });
      var oppCost = calculateCashOpportunityCost({
        flightEarnings: flightEarnings,
        cardRewards: cardRewards,
        mileValueCents: mileValueCents,
        lpValueCents: lpValueCents
      });
      var redemption = calculateRedemptionValue({
        totalMiles: awardResult.totalMiles,
        cashTotal: totalCashOutlay,
        awardCashOut: awardResult.totalCashOutOfPocket,
        forgoneValue: oppCost.totalForgoneValue
      });
      return {
        totalCashFare: totalCashFare,
        totalCashOutlay: totalCashOutlay,
        bagResult: bagResult,
        flightEarnings: flightEarnings,
        cardRewards: cardRewards,
        awardResult: awardResult,
        oppCost: oppCost,
        redemption: redemption
      };
    }

    var result = core(inputs.cashFarePerPerson);
    var recommendation = calculateRecommendation({
      effectiveCentsPerMile: result.redemption.effectiveCentsPerMile,
      mileValueCents: mileValueCents,
      totalMiles: result.awardResult.totalMiles
    });
    var lpContext = calculateLPOpportunityCost({
      statusKey: statusKey,
      currentLP: inputs.currentLP,
      forgoneLP: result.flightEarnings.loyaltyPoints + result.cardRewards.cardLoyaltyPoints
    });
    var breakevenFare = calculateBreakevenFare(function (fare) {
      return core(fare).redemption.effectiveCentsPerMile;
    }, mileValueCents);

    return {
      inputs: { cabinKey: cabinKey, statusKey: statusKey, cardKey: cardKey, travelers: travelers, bagsPerTraveler: bagsPerTraveler, legs: legs, govtTaxPct: govtTaxPct },
      totalCashFare: result.totalCashFare,
      totalCashOutlay: result.totalCashOutlay,
      bagResult: result.bagResult,
      flightEarnings: result.flightEarnings,
      cardRewards: result.cardRewards,
      awardResult: result.awardResult,
      oppCost: result.oppCost,
      redemption: result.redemption,
      recommendation: recommendation,
      lpContext: lpContext,
      breakevenFare: breakevenFare
    };
  }

  return {
    AA_RULES: AA_RULES,
    calculateAAFlightEarnings: calculateAAFlightEarnings,
    calculateCardRewards: calculateCardRewards,
    calculateBagCost: calculateBagCost,
    calculateAwardCost: calculateAwardCost,
    calculateCashOpportunityCost: calculateCashOpportunityCost,
    calculateLPOpportunityCost: calculateLPOpportunityCost,
    calculateRedemptionValue: calculateRedemptionValue,
    calculateRecommendation: calculateRecommendation,
    calculateBreakevenFare: calculateBreakevenFare,
    calculateFullComparison: calculateFullComparison
  };
});
