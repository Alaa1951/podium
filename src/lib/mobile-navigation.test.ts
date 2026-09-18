import { describe, expect, it } from "vitest";
import { hasContextNavigation, matchesRoute, mobileTabs, parentRoute, safeAppPath } from "./mobile-navigation";

describe("mobile navigation boundaries",()=>{
  it("chooses exactly one tab bar for console and personal routes",()=>{
    for (const path of ["/", "/series", "/series/new", "/series/test/scores/a", "/users/a/edit", "/studios", "/roles", "/audit", "/announcements/new", "/studio/test/teams", "/series/test/board"]) expect(hasContextNavigation(path),path).toBe(true);
    for (const path of ["/account", "/notifications/a", "/me", "/me/edit", "/my-wave", "/studio", "/studio/announcements", "/studio/announcements/a"]) expect(hasContextNavigation(path),path).toBe(false);
  });
  it("only includes permitted, unlocked contextual sections",()=>{
    const groups=[{title:"",items:[{href:"/series/test",label:"Overview"},{href:"/series/test/registrations",label:"Competitors"},{href:"/series/test/waves",label:"Waves",locked:true},{href:"/series/test/scores",label:"Scores"},{href:"/results",label:"Public"}]}];
    expect(mobileTabs(groups).map(item=>item.href)).toEqual(["/series/test/registrations","/series/test/scores"]);
  });
  it("does not highlight a sibling whose name shares a prefix",()=>{
    expect(matchesRoute("/users/abc/edit","/users")).toBe(true);
    expect(matchesRoute("/users-old","/users")).toBe(false);
    expect(matchesRoute("/series","/")).toBe(false);
  });
  it("returns direct detail and editing routes to their parents",()=>{
    expect(parentRoute("/studio/test/teams/abc/edit")).toBe("/studio/test/teams/abc");
    expect(parentRoute("/studio/test/teams/abc")).toBe("/studio/test/teams");
    expect(parentRoute("/notifications/abc")).toBe("/notifications");
  });
  it("offline recovery accepts internal routes and excludes sign-in and external URLs",()=>{
    for(const unsafe of [null,"https://example.com","//example.com","/\\example.com","/login?callbackUrl=/me","/verify","/me\n"]){expect(safeAppPath(unsafe)).toBeNull();}
    expect(safeAppPath("/series/test/scores/abc?wave=1")).toBe("/series/test/scores/abc?wave=1");
  });
});
