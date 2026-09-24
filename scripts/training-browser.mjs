/** Browser smoke against an ephemeral local database, called by training-integration.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { encode } from 'next-auth/jwt';
import { chromium } from '@playwright/test';
export async function verifyTrainingBrowser(databaseName, query) {
  if (!/^pudem_training_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('TEST_DATABASE_REQUIRED');
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('LOCAL_DATABASE_ONLY');
  url.pathname = '/' + databaseName; url.searchParams.set('allowPublicKeyRetrieval','true');
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const origin = `http://localhost:${port}`;
  const output = fs.openSync('.tmp-training-server.log','w');
  const server = spawn(process.execPath, ['server.js'], { windowsHide: true, stdio: ['ignore', output, output], env: { ...process.env, NODE_ENV:'production', DATABASE_URL:url.href, PORT:String(port), HOSTNAME:'127.0.0.1', NEXTAUTH_URL:origin, CRM_SYNC_ENABLED:'0', PORTRAITS_ENABLED:'0' } });
  let browser;
  try {
    for (let tries=0; tries<60; tries++) {
      if (server.exitCode !== null) throw new Error('TEST_SERVER_EXITED');
      try { const r=await fetch(origin+'/api/health'); if(r.ok) break; } catch {}
      if(tries===59) throw new Error('TEST_SERVER_NOT_READY');
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    await query("INSERT INTO Series(id,name,slug,competitionDate,status,signupOpen,updatedAt) VALUES ('upcoming','Next competition','next','2099-01-01','scheduled',1,NOW(3)),('completed','Old competition','old','2020-01-01','final',0,NOW(3))");
    await query("INSERT INTO SeriesParticipant(id,seriesId,userId,updatedAt) VALUES ('old-entry','completed','a',NOW(3))");
    browser=await chromium.launch({ headless:true });
    const context=await browser.newContext({ viewport: { width:390,height:844 } });
    const token=await encode({ secret:process.env.NEXTAUTH_SECRET, token:{ sub:'a', name:'Athlete A',email:'a@bftmena.com',role:'competitor',status:'active',locale:'en',refreshedAt:Date.now(),expiresAt:Date.now()+3600000 }, maxAge:3600 });
    await context.addCookies([{ name:'__Secure-next-auth.session-token', value:token, domain:'localhost',path:'/',httpOnly:true,secure:true,sameSite:'Lax' }]);
    const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    const response=await page.goto(origin+'/me'); assert.equal(response.status(),200);
    await page.locator('#my-competition:visible').waitFor(); assert.equal(await page.locator('#my-competition:visible').inputValue(),'source');
    assert.deepEqual(await page.locator('#my-competition:visible option').evaluateAll(rows=>rows.map(r=>r.value)),['source','target']);
    await page.locator('#my-competition:visible').selectOption('target'); await page.waitForURL('**/me?series=target');
    assert.equal(await page.locator('#my-competition:visible').inputValue(),'target');
    await page.locator('nav.personal-tabbar a[href="/my-wave?series=target"]:visible').click();
    await page.waitForURL('**/my-wave?series=target');
    await page.getByRole('heading',{name:'Training',exact:true}).waitFor();
    await page.locator('nav.personal-tabbar a[href="/me?series=target"]:visible').click();
    await page.waitForURL('**/me?series=target');
    await page.locator('#my-competition:visible').waitFor();
    assert.equal(await page.locator('body').evaluate(b=>b.scrollWidth<=window.innerWidth+1),true,'mobile page must not overflow');
    await page.screenshot({ path:'.tmp-training-mobile.png',fullPage:true });
    await page.goto(origin+'/me?series=not-my-competition'); await page.getByRole('heading',{name:'404',exact:true}).waitFor(); assert.equal(await page.locator('#my-competition:visible').count(),0);
    await page.goto(origin+'/me?series=all'); await page.getByRole('heading',{name:'Already completed'}).waitFor();
    const accounts=Number((await query('SELECT COUNT(*) AS n FROM User'))[0].n);
    await page.getByRole('button',{name:'Join competition'}).click(); await page.waitForURL('**/me?series=upcoming');
    assert.equal(Number((await query('SELECT COUNT(*) AS n FROM User'))[0].n),accounts,'joining must not create another login');
    assert.equal(Number((await query("SELECT COUNT(*) AS n FROM SeriesParticipant WHERE seriesId='upcoming' AND userId='a'"))[0].n),1);
    await page.goto(origin+'/me?series=all'); await page.locator('summary').filter({hasText:'Personal details'}).click();
    await page.locator('input[name=name]').fill('Athlete Corrected'); await page.locator('input[name=phone]').fill('+97455500000');
    await page.getByRole('button',{name:'Save changes'}).click(); await page.getByText('Profile updated.',{exact:true}).waitFor();
    for(const id of ['source','target']) { await page.goto(origin+'/me?series='+id); await page.getByText('Athlete Corrected',{exact:true}).filter({visible:true}).first().waitFor(); }
    assert.deepEqual(errors,[],'no browser runtime errors');
    console.log('PASS: mobile competition default/switch, completed archive, foreign event denied, same-account enrollment, shared profile display, no browser errors.');
  } finally { if(browser) await browser.close(); server.kill(); fs.closeSync(output); }
}
