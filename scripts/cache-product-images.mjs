import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const source = await readFile("lib/catalog.ts", "utf8");
const products = source.split("\n").flatMap((line) => {
  const match = line.match(/^\s*primary\("([^"]+)",\s*"[^"]+",\s*"[^"]+",\s*"([^"]+)".*"(https:[^"]+)", evidence\("(https:[^"]+)"/);
  return match ? [{ sku: match[1], name: match[2], imageUrl: match[3], sourceUrl: match[4] }] : [];
});
const outputDirectory = "public/products/real";
await mkdir(outputDirectory, { recursive: true });

const verifiedOverrides = {
  "PH-IQ-Z10X": "https://cdn.mobilecity.vn/mobilecity-vn/images/2025/04/vivo-iqoo-z10x-xanh.jpg.webp",
  "PH-SA-M35": "https://www.mobiledokan.com/media/samsung-galaxy-m35-light-blue-official-image_2.webp",
  "PH-PC-F7": "https://www.citytel.bg/wp-content/uploads/2025/06/2-41.png",
  "PH-RM-GT7": "https://cdn-ultra.esempla.com/storage/6803d1ed-a371-481f-b532-3d8fe193a1b7.png",
  "PH-SA-A56": "https://webstorage.public.gr/Product-Images/SAMSUNG_GALAXY_A56/A56_graphite.jpg",
  "PH-VI-V50": "https://exstatic-in.vivo.com/Oz84QB3Wo0uns8j1/in/1739430601603/90a0a3ed56243528fe85ce7dc69586a8.png",
  "PH-AP-17PM": "https://www.mobiledokan.com/media/apple-iphone-17-pro-max-deep-blue-official-image.webp",
  "HD-SO-XM4": "https://inews.co.uk/wp-content/uploads/2020/08/PRI_160376523-e1596730219984.jpg",
  "HD-BT-AD311": "https://www.boat-lifestyle.com/cdn/shop/files/Artboard1_950c35a0-2f02-4f38-ab46-98a6b88c2fa0_1300x.png?v=1716614425",
  "HD-RM-BA6": "https://cdn.pixelbin.io/v2/catalog-cloud/ccprod/original/products/assets/item/free/original/Z2uhAT1d32-realme-Air6-TWS-Earbuds-494410585-i-11.jpg",
  "HD-SA-GBFE": "https://bestmart.cl/cdn/shop/files/audifonos-samsung-galaxy-buds-fe-blanco-4579955_800x.jpg?v=1758551210",
  "HD-JB-Q350": "https://static.helixbeta.com/prod/8207/2715/8207_668972715.jpg?imwidth=5000",
  "HD-SO-INZ": "https://cdn.cs.1worldsync.com/22/db/22db90ee-bd3e-40e9-bdb1-fb8f9a886501.jpg",
  "HD-JB-LB3": "https://media.tatacroma.com/Croma%20Assets/Entertainment/Headphones%20and%20Earphones/Images/307074_2_u10EWfcUu.png?updatedAt=1767797267111",
  "HD-JB-T1M2": "https://fi.harmanaudio.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwf9453728/JBL_TOUR_One_M2_ProductImage_Front_Champagne.png?sh=535&sw=535",
  "HD-BOS-QCE": "https://www.worldwidestereo.com/cdn/shop/files/180428_WWS20_1946x.jpg?v=1704320722",
  "HD-SN-M4": "https://audiomonkey.ro/cdn/shop/products/c55052644e8ffcd3a87cf2d8592ccde8.png?v=1685918542&width=645",
  "HD-BOS-QCH": "https://lcdn.altex.ro/media/catalog/product/c/a/casti_bose_quietcomfort_ultra_headphones_black_update_11_878540d0.jpg",
  "SH-SK-GRC2": "https://www.schoenen.nl/images/products/bolcom/skechers-go-run-consistent-20-schoenen-zwart-man-1762969-d8k.jpg",
  "SH-AS-GC9": "https://cdn.plutosport.com/a/ProductMedia/Asics/P.ASI.RSH.2589/1011B881-002_g2.jpg?33=&profile=product_page_image_medium",
  "SH-BR-GH16": "https://brooksrunning.co.jp/cdn/shop/files/110418_125_L_Ghost_16.png?v=1720411696&width=720",
  "SH-SL-SC6": "https://m.media-amazon.com/images/I/71Oq21uEgXL._AC_SR920%2C736_.jpg",
  "SH-HK-CL10": "https://hoka.mx/cdn/shop/files/1162030-WKY_1_1200x.png?v=1750277360",
  "SH-AS-NIM27": "https://www.asics.com/nz/en-nz/media/catalog/product/image/125180a8e5/gel-nimbus-27.jpg",
  "SH-HK-SG6": "https://www.trailangel.gr/images/thumbs/0058413_hoka-speedgoat-6-andrika-papoytsia-trail-running-omn-oatmealmountain-iris_600.png",
  "SH-AS-KAY31": "https://irunsg.com/cdn/shop/files/1011b867-400_a76083e3-54ac-4dfb-9bce-bde7caae3b2d_2048x2048.png?v=1742535379",
  "SH-AD-UB5": "https://en-qa.sssports.com/dw/image/v2/BDVB_PRD/on/demandware.static/-/Sites-akeneo-master-catalog/default/dwc45835ef/sss/SSS2/A/D/I/F/1/SSS2_ADIF1480_4067889458687_1.jpg?sh=700&sm=fit&sw=700",
};

const headers = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36",
  accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
};

function decodeHtml(value) {
  return value.replaceAll("&amp;", "&").replaceAll("&#x27;", "'").replaceAll("&quot;", '"');
}

async function download(url) {
  const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000) throw new Error("image response was empty");
  return bytes;
}

async function downloadImage(url) {
  const bytes = await download(url);
  await sharp(bytes).metadata();
  return bytes;
}

async function officialPageImage(sourceUrl) {
  const response = await fetch(sourceUrl, { headers: { ...headers, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`source page HTTP ${response.status}`);
  const html = await response.text();
  const match = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
  if (!match) throw new Error("source page has no product image");
  return new URL(decodeHtml(match[1]), sourceUrl).toString();
}

async function imageSearchUrls(name) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(`${name} official product photo`)}`;
  const response = await fetch(url, { headers: { ...headers, accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`image search HTTP ${response.status}`);
  const html = await response.text();
  return [...html.matchAll(/murl&quot;:&quot;(https?:\/\/.*?)&quot;/g)]
    .map((match) => decodeHtml(match[1]))
    .filter((candidate) => !candidate.toLowerCase().endsWith(".svg"));
}

async function cacheProduct(product) {
  const output = path.join(outputDirectory, `${product.sku.toLowerCase()}.webp`);
  const verifiedImageUrl = verifiedOverrides[product.sku];
  if (!verifiedImageUrl) {
    try { await access(output); return { output, source: "cached" }; } catch {}
  }
  let bytes;
  let resolvedSource = verifiedImageUrl ?? product.imageUrl;
  try {
    bytes = await downloadImage(resolvedSource);
  } catch {
    if (verifiedImageUrl) throw new Error("verified image could not be downloaded");
    try {
      resolvedSource = await officialPageImage(product.sourceUrl);
      bytes = await downloadImage(resolvedSource);
    } catch {
      const candidates = await imageSearchUrls(product.name);
      let lastError;
      for (const candidate of candidates.slice(0, 12)) {
        try { bytes = await downloadImage(candidate); resolvedSource = candidate; break; }
        catch (error) { lastError = error; }
      }
      if (!bytes) throw lastError ?? new Error("no valid product photograph found");
    }
  }
  await sharp(bytes)
    .rotate()
    .resize(900, 650, { fit: "contain", background: "#f4f7ff", withoutEnlargement: true })
    .webp({ quality: 88, effort: 5 })
    .toFile(output);
  return { output, source: resolvedSource };
}

const failures = [];
const sources = {};
for (let index = 0; index < products.length; index += 6) {
  const batch = products.slice(index, index + 6);
  await Promise.all(batch.map(async (product) => {
    try { const result = await cacheProduct(product); sources[product.sku] = result.source; }
    catch (error) { failures.push(`${product.sku}: ${error instanceof Error ? error.message : String(error)}`); }
  }));
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  await writeFile(path.join(outputDirectory, "sources.json"), `${JSON.stringify(sources, null, 2)}\n`);
  console.log(`Cached ${products.length} real product images.`);
}
