const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];

if (inlineScripts.length === 0) {
  throw new Error('No se encontraron scripts inline en public/index.html');
}

inlineScripts.forEach((match, index) => {
  new vm.Script(match[1], {
    filename: `public/index.html:inline-script-${index + 1}`
  });
});

console.log(`Scripts inline verificados: ${inlineScripts.length}`);
