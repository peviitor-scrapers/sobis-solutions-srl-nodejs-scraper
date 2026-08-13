/**
 * SOBIS SOLUTIONS Job Scraper - Main Entry Point
 *
 * PURPOSE: Scrapes job listings from ANOFM (Agentia Nationala pentru Ocuparea
 * Fortei de Munca) for SOBIS SOLUTIONS S.R.L. and stores them via the
 * peviitor API. SOBIS SOLUTIONS has no public careers page — ANOFM API is
 * the primary source.
 */

import fetch from "node-fetch";
import fs from "fs";
import { fileURLToPath } from "url";
import { validateAndGetCompany } from "./company.js";
import { querySOLR, deleteJobByUrl, upsertJobs, upsertCompany } from "./api.js";
import { generateJobsMarkdown } from "./markdown-generator.js";
import companyConfig from "./config/company.js";

// ============================================================================
// CONFIGURATION CONSTANTS — derived from scraper/config/company.json
// ============================================================================

const COMPANY_CIF = companyConfig.id;

// Request timeout in milliseconds (10 seconds, per INSTRUCTIONS.md)
const TIMEOUT = 10000;

// Global variable to store company name after validation
let COMPANY_NAME = null;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Promise-based sleep function to introduce delays between requests
 * @param {number} ms - Milliseconds to sleep
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// API FUNCTIONS - Fetching data from ANOFM
// ============================================================================

/**
 * Searches ANOFM for job listings belonging to the given company CIF.
 * Uses the public ANOFM API with pagination support.
 * @param {string} cif - Company CIF
 * @param {boolean} testOnlyOnePage - If true, limits to first page only (for testing)
 * @returns {Promise<Array>} - Array of job objects { url, title, location, source }
 */
async function searchANOFM(cif, testOnlyOnePage = false) {
  const jobs = [];
  let current = 1;
  const rowCount = 250;
  let hasMore = true;

  try {
    while (hasMore) {
      console.log(`Fetching ANOFM page ${current} for CIF: ${cif}`);
      const payload = {
        current,
        rowCount,
        sort: { created_at: "desc" },
        employer_tax_code: cif
      };
      const res = await fetch("https://mediere.anofm.ro/api/entity/vw_public_job_posting", {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "job_seeker_ro_spider"
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        console.log(`  ANOFM returned ${res.status}`);
        break;
      }
      const data = await res.json();
      const rows = data.rows || [];
      for (const row of rows) {
        const locationParts = (row.address_locality_name || '').split('>').map(s => s.trim());
        const location = locationParts.length > 1 ? locationParts[locationParts.length - 1] : locationParts[0];
        jobs.push({
          url: `https://mediere.anofm.ro/app/module/mediere/job/${row.id}`,
          title: row.occupation,
          location: location ? [location] : undefined,
          source: "ANOFM"
        });
      }
      console.log(`  Fetched ${rows.length} jobs (total so far: ${jobs.length})`);

      if (rows.length < rowCount || testOnlyOnePage) {
        hasMore = false;
      } else {
        current++;
        await sleep(500);
      }
    }
    console.log(`Found ${jobs.length} jobs on ANOFM`);
  } catch (err) {
    console.log(`  ANOFM error: ${err.message}`);
  }
  return jobs;
}

// ============================================================================
// DATA TRANSFORMATION - Preparing jobs for the peviitor API
// ============================================================================

/**
 * Maps raw job data to the Solr-compatible job model with timestamps and status
 * @param {Object} rawJob - Job object from scraper
 * @param {string} cif - Company identifier
 * @param {string} companyName - Company name
 * @returns {Object} - Job object ready for the peviitor API
 */
function mapToJobModel(rawJob, cif, companyName = COMPANY_NAME) {
  const now = new Date().toISOString();

  const job = {
    url: rawJob.url,
    title: rawJob.title,
    company: companyName,
    cif: cif,
    location: rawJob.location?.length ? rawJob.location : undefined,
    tags: rawJob.tags?.length ? rawJob.tags : undefined,
    workmode: rawJob.workmode || undefined,
    date: now,
    status: "scraped"
  };

  // Remove undefined fields to keep payload clean
  Object.keys(job).forEach((k) => job[k] === undefined && delete job[k]);

  return job;
}

/**
 * Transforms jobs to match the Solr schema and filters for Romanian locations
 * @param {Object} payload - Job payload with jobs array
 * @returns {Object} - Transformed payload ready for the peviitor API
 */
function transformJobsForSOLR(payload) {
  // List of Romanian cities for location validation
  const romanianCities = [
    'Bucharest', 'București', 'Cluj-Napoca', 'Cluj Napoca',
    'Timișoara', 'Timisoara', 'Iași', 'Iasi', 'Brașov', 'Brasov',
    'Constanța', 'Constanta', 'Craiova', 'Bacău', 'Sibiu',
    'Târgu Mureș', 'Targu Mures', 'Oradea', 'Baia Mare', 'Satu Mare',
    'Ploiești', 'Ploiesti', 'Pitești', 'Pitesti', 'Arad', 'Galați', 'Galati',
    'Brăila', 'Braila', 'Drobeta-Turnu Severin', 'Râmnicu Vâlcea', 'Ramnicu Valcea',
    'Buzău', 'Buzau', 'Botoșani', 'Botosani', 'Zalău', 'Zalau', 'Hunedoara', 'Deva',
    'Suceava', 'Bistrița', 'Bistrita', 'Tulcea', 'Călărași', 'Calarasi',
    'Giurgiu', 'Alba Iulia', 'Slatina', 'Piatra Neamț', 'Piatra Neamt', 'Roman',
    'Dumbrăvița', 'Dumbravita', 'Voluntari', 'Popești-Leordeni', 'Popesti-Leordeni',
    'Chitila', 'Mogoșoaia', 'Mogosoaia', 'Otopeni'
  ];

  const citySet = new Set(romanianCities.map(c => c.toLowerCase()));

  const normalizeWorkmode = (wm) => {
    if (!wm) return undefined;
    const lower = wm.toLowerCase();
    if (lower.includes('remote')) return 'remote';
    if (lower.includes('office') || lower.includes('on-site') || lower.includes('site')) return 'on-site';
    return 'hybrid';
  };

  const transformed = {
    ...payload,
    company: payload.company?.toUpperCase(),
    jobs: payload.jobs.map(job => {
      const validLocations = (job.location || []).filter(loc => {
        const lower = loc.toLowerCase().trim();
        if (lower === 'romania' || lower === 'românia') return true;
        return citySet.has(lower);
      }).map(loc => loc.toLowerCase() === 'romania' ? 'România' : loc);

      return {
        ...job,
        location: validLocations.length > 0 ? validLocations : ['România'],
        workmode: normalizeWorkmode(job.workmode)
      };
    })
  };

  return transformed;
}

// ============================================================================
// MAIN ORCHESTRATION - Coordinates the entire scraping workflow
// ============================================================================

/**
 * Main function that orchestrates the complete scraping workflow:
 * 1. Check existing jobs via the peviitor API
 * 2. Validate company via ANAF
 * 3. Scrape jobs from ANOFM API
 * 4. Transform data
 * 5. Upsert jobs via the peviitor API
 * 6. Delete stale jobs no longer published on ANOFM
 * 7. Report summary
 */
async function main() {
  const testOnlyOnePage = process.argv.includes("--test");

  try {
    fs.mkdirSync("scraper", { recursive: true });

    // Step 1: Get count of existing jobs
    console.log("=== Step 1: Get existing jobs count ===");
    const existingResult = await querySOLR(COMPANY_CIF);
    const existingCount = existingResult.numFound;
    const existingUrls = new Set(existingResult.docs.map(doc => doc.url).filter(Boolean));
    console.log(`Found ${existingCount} existing jobs`);

    // Step 2: Validate company data via ANAF
    console.log("=== Step 2: Validate company via ANAF ===");
    const { status, company, cif, address } = await validateAndGetCompany();
    COMPANY_NAME = company;
    const localCif = cif;

    // If company is inactive, jobs were already deleted by company.js — STOP
    if (status === "inactive") {
      console.log("\n⛔ Company is INACTIVE in ANAF — scraper stopping (no jobs to scrape)");
      return;
    }

    // Upsert company to the company core via the peviitor API
    try {
      await upsertCompany({
        id: cif,
        company,
        brand: companyConfig.brand,
        status: "activ",
        location: address ? [address] : companyConfig.location,
        website: companyConfig.website,
        career: companyConfig.career,
        lastScraped: new Date().toISOString().split('T')[0]
      });
    } catch (err) {
      console.log(`Note: Could not upsert company: ${err.message}`);
    }

    // Step 3: Scrape all jobs from ANOFM
    console.log("=== Step 3: Scrape jobs from ANOFM ===");
    const rawJobs = await searchANOFM(localCif, testOnlyOnePage);
    const scrapedCount = rawJobs.length;
    console.log(`📊 Jobs scraped from ANOFM: ${scrapedCount}`);

    if (scrapedCount === 0) {
      console.log("⚠️ No jobs found on ANOFM for this company");
    }

    // Step 4: Map raw jobs to the job model
    const jobs = rawJobs.map(job => mapToJobModel(job, localCif));

    const payload = {
      source: "anofm.ro",
      scrapedAt: new Date().toISOString(),
      company: COMPANY_NAME,
      cif: localCif,
      jobs
    };

    // Step 5: Transform jobs (filter locations, normalize values)
    console.log("Transforming jobs...");
    const transformedPayload = transformJobsForSOLR(payload);
    const validCount = transformedPayload.jobs.filter(j => j.location).length;
    console.log(`📊 Jobs with valid Romanian locations: ${validCount}`);

    // Save transformed jobs to file
    fs.writeFileSync("scraper/jobs.json", JSON.stringify(transformedPayload, null, 2), "utf-8");
    console.log("Saved scraper/jobs.json");

    // Generate and save docs/jobs.md
    const companyData = {
      id: localCif,
      company: transformedPayload.company,
      brand: companyConfig.brand,
      status: "activ",
      location: address ? [address] : companyConfig.location,
      website: companyConfig.website,
      career: companyConfig.career,
      lastScraped: new Date().toISOString().split('T')[0]
    };
    const markdown = generateJobsMarkdown(companyData, transformedPayload.jobs);
    fs.mkdirSync("docs", { recursive: true });
    fs.writeFileSync("docs/jobs.md", markdown, "utf-8");
    console.log("Saved docs/jobs.md");

    // Publish company config for GitHub Pages
    fs.copyFileSync("scraper/config/company.json", "docs/company.json");
    console.log("Copied scraper/config/company.json → docs/company.json");

    // Step 6: Upsert all jobs via the peviitor API
    console.log("\n=== Step 6: Upsert jobs ===");
    await upsertJobs(transformedPayload.jobs);

    // Step 7: Delete stale jobs no longer published on ANOFM
    const scrapedUrls = new Set(transformedPayload.jobs.map(job => job.url));
    const staleUrls = [...existingUrls].filter(url => !scrapedUrls.has(url));

    if (staleUrls.length > 0) {
      console.log(`\n=== Step 7: Delete ${staleUrls.length} stale job(s) ===`);
      let deletedCount = 0;
      for (const url of staleUrls) {
        try {
          console.log(`  Deleting: ${url}`);
          await deleteJobByUrl(url);
          deletedCount++;
        } catch (delErr) {
          console.warn(`  ⚠️ Failed to delete: ${url} — ${delErr.message}`);
        }
      }
      console.log(`✅ Deleted ${deletedCount}/${staleUrls.length} stale job(s)`);
    } else {
      console.log("\n✅ No stale jobs to delete");
    }

    // Step 8: Verify final count
    await new Promise(r => setTimeout(r, 2000));
    const finalResult = await querySOLR(COMPANY_CIF);
    console.log(`\n📊 === SUMMARY ===`);
    console.log(`📊 Jobs existing before scrape: ${existingCount}`);
    console.log(`📊 Jobs scraped from ANOFM: ${scrapedCount}`);
    console.log(`📊 Stale jobs attempted: ${staleUrls.length}`);
    console.log(`📊 Jobs after scrape: ${finalResult.numFound}`);
    console.log(`====================`);

    console.log("\n=== DONE ===");
    console.log("Scraper completed successfully!");

  } catch (err) {
    console.error("Scraper failed:", err);
    process.exit(1);
  }
}

// Export functions for testing
export { searchANOFM, mapToJobModel, transformJobsForSOLR };

// Run main function when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
