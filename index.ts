import { config } from "./config";
import axios, { type AxiosResponse } from "axios";
import { promises as fs } from 'fs';

// Types for the API responses
interface AlgoliaHit {
  company_id: number;
}

interface AlgoliaResponse {
  results: Array<{
    hits: AlgoliaHit[];
    nbHits: number;
  }>;
}

interface Job {
  id: number;
  title: string;
  department?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  equity_min?: number;
  equity_max?: number;
  pretty_min_experience?: string;
  pretty_job_type?: string;
  pretty_role?: string;
  pretty_salary_range?: string;
}

interface Company {
  id: number;
  name: string;
  website?: string;
  description?: string;
  jobs: Job[];
  team_size?: number;
  founders?: Array<{
    full_name?: string;
    linkedin?: string;
    founder_bio?: string;
  }>;
  primary_vertical?: string;
  website_display?: string;
  country?: string;
}

interface CompanyResponse {
  companies: Company[];
}

// Target format for output
export interface OutputCompany {
  name: string;
  website: string;
  team_size?: number;
  founders?: Array<{
    full_name?: string;
    linkedin?: string;
    founder_bio?: string;
  }>;
  primary_vertical?: string;
  website_display?: string;
  country?: string;
  jobs: Array<{
    name: string;
    pretty_min_experience?: string;
    pretty_job_type?: string;
    pretty_role?: string;
    pretty_salary_range?: string;
  }>;
}

export class YCDataExtractor {
  private session: {
    cookies: string;
    csrfToken: string;
  } | null = null;

  constructor() {
    // Set up axios defaults
    axios.defaults.timeout = 30000;
  }

  /**
   * Login to YC account and get session cookies
   */
  private async login(): Promise<void> {
    try {
      console.log("Logging in to YC account...");
      
      // Step 1: Get the login page to extract CSRF token
      const loginPageResponse = await axios.get("https://account.ycombinator.com/?continue=https%3A%2F%2Fwww.workatastartup.com%2F", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "DNT": "1",
          "Sec-GPC": "1",
          "Connection": "keep-alive",
          "Upgrade-Insecure-Requests": "1"
        }
      });

      // Extract initial cookies and CSRF token
      const initialCookies = loginPageResponse.headers['set-cookie']?.map(cookie => cookie.split(';')[0]).join('; ') || '';
      const csrfMatch = loginPageResponse.data.match(/name="csrf-token" content="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : '';

      if (!csrfToken) {
        throw new Error("Failed to extract CSRF token from login page");
      }

      // Step 2: Perform login
      const loginPayload = {
        ycid: config.YC_USERNAME,
        password: config.YC_PASSWORD,
        captcha: null,
        totp: "",
        continue: "https://www.workatastartup.com/"
      };

      const loginResponse = await axios.post("https://account.ycombinator.com/sign_in", loginPayload, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Referer": "https://account.ycombinator.com/?continue=https%3A%2F%2Fwww.workatastartup.com%2F",
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "x-requested-with": "XMLHttpRequest",
          "Origin": "https://account.ycombinator.com",
          "DNT": "1",
          "Sec-GPC": "1",
          "Connection": "keep-alive",
          "Cookie": initialCookies,
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin"
        },
        maxRedirects: 0,
        validateStatus: (status) => status < 400 || status === 302
      });

      // Step 3: Get session cookies after successful login
      const allCookies = [
        ...loginPageResponse.headers['set-cookie'] || [],
        ...loginResponse.headers['set-cookie'] || []
      ];
      
      const sessionCookies = allCookies.map(cookie => cookie.split(';')[0]).join('; ');

      // Step 4: Visit workatastartup.com to get the final session
      const waasResponse = await axios.get("https://www.workatastartup.com/companies", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Cookie": sessionCookies,
          "DNT": "1",
          "Sec-GPC": "1",
          "Connection": "keep-alive",
          "Upgrade-Insecure-Requests": "1"
        }
      });

      // Extract WAAS CSRF token
      const waasCsrfMatch = waasResponse.data.match(/name="csrf-token" content="([^"]+)"/);
      const waasCsrfToken = waasCsrfMatch ? waasCsrfMatch[1] : '';

      // Combine all cookies
      const finalCookies = [
        ...allCookies,
        ...waasResponse.headers['set-cookie'] || []
      ].map(cookie => cookie.split(';')[0]).join('; ');

      this.session = {
        cookies: finalCookies,
        csrfToken: waasCsrfToken
      };

      console.log("Successfully logged in and established session");
    } catch (error) {
      console.error("Failed to login:", error);
      throw new Error(`Login failed: ${error}`);
    }
  }

  /**
   * Fetch company IDs using Algolia search
   */
  private async fetchCompanyIds(page: number = 0, hitsPerPage: number = 100): Promise<number[]> {
    try {
      console.log(`Fetching company IDs (page ${page + 1})...`);

      const payload = {
        requests: [
          {
            indexName: "WaaSPublicCompanyJob_created_at_desc_production",
            params: `query=&page=${page}&filters=(us_visa_required%3Anone%20OR%20us_visa_required%3Apossible)&attributesToRetrieve=%5B%22company_id%22%5D&attributesToHighlight=%5B%5D&attributesToSnippet=%5B%5D&hitsPerPage=${hitsPerPage}&clickAnalytics=true&distinct=true`
          }
        ]
      };

      const response: AxiosResponse<AlgoliaResponse> = await axios.post(
        `https://${config.ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries`,
        payload,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Referer": "https://www.workatastartup.com/",
            "content-type": "application/json",
            "Origin": "https://www.workatastartup.com",
            "Sec-GPC": "1",
            "Connection": "keep-alive",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "cross-site",
            "x-algolia-agent": "Algolia for JavaScript (3.35.1); Browser",
            "x-algolia-application-id": config.ALGOLIA_APP_ID,
            "x-algolia-api-key": config.ALGOLIA_API_KEY
          }
        }
      );

      const companyIds = response.data.results[0]?.hits?.map(hit => hit.company_id) || [];
      console.log(`Found ${companyIds.length} company IDs`);
      
      return companyIds;
    } catch (error) {
      console.error("Failed to fetch company IDs:", error);
      throw error;
    }
  }

  /**
   * Fetch company details for given IDs
   */
  private async fetchCompanyDetails(companyIds: number[]): Promise<Company[]> {
    if (!this.session) {
      await this.login();
    }

    try {
      console.log(`Fetching details for ${companyIds.length} companies...`);

      const response: AxiosResponse<CompanyResponse> = await axios.post(
        "https://www.workatastartup.com/companies/fetch",
        { ids: companyIds },
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Referer": "https://www.workatastartup.com/companies",
            "content-type": "application/json",
            "x-csrf-token": this.session!.csrfToken,
            "x-requested-with": "XMLHttpRequest",
            "Origin": "https://www.workatastartup.com",
            "Sec-GPC": "1",
            "Connection": "keep-alive",
            "Cookie": this.session!.cookies,
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "Pragma": "no-cache",
            "Cache-Control": "no-cache"
          }
        }
      );

      console.log(`Successfully fetched details for ${response.data.companies?.length || 0} companies`);
      return response.data.companies || [];
    } catch (error) {
      console.error("Failed to fetch company details:", error);
      throw error;
    }
  }

  /**
   * Format company data to match the required output structure
   */
  private formatCompanyData(companies: Company[]): OutputCompany[] {
    return companies.map(company => ({
      name: company.name || "",
      website: company.website || "",
      team_size: company.team_size,
      founders: company.founders || [],
      primary_vertical: company.primary_vertical,
      website_display: company.website_display,
      country: company.country,
      jobs: (company.jobs || []).map(job => ({
        name: job.title || "",
        pretty_min_experience: job.pretty_min_experience,
        pretty_job_type: job.pretty_job_type,
        pretty_role: job.pretty_role,
        pretty_salary_range: job.pretty_salary_range
      }))
    }));
  }

  /**
   * Main extraction method
   */
  async extractData(maxCompanies: number = 50): Promise<OutputCompany[]> {
    try {
      console.log("Starting YC data extraction...");

      // Calculate how many pages we need to get the desired number of companies
      const hitsPerPage = Math.min(maxCompanies, 100);
      const numPages = Math.ceil(maxCompanies / hitsPerPage);

      let allCompanyIds: number[] = [];

      // Fetch company IDs from multiple pages if needed
      for (let page = 0; page < numPages && allCompanyIds.length < maxCompanies; page++) {
        const companyIds = await this.fetchCompanyIds(page, hitsPerPage);
        allCompanyIds = [...allCompanyIds, ...companyIds];
        
        // Small delay between requests to be respectful
        if (page < numPages - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Limit to the requested number
      allCompanyIds = allCompanyIds.slice(0, maxCompanies);

      if (allCompanyIds.length === 0) {
        console.log("No company IDs found");
        return [];
      }

      // Fetch company details in batches to avoid overwhelming the server
      const batchSize = 20;
      let allCompanies: Company[] = [];

      for (let i = 0; i < allCompanyIds.length; i += batchSize) {
        const batch = allCompanyIds.slice(i, i + batchSize);
        const companies = await this.fetchCompanyDetails(batch);
        allCompanies = [...allCompanies, ...companies];
        
        // Small delay between batches
        if (i + batchSize < allCompanyIds.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      const formattedData = this.formatCompanyData(allCompanies);
      
      console.log(`\nExtraction completed successfully!`);
      console.log(`Total companies extracted: ${formattedData.length}`);
      console.log(`Total jobs found: ${formattedData.reduce((sum, company) => sum + company.jobs.length, 0)}`);

      return formattedData;

    } catch (error) {
      console.error("Data extraction failed:", error);
      throw error;
    }
  }
}

// Main execution
async function main() {
  try {
    const extractor = new YCDataExtractor();
    
    // Extract data for 30 companies (you can adjust this number)
    const data = await extractor.extractData(537);
    
    // Output the formatted JSON
    console.log("\n" + "=".repeat(50));
    console.log("EXTRACTED DATA:");
    console.log("=".repeat(50));

    // Also save to a file
    await fs.writeFile('yc_companies_data.json', JSON.stringify(data, null, 2));
    console.log("\n✅ Data saved to yc_companies_data.json");

  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.main) {
  main();
}

