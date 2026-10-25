/**
 * FORGE — Research Engine v3
 * Sequential flow (correct order):
 * 1. DuckDuckGo  — instant answer, always fast
 * 2. Wikipedia   — deep content, 3 queries
 * 3. arXiv       — science/tech papers
 * 4. World Bank  — economics data
 * 5. HackerNews  — current news
 */

import { log } from '../utils/logger.js';

const FETCH_TIMEOUT_MS = 20000;

// ── HELPERS ──────────────────────────────────────────────────────────────────

async function safeFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function fetchJson(url) {
  const res = await safeFetch(url);
  return res.json();
}

async function fetchText(url) {
  const res = await safeFetch(url);
  return res.text();
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\[\d+\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max) + '...';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── STEP 1: DUCKDUCKGO ────────────────────────────────────────────────────────

async function runDuckDuckGo(query) {
  const results = [];

  // DDG works best with noun phrases, strip question words
  const cleanQuery = query
    .replace(/^(how|what|why|when|where|who)\s+(does|do|is|are|was|were|did|can|could)?\s*/i, '')
    .trim();

  log(`  [DDG] Searching: "${cleanQuery}"`);

  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const data = await fetchJson(url);

    if (data.Abstract && data.Abstract.length > 30) {
      results.push({
        source: 'duckduckgo',
        title: data.Heading || cleanQuery,
        summary: cleanText(data.Abstract),
        url: data.AbstractURL || '',
        type: 'overview',
      });
      log(`  [DDG] Got abstract (${data.Abstract.length} chars)`);
    }

    if (data.Definition && data.Definition.length > 20) {
      results.push({
        source: 'duckduckgo',
        title: `Definition: ${cleanQuery}`,
        summary: cleanText(data.Definition),
        url: data.DefinitionURL || '',
        type: 'definition',
      });
      log(`  [DDG] Got definition`);
    }

    const related = (data.RelatedTopics || [])
      .filter(t => t.Text && t.Text.length > 20)
      .slice(0, 5)
      .map(t => cleanText(t.Text));

    if (related.length > 0) {
      results.push({
        source: 'duckduckgo',
        title: `Related: ${cleanQuery}`,
        summary: related.join(' | '),
        url: '',
        type: 'related',
      });
      log(`  [DDG] Got ${related.length} related topics`);
    }

    if (data.Infobox?.content) {
      const info = data.Infobox.content
        .filter(i => i.label && i.value)
        .slice(0, 6)
        .map(i => `${i.label}: ${i.value}`)
        .join(' | ');

      if (info) {
        results.push({
          source: 'duckduckgo',
          title: `Facts: ${cleanQuery}`,
          summary: info,
          url: '',
          type: 'facts',
        });
        log(`  [DDG] Got infobox`);
      }
    }

    if (results.length === 0) {
      log(`  [DDG] No results — topic may be too specific`);
    }

  } catch (err) {
    log(`  [DDG] Failed: ${err.message}`);
  }

  return results;
}

// ── STEP 2: WIKIPEDIA ─────────────────────────────────────────────────────────

async function runWikipedia(query) {
  const results = [];
  log(`  [Wiki] Searching: "${query}"`);

  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`;
    const searchData = await fetchJson(searchUrl);
    const titles = (searchData.query?.search || []).map(r => r.title);

    if (titles.length === 0) {
      log(`  [Wiki] No articles found`);
      return results;
    }

    log(`  [Wiki] Articles: ${titles.join(', ')}`);

    // Fetch summaries for top 2 articles
    for (const title of titles.slice(0, 2)) {
      try {
        await sleep(400);
        const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        const data = await fetchJson(summaryUrl);

        if (data.extract && data.extract.length > 50) {
          results.push({
            source: 'wikipedia',
            title: data.title,
            summary: truncate(cleanText(data.extract), 1500),
            url: data.content_urls?.desktop?.page || '',
            type: 'encyclopedia',
          });
          log(`  [Wiki] Got "${data.title}" (${data.extract.length} chars)`);
        }
      } catch (err) {
        log(`  [Wiki] Article "${title}" failed: ${err.message}`);
      }
    }

    // Get key sections from first article
    if (titles.length > 0) {
      try {
        await sleep(400);
        const sectUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(titles[0])}&prop=sections&format=json&origin=*`;
        const sectData = await fetchJson(sectUrl);
        const sections = sectData.parse?.sections || [];

        const wantedKeywords = [
          'history', 'background', 'mechanism', 'process', 'cause',
          'effect', 'discovery', 'development', 'application', 'future',
          'overview', 'how', 'type', 'use', 'function', 'structure',
        ];

        const relevant = sections
          .filter(s => wantedKeywords.some(kw => s.line?.toLowerCase().includes(kw)))
          .slice(0, 3);

        for (const section of relevant) {
          try {
            await sleep(300);
            const wikiUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(titles[0])}&section=${section.index}&prop=wikitext&format=json&origin=*`;
            const wikiData = await fetchJson(wikiUrl);
            const text = wikiData.parse?.wikitext?.['*'] || '';

            if (text.length > 100) {
              results.push({
                source: 'wikipedia_detail',
                title: `${titles[0]} — ${section.line}`,
                summary: truncate(cleanText(text), 1000),
                url: '',
                type: 'encyclopedia_detail',
              });
              log(`  [Wiki] Got section "${section.line}"`);
            }
          } catch (err) {}
        }
      } catch (err) {
        log(`  [Wiki] Sections failed: ${err.message}`);
      }
    }

  } catch (err) {
    log(`  [Wiki] Failed: ${err.message}`);
  }

  return results;
}

// ── STEP 3: ARXIV ─────────────────────────────────────────────────────────────

function arxivSearchTerms(query) {
  const stop = new Set([
    'how','what','why','when','where','who','does','do','is','are','was','were',
    'can','could','the','a','an','and','or','of','to','for','in','on','with',
    'from','about','work','works','working','explain','explains','explained',
    'system','systems','process','processes','using','use','used','based',
  ]);

  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !stop.has(t))
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, 6);
}

function arxivRelevanceScore(query, title, summary) {
  const terms = arxivSearchTerms(query);
  const titleLower = title.toLowerCase();
  const summaryLower = summary.toLowerCase();

  if (!terms.length) return 0;

  let score = 0;
  let matched = 0;

  for (const term of terms) {
    const inTitle = titleLower.includes(term);
    const inSummary = summaryLower.includes(term);
    if (inTitle) {
      score += 5;
      matched++;
    } else if (inSummary) {
      score += 2;
      matched++;
    }
  }

  // The topic's strongest terms should not be absent from both title and abstract.
  // This is what prevents broad results such as unrelated Gene Ontology papers
  // from being accepted for a CRISPR query.
  const coverage = matched / terms.length;
  if (coverage < 0.34) return 0;

  return score + coverage * 4;
}

async function fetchArxivEntries(searchQuery, maxResults = 5) {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;
  const xml = await fetchText(url);
  return xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
}

function parseArxivEntry(entry) {
  const title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
  const summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1];
  const published = (entry.match(/<published>([\s\S]*?)<\/published>/) || [])[1];
  const id = (entry.match(/<id>([\s\S]*?)<\/id>/) || [])[1];

  if (!title || !summary) return null;

  return {
    title: cleanText(title),
    summary: cleanText(summary),
    published_date: published?.slice(0, 10) || '',
    url: id?.trim() || '',
  };
}

async function runArXiv(query) {
  const resultsByUrl = new Map();
  log(`  [arXiv] Searching with relevance filtering: "${query}"`);

  try {
    const terms = arxivSearchTerms(query);
    const strongTerms = terms.slice(0, 4);

    // Use several narrow queries instead of one broad `all:<entire user prompt>`
    // query. The broad query was allowing tangential papers to enter the brief.
    const queries = [];

    if (strongTerms.length >= 2) {
      queries.push(`all:${strongTerms[0]} AND all:${strongTerms[1]}`);
    }
    if (strongTerms.length >= 3) {
      queries.push(`all:${strongTerms[0]} AND all:${strongTerms[1]} AND all:${strongTerms[2]}`);
    }
    if (strongTerms.length >= 1) {
      queries.push(`all:${strongTerms[0]}`);
    }

    const candidates = [];
    for (const searchQuery of [...new Set(queries)].slice(0, 3)) {
      try {
        const entries = await fetchArxivEntries(searchQuery, 5);
        for (const entry of entries) {
          const parsed = parseArxivEntry(entry);
          if (parsed) candidates.push(parsed);
        }
      } catch (err) {
        log(`  [arXiv] Query failed: ${err.message}`);
      }
      await sleep(350);
    }

    const ranked = candidates
      .map(item => ({
        ...item,
        relevance_score: arxivRelevanceScore(query, item.title, item.summary),
      }))
      .filter(item => item.relevance_score > 0)
      .sort((a, b) => b.relevance_score - a.relevance_score);

    for (const item of ranked) {
      const key = item.url || item.title.toLowerCase();
      if (resultsByUrl.has(key)) continue;
      resultsByUrl.set(key, {
        source: 'arxiv',
        title: item.title,
        summary: truncate(item.summary, 700),
        url: item.url,
        published_date: item.published_date,
        type: 'scientific_paper',
        relevance_score: Number(item.relevance_score.toFixed(2)),
      });
      if (resultsByUrl.size >= 4) break;
    }

    const results = [...resultsByUrl.values()];
    log(`  [arXiv] Accepted ${results.length} relevant papers from ${candidates.length} candidates`);
    return results;
  } catch (err) {
    log(`  [arXiv] Failed: ${err.message}`);
    return [];
  }
}

// ── STEP 4: WORLD BANK ────────────────────────────────────────────────────────

async function runWorldBank(query) {
  const results = [];
  const lower = query.toLowerCase();

  const indicators = {
    'gdp': 'NY.GDP.MKTP.CD',
    'population': 'SP.POP.TOTL',
    'inflation': 'FP.CPI.TOTL.ZG',
    'unemployment': 'SL.UEM.TOTL.ZS',
    'poverty': 'SI.POV.DDAY',
    'co2': 'EN.ATM.CO2E.KT',
    'literacy': 'SE.ADT.LITR.ZS',
    'life expectancy': 'SP.DYN.LE00.IN',
  };

  const match = Object.entries(indicators).find(([k]) => lower.includes(k));
  if (!match) return results;

  log(`  [WorldBank] Fetching: ${match[0]}`);

  try {
    const url = `https://api.worldbank.org/v2/country/WLD/indicator/${match[1]}?format=json&mrv=5&per_page=5`;
    const data = await fetchJson(url);
    const entries = (data[1] || []).filter(e => e.value !== null);

    if (entries.length > 0) {
      const points = entries.map(e => `${e.date}: ${Number(e.value).toLocaleString()}`).join(', ');
      results.push({
        source: 'world_bank',
        title: `World Data: ${match[0]}`,
        summary: `Global ${match[0]} — ${points}`,
        url: '',
        type: 'economic_data',
      });
      log(`  [WorldBank] Got ${entries.length} data points`);
    }
  } catch (err) {
    log(`  [WorldBank] Failed: ${err.message}`);
  }

  return results;
}

// ── STEP 5: HACKERNEWS ────────────────────────────────────────────────────────

async function runHackerNews(query) {
  const results = [];
  log(`  [HN] Searching: "${query}"`);

  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`;
    const data = await fetchJson(url);
    const hits = (data.hits || []).filter(h => h.title && h.points > 5).slice(0, 3);

    for (const hit of hits) {
      results.push({
        source: 'hackernews',
        title: hit.title,
        summary: `${hit.points} points. ${truncate(cleanText(hit.story_text || ''), 150)}`,
        url: hit.url || '',
        published_date: hit.created_at?.slice(0, 10) || '',
        type: 'current_news',
      });
    }

    log(`  [HN] Got ${hits.length} stories`);
  } catch (err) {
    log(`  [HN] Failed: ${err.message}`);
  }

  return results;
}

// ── TOPIC CLASSIFIER ──────────────────────────────────────────────────────────

function classifyTopic(prompt) {
  const lower = prompt.toLowerCase();

  const categories = {
    science: [
      'physics', 'chemistry', 'biology', 'quantum', 'relativity',
      'evolution', 'genetics', 'dna', 'rna', 'crispr', 'gene', 'cell',
      'atom', 'molecule', 'force', 'energy', 'light', 'wave',
      'black hole', 'star', 'galaxy', 'universe', 'climate', 'ecosystem',
      'protein', 'enzyme', 'virus', 'bacteria', 'neuron', 'brain',
      'photosynthesis', 'mutation', 'chromosome', 'genome',
    ],
    technology: [
      'ai', 'artificial intelligence', 'machine learning', 'computer',
      'software', 'internet', 'blockchain', 'robot', 'programming',
      'algorithm', 'neural network', 'semiconductor', 'chip', 'tech',
      'app', 'code', 'data', 'cloud', 'cyber',
    ],
    history: [
      'war', 'empire', 'revolution', 'ancient', 'medieval', 'civilization',
      'century', 'historical', 'dynasty', 'battle', 'colonialism', 'history',
      'world war', 'cold war', 'roman', 'greek', 'egyptian',
    ],
    economics: [
      'gdp', 'economy', 'market', 'inflation', 'poverty', 'wealth',
      'trade', 'financial', 'recession', 'unemployment', 'currency',
      'stock', 'investment', 'crypto', 'bitcoin',
    ],
    medicine: [
      'disease', 'cancer', 'treatment', 'vaccine', 'drug', 'health',
      'medical', 'anatomy', 'heart', 'immune', 'pandemic', 'surgery',
      'mental health', 'depression', 'diabetes', 'covid',
    ],
    geography: [
      'country', 'continent', 'ocean', 'mountain', 'river',
      'population', 'city', 'capital', 'climate zone',
    ],
  };

  const detected = Object.entries(categories)
    .filter(([, keywords]) => keywords.some(kw => lower.includes(kw)))
    .map(([cat]) => cat);

  return detected.length > 0 ? detected : ['general'];
}

// ── MAIN RESEARCH FUNCTION ────────────────────────────────────────────────────

export async function conductResearch(userPrompt) {
  log(`  Starting research: "${userPrompt}"`);

  const categories = classifyTopic(userPrompt);
  log(`  Categories: ${categories.join(', ')}`);

  const allResults = [];

  // ── STEP 1: DuckDuckGo ───────────────────────────────────────────────────
  log(`\n  --- Step 1: DuckDuckGo ---`);
  const ddgResults = await runDuckDuckGo(userPrompt);
  allResults.push(...ddgResults);
  log(`  DDG: ${ddgResults.length} results`);

  await sleep(500);

  // ── STEP 2: Wikipedia — 3 queries (main, mechanism, history) ────────────
  log(`\n  --- Step 2: Wikipedia ---`);

  const wikiMain = await runWikipedia(userPrompt);
  allResults.push(...wikiMain);
  await sleep(600);

  const wikiMech = await runWikipedia(`${userPrompt} mechanism process`);
  allResults.push(...wikiMech);
  await sleep(600);

  const wikiHist = await runWikipedia(`${userPrompt} history origin`);
  allResults.push(...wikiHist);

  const wikiTotal = wikiMain.length + wikiMech.length + wikiHist.length;
  log(`  Wikipedia: ${wikiTotal} results`);

  await sleep(500);

  // ── STEP 3: arXiv — science/tech/medicine only ───────────────────────────
  if (categories.some(c => ['science', 'technology', 'medicine'].includes(c))) {
    log(`\n  --- Step 3: arXiv ---`);
    const arxivResults = await runArXiv(userPrompt);
    allResults.push(...arxivResults);
    log(`  arXiv: ${arxivResults.length} papers`);
    await sleep(500);
  }

  // ── STEP 4: World Bank — economics/geography only ────────────────────────
  if (categories.some(c => ['economics', 'geography'].includes(c))) {
    log(`\n  --- Step 4: World Bank ---`);
    const wbResults = await runWorldBank(userPrompt);
    allResults.push(...wbResults);
    log(`  WorldBank: ${wbResults.length} data points`);
    await sleep(500);
  }

  // ── STEP 5: HackerNews — tech/science current news ───────────────────────
  if (categories.some(c => ['technology', 'science'].includes(c))) {
    log(`\n  --- Step 5: HackerNews ---`);
    const hnResults = await runHackerNews(userPrompt);
    allResults.push(...hnResults);
    log(`  HN: ${hnResults.length} stories`);
  }

  // ── DEDUPLICATE ──────────────────────────────────────────────────────────
  const seen = new Set();
  const deduped = allResults.filter(r => {
    const key = r.title?.toLowerCase().trim().slice(0, 60);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  log(`\n  Total: ${allResults.length} raw → ${deduped.length} unique`);

  return buildFactsBrief(userPrompt, categories, deduped);
}

// ── BUILD FACTS BRIEF ─────────────────────────────────────────────────────────

function buildFactsBrief(prompt, categories, results) {
  const typeOrder = [
    'overview', 'definition', 'facts', 'encyclopedia',
    'encyclopedia_detail', 'scientific_paper', 'economic_data',
    'current_news', 'related',
  ];

  let briefText = `=== RESEARCH BRIEF: "${prompt}" ===\n`;
  briefText += `Categories: ${categories.join(', ')}\n\n`;

  const byType = {};
  for (const r of results) {
    const t = r.type || 'general';
    if (!byType[t]) byType[t] = [];
    byType[t].push(r);
  }

  let factCount = 0;

  for (const type of typeOrder) {
    if (!byType[type]) continue;
    const label = type.replace(/_/g, ' ').toUpperCase();
    briefText += `--- ${label} ---\n`;

    for (const item of byType[type]) {
      if (item.summary?.length > 20) {
        briefText += `[${item.source.toUpperCase()}] ${item.title}\n`;
        briefText += `${truncate(item.summary, 600)}\n\n`;
        factCount++;
      }
    }
  }

  briefText += `=== END RESEARCH BRIEF ===`;

  const estimatedTokens = Math.floor(briefText.length / 4);
  log(`  Facts brief: ${factCount} facts, ~${estimatedTokens} tokens`);

  return {
    prompt,
    categories,
    brief_text: truncate(briefText, 50000),
    total_facts: factCount,
    estimated_tokens: estimatedTokens,
    sources_used: [...new Set(results.map(r => r.source))],
    result_count: results.length,
  };
}
