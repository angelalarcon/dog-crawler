import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Helpers ────────────────────────────────────────────────────────────────────

async function scrollToBottom(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 500);
        total += 500;
        if (total >= document.body.scrollHeight) { clearInterval(timer); resolve(); }
      }, 150);
    });
  });
  await new Promise(r => setTimeout(r, 1500));
}

// ── Listing extractor (miwuki.com) ─────────────────────────────────────────────

async function extractListing(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('div.caso')).map(card => {
      const link = card.querySelector('a[href]');
      const img = card.querySelector('div.foto img');
      const nombreEl = card.querySelector('div.nombre');

      const nameNode = Array.from(nombreEl?.childNodes || [])
        .find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      const name = nameNode?.textContent.trim()
        || img?.alt?.replace(/^Adopta a\s*/i, '').trim()
        || null;

      const location = nombreEl?.querySelector('span')?.textContent.trim() || null;

      const estadoEl = card.querySelector('div.estado');
      const estadoClass = estadoEl?.classList[1] || null;
      const STATUS_MAP = { e1: 'Disponible', e2: 'Reservado', e3: 'Adoptado', e4: 'Acogida temporal' };
      const status = STATUS_MAP[estadoClass] || null;

      const tipoIcon = card.querySelector('div.tipo i');
      const tipo = tipoIcon?.classList.contains('fa-house') ? 'Protectora' : 'Particular';

      const image = img?.src || img?.getAttribute('data-src') || null;
      const href = link?.getAttribute('href') || null;

      return { name, location, status, tipo, image, link: href };
    });
  });
}

// ── Generic fallback extractor ─────────────────────────────────────────────────

async function extractGeneric(page) {
  return page.evaluate(() => {
    const selectors = [
      '[class*="AnimalCard"]', '[class*="animal-card"]', '[class*="PetCard"]',
      '[class*="pet-card"]', '[class*="shelter-animal"]', 'article[class*="card"]',
    ];
    let cards = [];
    for (const sel of selectors) {
      cards = Array.from(document.querySelectorAll(sel));
      if (cards.length > 0) break;
    }
    if (cards.length === 0) {
      cards = Array.from(document.querySelectorAll('a[href]'))
        .filter(a => /adopc|perro|animal|mascota|dog/i.test(a.href) && a.querySelector('img'));
    }
    return cards.map(card => {
      const img = card.querySelector('img');
      const nameEl = card.querySelector('h1,h2,h3,h4,[class*="name"],[class*="nombre"]');
      const linkEl = card.tagName === 'A' ? card : card.querySelector('a[href]');
      const name = nameEl?.textContent?.trim() || img?.alt?.replace(/^Adopta a\s*/i, '').trim() || null;
      const image = img?.src || img?.getAttribute('data-src') || null;
      const href = linkEl?.getAttribute('href') || null;
      const link = href ? (href.startsWith('http') ? href : `${window.location.origin}${href}`) : null;
      return { name, image, link };
    });
  });
}

// ── Detail page extractor (miwuki.com) ────────────────────────────────────────

async function extractDetail(page) {
  return page.evaluate(() => {
    const genderIcon = document.querySelector('h1 i.fa-mars, h1 i.fa-venus');
    const gender = genderIcon?.getAttribute('title')
      || document.querySelector('h1 .sr-only')?.textContent.trim()
      || null;

    const mainImg = document.querySelector('.col-md-3 img, .col-12.col-md-3 img');
    const imageHD = mainImg?.src?.replace(/\/\d+$/, '/800') || null;

    const gallery = Array.from(document.querySelectorAll('div.fotos a[href]'))
      .map(a => a.getAttribute('href'))
      .filter(Boolean);

    const detailsRow = document.querySelector('div.row.detalles');
    const dataFields = {};
    if (detailsRow) {
      Array.from(detailsRow.querySelectorAll('div[class^="col"]')).forEach(div => {
        const label = div.querySelector('span')?.textContent.trim();
        if (!label) return;
        const raw = div.textContent.trim();
        const value = raw.replace(label, '').trim().replace(/\s+/g, ' ');
        if (value) dataFields[label] = value;
      });
    }

    const personality = Array.from(document.querySelectorAll('div.pills span'))
      .map(s => s.textContent.trim())
      .filter(Boolean);

    const deliverables = Array.from(document.querySelectorAll('ul.entrega li'))
      .map(li => li.textContent.trim())
      .filter(Boolean);

    let description = null;
    document.querySelectorAll('h2').forEach(h2 => {
      if (/historia/i.test(h2.textContent)) {
        description = h2.nextElementSibling?.textContent.trim() || null;
      }
    });

    return {
      gender,
      imageHD,
      gallery,
      breed: dataFields['Raza'] || null,
      species: dataFields['Especie'] || null,
      ageText: (() => {
        const ageDiv = Array.from(document.querySelectorAll('div.row.detalles div[class^="col"]'))
          .find(d => d.querySelector('span small'));
        if (!ageDiv) return null;
        let parts = [];
        ageDiv.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            const t = node.textContent.trim();
            if (t) parts.push(t);
          } else if (node.nodeName === 'SMALL' && !node.textContent.includes('-')) {
            parts.push(node.textContent.trim());
          }
        });
        return parts.join(' ').trim() || null;
      })(),
      lifeStage: dataFields['Edad'] || null,
      size: dataFields['Tamaño'] || null,
      weight: (() => { const w = dataFields['Peso']; return w && !/^0?\s*kg$/.test(w.trim()) ? w : null; })(),
      activityLevel: dataFields['Nivel Actividad'] || null,
      personality,
      deliverables,
      description,
    };
  });
}

// ── Core crawl function (exported) ────────────────────────────────────────────

export async function crawl(url, { concurrency = 4, onProgress, onDog } = {}) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=es-ES,es'],
  });

  let dogs = [];

  try {
    const listPage = await browser.newPage();
    await listPage.setViewport({ width: 1280, height: 900 });
    await listPage.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9' });
    await listPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await listPage.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await scrollToBottom(listPage);

    const hasMiwuki = await listPage.evaluate(() => document.querySelectorAll('div.caso').length > 0);
    dogs = hasMiwuki ? await extractListing(listPage) : await extractGeneric(listPage);

    if (dogs.length === 0) {
      await new Promise(r => setTimeout(r, 3000));
      await scrollToBottom(listPage);
      dogs = hasMiwuki ? await extractListing(listPage) : await extractGeneric(listPage);
    }
    await listPage.close();

    dogs = dogs.filter(d => d.name || d.image);

    onProgress?.({ phase: 'listing', total: dogs.length });

    let completed = 0;
    const total = dogs.length;

    async function processOne(dog, index) {
      if (!dog.link) {
        completed++;
        onProgress?.({ phase: 'detail', current: completed, total, name: dog.name });
        onDog?.({ ...dog, index });
        return dog;
      }
      const page = await browser.newPage();
      try {
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9' });
        await page.goto(dog.link, { waitUntil: 'domcontentloaded', timeout: 25000 });
        const detail = await extractDetail(page);
        const enriched = { ...dog, ...detail };
        completed++;
        onProgress?.({ phase: 'detail', current: completed, total, name: dog.name });
        onDog?.({ ...enriched, index });
        return enriched;
      } catch {
        completed++;
        onProgress?.({ phase: 'detail', current: completed, total, name: dog.name });
        onDog?.({ ...dog, index });
        return dog;
      } finally {
        await page.close();
      }
    }

    for (let i = 0; i < dogs.length; i += concurrency) {
      const batch = dogs.slice(i, i + concurrency);
      const results = await Promise.all(batch.map((dog, j) => processOne(dog, i + j)));
      results.forEach((r, j) => { dogs[i + j] = r; });
    }

  } finally {
    await browser.close();
  }

  return dogs;
}

// ── CLI entry point ────────────────────────────────────────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const url = args.find(a => a.startsWith('http'));
  const concurrencyArg = args.find(a => a.startsWith('--concurrency='));
  const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1]) : 4;

  if (!url) {
    console.error('Uso: node crawler.js <URL> [--concurrency=N]');
    process.exit(1);
  }

  console.log(`\n🐾 Dog Crawler\n📍 ${url}\n`);

  let lastTotal = 0;
  crawl(url, {
    concurrency,
    onProgress({ phase, current, total, name }) {
      if (phase === 'listing') {
        lastTotal = total;
        console.log(`✅ Listado: ${total} perros`);
        console.log(`\n🔗 Obteniendo perfiles...`);
      } else {
        process.stdout.write(`\r  [${current}/${total}] ${name}${' '.repeat(20)}`);
      }
    },
  })
    .then(async dogs => {
      console.log('\n');
      const outputDir = path.join(__dirname, 'output');
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(
        path.join(outputDir, 'dogs.json'),
        JSON.stringify({ url, total: dogs.length, scrapedAt: new Date().toISOString(), dogs }, null, 2),
        'utf-8'
      );
      console.log(`💾 output/dogs.json (${dogs.length} perros)`);
      dogs.slice(0, 5).forEach((d, i) => {
        console.log(`  ${i + 1}. ${[d.name, d.breed, d.lifeStage, d.gender, d.size, d.status].filter(Boolean).join(' | ')}`);
      });
    })
    .catch(err => { console.error('❌', err.message); process.exit(1); });
}
