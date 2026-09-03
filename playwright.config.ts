import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 20_000,
  fullyParallel: false,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: {
    command: "env GEMINI_API_KEY= RAZORPAY_KEY_ID= RAZORPAY_KEY_SECRET= CHOOSY_OPERATOR_ACCESS_CODE= CHOOSY_SESSION_SECRET= USE_SUPABASE_COMMERCE=false npm run dev -- --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
