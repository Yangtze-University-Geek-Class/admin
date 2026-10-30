#!/usr/bin/env node
// 在已有 server 镜像中运行；源数据卷只读挂到 /source，输出目录挂到 /output。
// 复用 #282 导出格式，兼容尚无备份接口的旧正式镜像所使用的数据结构。
import { createWriteStream, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';

const [environment, appVersion, imageTag] = process.argv.slice(2);
// 版本口径与 platform-maintenance.sh 相同：正式只有 X.Y.Z；预发布是 X.Y.Z-rc.N / -hf.N / -stable 加 @<镜像 tag>，N 从 1 起、没有前导 0。
const releaseVersionRe = () => (environment === 'production' ? /^\d+\.\d+\.\d+$/ : new RegExp(`^\\d+\\.\\d+\\.\\d+(?:-rc\\.[1-9]\\d*|-hf\\.[1-9]\\d*|-stable)@${imageTag}$`));
if (!['production', 'preview'].includes(environment) || !/^[a-f0-9]{12}$/.test(imageTag ?? '') || !releaseVersionRe().test(appVersion ?? '')) {
  throw new Error('用法：export-stack-snapshot.mjs <production|preview> <已发布版本> <sha12>');
}
if (readdirSync('/output').some(name => name === 'system-backup.tar.gz' || name === 'manifest.json')) {
  throw new Error('输出目录已有系统快照或清单，拒绝覆盖或混入新快照');
}
const require = createRequire('/app/app/server/package.json');
const Database = require('better-sqlite3');
const { prepareSystemBackup } = await import('/app/app/server/dist/lib/system-backup.js');
const db = new Database('/source/data.db', { readonly: true, fileMustExist: true });
try {
  const result = await prepareSystemBackup({
    db,
    sitesRoot: '/source/sites',
    environment,
    imageTag,
    appVersion,
    requiredEnv: [],
  });
  await pipeline(result.stream, createWriteStream('/output/system-backup.tar.gz', { flags: 'wx', mode: 0o600 }));
  writeFileSync('/output/manifest.json', `${JSON.stringify(result.manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ environment, version: appVersion, image_tag: imageTag, tables: result.manifest.database.tables.length, files: result.manifest.files.length, excluded_tables: result.manifest.database.excluded_tables }));
} finally {
  db.close();
}
