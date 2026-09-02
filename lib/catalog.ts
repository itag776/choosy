import type { CategoryProfile, Product, ProductCategory, ProductVariant } from "@/lib/types";

export const CATALOG_VERSION = "choosy-catalog-2026-09-v1";

export const CATEGORY_PROFILES: CategoryProfile[] = [
  { category: "phones", label: "Phones", description: "Smartphones for everyday use, photography, gaming and long battery life", version: "phones-v1", questions: [
    { key: "os", prompt: "Do you prefer Android, iOS, or are you open to either?", choices: ["Android", "iOS", "No preference"], required: true, weight: 16 },
    { key: "priority", prompt: "What matters most: camera, battery, performance, or a balanced phone?", choices: ["Camera", "Battery", "Performance", "Balanced"], required: true, weight: 22 },
    { key: "size", prompt: "What size feels right?", choices: ["Compact", "Standard", "Large", "No preference"], required: true, weight: 10 },
  ] },
  { category: "headphones", label: "Headphones", description: "Personal audio for travel, work, calls and gaming", version: "headphones-v1", questions: [
    { key: "formFactor", prompt: "Which style do you prefer?", choices: ["Over-ear", "Earbuds", "No preference"], required: true, weight: 14 },
    { key: "environment", prompt: "Where will you use them most?", choices: ["Commute", "Office", "Gym", "Gaming"], required: true, weight: 18 },
    { key: "feature", prompt: "Which feature matters most?", choices: ["Noise cancellation", "Low latency", "Call quality", "No preference"], required: true, weight: 18 },
    { key: "connectivity", prompt: "Wireless, wired, or either?", choices: ["Wireless", "Wired", "Either"], required: true, weight: 8 },
  ] },
  { category: "running-shoes", label: "Running shoes", description: "Road and trail shoes for daily training and longer distances", version: "running-shoes-v1", questions: [
    { key: "size", prompt: "What shoe size do you need?", choices: ["UK 7", "UK 8", "UK 9", "UK 10"], required: true, weight: 20 },
    { key: "terrain", prompt: "Where do you usually run?", choices: ["Road", "Trail", "Mixed"], required: true, weight: 18 },
    { key: "distance", prompt: "What does a typical run look like?", choices: ["Under 5 km", "5–10 km", "10 km+", "Walking / casual"], required: true, weight: 14 },
    { key: "cushioning", prompt: "How should the ride feel?", choices: ["Soft", "Balanced", "Responsive", "No preference"], required: true, weight: 12 },
  ] },
];

const variant = (sku: string, label: string, price: number, stock = 8, attributes: Record<string, string> = {}): ProductVariant => ({ id: `var_${sku.toLowerCase()}`, sku, label, pricePaise: price * 100, stock, attributes });
const primary = (sku: string, category: ProductCategory, brand: string, name: string, price: number, tags: string[], description: string, imageUrl: string, promoted = false, variants?: ProductVariant[]): Product => ({ id: `prod_${sku.toLowerCase()}`, sku, category, kind: "primary", brand, name, description, imageUrl, promoted, tags, attributes: { demoData: true }, variants: variants ?? [variant(`${sku}-STD`, "Standard", price)] });
const addon = (sku: string, category: ProductCategory, brand: string, name: string, price: number, tags: string[], description: string): Product => ({ id: `prod_${sku.toLowerCase()}`, sku, category, kind: "addon", brand, name, description, imageUrl: `/products/${category}.png`, promoted: false, tags, attributes: { demoData: true }, variants: [variant(`${sku}-STD`, "Standard", price, 20)] });
const shoeVariants = (sku: string, price: number) => ["UK 7", "UK 8", "UK 9", "UK 10"].map((size) => variant(`${sku}-${size.replace(" ", "")}`, size, price, 6, { size }));

export const DEMO_CATALOG: Product[] = [
  primary("PH-A1", "phones", "Aster", "Aster One", 24999, ["android", "balanced", "standard", "battery", "everyday"], "A balanced 5G phone with two-day battery life and a bright 6.3-inch display.", "/products/phones.png", true),
  primary("PH-A2", "phones", "Aster", "Aster One Pro", 41999, ["android", "camera", "performance", "standard", "photography"], "A camera-first Android phone with fast performance and a dedicated portrait lens.", "/products/phones.png"),
  primary("PH-N1", "phones", "Northstar", "Northstar Mini", 32999, ["android", "compact", "balanced", "everyday"], "A compact phone designed for one-handed use without sacrificing flagship speed.", "/products/phones.png"),
  primary("PH-N2", "phones", "Northstar", "Northstar Max", 52999, ["android", "large", "battery", "performance", "gaming"], "A large-display performance phone with enhanced cooling and long battery life.", "/products/phones.png"),
  primary("PH-L1", "phones", "Luma", "Luma 16", 58999, ["ios", "camera", "compact", "balanced", "photography"], "A compact, camera-led phone with a simple, tightly integrated mobile experience.", "/products/phones.png"),
  primary("PH-L2", "phones", "Luma", "Luma 16 Air", 68999, ["ios", "large", "battery", "camera", "everyday"], "A thin large-screen phone tuned for battery life, video and everyday creative work.", "/products/phones.png", true),
  primary("HD-O1", "headphones", "Orbit", "Orbit Quiet", 12999, ["over-ear", "wireless", "noise cancellation", "commute", "office"], "Comfortable wireless over-ear headphones with adaptive noise cancellation.", "/products/headphones.png", true),
  primary("HD-O2", "headphones", "Orbit", "Orbit Studio", 8999, ["over-ear", "wired", "call quality", "office", "balanced"], "Detailed wired headphones for focused desk listening and clear calls.", "/products/headphones.png"),
  primary("HD-P1", "headphones", "Pulse", "Pulse Air", 6999, ["earbuds", "wireless", "gym", "call quality"], "Secure-fit wireless earbuds with sweat resistance and beamforming microphones.", "/products/headphones.png"),
  primary("HD-P2", "headphones", "Pulse", "Pulse Play", 9999, ["earbuds", "wireless", "low latency", "gaming"], "Low-latency earbuds with a dedicated game mode and compact charging case.", "/products/headphones.png"),
  primary("HD-S1", "headphones", "Serein", "Serein ANC", 16999, ["over-ear", "wireless", "noise cancellation", "commute", "call quality"], "Premium travel headphones with strong isolation and natural voice pickup.", "/products/headphones.png"),
  primary("HD-S2", "headphones", "Serein", "Serein Flex", 4999, ["earbuds", "wired", "low latency", "gaming", "gym"], "Lightweight wired in-ear monitors with zero-lag sound and replaceable tips.", "/products/headphones.png"),
  primary("SH-V1", "running-shoes", "Vela", "Vela Daily", 6499, ["road", "balanced", "under 5 km", "5–10 km", "walking / casual"], "A durable daily trainer with a stable, balanced ride.", "/products/running-shoes.png", true, shoeVariants("SH-V1", 6499)),
  primary("SH-V2", "running-shoes", "Vela", "Vela Cloud", 8499, ["road", "soft", "5–10 km", "10 km+"], "Soft high-stack cushioning for comfortable longer road runs.", "/products/running-shoes.png", false, shoeVariants("SH-V2", 8499)),
  primary("SH-R1", "running-shoes", "Ridge", "Ridge Trail", 7999, ["trail", "balanced", "5–10 km", "10 km+"], "A protective trail shoe with dependable grip on loose ground.", "/products/running-shoes.png", false, shoeVariants("SH-R1", 7999)),
  primary("SH-R2", "running-shoes", "Ridge", "Ridge Hybrid", 7499, ["mixed", "balanced", "under 5 km", "5–10 km"], "A road-to-trail outsole for runners who split time across surfaces.", "/products/running-shoes.png", false, shoeVariants("SH-R2", 7499)),
  primary("SH-K1", "running-shoes", "Kite", "Kite Tempo", 9499, ["road", "responsive", "5–10 km", "10 km+"], "A responsive lightweight trainer for quicker sessions and race preparation.", "/products/running-shoes.png", true, shoeVariants("SH-K1", 9499)),
  primary("SH-K2", "running-shoes", "Kite", "Kite Ease", 5499, ["road", "soft", "under 5 km", "walking / casual"], "An easygoing cushioned shoe for short runs, walking and all-day wear.", "/products/running-shoes.png", false, shoeVariants("SH-K2", 5499)),
  addon("AC-P1", "phones", "Choosy", "30W compact charger", 1499, ["phones", "battery", "charging"], "A compact fast charger selected for compatible Choosy demo phones."),
  addon("AC-P2", "phones", "Choosy", "Everyday protective case", 999, ["phones", "protection", "everyday"], "A slim protective case matched to the selected phone."),
  addon("AC-H1", "headphones", "Choosy", "Travel hard case", 1199, ["headphones", "commute", "protection"], "A structured travel case for over-ear headphones."),
  addon("AC-H2", "headphones", "Choosy", "Comfort ear-tip set", 699, ["headphones", "earbuds", "gym"], "Multiple ear-tip sizes for a more secure and comfortable fit."),
  addon("AC-S1", "running-shoes", "Choosy", "Performance running socks", 799, ["running-shoes", "road", "trail"], "Two pairs of breathable, anti-blister running socks."),
  addon("AC-S2", "running-shoes", "Choosy", "Reflective run band", 599, ["running-shoes", "road", "safety"], "A lightweight reflective band for low-light runs."),
];

export function categoryProfile(category: ProductCategory): CategoryProfile { return CATEGORY_PROFILES.find((item) => item.category === category)!; }
export function productById(id: string, catalog = DEMO_CATALOG): Product | undefined { return catalog.find((item) => item.id === id); }
export function variantById(product: Product, id: string): ProductVariant | undefined { return product.variants.find((item) => item.id === id); }
