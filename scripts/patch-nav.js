'use strict';
const fs = require('fs');
const f = 'components/shell/nav.ts';
let c = fs.readFileSync(f, 'utf8');
if (!c.includes('Phantom C2')) {
  const group = [
    '  {',
    '    label: "Offensive",',
    '    items: [',
    '      { label: "Phantom C2", href: "/phantom", icon: Ghost },',
    '    ],',
    '  },',
    '];',
  ].join('\n');
  const idx = c.lastIndexOf('];');
  c = c.slice(0, idx) + group + c.slice(idx + 2);
  fs.writeFileSync(f, c);
  console.log('nav: Offensive group added');
} else {
  console.log('nav: already present');
}
