import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkProject, specifiers } from "../../scripts/check-boundaries.mjs";
const roots: string[] = [];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(files: Record<string,string>) { const root=mkdtempSync(join(tmpdir(),"geek-boundary-test-"));roots.push(root);for(const [path,source] of Object.entries(files)){mkdirSync(join(root,path,".."),{recursive:true});writeFileSync(join(root,path),source);}return root; }
it("parses static, dynamic, type and re-export dependencies without matching comments",()=>{
 const result=specifiers(`// import './not-real';
import './static'; export { x } from './export'; const y = import('./dynamic'); type T = import('./type').T;`);
 expect(result.map((item: {spec:string})=>item.spec)).toEqual(['./static','./export','./dynamic','./type']);
});
it("rejects backend cross-module .js imports resolving to TypeScript",()=>{
 const root=fixture({'app/server/src/routes/forum/a.ts':`import {x} from '../admin/b.js';`,'app/server/src/routes/admin/b.ts':`export const x=1;`});
 expect(checkProject(root).violations.join(' ')).toContain('cross-module');
});
it("rejects dynamic cross-site imports and shared reverse imports",()=>{
 const root=fixture({'app/web/sites/portal/a.ts':`import('../forum/b');`,'app/web/sites/forum/b.ts':`export const x=1;`,'app/web/shared/x.ts':`export {x} from '../sites/forum/b';`});
 expect(checkProject(root).violations).toHaveLength(2);
});
it("fails closed on an unresolved relative module",()=>{
 const root=fixture({'app/web/sites/portal/a.ts':`import './missing';`}); expect(checkProject(root).violations[0]).toContain('unresolved');
});
it("rejects identity adapters that import HTTP middleware",()=>{
 const root=fixture({'app/server/src/lib/identity.ts':`import { authorize } from '../middleware/auth.js';`,'app/server/src/middleware/auth.ts':`export const authorize = () => true;`});
 expect(checkProject(root).violations.join(' ')).toContain('adapters depend on HTTP middleware');
});
it("resolves arbitrary tsconfig aliases before deciding the module boundary",()=>{
 const root=fixture({
   'app/web/tsconfig.json':JSON.stringify({compilerOptions:{moduleResolution:'Bundler',paths:{'@forum/*':['./sites/forum/*']}}}),
   'app/web/sites/portal/a.ts':`export { x } from '@forum/b';`,
   'app/web/sites/forum/b.ts':`export const x=1;`,
 });
 expect(checkProject(root).violations.join(' ')).toContain('cross-site dependency');
});
it("fails closed for an unresolved declared alias without mistaking a builtin for local code",()=>{
 const root=fixture({
   'app/server/tsconfig.json':JSON.stringify({compilerOptions:{moduleResolution:'Bundler',paths:{'@domain/*':['./src/lib/*']}}}),
   'app/server/src/routes/forum/a.ts':`import fs from 'node:fs'; import { x } from '@domain/missing';`,
 });
 const violations=checkProject(root).violations;
 expect(violations).toHaveLength(1);
 expect(violations[0]).toContain('unresolved local import @domain/missing');
});
it("parses imports inside Vue single-file component scripts only",()=>{
 const result=specifiers(`<template><div>import './not-a-module'</div></template>
<script setup lang="ts">
import A from './a.vue';
const b = import('./b');
</script>`,'x.vue');
 expect(result.map((item: {spec:string})=>item.spec)).toEqual(['./a.vue','./b']);
 expect(result[0].line).toBe(3);
});
it("keeps the console app separate from the web sites and the server",()=>{
 const root=fixture({
   'app/console/src/a.ts':`import '../../web/shared/lib/http';`,
   'app/console/src/b.vue':`<script setup lang="ts">import { x } from '../../server/src/lib/roles';</script>`,
   'app/web/shared/lib/http.ts':`import '../../../console/src/c';`,
   'app/console/src/c.ts':`export const c=1;`,
   'app/server/src/lib/roles.ts':`export const x=1;`,
 });
 const violations=checkProject(root).violations.join('\n');
 expect(violations).toContain('app/console/src/a.ts:1: console and web must not import each other (console -> web)');
 expect(violations).toContain('app/web/shared/lib/http.ts:1: console and web must not import each other (web -> console)');
 expect(violations).toContain('app/console/src/b.vue:1: frontend/backend implementation import is forbidden (console -> server)');
});
