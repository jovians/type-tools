import * as dedentOriginal from 'dedent';

export { dedentOriginal as dedent };

export function parseProperties<T extends object = any>(content: string): T {
  const buff = Buffer.alloc(content.length * 2);
  let offset = 0;
  let withinBackTick = false;
  for (let i = 0; i < content.length; ++i) {
    if (!withinBackTick && content[i] === '`') {
      withinBackTick = true;
      buff[i + offset] = content.charCodeAt(i);
      continue;
    }
    if (withinBackTick) {
      if (content[i] === '\n') {
        buff[i + offset] = 92; // \
        ++offset;
        buff[i + offset] = 110; // n
        continue;
      }
      if (content[i] === '`' && content[i-1] !== '\\') {
        buff[i + offset] = content.charCodeAt(i);
        withinBackTick = false;
        continue;
      }
    }
    buff[i + offset] = content.charCodeAt(i);
  }
  content = buff.slice(0, content.length + offset).toString('ascii');
  const flatMap = content
          // Split by line breaks.
          .split('\n')
          // Remove commented lines:
          .filter((line) =>
              /(\#|\!)/.test(line.replace(/\s/g, '').slice(0, 1))
                  ? false
                  : line
          )
          .reduce((obj, line) => {
              // Replace only '=' that are not escaped with '\' to handle separator inside key
              const colonifiedLine = line.replace(/(?<!\\)=/, ':');
              const key = colonifiedLine
                  // Extract key from index 0 to first not escaped colon index
                  .substring(0, colonifiedLine.search(/(?<!\\):/))
                  // Remove not needed backslash from key
                  .replace(/\\/g, '')
                  .trim();
              const value = colonifiedLine
                  .substring(colonifiedLine.search(/(?<!\\):/) + 1)
                  .trim();
              obj[key] = value;
              return obj;
          }, {});
  const tallMap = {};
  for (const fullPath of Object.keys(flatMap)) {
    if (!fullPath) { continue; }
    const path = fullPath.split('.');
    const pathTraveled = [];
    const last = path.pop();
    let node = tallMap;
    for (let i = 0; i < path.length; ++i) {
      const at = path[i];
      pathTraveled.push(at);
      if (!node[at]) { node[at] = {}; }
      node = node[at];
      if (typeof node !== 'object') {
        throw new Error(`${fullPath} key has conflict with previously defined path ${pathTraveled.join('.')}`);
      }
    }
    let value: string = flatMap[fullPath];
    if (!isNaN(+value)) {
      node[last] = +value;
    } else {
      if (value.startsWith('`') && value.endsWith('`')) {
        value = dedentOriginal.default(value.slice(1, -1).replace(/\\n/g, '\n'));
      }
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\n/g, '\n');
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\\'/g, "'");
      }
      node[last] = value.trim();
    }
  }
  return tallMap as T;
};

export function parsePropertyValue(entry: string): {[key: string]: any;} {
  const lines = entry.split('\n');
  const result = {};
  for (let i = 0; i < lines.length; ++i) {
    let line = lines[i].trim();
    while (line.endsWith(';')) { line = line.slice(0, -1); }
    const lit = line.split('=');
    const propName = trimQuote(lit[0].trim());
    const value = lit.slice(1).join('=').trim();
    if (propName.startsWith('[') && propName.endsWith(']')) {
      const lit2 = propName.slice(1, -1).split(':').map(a => trimQuote(a.trim()));
      const baseKey = lit2[0];
      const childKey = lit2[1];
      if (!result[baseKey]) { result[baseKey] = {}; }
      if (value.indexOf(',') >= 0) {
        result[baseKey][childKey] = value.split(',').map(a => trimQuote(a.trim())).filter(a => a);
      } else {
        result[baseKey][childKey] = trimQuote(value);
      }
    } else {
      if (value.indexOf(',') >= 0) {
        result[propName] = value.split(',').map(a => trimQuote(a.trim())).filter(a => a);
      } else {
        result[propName] = trimQuote(value);
      }
    }
  }
  for (const prop of Object.keys(result)) {
    if (!isNaN(+result[prop])) { result[prop] = +result[prop]; }
  }
  return result;
}

function trimQuote(str: string) {
  while (str.startsWith("'") && str.endsWith("'")) { str = str.slice(1, -1).trim(); }
  while (str.startsWith('"') && str.endsWith('"')) { str = str.slice(1, -1).trim(); }
  return str;
}
