# YC Work Portal Data Extractor

A TypeScript program that extracts company and job data from Y Combinator's Work at a Startup portal.

## Features

- Extracts company information from YC's Work portal
- Fetches job listings for each company
- Outputs data in clean JSON format
- Handles API rate limiting and batching
- Automatic login with YC credentials
- Session management for authenticated requests

## Output Format

The program generates a JSON array with the following structure:

```json
[
  {
    "name": "Company Name",
    "website": "https://company-website.com",
    "jobs": [
      {
        "name": "Job Title"
      }
    ]
  }
]
```

## Setup

1. **Install dependencies:**
   ```bash
   bun install
   ```

2. **Set up environment variables:**
   Create a `.env` file with your YC credentials:
   ```env
   YC_USERNAME=your_yc_username
   YC_PASSWORD=your_yc_password
   X_ALGOLIA_APP_ID=
   X_ALGOLIA_API_KEY=
   ```
> Note: ALGOLIA keys can be found via checking requests in the network tab of your browser.

## Usage

### Basic Usage

```bash
bun run index.ts
```

This will extract data for 30 companies by default and save the results to `yc_companies_data.json`.

### Customizing the Number of Companies

You can modify the `maxCompanies` parameter in the `main()` function:

```typescript
const data = await extractor.extractData(50); // Extract 50 companies
```

## How It Works

The extractor works in three main steps:

1. **Authentication:** Logs into YC account automatically
   - Gets login page from `https://account.ycombinator.com/`
   - Extracts CSRF token and performs login
   - Establishes authenticated session with cookies

2. **Company ID Discovery:** Uses Algolia search API to find company IDs
   - Endpoint: `https://X_ALGOLIA_APP_ID-dsn.algolia.net/1/indexes/*/queries`
   - Searches for companies with specific visa requirements
   - Retrieves company IDs in batches

3. **Company Details Fetch:** Gets detailed company and job information
   - Endpoint: `https://www.workatastartup.com/companies/fetch`
   - Uses authenticated session cookies and CSRF tokens
   - Fetches company details and associated job listings

## API Rate Limiting

The program includes built-in rate limiting:
- 1 second delay between Algolia page requests
- 2 second delay between company detail batches
- Processes companies in batches of 20

## Technical Details

### Dependencies
- **axios**: HTTP client for API requests  
- **zod**: Environment variable validation

### Error Handling
- Automatic session initialization
- Request retry logic
- Graceful handling of API errors
- Detailed logging throughout the process

### Data Validation
- TypeScript interfaces for API responses
- Zod schemas for configuration validation
- Input sanitization and error checking

## Files Generated

- `yc_companies_data.json`: Main output file with extracted data
- Console logs: Real-time progress and statistics

## Development

The program is structured as a class-based extractor with the following main methods:

- `login()`: Handles YC account authentication
- `fetchCompanyIds()`: Gets company IDs from Algolia
- `fetchCompanyDetails()`: Retrieves detailed company info
- `formatCompanyData()`: Converts to required output format
- `extractData()`: Main orchestration method

## License

This project is for educational and research purposes. Please respect Y Combinator's terms of service when using this tool.
