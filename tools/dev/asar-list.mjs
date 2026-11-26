import fs from 'node:fs';

const asarPath = process.argv[2];
const fd = fs.openSync(asarPath, 'r');
const head = Buffer.alloc(8);
fs.readSync(fd, head, 0, 8, 0);
const totalHeaderSize = head.readUInt32LE(0);
const jsonSize = head.readUInt32LE(4);
console.log({ totalHeaderSize, jsonSize, dataOffset: 8 + jsonSize });
const headerBuf = Buffer.alloc(jsonSize);
fs.readSync(fd, headerBuf, 0, jsonSize, 8);
const header = JSON.parse(headerBuf.toString('utf8'));
const paths = [];
const walk = (node, prefix) => {
  if (!node || typeof node !== 'object') return;
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (child.files) walk(child, path);
    else paths.push({ path, size: child.size, offset: child.offset });
  }
};
walk(header, '');
console.log('files:', paths.length);
for (const item of paths.filter((item) => /provider|model|config|catalog|ai/i.test(item.path) && !/node_modules\//.test(item.path)).slice(0, 80)) {
  console.log(item.path, item.size);
}
fs.closeSync(fd);
