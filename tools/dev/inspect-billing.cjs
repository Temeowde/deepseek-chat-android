const fs = require('node:fs');
const path = require('node:path');
const dir = path.join('web', 'dist', 'static', 'js');
const file = fs.readdirSync(dir).find((name) => /^main\..*\.js$/.test(name));
const text = fs.readFileSync(path.join(dir, file), 'utf8');
const needles = ['sl("billing")', 'sa()', 'workbuddyAutoCheckin', 'maybeAutoCheckin', 'wb-billing'];
for (const needle of needles) {
  let index = -1;
  let count = 0;
  while ((index = text.indexOf(needle, index + 1)) >= 0 && count < 3) {
    console.log('###', needle, index);
    console.log(text.slice(Math.max(0, index - 700), index + 500));
    count += 1;
  }
  console.log('---', needle, 'count', count);
}
