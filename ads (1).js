/* eslint-disable */
/**
 * ads.js — 5 sponsored cards inserted into the flkr feed (one every 5 facts).
 * All sponsors are real Nigerian brands; image seeds route through
 * picsum.photos so the fallback chain works without bespoke assets.
 *
 * Structure matches the backend's adSchema.
 */
window.FLKR_ADS = [
  {
    id: 1,
    sponsor: "Jumia Nigeria",
    headline: "Shop millions of products, delivered to your door",
    body: "From phones to fashion — pay on delivery in Lagos, Abuja, Port Harcourt and beyond.",
    ctaUrl: "https://www.jumia.com.ng/",
    imageSeed: "jumia-ng",
    status: "active",
  },
  {
    id: 2,
    sponsor: "Flutterwave",
    headline: "Take payments anywhere in Africa",
    body: "Collect with cards, bank transfers, mobile money, and USSD — one API for 30+ countries.",
    ctaUrl: "https://www.flutterwave.com/",
    imageSeed: "flutterwave",
    status: "active",
  },
  {
    id: 3,
    sponsor: "Paystack",
    headline: "Modern online payments for African businesses",
    body: "Accept and make payments in 30+ currencies. Trusted by thousands of Nigerian startups.",
    ctaUrl: "https://paystack.com/",
    imageSeed: "paystack",
    status: "active",
  },
  {
    id: 4,
    sponsor: "Konga",
    headline: "Nigeria's online marketplace — pay on delivery",
    body: "Phones, electronics, groceries, fashion. Order today, get it tomorrow in 12+ cities.",
    ctaUrl: "https://www.konga.com/",
    imageSeed: "konga",
    status: "active",
  },
  {
    id: 5,
    sponsor: "Carbon",
    headline: "Instant loans, no paperwork",
    body: "Get up to ₦1,000,000 in minutes. Pay bills, transfer funds, and invest — all in one app.",
    ctaUrl: "https://carbon.ng/",
    imageSeed: "carbon-ng",
    status: "active",
  },
];
