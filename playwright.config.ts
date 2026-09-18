import { defineConfig } from "@playwright/test";

const baseURL=process.env.MOBILE_QA_URL ?? "http://127.0.0.1:3100";
if(!["localhost","127.0.0.1","[::1]"].includes(new URL(baseURL).hostname)) throw new Error("Mobile QA only runs against a local server.");
const reportName = process.env.MOBILE_QA_REPORT;
if (reportName && !/^[a-z0-9-]+$/.test(reportName)) throw new Error("Invalid local QA report name.");
const reportFolder = `.mobile-qa/report${reportName ? `/${reportName}` : ""}`;

const projects = ["chromium","webkit"].flatMap((browser) => [320,375,390,430,768,1024].flatMap((width) => ["en","ar"].flatMap((locale) => ["dark","light"].map((theme) => ({
  name:`${browser}-${width}-${locale}-${theme}`,
  use:{ browserName:browser as "chromium"|"webkit", viewport:{width,height:844}, locale, colorScheme:theme as "dark"|"light", ...(browser === "chromium" && baseURL.startsWith("https://") ? {launchOptions:{args:["--ignore-certificate-errors"]}} : {}) },
})))));

export default defineConfig({
  testDir:"./e2e", timeout:180_000, expect:{timeout:15_000}, workers:2,
  reporter:[["list"],["html",{outputFolder:reportFolder,open:"never"}],["json",{outputFile:`${reportFolder}/results.json`}]],
  outputDir:`.mobile-qa/results${reportName ? `/${reportName}` : ""}`, projects,
  use:{baseURL,ignoreHTTPSErrors:true,serviceWorkers:"block",trace:"retain-on-failure",screenshot:"only-on-failure"},
  webServer:{command:"npm run dev -- --hostname 127.0.0.1 --port 3100",url:`${baseURL}/login`,ignoreHTTPSErrors:true,reuseExistingServer:true,timeout:120_000},
});
