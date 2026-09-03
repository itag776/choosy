import type { CategoryProfile, Product, ProductCategory, ProductVariant } from "@/lib/types";

export const CATALOG_VERSION = "choosy-catalog-2026-09-v2";
export const CATALOG_PRICE_AS_OF = "2026-09-03";
export const CATALOG_MARKET = "India";
export const CATALOG_PRICE_NOTICE = "Real products with frozen Razorpay Test Mode prices; stock is simulated and prices are not live retail offers.";

export const CATEGORY_PROFILES: CategoryProfile[] = [
  { category: "phones", label: "Phones", description: "Smartphones for everyday use, photography, gaming and long battery life", version: "phones-v2", questions: [
    { key: "os", prompt: "Do you prefer Android, iOS, or are you open to either?", choices: ["Android", "iOS", "No preference"], required: true, weight: 16 },
    { key: "priority", prompt: "What matters most: camera, battery, performance, or a balanced phone?", choices: ["Camera", "Battery", "Performance", "Balanced"], required: true, weight: 22 },
    { key: "size", prompt: "What size feels right?", choices: ["Compact", "Standard", "Large", "No preference"], required: true, weight: 10 },
  ] },
  { category: "headphones", label: "Headphones", description: "Personal audio for travel, work, calls and gaming", version: "headphones-v2", questions: [
    { key: "formFactor", prompt: "Which style do you prefer?", choices: ["Over-ear", "Earbuds", "No preference"], required: true, weight: 14 },
    { key: "environment", prompt: "Where will you use them most?", choices: ["Commute", "Office", "Gym", "Gaming"], required: true, weight: 18 },
    { key: "feature", prompt: "Which feature matters most?", choices: ["Noise cancellation", "Low latency", "Call quality", "No preference"], required: true, weight: 18 },
    { key: "connectivity", prompt: "Wireless, wired, or either?", choices: ["Wireless", "Wired", "Either"], required: true, weight: 8 },
  ] },
  { category: "running-shoes", label: "Running shoes", description: "Road and trail shoes for daily training and longer distances", version: "running-shoes-v2", questions: [
    { key: "size", prompt: "What shoe size do you need?", choices: ["UK 7", "UK 8", "UK 9", "UK 10"], required: true, weight: 20 },
    { key: "terrain", prompt: "Where do you usually run?", choices: ["Road", "Trail", "Mixed"], required: true, weight: 18 },
    { key: "distance", prompt: "What does a typical run look like?", choices: ["Under 5 km", "5–10 km", "10 km+", "Walking / casual"], required: true, weight: 14 },
    { key: "cushioning", prompt: "How should the ride feel?", choices: ["Soft", "Balanced", "Responsive", "No preference"], required: true, weight: 12 },
  ] },
];

const variant = (sku: string, label: string, price: number, stock = 8, attributes: Record<string, string> = {}): ProductVariant => ({ id: `var_${sku.toLowerCase()}`, sku, label, pricePaise: price * 100, stock, attributes });

interface CatalogEvidence {
  sourceUrl: string;
  priceKind: "official_mrp" | "official_price" | "retail_snapshot";
  segment: "budget" | "value" | "midrange" | "premium" | "flagship";
  popularitySignal: string;
}

const primary = (sku: string, category: ProductCategory, brand: string, name: string, price: number, tags: string[], description: string, imageUrl: string, catalogEvidence: CatalogEvidence, promoted = false, variants?: ProductVariant[]): Product => ({
  id: `prod_${sku.toLowerCase()}`,
  sku,
  category,
  kind: "primary",
  brand,
  name,
  description,
  imageUrl,
  promoted,
  tags,
  attributes: {
    realProduct: true,
    catalogMode: "curated_snapshot",
    market: CATALOG_MARKET,
    priceAsOf: CATALOG_PRICE_AS_OF,
    priceKind: catalogEvidence.priceKind,
    segment: catalogEvidence.segment,
    popularitySignal: catalogEvidence.popularitySignal,
    sourceUrl: catalogEvidence.sourceUrl,
    stockMode: "simulated",
  },
  variants: variants ?? [variant(`${sku}-STD`, "Standard", price)],
});

const addon = (sku: string, category: ProductCategory, name: string, price: number, tags: string[], description: string): Product => ({
  id: `prod_${sku.toLowerCase()}`,
  sku,
  category,
  kind: "addon",
  brand: "Choosy",
  name,
  description,
  imageUrl: `/products/${category}.png`,
  promoted: false,
  tags,
  attributes: { realProduct: false, catalogMode: "generic_demo_accessory", stockMode: "simulated" },
  variants: [variant(`${sku}-STD`, "Standard", price, 20)],
});

const shoeVariants = (sku: string, price: number) => ["UK 7", "UK 8", "UK 9", "UK 10"].map((size) => variant(`${sku}-${size.replace(" ", "")}`, size, price, 6, { size }));
const evidence = (sourceUrl: string, priceKind: CatalogEvidence["priceKind"], segment: CatalogEvidence["segment"], popularitySignal: string): CatalogEvidence => ({ sourceUrl, priceKind, segment, popularitySignal });

export const CURATED_CATALOG: Product[] = [
  primary("PH-IQ-Z10X", "phones", "iQOO", "iQOO Z10x 5G", 13_499, ["android", "battery", "performance", "large", "gaming", "everyday"], "A high-value Android phone with a 6,500 mAh battery and Dimensity 7300 performance.", "https://www.jiomart.com/images/product/original/rv6lnav4vi/iqoo-z10x-5g-8gb-ram-128gb-storage-ultramarine-smartphone-product-images-orv6lnav4vi-p611504336-0-202505202019.jpg", evidence("https://www.iqoo.com/in/products/z10x", "retail_snapshot", "budget", "Amazon India Electronics bestseller snapshot"), true),
  primary("PH-OP-CE4L", "phones", "OnePlus", "OnePlus Nord CE4 Lite 5G", 19_999, ["android", "battery", "balanced", "standard", "large", "everyday", "camera"], "A value-focused 5G phone with a 5,500 mAh battery, 80W charging, OIS and a 120 Hz AMOLED display.", "https://oasis.opstatics.com/content/dam/oasis/page/2024/camry/share.jpg", evidence("https://www.oneplus.in/nord-ce4-lite-5g", "official_price", "value", "Amazon India Electronics bestseller snapshot")),
  primary("PH-NO-3A", "phones", "Nothing", "Nothing Phone (3a)", 24_999, ["android", "camera", "photography", "balanced", "standard", "large", "everyday"], "A distinctive mid-range Android phone with a 50 MP OIS main camera and dedicated 50 MP telephoto camera.", "https://kontakt.az/media/catalog/product/cache/fbd42596869cc4deb59edfc1ed742a64/t/m/tm-dg-sbp-1105-sm-3876_.png", evidence("https://in.nothing.tech/products/phone-3a", "retail_snapshot", "midrange", "High-volume mid-range launch pick")),
  primary("PH-GO-P8A", "phones", "Google", "Google Pixel 8a", 34_999, ["android", "camera", "photography", "balanced", "compact", "standard", "everyday"], "A compact previous-generation Pixel with a strong computational camera and long software-support window.", "https://www.proshop.de/Images/1600x1200/3265920_c73bf3f210f0.jpg", evidence("https://store.google.com/in/product/pixel_8a?hl=en-IN", "retail_snapshot", "midrange", "Popular compact Pixel value pick")),
  primary("PH-OP-N5", "phones", "OnePlus", "OnePlus Nord 5", 33_999, ["android", "performance", "gaming", "camera", "large", "battery"], "An upper-midrange performance phone with Snapdragon 8s Gen 3, 144 Hz display and 6,800 mAh battery.", "https://1shopmobile.com/wp-content/uploads/2025/07/OnePlus-Nord-5.png", evidence("https://www.oneplus.in/nord-5", "official_price", "midrange", "Current OnePlus Nord performance flagship"), true),
  primary("PH-OP-13R", "phones", "OnePlus", "OnePlus 13R", 42_999, ["android", "performance", "camera", "photography", "battery", "large", "gaming"], "A premium-value Android phone with Snapdragon 8 Gen 3, a 6,000 mAh battery and optical telephoto camera.", "https://static.smartphone.nl/orca/products/27662/oneplus-13r.png?w=1080", evidence("https://www.oneplus.in/13r", "official_price", "premium", "Popular value-flagship series")),
  primary("PH-GO-P9A", "phones", "Google", "Google Pixel 9a", 49_999, ["android", "camera", "photography", "balanced", "standard", "compact", "battery", "everyday"], "A compact camera-first Android phone with a 48 MP main camera, Tensor G4 and seven years of updates.", "https://lh3.googleusercontent.com/0FQnNXFGulZ3DGGAPJJOfgwwAW3qEPyjpWg2SLBkmuIU3-c6FxDcmGBEspqPxKFZzTRHXuiCilf-VlDVAEEZzVb4TeP3JNuKnPQi=rj-sc0xffffffff", evidence("https://store.google.com/in/product/pixel_9a?hl=en-IN", "official_price", "premium", "Google's current value camera phone"), true),
  primary("PH-AP-17E", "phones", "Apple", "Apple iPhone 17e", 64_900, ["ios", "camera", "photography", "performance", "compact", "standard", "balanced", "everyday"], "A compact current-generation iPhone with the A19 chip, a 48 MP Fusion camera and 256 GB storage.", "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-17e-finish-unselect-gallery-1-202603_GEO_EMEA?wid=1200&hei=630&fmt=jpeg&qlt=95&.v=1770766619343", evidence("https://www.apple.com/in/shop/buy-iphone/iphone-17e", "official_price", "premium", "Current entry iPhone")),
  primary("PH-AP-17", "phones", "Apple", "Apple iPhone 17", 82_900, ["ios", "camera", "photography", "performance", "standard", "balanced", "everyday"], "A current flagship iPhone with A19 performance and a 48 MP Dual Fusion camera system.", "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-17-finish-unselect-gallery-1-202509_GEO_EMEA?wid=1200&hei=630&fmt=jpeg&qlt=95&.v=1758739981039", evidence("https://www.apple.com/in/shop/buy-iphone/iphone-17", "official_price", "flagship", "Current mainstream iPhone flagship")),

  primary("HD-JB-C100", "headphones", "JBL", "JBL C100SI", 649, ["earbuds", "wired", "call quality", "low latency", "gaming", "office", "everyday"], "Popular wired in-ear headphones with a microphone, one-button remote and zero Bluetooth delay.", "https://in.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw6abf13fa/C100SI_black_dvHAMaster.png?sh=535&sw=535", evidence("https://in.jbl.com/C100SI.html", "official_price", "budget", "Amazon India Electronics bestseller snapshot"), true),
  primary("HD-OP-NB3", "headphones", "OnePlus", "OnePlus Nord Buds 3", 2_299, ["earbuds", "wireless", "noise cancellation", "call quality", "low latency", "gaming", "gym", "commute", "fitness"], "Value true-wireless earbuds with up to 32 dB ANC, low-latency mode and up to 43 hours total playback.", "https://oasis.opstatics.com/content/dam/oasis/page/2024/global/product/mendel/share.jpg", evidence("https://www.oneplus.in/oneplus-nord-buds-3", "retail_snapshot", "budget", "Amazon India Electronics bestseller snapshot"), true),
  primary("HD-JB-Q100", "headphones", "JBL", "JBL Quantum 100M2", 2_499, ["over-ear", "wired", "call quality", "low latency", "gaming", "office"], "A wired over-ear gaming headset with a detachable voice-focus microphone and lossless low-latency audio.", "https://uk.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw3c924442/02.JBL_Quantum%20100M2_Product%20Image_Front_White.png?sh=680&sw=680", evidence("https://in.jbl.com/QUANTUM100M2.html", "official_price", "budget", "Popular entry gaming headset")),
  primary("HD-SO-CH520", "headphones", "Sony", "Sony WH-CH520", 5_990, ["over-ear", "wireless", "call quality", "office", "everyday", "battery"], "Lightweight wireless headphones with up to 50-hour battery life and multipoint connection.", "https://sony.scene7.com/is/image/sonyglobalsolutions/wh-ch520_Primary_image?$S7Product$&fmt=png-alpha", evidence("https://www.sony.co.in/headphones/products/wh-ch520", "official_mrp", "value", "Hundreds of official-store reviews")),
  primary("HD-SO-CH720N", "headphones", "Sony", "Sony WH-CH720N", 14_990, ["over-ear", "wireless", "noise cancellation", "commute", "office", "call quality", "travel"], "Comfortable wireless over-ear headphones with active noise cancellation and beamforming microphones.", "https://sony.scene7.com/is/image/sonyglobalsolutions/wh-ch720_Primary_image?$S7Product$&fmt=png-alpha", evidence("https://www.sony.co.in/headphones/products/wh-ch720n", "official_mrp", "midrange", "Hundreds of official-store reviews"), true),
  primary("HD-AP-A4ANC", "headphones", "Apple", "Apple AirPods 4 with ANC", 17_900, ["earbuds", "wireless", "noise cancellation", "call quality", "gym", "commute", "office", "fitness"], "Open-fit wireless earbuds with active noise cancellation, adaptive audio and voice isolation.", "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/airpods-4-select-202409?wid=1200&hei=630&fmt=jpeg&qlt=95&.v=1723685836351", evidence("https://www.apple.com/in/airpods-4/", "official_price", "premium", "Current mainstream AirPods model")),
  primary("HD-SO-WF5", "headphones", "Sony", "Sony WF-1000XM5", 29_990, ["earbuds", "wireless", "noise cancellation", "call quality", "commute", "office", "travel"], "Sony's premium compact true-wireless earbuds with flagship noise cancellation and call processing.", "https://sony.scene7.com/is/image/sonyglobalsolutions/Primary_image_black?$S7Product$&fmt=png-alpha", evidence("https://www.sony.co.in/headphones/products/wf-1000xm5", "official_mrp", "premium", "Flagship Sony true-wireless line")),
  primary("HD-SO-XM4", "headphones", "Sony", "Sony WH-1000XM4", 29_990, ["over-ear", "wireless", "noise cancellation", "call quality", "commute", "office", "travel", "battery"], "A widely reviewed premium over-ear ANC headphone with multipoint connection and long battery life.", "https://sony.scene7.com/is/image/sonyglobalsolutions/WH-1000XM4_Primary_image_black?$S7Product$&fmt=png-alpha", evidence("https://www.sony.co.in/headphones/products/wh-1000xm4", "official_mrp", "premium", "More than 2,000 official-store reviews"), true),
  primary("HD-SO-XM6", "headphones", "Sony", "Sony WH-1000XM6", 39_990, ["over-ear", "wireless", "noise cancellation", "call quality", "commute", "office", "travel", "flagship"], "Sony's current flagship wireless over-ear headphone with adaptive noise cancellation and improved microphones.", "https://sony.scene7.com/is/image/sonyglobalsolutions/WH1000XM6_Primary_image_Black?$S7Product$&fmt=png-alpha", evidence("https://www.sony.co.in/headphones/products/wh-1000xm6", "official_price", "flagship", "Current Sony noise-cancelling flagship")),

  primary("SH-KI-JF190", "running-shoes", "KIPRUN", "KIPRUN JF 190 Grip", 3_299, ["trail", "mixed", "balanced", "under 5 km", "5–10 km", "10 km+", "walking / casual"], "An accessible mixed-surface running shoe with trail-oriented grip and broad community adoption.", "https://contents.mediadecathlon.com/p2819726/e4dc6505412c66165fb2ebb269bac603/p2819726.jpg?format=auto&f=768x0", evidence("https://www.decathlon.in/c/trail-running-shoes-25404", "official_price", "budget", "Thousands of Decathlon customer ratings"), true, shoeVariants("SH-KI-JF190", 3_299)),
  primary("SH-NI-REV8", "running-shoes", "Nike", "Nike Revolution 8", 4_295, ["road", "soft", "balanced", "under 5 km", "walking / casual", "everyday"], "A popular entry road shoe with soft cushioning for short runs, walking and daily wear.", "https://i.ebayimg.com/images/g/K7IAAeSwfAtobrNN/s-l1200.png", evidence("https://www.nike.com/in/w/revolution-running-shoes-37v7jz7yfbz8s9m5", "official_mrp", "budget", "Nike bestseller label"), true, shoeVariants("SH-NI-REV8", 4_295)),
  primary("SH-KI-KS500", "running-shoes", "KIPRUN", "KIPRUN KS500 2", 6_499, ["road", "soft", "responsive", "balanced", "5–10 km", "10 km+"], "A cushioned daily road trainer built for regular middle- and longer-distance running.", "https://contents.mediadecathlon.com/p2602524/k$051982e8fba4d9780102ee7d66f8183e/tenis-de-running-con-mayor-estabilidad-para-hombre-kiprun-ks500-2-negroslashamarillo.jpg", evidence("https://www.decathlon.in/p/8940965/kiprun-ks500-2-men-s-running-shoes-white", "official_price", "value", "Hundreds of high Decathlon ratings"), false, shoeVariants("SH-KI-KS500", 6_499)),
  primary("SH-AD-DUR2", "running-shoes", "adidas", "adidas Duramo SL 2", 6_999, ["road", "balanced", "under 5 km", "5–10 km", "walking / casual", "everyday"], "A lightweight road trainer with LIGHTMOTION cushioning for daily short- and middle-distance runs.", "https://assetmanagerpim-res.cloudinary.com/images/w_450/q_90/62604899a56c494cbac9bfdda64ca55e_9366/IH8217_01_standard.WebP", evidence("https://www.adidas.co.in/duramo-sl-2-running-shoes/IH8217.html", "official_mrp", "value", "More than 2,000 official-store ratings"), false, shoeVariants("SH-AD-DUR2", 6_999)),
  primary("SH-NI-PEG41", "running-shoes", "Nike", "Nike Pegasus 41", 11_895, ["road", "responsive", "balanced", "5–10 km", "10 km+"], "A bestseller daily road trainer with ReactX foam and dual Air Zoom units for an energised ride.", "https://static.nike.com/a/images/t_PDP_864_v1%2Cf_auto%2Cq_auto%3Aeco/9d45f2da-011a-416f-84dd-6c1cb740d4b8/pegasus-41-womens-road-running-shoes-tSbZGh.png", evidence("https://www.nike.com/in/t/pegasus-41-road-running-shoes-Gbj6Js", "official_mrp", "midrange", "Nike bestseller label"), true, shoeVariants("SH-NI-PEG41", 11_895)),
  primary("SH-NI-PGT5", "running-shoes", "Nike", "Nike Pegasus Trail 5", 12_795, ["trail", "mixed", "balanced", "responsive", "5–10 km", "10 km+"], "A road-to-trail trainer with responsive cushioning and dependable mixed-surface traction.", "https://www.nike.sa/dw/image/v2/BDVB_PRD/on/demandware.static/-/Sites-akeneo-master-catalog/default/dw28b80db2/nk/7e8/0/6/4/3/8/7e806438_7c44_4391_a2fa_4713bb7d77fc.jpg", evidence("https://www.nike.com/in/t/pegasus-trail-5-trail-running-shoes-2jxMFQ/DV3864-009", "official_mrp", "midrange", "Highly rated Pegasus trail line"), true, shoeVariants("SH-NI-PGT5", 12_795)),
  primary("SH-AD-BOS13", "running-shoes", "adidas", "adidas Adizero Boston 13", 15_999, ["road", "responsive", "5–10 km", "10 km+", "performance"], "A fast training shoe with Lightstrike Pro cushioning and ENERGYRODS for tempo and long runs.", "https://assetmanagerpim-res.cloudinary.com/images/w_1560/q_100/0b7c71ea1642448281858d43b1089a2c_9366/JS4932_01_00_standard.WebP", evidence("https://www.adidas.co.in/adizero-boston-13-shoes/JS4945.html", "official_mrp", "premium", "Hundreds of official-store ratings"), true, shoeVariants("SH-AD-BOS13", 15_999)),
  primary("SH-NI-VF4", "running-shoes", "Nike", "Nike Vaporfly 4", 21_495, ["road", "responsive", "10 km+", "performance", "race"], "A lightweight carbon-plated road racing shoe for faster 10K, half-marathon and marathon efforts.", "https://static.nike.com/a/images/t_default/117eaf48-f736-44cf-9619-abf75a7e4320/ZOOMX%2BVAPORFLY%2BNEXT%25%2B4.png", evidence("https://www.nike.com/in/w/vaporfly-running-shoes-37v7jz7yfbz8n3yx", "official_mrp", "flagship", "Nike bestseller race shoe"), false, shoeVariants("SH-NI-VF4", 21_495)),

  addon("AC-P1", "phones", "30W compact charger", 1_499, ["phones", "battery", "charging"], "A generic demo charger used only to prove a relevant, budget-safe add-on."),
  addon("AC-P2", "phones", "Everyday protective case", 999, ["phones", "protection", "everyday"], "A generic demo case used only to prove a relevant, budget-safe add-on."),
  addon("AC-H1", "headphones", "Travel hard case", 1_199, ["headphones", "commute", "protection"], "A generic demo travel case for over-ear headphones."),
  addon("AC-H2", "headphones", "Comfort ear-tip set", 699, ["headphones", "earbuds", "gym"], "A generic demo ear-tip set for compatible in-ear headphones."),
  addon("AC-S1", "running-shoes", "Performance running socks", 799, ["running-shoes", "road", "trail"], "A generic demo two-pair running sock bundle."),
  addon("AC-S2", "running-shoes", "Reflective run band", 599, ["running-shoes", "road", "safety"], "A generic demo reflective band for low-light runs."),
];

// Backwards-compatible name while existing modules migrate to the clearer catalog terminology.
export const DEMO_CATALOG = CURATED_CATALOG;

export function categoryProfile(category: ProductCategory): CategoryProfile { return CATEGORY_PROFILES.find((item) => item.category === category)!; }
export function productById(id: string, catalog = CURATED_CATALOG): Product | undefined { return catalog.find((item) => item.id === id); }
export function variantById(product: Product, id: string): ProductVariant | undefined { return product.variants.find((item) => item.id === id); }
