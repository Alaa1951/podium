import { test, expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";
import { signViewAs, VIEW_AS_COOKIE } from "../src/lib/view-as-token";
loadEnvConfig(process.cwd());

type Fixtures = {authTokens?:{invite:string;reset:string};accessRoleId:string;users:Record<string,{id:string;email:string;name:string;role:"admin"|"studio"|"competitor";studioId:string|null}>;series:{slug:string;status:string;teams:string[];waveId:string;zoneId?:string}[]};
const fixtureFile=path.resolve('.mobile-qa/fixtures.json');
const fixtures:Fixtures|null=fs.existsSync(fixtureFile)?JSON.parse(fs.readFileSync(fixtureFile,'utf8')):null;
const live=fixtures?.series.find(item=>item.status==='live');

async function reviewFrame(page:Page, info:TestInfo, name:string){
  if(!['chromium-390-en-dark','webkit-390-ar-light','chromium-1024-en-dark','webkit-1024-en-dark'].includes(info.project.name))return;
  const folder=`.mobile-qa/screenshots/${info.project.name}`;fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:`${folder}/${name}_frame.png`});
}

async function setup(context:BrowserContext,info:TestInfo,role?:string){
  const [,width,locale,theme]=info.project.name.split('-');
  const localURL=info.project.use.baseURL ?? 'http://127.0.0.1:3100';
  await context.addCookies([{name:'podium_locale',value:locale,url:localURL},{name:'podium_theme',value:theme,url:localURL}]);
  if(role){
    if(!fixtures)throw new Error('Run npm run mobile:fixtures before signed-in mobile QA.');
    const user=fixtures.users[role];
    const value=await encode({secret:process.env.NEXTAUTH_SECRET!,token:{sub:user.id,...user,status:'active',accessRoleId:role==='limited'?fixtures.accessRoleId:null,locale,expiresAt:Date.now()+3600000,refreshedAt:Date.now()}});
    await context.addCookies([{name:process.env.MOBILE_QA_PRODUCTION==='1'?'__Secure-next-auth.session-token':'next-auth.session-token',value,url:localURL,secure:process.env.MOBILE_QA_PRODUCTION==='1'}]);
  }
  return Number(width);
}

async function verifyLayout(page:Page,route:string,info:TestInfo){
  const errors:string[]=[];const onError=(error:Error)=>{if(error.message.includes("127.0.0.1:3100")&&error.message.includes("_rsc=")&&error.message.endsWith("due to access control checks."))return;errors.push(error.message);};page.on("pageerror",onError);
  const response = await page.goto(route);
  expect(response?.status(),route).toBeLessThan(500);
  if (route.startsWith("/series/") || route.startsWith("/studio/") || route.startsWith("/users/") || route.startsWith("/roles/")) expect(response?.status(),route).toBe(200);
  await page.locator('body').waitFor();
  await expect(page.locator('html')).toHaveAttribute('data-mobile-ready','true');
  await expect(page.locator('html')).toHaveAttribute('lang',info.project.name.includes('-ar-')?'ar':'en');
  await page.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--mobile-nav-h').trim().length>0, undefined, {timeout:15_000});
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(150);
  if(route.startsWith('/results')){const text=await page.locator('body').innerText();expect(text).not.toContain('+97412345678');expect(text).not.toMatch(/person-.*@mobile-qa\.invalid/);}
  const overflow=await page.evaluate(()=>Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(el=>{
    const style=getComputedStyle(el),rect=el.getBoundingClientRect();
    if(style.display==='none'||style.position==='absolute'||rect.width<=1||el.closest('dialog:not([open]),[hidden],thead'))return false;
    // A desktop table or sponsor rail can intentionally scroll inside a clipped container.
    if(document.documentElement.clientWidth > 900 && el.closest('.table-scroll,.sponsor-track'))return false;
    return rect.left < -1 || rect.right > document.documentElement.clientWidth+1 || (el.classList.contains('table-scroll')&&el.scrollWidth>el.clientWidth+1);
  }).map(el=>`${el.tagName}.${el.className}`).slice(0,12));
  expect(overflow,route).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),route).toBe(true);
  if(route.startsWith('/results') || route.endsWith('/board')){
    const contrast=await page.evaluate(()=>Array.from(document.querySelectorAll<HTMLElement>('.picker-select,.pb-select,.picker-choice')).filter(el=>el.getBoundingClientRect().height>0).map(el=>{
      const style=getComputedStyle(el),luminance=(color:string)=>{const channels=color.match(/[\d.]+/g)!.slice(0,3).map(value=>{const channel=Number(value)/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;});return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
      const a=luminance(style.color),b=luminance(style.backgroundColor);return {ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),scheme:style.colorScheme,select:el.tagName==='SELECT'};
    }));
    for(const control of contrast){expect(control.ratio,route).toBeGreaterThanOrEqual(4.5);if(control.select)expect(control.scheme).toContain('dark');}
  }
  const bar=page.locator('.mobile-tabbar:visible');
  if(await bar.count()){
    const box=await bar.first().boundingBox();expect(box!.y+box!.height).toBeLessThanOrEqual(845);
    for(const button of await bar.first().locator('a,button').all()){const rect=await button.boundingBox();expect(rect!.height).toBeGreaterThanOrEqual(48);}
    const title=page.locator('.mobile-heading-title:visible');
    if(await title.count())expect((await title.first().boundingBox())!.height).toBeGreaterThanOrEqual(48);
    if(route.includes('/scores/')){
      const save=page.locator('.team-entry-save');await expect(save).toBeVisible();const action=await save.boundingBox();expect(action!.height).toBeGreaterThanOrEqual(48);expect(action!.y+action!.height).toBeLessThanOrEqual(box!.y+1);
    }
  }
  if(route.startsWith('/roles/') && route.endsWith('/edit') && info.project.name.split('-')[1] !== '1024'){
    const save=page.locator('.mobile-action-bar button').first();await expect(save).toBeVisible();const box=await save.boundingBox();expect(box!.y+box!.height).toBeLessThanOrEqual((await bar.first().boundingBox())!.y+1);
  }
  if(['chromium-390-en-dark','webkit-390-ar-light'].includes(info.project.name)){const folder=`.mobile-qa/screenshots/${info.project.name}`;fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:`${folder}/${route.split("?")[0].replace(/[^\w-]/g,'_')||'home'}.png`,fullPage:true});await page.screenshot({path:`${folder}/${route.split("?")[0].replace(/[^\w-]/g,"_")||"home"}_frame.png`});}
  page.off("pageerror",onError);expect(errors,route).toEqual([]);
  fs.mkdirSync(".mobile-qa/coverage",{recursive:true});fs.appendFileSync(`.mobile-qa/coverage/${info.project.name}.jsonl`,JSON.stringify({route:route.split("?")[0],scenario:info.title,status:response?.status(),checkedAt:new Date().toISOString()})+"\n");
}

test('public and authentication screens fit without sideways scrolling',async({page,context},info)=>{
  await setup(context,info);
  const final=fixtures?.series.find(item=>item.status==='final');
  const routes=['/login','/competitor','/forgot-password','/reset-password','/activate','/verify','/results','/privacy','/missing-mobile-qa'];
  if(fixtures?.authTokens)routes.push(`/activate?token=${fixtures.authTokens.invite}`,`/reset-password?token=${fixtures.authTokens.reset}`,`/verify?email=${encodeURIComponent(fixtures.users.studio.email)}`);
  if(final)routes.push(`/results/${final.slug}/Womens/Rookie`,`/results/${final.slug}/team/${final.teams[0]}`);
  for(const route of routes)await verifyLayout(page,route,info);
});

for(const role of ['admin','studio','competitor','limited'])test(`${role}: role screens and details fit`,async({page,context},info)=>{
  test.skip(!fixtures,'Local mobile fixtures have not been created.');
  const width=await setup(context,info,role);
  const event=live!;
  const routes=role==='admin'?['/','/series','/series/new','/studios','/users','/roles','/audit','/announcements','/account',...['','studios','registrations','registrations/new','waves','scores','results','settings','board'].map(section=>`/series/${event.slug}${section?'/'+section:''}`),`/users/${fixtures!.users.studio.id}`,`/users/${fixtures!.users.studio.id}/edit`,`/series/${event.slug}/registrations/${event.teams[0]}`,`/series/${event.slug}/registrations/${event.teams[0]}/people/${event.teams[0]}-person-1`,`/series/${event.slug}/scores/${event.teams[0]}`]
   :role==='studio'?['/studio','/studio/announcements','/account',...['','teams','waves','scores','results'].map(section=>`/studio/${event.slug}${section?'/'+section:''}`),`/studio/${event.slug}/teams/${event.teams[0]}`,`/studio/${event.slug}/teams/${event.teams[0]}/edit`,`/studio/${event.slug}/scores/${event.teams[0]}`]
   :role==='competitor'?['/me','/my-wave','/account','/results']:['/my-wave','/account',`/series/${event.slug}/scores`];
  if(role==='admin')routes.push(`/series/${event.slug}/results/${event.teams[0]}`,`/series/${event.slug}/registrations/${event.teams[0]}/edit`,'/missing-mobile-qa','/users/new','/announcements/new','/announcements/mobile-e2e-notice-own','/audit/mobile-e2e-audit','/notifications','/notifications/mobile-e2e-notice-own','/studios/mobile-e2e-studio','/studios/mobile-e2e-studio/edit',`/roles/${fixtures!.accessRoleId}`,`/roles/${fixtures!.accessRoleId}/edit`,`/series/${event.slug}/waves/${event.waveId}`,`/series/${event.slug}/waves/${event.waveId}/edit`);
  if(role==='admin' && event.zoneId)routes.push(`/series/${event.slug}/settings/zones`,`/series/${event.slug}/settings/zones/new`,`/series/${event.slug}/settings/zones/${event.zoneId}`,`/series/${event.slug}/settings/zones/${event.zoneId}/edit`);
  if(role==='studio')routes.push('/studio/announcements/mobile-e2e-notice-studio','/notifications','/notifications/mobile-e2e-notice-own','/studio/announcements/new',`/studio/${event.slug}/waves/${event.waveId}`,`/studio/${event.slug}/teams/${event.teams[0]}/people/${event.teams[0]}-person-1`,`/studio/${event.slug}/results/${event.teams[0]}`);
  if(role==='competitor')routes.push('/me/edit');
  if(role==='limited')routes.push(`/my-wave/${event.teams[0]}`,`/series/${event.slug}/scores/${event.teams[0]}`);
  for(const route of routes){await verifyLayout(page,route,info);if(width<=900&&role==='competitor')await expect(page.locator('.personal-tabbar')).toBeVisible();if(role==='limited'&&route.includes('/series/')){if(route.includes('/scores/'))await expect(page.locator('.team-entry-save')).toBeDisabled();await expect(page.locator('.mobile-tabbar a[href$="/registrations"]')).toHaveCount(0);await expect(page.locator('.mobile-tabbar a[href$="/waves"]')).toHaveCount(0);}}
  if(role==='limited'){await page.goto('/users');await expect(page).toHaveURL(/\/my-wave$/);await expect(page.getByRole('link',{name:'Create an account',exact:true})).toHaveCount(0);}
});

test('direct details have a parent; dirty forms and bottom filters behave',async({page,context},info)=>{
  test.skip(!fixtures || !info.project.name.endsWith('390-en-dark'),'Behavior runs once in each engine.');
  await setup(context,info,'admin');
  await page.goto(`/users/${fixtures!.users.studio.id}/edit`);
  await expect(page.locator('html')).toHaveAttribute('data-mobile-ready','true');
  await page.locator('input').first().fill('Changed mobile draft');
  await expect(page.locator('.account-editor')).toHaveAttribute('data-unsaved','true');
  let prompts=0;page.on('dialog',async dialog=>{prompts++;await dialog.dismiss();});
  await page.locator('.mobile-back').click();await expect(page).toHaveURL(/\/edit$/);expect(prompts).toBe(1);
  page.removeAllListeners('dialog');page.on('dialog',async dialog=>dialog.accept());
  await page.locator('.mobile-back').click();await expect(page).toHaveURL(new RegExp(`/users/${fixtures!.users.studio.id}$`));
  {await page.getByRole("link",{name:"Edit",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("data-mobile-ready","true");await page.locator("input").first().fill("Browser Back draft");await expect(page.locator(".account-editor")).toHaveAttribute("data-unsaved","true");
  page.removeAllListeners("dialog");page.on("dialog",async dialog=>dialog.dismiss());await page.goBack();await expect(page).toHaveURL(/\/edit$/);await expect(page.locator("input").first()).toHaveValue("Browser Back draft");}
  page.removeAllListeners("dialog");page.on("dialog",async dialog=>dialog.accept());
  await page.goto(`/series/${live!.slug}/registrations`);
  await page.getByRole('button',{name:'Filters',exact:true}).click();await expect(page.locator('dialog.filter-sheet')).toBeVisible();
  await page.getByRole('combobox',{name:'Payment',exact:true}).selectOption('pending');
  await expect(page).toHaveURL(/payment=pending/);await reviewFrame(page,info,'filters');await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.locator('dialog.filter-sheet')).not.toBeVisible();await page.locator('.mobile-list-card').first().click();
  await page.locator('html').evaluate(el=>el.setAttribute('data-keyboard','true'));await expect(page.locator('.mobile-tabbar:visible')).toHaveCount(0);
  // Payment moved to the CRM, so the action that has to fit here is check-in.
  // The button this used to measure no longer exists, and asserting that is
  // part of the point: a payment control reappearing on this screen would be
  // a second owner for a figure the CRM owns.
  await expect(page.getByRole('button',{name:'Confirm payment',exact:true})).toHaveCount(0);
  const action=page.getByRole('button',{name:/^Check(ed)? in$/});
  await action.scrollIntoViewIfNeeded();
  const box=await action.boundingBox();expect(box!.y+box!.height).toBeLessThanOrEqual(844);
});

test('tablet app layout stays mobile above the browser breakpoint',async({page,context},info)=>{
  test.skip(!fixtures || !info.project.name.endsWith('1024-en-dark'),'Tablet platform simulation runs once in each engine; this is not a device test.');
  await setup(context,info,'admin');await page.goto('/users');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-ready','true');await expect(page.locator('.console-nav')).toBeVisible();await expect(page.locator('.mobile-tabbar').first()).toBeHidden();
  await reviewFrame(page,info,'desktop-users');
  await context.addInitScript(()=>{
    const surface=window as unknown as Record<string,unknown>;
    surface.CapacitorCustomPlatform={name:'ios'};surface.Capacitor={isNativePlatform:()=>true};
  });
  await page.goto(`/series/${live!.slug}/registrations`);
  await expect(page.locator('html')).toHaveAttribute('data-native','true');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-ready','true');
  await expect(page.locator('.mobile-tabbar').first()).toBeVisible();
  await expect(page.locator('.console-nav')).toBeHidden();
  await expect(page.locator('.mobile-list-card').first()).toBeVisible();
  expect(await page.locator('.mobile-list').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
  await reviewFrame(page,info,'tablet-app');
});

test('details preserve filters and Back; More is a screen',async({page,context},info)=>{
  test.skip(!fixtures||!info.project.name.includes('-390-'),'Interaction scenarios run at the representative phone width.');
  await setup(context,info,'admin');
  await page.goto(`/series/${live!.slug}/registrations?q=Mobile`);
  await page.locator('.mobile-list-card').last().scrollIntoViewIfNeeded();const scroll=await page.evaluate(()=>window.scrollY);
  await page.locator('.mobile-list-card').last().click();await expect(page).toHaveURL(/\/registrations\/mobile-e2e/);
  await page.getByRole('button',{name:info.project.name.includes('-ar-')?'رجوع':'Back',exact:true}).click();
  await expect(page).toHaveURL(/q=Mobile/);
  await expect.poll(()=>page.evaluate(()=>{
    const saved=JSON.parse(sessionStorage.getItem('podium:list:'+location.pathname)!);
    return Math.abs(window.scrollY-Number(saved.scroll));
  })).toBeLessThanOrEqual(2);
  expect(scroll).toBeGreaterThan(0);
  await page.locator('.mobile-tabbar button').click();await expect(page.locator('.console-nav')).toBeVisible();await expect(page.locator('.console-content')).toBeHidden();
  await reviewFrame(page,info,'more');
  await page.goBack();await expect(page.locator('.console-nav')).toBeHidden();
});

test('cross-studio detail URLs do not reveal another team',async({page,context},info)=>{
  test.skip(!fixtures||!info.project.name.includes('-390-'),'Access scenario runs at the representative phone width.');
  await setup(context,info,'studio');
  const response=await page.goto(`/studio/${live!.slug}/teams/${live!.teams[2]}`);
  // A loading boundary can commit HTTP 200 before notFound() streams in.
  // Assert the resolved denial and absence of private content, not just status.
  expect([200,404]).toContain(response?.status());await expect(page.getByRole('heading',{name:'404',exact:true})).toBeVisible();await expect(page.getByText('Mobile QA Team 3',{exact:true})).toHaveCount(0);
  await page.goto('/notifications/mobile-e2e-notice-other');await expect(page.getByRole('heading',{name:'404',exact:true})).toBeVisible();
});

test('local payment, attendance, scores and notification receipts confirm after the server',async({page,context},info)=>{
  test.skip(!fixtures || info.project.name!=='chromium-390-en-dark','Write scenarios use dedicated fixtures once to avoid concurrent changes.');
  await setup(context,info,'admin');const scheduled=fixtures!.series.find(item=>item.status==='scheduled')!;
  await page.goto(`/series/${scheduled.slug}/registrations/${scheduled.teams[1]}`);await expect(page.locator('html')).toHaveAttribute('data-mobile-ready','true');
  // PAYMENT IS NOT WRITTEN FROM HERE ANY MORE. The CRM owns it and the sync
  // brings it in, so this screen shows the figure and offers nothing to press.
  // Asserting the absence is the test: a button coming back would mean two
  // places can set one number, and the next poll would undo whichever lost.
  await expect(page.getByRole('button',{name:'Confirm payment',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Mark unpaid',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Refund',exact:true})).toHaveCount(0);
  const check=page.getByRole('button',{name:'Check in',exact:true});if(await check.count()){await check.click();await expect(page.getByRole('button',{name:'Checked in',exact:true})).toBeVisible();}
  await page.getByRole('button',{name:'Checked in',exact:true}).click();await expect(check).toBeVisible();
  await page.goto(`/series/${live!.slug}/scores/${live!.teams[0]}`);await expect(page.locator('html')).toHaveAttribute('data-mobile-ready','true');
  const counter=page.locator('.team-entry-count-value:visible').first();const previous=Number(await counter.textContent());
  await page.locator('.team-entry-stepper:visible').first().click();await expect(counter).toHaveText(String(previous+1));
  await page.locator('.team-entry-save:visible').click();await expect(page.locator('.team-entry-save:visible')).toContainText('Saved');await page.reload();await expect(counter).toHaveText(String(previous+1));
  // Restore the changed measurement without inventing success before the server reply.
  await page.locator('.team-entry-stepper-minus:visible').first().click();await page.locator('.team-entry-save:visible').click();await expect(page.locator('.team-entry-save:visible')).toContainText('Saved');
  await page.goto('/notifications/mobile-e2e-notice-own');const read=page.getByRole('button',{name:'Mark as read',exact:true});if(await read.count()){await read.click();await expect(page.getByRole('button',{name:'Mark shown as read',exact:true})).toBeDisabled();}
});

test('role preview remains scoped and read-only',async({page,context},info)=>{
  test.skip(!fixtures || !info.project.name.endsWith('390-en-dark'),'Preview runs in both engines.');
  await setup(context,info,'admin');
  await context.addCookies([{name:VIEW_AS_COOKIE,value:signViewAs(fixtures!.users.studio.id,Date.now()+3600000,process.env.OTP_SECRET || process.env.NEXTAUTH_SECRET!),url:info.project.use.baseURL ?? 'http://127.0.0.1:3100'}]);
  await page.goto(`/studio/${live!.slug}/scores/${live!.teams[0]}`);
  await expect(page.locator('.view-as-banner')).toBeVisible();await expect(page.locator('.team-entry-save:visible')).toBeDisabled();
  await page.goto(`/studio/${live!.slug}/teams/${live!.teams[2]}`);await expect(page.getByRole('heading',{name:'404',exact:true})).toBeVisible();
  await page.goto('/notifications/mobile-e2e-notice-own');await expect(page.locator('.mobile-action-bar button')).toBeDisabled();
});


test('local registration, editing and wave locking complete through mobile screens',async({page,context},info)=>{
  test.skip(!fixtures || info.project.name!=='chromium-390-en-dark','Dedicated local writes run once.');
  await setup(context,info,'admin');const scheduled=fixtures!.series.find(item=>item.status==='scheduled')!;
  await page.goto(`/series/${scheduled.slug}/registrations/new`);await expect(page.locator('html')).toHaveAttribute('data-mobile-ready','true');
  const name='Mobile QA created '+Date.now();await page.getByRole('textbox',{name:/^Team name/}).fill(name);
  await page.getByRole('textbox',{name:'Full name',exact:true}).nth(0).fill('Mobile QA New Person One');await page.getByRole('textbox',{name:'Full name',exact:true}).nth(1).fill('Mobile QA New Person Two');
  await page.getByRole('combobox',{name:/^BFT studio membership/}).nth(0).selectOption('mobile-e2e-studio');
  await page.getByRole('button',{name:'Register this pair',exact:true}).click();await expect(page).toHaveURL(new RegExp('/registrations$'));
  await page.locator('.mobile-list-card').filter({hasText:name.toUpperCase()}).click();await expect(page.locator('.mobile-detail h1')).toHaveText(name.toUpperCase());
  await page.getByRole('link',{name:'Edit',exact:true}).click();await page.getByRole('textbox',{name:'Team name',exact:true}).fill(name+' edited');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.locator('.mobile-detail h1')).toHaveText((name+' edited').toUpperCase());
  await page.getByRole('button',{name:'Archive registration',exact:true}).click();await expect(page).toHaveURL(new RegExp('/registrations$'));await expect(page.locator('.mobile-list-card').filter({hasText:(name+' edited').toUpperCase()})).toHaveCount(0);
  // Wave control is the supervisor's page, and waves only start while the competition runs.
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(`/series/${live!.slug}/wave-control`);const wave=page.locator('.floor-wave').first();
  await wave.getByRole('button',{name:'End now',exact:true}).click();await expect(wave.getByRole('button',{name:'Reset',exact:true})).toBeVisible();
  await wave.getByRole('button',{name:'Reset',exact:true}).click();await expect(wave.getByRole('button',{name:'Start wave',exact:true})).toBeVisible();
  // Studios read their scores; the judges enter them.
  await setup(context,info,'studio');await page.goto(`/studio/${scheduled.slug}/scores/${scheduled.teams[0]}`);await expect(page.locator('.team-entry-save')).toBeDisabled();
  await setup(context,info,'admin');await page.goto(`/series/${live!.slug}/wave-control`);await wave.getByRole('button',{name:'Start wave',exact:true}).click();await expect(wave.getByRole('button',{name:'End now',exact:true})).toBeVisible();
});

test('a failed offline save retains the draft and never reports success',async({page,context},info)=>{
  test.skip(!fixtures || !info.project.name.endsWith('390-en-dark'),'Network failure runs once in each engine.');
  await setup(context,info,'admin');await page.goto(`/series/${live!.slug}/scores/${live!.teams[0]}`);await expect(page.locator('html')).toHaveAttribute('data-mobile-ready','true');
  const counter=page.locator('.team-entry-count-value').first(),previous=Number(await counter.textContent());await page.locator('.team-entry-stepper').first().click();await context.setOffline(true);
  try{await page.locator('.team-entry-save').click();await expect(page.getByText('Could not save. Check your connection and try again.',{exact:true})).toBeVisible();await expect(counter).toHaveText(String(previous+1));await expect(page.locator('.team-entry-save')).not.toContainText('Saved');}
  finally{await context.setOffline(false);}
});

test('account editing persists and password validation retains the draft',async({page,context},info)=>{
  test.skip(!fixtures || info.project.name!=='chromium-390-en-dark','Account writes use dedicated fixtures once.');
  await setup(context,info,'admin');
  const user=fixtures!.users.competitor,edit=`/users/${user.id}/edit`;
  await page.goto(edit);await page.getByRole('textbox',{name:'Name',exact:true}).fill(user.name+' edited');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByText('Saved.',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('textbox',{name:'Name',exact:true})).toHaveValue(user.name+' edited');
  await page.getByRole('textbox',{name:'Name',exact:true}).fill(user.name);await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByText('Saved.',{exact:true})).toBeVisible();
  // Changing a password is an emailed link now, not a form with the old one
  // in it, so there is no draft to retain — what has to be on this screen is
  // the way to ask for the link and the way to close the account, both of
  // which the app stores require to be reachable in the app itself.
  await page.goto('/account');
  await expect(page.getByLabel('Current password',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Email me a link',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Delete account',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Delete account',exact:true}).click();
  await expect(page.getByRole('button',{name:'Yes, delete my account',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByRole('button',{name:'Yes, delete my account',exact:true})).toHaveCount(0);
});
