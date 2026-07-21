import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const HAS_SOLR = !!process.env.SOLR_AUTH;

function itIfSolr(name, fn, timeout) {
  if (HAS_SOLR) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: SOLR_AUTH not set)`, fn, timeout);
}

let HAS_ANAF = false;

async function checkAnafAvailability() {
  try {
    const res = await fetch('https://demoanaf.ro/api/search?q=test', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

function itIfAnaf(name, fn, timeout) {
  if (HAS_ANAF) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: ANAF API unavailable)`, fn, timeout);
}

beforeAll(async () => {
  HAS_ANAF = await checkAnafAvailability();
  if (HAS_SOLR) {
    process.env.SOLR_AUTH = process.env.SOLR_AUTH;
  }
});

const TEST_CIF = '12018818';
const TEST_BRAND = 'SOBIS';
const ANOFM_API_URL = 'https://mediere.anofm.ro/api/entity/vw_public_job_posting';

describe('E2E: Full Scraping Pipeline', () => {

  describe('ANOFM API — Real Data Fetch', () => {
    let apiData;

    beforeAll(async () => {
      const res = await fetch(ANOFM_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'job_seeker_ro_spider'
        },
        body: JSON.stringify({
          current: 1,
          rowCount: 5,
          sort: { created_at: 'desc' },
          employer_tax_code: TEST_CIF
        })
      });
      apiData = await res.json();
    }, 15000);

    it('should respond with valid job data from ANOFM API', () => {
      expect(apiData).toHaveProperty('rows');
      expect(Array.isArray(apiData.rows)).toBe(true);
    }, 10000);

    it('if jobs exist, should have expected fields', () => {
      if (!apiData.rows || apiData.rows.length === 0) {
        console.log('No ANOFM jobs for CIF 12018818 — skipping field assertions');
        return;
      }

      const job = apiData.rows[0];
      expect(job).toHaveProperty('id');
      expect(job).toHaveProperty('occupation');
      expect(typeof job.occupation).toBe('string');
    });
  });

  describe('Parse + Transform Pipeline', () => {
    let index;

    beforeAll(async () => {
      index = await import('../../index.js');
    });

    it('should fetch jobs from ANOFM API via searchANOFM', async () => {
      const jobs = await index.searchANOFM(TEST_CIF, true);

      expect(Array.isArray(jobs)).toBe(true);

      if (jobs.length === 0) {
        console.log('No ANOFM jobs for CIF 12018818 — skipping further pipeline tests');
        return;
      }

      expect(jobs.length).toBeGreaterThan(0);

      const job = jobs[0];
      expect(job).toHaveProperty('url');
      expect(job.url).toMatch(/^https:\/\/mediere\.anofm\.ro\//);
      expect(job).toHaveProperty('title');
      expect(job).toHaveProperty('source', 'ANOFM');
    }, 30000);

    it('should map ANOFM jobs to job model', async () => {
      const jobs = await index.searchANOFM(TEST_CIF, true);

      if (jobs.length === 0) {
        console.log('No ANOFM jobs — skipping mapToJobModel test');
        return;
      }

      const model = index.mapToJobModel(jobs[0], TEST_CIF);

      expect(model).toHaveProperty('url');
      expect(model).toHaveProperty('title');
      expect(model.company).toContain('SOBIS SOLUTIONS');
      expect(model).toHaveProperty('cif', TEST_CIF);
      expect(model).toHaveProperty('status', 'scraped');
      expect(model).toHaveProperty('date');
      expect(model.url).toMatch(/^https:\/\/mediere\.anofm\.ro\//);
    }, 30000);

    it('should transform jobs and filter to Romanian locations', async () => {
      const jobs = await index.searchANOFM(TEST_CIF, true);

      if (jobs.length === 0) {
        console.log('No ANOFM jobs — skipping transformJobsForSOLR test');
        return;
      }

      const mappedJobs = jobs.map(j => index.mapToJobModel(j, TEST_CIF));

      const payload = {
        source: 'anofm.ro',
        company: 'SOBIS SOLUTIONS S.R.L.',
        cif: TEST_CIF,
        jobs: mappedJobs
      };

      const transformed = index.transformJobsForSOLR(payload);

      expect(transformed.company).toContain('SOBIS SOLUTIONS');
      expect(transformed.jobs.length).toBe(mappedJobs.length);

      for (const job of transformed.jobs) {
        expect(job).toHaveProperty('location');
        expect(Array.isArray(job.location)).toBe(true);
        expect(job.location.length).toBeGreaterThan(0);
      }
    }, 30000);
  });

  describe('Company Validation Path', () => {
    let anaf;
    let company;

    beforeAll(async () => {
      anaf = await import('../../src/anaf.js');
      company = await import('../../company.js');
    });

    itIfAnaf('should find SOBIS SOLUTIONS in ANAF and validate active status', async () => {
      const results = await anaf.searchCompany(TEST_BRAND);

      const sobis = results.find(c =>
        c.name.toUpperCase().startsWith('SOBIS SOLUTIONS') &&
        c.statusLabel === 'Funcțiune'
      );
      expect(sobis).toBeDefined();
      expect(sobis.cui.toString()).toBe(TEST_CIF);

      const anafData = await anaf.getCompanyFromANAF(TEST_CIF);
      expect(anafData).toBeDefined();
      expect(anafData.inactive).toBe(false);
    }, 30000);

    itIfSolr('should run full validation and report active status with job count', async () => {
      const result = await company.validateAndGetCompany();

      expect(result.status).toBe('active');
      expect(result.company).toBe('SOBIS SOLUTIONS S.R.L.');
      expect(result.cif).toBe(TEST_CIF);

      if (result.existingJobsCount === 0) {
        console.log('No SOBIS jobs in Solr — skipping job count assertion');
        return;
      }
      expect(result.existingJobsCount).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Inactive Company Handling', () => {
    let anaf;

    beforeAll(async () => {
      anaf = await import('../../src/anaf.js');
    });

    itIfAnaf('should detect inactive/radiated companies via ANAF', async () => {
      const results = await anaf.searchCompany('SOBIS');

      const nonActive = results.find(c => c.statusLabel !== 'Funcțiune');

      if (nonActive) {
        try {
          const anafData = await anaf.getCompanyFromANAF(nonActive.cui.toString());
          expect(anafData).toBeDefined();
          if (anafData.inactive !== undefined) {
            expect(anafData.inactive).toBe(true);
          }
        } catch {
          expect(nonActive.statusLabel).toMatch(/Radiată|Inactiv|Suspendat/);
        }
      }
    }, 30000);
  });

  describe('SOLR Data Verification', () => {
    let solr;

    beforeAll(async () => {
      solr = await import('../../solr.js');
    });

    itIfSolr('should have SOBIS jobs in SOLR with correct company name', async () => {
      const result = await solr.querySOLR(TEST_CIF);

      if (result.numFound === 0) {
        console.log('No SOBIS jobs in Solr — skipping SOLR data verification');
        return;
      }

      for (const job of result.docs) {
        expect(job.company).toContain('SOBIS SOLUTIONS');
        expect(job.cif).toBe(TEST_CIF);
      }
    }, 15000);

    itIfSolr('should have SOBIS company core entry with required fields', async () => {
      const result = await solr.queryCompanySOLR(`id:${TEST_CIF}`);

      expect(result.numFound).toBe(1);
      const sobis = result.docs[0];
      expect(sobis.company).toContain('SOBIS SOLUTIONS');
      expect(sobis.status).toBe('activ');
    }, 15000);
  });
});
