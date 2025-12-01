/**
 * This script processes Fred Meyer product information to look for good deals.
 *
 * It reads a JSON file (FM_data.json) with data copy pasted from https://www.fredmeyer.com/atlas/v1 requests
 * It outputs a simplified JSON file (FM_processed.json), sorted by savings percentage.
 *
 * Instructions:
 * - Open dev tools, network request, and filter requests by: https://www.fredmeyer.com/atlas/v1/
 * - Go to www.fredmeyer.com and set the correct store
 * - Go to https://www.fredmeyer.com/pl/meat-seafood/05?fulfillment=all&page=1&savings=On%20Sale&taxonomyId=05
 * - For the products?filter request, right click, copy, copy response and paste info FM_data product array
 * - For the coupons?filter request, right click, copy, copy response and paste info FM_data coupon array
 * - Change the page number in the URL to get more products and repeat until you get bored
 * - Run this script with: node fred_meyer_search.js
 */

const path = require("path");
const fs = require("fs");

const dataPath = path.join(__dirname, "ignore_data", "FM_data.json");
const processedPath = path.join(__dirname, "ignore_data", "FM_processed.json");

// Load data
const fmData = JSON.parse(fs.readFileSync(dataPath, "utf8"));
// Helper to extract price as number from storePrices object
function extractPriceObj(obj) {
  return {
    price: parseFloat(obj.price.slice(4)) || null,
    unitPrice: parseFloat(obj.equivalizedUnitPrice?.amount) || null,
  };
}

function summarizeItem({ item, price }) {
  const weight = parseFloat(item.weight) || parseFloat(item.weightPerUnit) || 0;
  const storePrices = price?.storePrices || {};
  const promo = extractPriceObj(storePrices.promo);
  const regular = extractPriceObj(storePrices.regular);
  const buyPrice = promo.price || regular.price || null;

  let priceByWeight = null;
  if (buyPrice !== null && weight > 0) {
    priceByWeight = buyPrice / weight;
  }

  let savingsPct = null;
  if (promo.unitPrice && regular.unitPrice) {
    savingsPct = promo.unitPrice / regular.unitPrice;
  } else if (promo.price && regular.price) {
    savingsPct = promo.price / regular.price;
  }

  return {
    description: item.description || "",
    weight,
    price: buyPrice,
    unitPricing: {
      normal: regular.unitPrice,
      promo: promo.unitPrice,
    },
    url: item.shareLink || "",
    savingsPct: savingsPct,
    priceByWeight,
  };
}

const products = fmData.product.flatMap((x) => x.data.products || []);
const coupons = fmData.coupon.flatMap((x) => x.data.coupons || []);
const summaryMap = {};

products.forEach((item) => {
  summaryMap[item.id] = summarizeItem(item);
});

coupons.forEach((c) => {
  c.upcs.forEach((upc) => {
    const item = summaryMap[upc];
    if (item) {
      item.coupon = {
        value: c.value,
        title: c.title,
      };
    }
  });
});

let summarized = Object.values(summaryMap);

console.log(`Found ${summarized.length} products`);

summarized = summarized
  .filter((x) => !x.priceByWeight || x.priceByWeight < 12)
  .filter((x) => !x.savingsPct || x.savingsPct < 0.85);

console.log(`Filtered to ${summarized.length} products`);

// Sort by savingsPct ascending (best savings first)
summarized.sort((a, b) => {
  if (!a.savingsPct && !b.savingsPct) {
    return a.priceByWeight - b.priceByWeight;
  }
  if (!a.savingsPct) {
    return 1;
  }
  if (!b.savingsPct) {
    return -1;
  }
  return a.savingsPct - b.savingsPct;
});

// Save to FM_processed.json
fs.writeFileSync(processedPath, JSON.stringify(summarized, null, 2));

console.log("Processed and saved to FM_processed.json");
