const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_RCLONE_LOG, JSON.stringify({ args, config: {
  type: process.env.RCLONE_CONFIG_ARCHIVE_TYPE,
  provider: process.env.RCLONE_CONFIG_ARCHIVE_PROVIDER,
  endpoint: process.env.RCLONE_CONFIG_ARCHIVE_ENDPOINT,
  region: process.env.RCLONE_CONFIG_ARCHIVE_REGION,
  pathStyle: process.env.RCLONE_CONFIG_ARCHIVE_FORCE_PATH_STYLE,
  hasAccess: Boolean(process.env.RCLONE_CONFIG_ARCHIVE_ACCESS_KEY_ID),
  hasSecret: Boolean(process.env.RCLONE_CONFIG_ARCHIVE_SECRET_ACCESS_KEY),
} }) + '\n');
if (process.env.FAKE_RCLONE_FAIL === '1') {
  console.error('provider error ' + process.env.RCLONE_CONFIG_ARCHIVE_SECRET_ACCESS_KEY);
  process.exit(91);
}
function remote(value) {
  const match = /^archive:([^/]+)\/(.+)$/.exec(value || '');
  if (!match) process.exit(92);
  return { bucket: match[1], key: match[2], file: path.join(process.env.FAKE_RCLONE_OBJECTS, match[1], ...match[2].split('/')) };
}
if (args[0] === 'lsjson' && args.includes('--stat')) {
  const item = remote(args[1]);
  if (!fs.existsSync(item.file) || !fs.statSync(item.file).isFile()) process.exit(3);
  const info = fs.statSync(item.file);
  console.log(JSON.stringify({ Path: path.basename(item.file), Name: path.basename(item.file), Size: info.size, IsDir: false }));
} else if (args[0] === 'copyto') {
  const item = remote(args[2]);
  if (fs.existsSync(item.file)) process.exit(4);
  fs.mkdirSync(path.dirname(item.file), { recursive: true });
  fs.copyFileSync(args[1], item.file);
} else if (args[0] === 'cat') {
  const item = remote(args[1]);
  if (!fs.existsSync(item.file)) process.exit(3);
  process.stdout.write(fs.readFileSync(item.file));
} else if (args[0] === 'lsjson' && args.includes('--recursive')) {
  const item = remote(args[1]);
  const output = [];
  function walk(current, prefix = '') {
    if (!fs.existsSync(current)) return;
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name);
      const rel = prefix ? prefix + '/' + name : name;
      const info = fs.statSync(file);
      if (info.isDirectory()) walk(file, rel);
      else output.push({ Path: rel, Name: name, Size: info.size, IsDir: false });
    }
  }
  walk(item.file);
  console.log(JSON.stringify(output));
} else {
  console.error('unexpected rclone command');
  process.exit(93);
}
