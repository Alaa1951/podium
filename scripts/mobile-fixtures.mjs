/** Dedicated local-only data; never rebuilds or deletes an existing competition. */
import fs from "node:fs/promises";
import crypto from "node:crypto";
import nextEnv from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { createDefaultZones } from "../prisma/seed-helpers.ts";

nextEnv.loadEnvConfig(process.cwd());
const url = new URL(process.env.DATABASE_URL || "");
if (!['localhost','127.0.0.1','::1'].includes(url.hostname)) throw new Error("Mobile fixtures require a local database.");
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url.toString()) });
const prefix = "mobile-e2e";
try {
  if(process.argv.includes("--expire-auth")){await prisma.authToken.updateMany({where:{id:{in:[`${prefix}-token-invite`,`${prefix}-token-reset`]}},data:{usedAt:new Date()}});console.log("Local mobile authentication fixture links expired.");} else {
  for (const suffix of ["studio","other-studio"]) await prisma.studio.upsert({ where:{id:`${prefix}-${suffix}`}, update:{}, create:{id:`${prefix}-${suffix}`,name:`Mobile QA ${suffix}`} });
  const accessRole = await prisma.accessRole.upsert({ where:{key:`${prefix}-limited`},update:{permissions:["scores.view"]},create:{key:`${prefix}-limited`,name:"Mobile QA score viewer",permissions:["scores.view"]} });
  const users = {};
  for (const role of ["admin","studio","competitor","limited"]) {
    const id=`${prefix}-${role}`;
    users[role]=await prisma.user.upsert({where:{id},update:{status:"active",archivedAt:null},create:{id,email:`${role}@mobile-qa.invalid`,name:`Mobile QA ${role}`,status:"active",role:role==='limited'?'studio':role,studioId:role==='admin'?null:`${prefix}-studio`,accessRoleId:role==='limited'?accessRole.id:null}});
  }
  const series = [];
  for(const status of ["scheduled","live","final"]){
    const id=`${prefix}-${status}`, slug=`mobile-qa-${status}`;
    await prisma.series.upsert({where:{id},update:{},create:{id,slug,name:`Mobile QA ${status}`,status,competitionDate:new Date(Date.now()+7*86400000),boardOpensAt:new Date(0),studiosMayEnterScores:true,studioScoreCorrections:5,resultsPublicAt:status==='final'?new Date(0):null}});
    for(const studioId of [`${prefix}-studio`,`${prefix}-other-studio`]) await prisma.seriesStudio.upsert({where:{seriesId_studioId:{seriesId:id,studioId}},update:{},create:{seriesId:id,studioId}});
    if(await prisma.zone.count({where:{seriesId:id}})===0)await createDefaultZones(prisma,id);
    const waveState={status:status==='live'?'running':status==='final'?'complete':'pending',startedAt:status==='live'?new Date():null,endsAt:status==='live'?new Date(Date.now()+3*3600000):status==='final'?new Date(0):null};
    const wave=await prisma.wave.upsert({where:{id:`${id}-wave`},update:waveState,create:{id:`${id}-wave`,seriesId:id,number:1,startTime:"09:00",...waveState}});
    const teams=[];
    for(let number=1;number<=3;number++){
      const teamId=`${id}-team-${number}`, studioId=number===3?`${prefix}-other-studio`:`${prefix}-studio`;
      const team=await prisma.team.upsert({where:{id:teamId},update:{archivedAt:null},create:{id:teamId,seriesId:id,number,name:number===1?'Mobile QA Team — long name for layout validation':'Mobile QA Team '+number,category:"Womens",division:"Rookie",studioId,waveId:wave.id,wave:1,paymentStatus:number===2?'pending':'paid',amountMinor:number===2?null:25000,currency:"QAR"}});
      for(let position=1;position<=2;position++)await prisma.competitor.upsert({where:{teamId_position:{teamId,position}},update:{},create:{id:`${teamId}-person-${position}`,teamId,position,fullName:`Mobile QA Competitor ${number}-${position}`,normalizedName:`mobile qa competitor ${number} ${position}`,email:`person-${status}-${number}-${position}@mobile-qa.invalid`,phone:"+97412345678",studioId,dateOfBirth:new Date("1995-01-01"),userId:number===1&&position===1?users.competitor.id:null}});
      if(status==='final'&&number!==2)await prisma.score.upsert({where:{teamId},update:{},create:{teamId,status:"submitted",submittedAt:new Date()}});
      teams.push(team.id);
    }
    series.push({id,slug,status,teams,waveId:wave.id,zoneId:(await prisma.zone.findFirst({where:{seriesId:id},orderBy:{number:"asc"}})).id});
  }
  await prisma.waveAccess.upsert({where:{userId_waveId:{waveId:series.find(s=>s.status==='live').waveId,userId:users.limited.id}},update:{},create:{waveId:series.find(s=>s.status==='live').waveId,userId:users.limited.id}});
  for(const suffix of ["own","other"]) await prisma.notification.upsert({where:{id:`${prefix}-notice-${suffix}`},update:{audience:suffix==="own"?"all":"studio",audienceStudioId:suffix==="own"?null:`${prefix}-other-studio`},create:{id:`${prefix}-notice-${suffix}`,title:`Mobile QA ${suffix} announcement`,body:"Local mobile layout fixture. ".repeat(30),audience:suffix==="own"?"all":"studio",audienceStudioId:suffix==="own"?null:`${prefix}-other-studio`,createdBy:users.admin.id}});
  await prisma.notification.upsert({where:{id:`${prefix}-notice-studio`},update:{},create:{id:`${prefix}-notice-studio`,title:"Mobile QA studio announcement",body:"Local studio history fixture.",audience:"studio",audienceStudioId:`${prefix}-studio`,createdBy:users.studio.id}});
  await prisma.adminAuditLog.upsert({where:{id:`${prefix}-audit`},update:{},create:{id:`${prefix}-audit`,actorId:users.admin.id,action:"mobile.qa.fixture",targetType:"team",targetId:series[0].teams[0],targetLabel:"Mobile QA fixture",detail:"Local-only screen coverage fixture"}});
  const authTokens={};
  for(const purpose of ["invite","reset"]){const token=crypto.randomBytes(32).toString("hex");authTokens[purpose]=token;const data={tokenHash:crypto.createHmac("sha256",process.env.OTP_SECRET || process.env.NEXTAUTH_SECRET).update(token).digest("hex"),expiresAt:new Date(Date.now()+3600000),usedAt:null};await prisma.authToken.upsert({where:{id:`${prefix}-token-${purpose}`},update:data,create:{id:`${prefix}-token-${purpose}`,userId:users.studio.id,purpose,...data}});}
  const data={authTokens,accessRoleId:accessRole.id,users:Object.fromEntries(Object.entries(users).map(([key,user])=>[key,{id:user.id,email:user.email,name:user.name,role:user.role,studioId:user.studioId}])),series};
  await fs.mkdir('.mobile-qa',{recursive:true});await fs.writeFile('.mobile-qa/fixtures.json',JSON.stringify(data,null,2));
  console.log('Local mobile fixtures ready (4 accounts, 3 dedicated competitions).');
  }
} finally { await prisma.$disconnect(); }
