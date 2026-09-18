import { test, expect, type BrowserContext, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
async function setup(context: BrowserContext, info: TestInfo, native = false) {
  const fixtures = JSON.parse(fs.readFileSync(".mobile-qa/fixtures.json", "utf8"));
  const [, , locale, theme] = info.project.name.split("-");
  const origin = info.project.use.baseURL!;
  const user = fixtures.users.admin;
  await context.addCookies([{name:"podium_locale",value:locale,url:origin},{name:"podium_theme",value:theme,url:origin},
    {name:process.env.MOBILE_QA_PRODUCTION === "1" ? "__Secure-next-auth.session-token" : "next-auth.session-token",url:origin,secure:process.env.MOBILE_QA_PRODUCTION === "1",value:await encode({secret:process.env.NEXTAUTH_SECRET!,token:{sub:user.id,...user,status:"active",accessRoleId:null,locale,expiresAt:Date.now()+3600000,refreshedAt:Date.now()}})}]);
  if (native) await context.addInitScript((portrait: boolean) => {
    const surface = window as typeof window & { CapacitorCustomPlatform?: {name:string}; Capacitor?: unknown };
    surface.CapacitorCustomPlatform = {name:"ios"};
    surface.Capacitor = {isNativePlatform:()=>true,getPlatform:()=>"ios"};
    Object.defineProperty(window,"orientation",{value:portrait ? 0 : 90,configurable:true});
  },info.project.use.viewport!.width < 844);
  return fixtures;
}

test("slow tab navigation responds immediately and remains interruptible", async ({page,context},info) => {
  test.skip(info.project.use.viewport!.width > 900);
  await setup(context,info);
  await page.goto("/series/mobile-qa-live/registrations");
  await expect(page.locator("html")).toHaveAttribute("data-mobile-ready","true");
  await page.route("**/*_rsc=*",async route=>{await new Promise(resolve=>setTimeout(resolve,1800));await route.continue();});
  await page.locator('.mobile-tabbar:visible a[href="/series/mobile-qa-live/waves"]').click();
  // Either the prefetched skeleton or the cold-link indicator responds while
  // the deliberately delayed server payload is still unavailable.
  await expect(page.locator('[data-route-loading], [data-navigation-pending="true"]').first()).toBeVisible({timeout:800});
  await expect(page.locator('.mobile-tabbar:visible')).toBeVisible();
  await page.locator('.mobile-tabbar:visible a[href="/series/mobile-qa-live/results"]').click();
  await expect(page).toHaveURL(/\/results$/);
  await expect(page.locator('[data-route-loading]')).toHaveCount(0);
  await expect(page.locator('.mobile-tabbar:visible [aria-current="page"]')).toHaveAttribute('href','/series/mobile-qa-live/results');
});

test("installed iOS back stays below the clock after scrolling and direct details", async ({page,context},info) => {
  const fixtures=await setup(context,info,true);
  const id=fixtures.series.find((series:{status:string})=>series.status==="live").teams[0];
  for(const route of [`/series/mobile-qa-live/registrations/${id}/edit`,"/account"]) {
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('data-native-platform','ios');
    await expect(page.locator('.mobile-back:visible')).toHaveCount(1);
    for(const scroll of [0,600,3000,0]) {
      await page.evaluate(y=>window.scrollTo(0,y),scroll);
      const bounds=await page.locator('.mobile-back:visible').boundingBox();
      // Desktop Playwright has no real env inset; portrait tests exercise the
      // legacy-shell fallback. This does not claim physical-device coverage.
      const minimum=info.project.use.viewport!.width < 844 ? 64 : 0;
      expect(bounds!.y).toBeGreaterThanOrEqual(minimum);
      expect(bounds!.height).toBeGreaterThanOrEqual(48);
      expect(bounds!.y+bounds!.height).toBeLessThan(180);
      const hit=await page.locator('.mobile-back:visible').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
      expect(hit).toBe(true);
    }
  }
  if(info.project.use.viewport!.width < 844) {
    await page.setViewportSize({width:390,height:350});
    await expect.poll(async()=> (await page.locator('.mobile-back:visible').boundingBox())!.y).toBeGreaterThanOrEqual(64);
    await page.setViewportSize(info.project.use.viewport!);
  }
  await page.locator('.mobile-back:visible').click();
  await expect(page).not.toHaveURL(/\/account$/);
  await expect(page.locator('[data-route-loading]')).toHaveCount(0);
  await expect(page.locator('.mobile-back:visible')).toHaveCount(1);
  const folder=`.mobile-qa/navigation-review/${info.project.name}`;
  fs.mkdirSync(folder,{recursive:true});
  await page.screenshot({path:`${folder}/ios-header.png`});
});

test("timer updates do not rescan unrelated tables",async({page,context},info)=>{
  test.skip(info.project.use.viewport!.width > 900);
  await setup(context,info);
  await page.goto('/account');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-ready','true');
  const counts=await page.evaluate(async()=>{
    const table=document.createElement('table');table.className='table';table.innerHTML='<thead><tr><th>Name</th></tr></thead><tbody><tr><td>Example</td></tr></tbody>';
    const timer=document.createElement('span');document.body.append(table,timer);
    const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    await frame();
    const label=table.querySelector('td')!.dataset.label;
    let reads=0;
    const original=table.querySelectorAll.bind(table);
    table.querySelectorAll=((selector:string)=>{reads++;return original(selector);}) as typeof table.querySelectorAll;
    for(let i=0;i<8;i++){timer.textContent=String(i);await frame();}
    table.remove();timer.remove();return {label,reads};
  });
  expect(counts).toEqual({label:'Name',reads:0});
});
