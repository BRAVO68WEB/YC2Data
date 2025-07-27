import { z } from "zod";

export const configSchema = z.object({
  YC_USERNAME: z.string(),
  YC_PASSWORD: z.string(),
  ALGOLIA_APP_ID: z.string(),
  ALGOLIA_API_KEY: z.string(),
});

export const config = configSchema.parse(process.env);