const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "e2e", use: { baseURL: "http://localhost:3000" },
  webServer: [
    { command: "npm run dev", url: "http://localhost:4000/api/orders?status=WAITING", timeout: 60000 },
    { command: "npm run web", url: "http://localhost:3000", timeout: 60000 },
  ],
});
