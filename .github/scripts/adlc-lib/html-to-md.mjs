// Minimal HTML -> Markdown converter (design doc §4.1/§9.1). ADO descriptions, acceptance
// criteria, and comments are stored as HTML; this renders them back to the markdown
// context.md uses. Not a full HTML parser: a small permissive tokenizer + tree builder is
// enough for the tag soup ADO/GitHub actually produce. script/style content is dropped,
// never emitted.
const VOID_ELEMENTS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '\u2014', ndash: '\u2013' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (full, code) => {
    if (code[0] === '#') {
      const isHex = code[1] === 'x' || code[1] === 'X';
      const codePoint = isHex ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : full;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? full;
  });
}

function tokenize(html) {
  const tokens = [];
  const tagRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let lastIndex = 0;
  let match;
  while ((match = tagRe.exec(html))) {
    if (match.index > lastIndex) tokens.push({ type: 'text', value: html.slice(lastIndex, match.index) });
    lastIndex = tagRe.lastIndex;
    if (match[0].startsWith('<!--')) continue; // drop comments

    const isClose = match[0][1] === '/';
    const name = match[1].toLowerCase();
    if (isClose) {
      tokens.push({ type: 'close', name });
      continue;
    }
    const selfClose = /\/\s*>$/.test(match[0]) || VOID_ELEMENTS.has(name);
    tokens.push({ type: 'open', name, attrs: match[2] ?? '' });
    if (RAW_TEXT_ELEMENTS.has(name) && !selfClose) {
      const closeRe = new RegExp(`<\\/${name}\\s*>`, 'i');
      const rest = html.slice(lastIndex);
      const closeMatch = closeRe.exec(rest);
      const rawEnd = closeMatch ? closeMatch.index : rest.length;
      tokens.push({ type: 'text', value: rest.slice(0, rawEnd) });
      tokens.push({ type: 'close', name });
      lastIndex += closeMatch ? closeMatch.index + closeMatch[0].length : rest.length;
      tagRe.lastIndex = lastIndex;
    } else if (selfClose) {
      tokens.push({ type: 'close', name });
    }
  }
  if (lastIndex < html.length) tokens.push({ type: 'text', value: html.slice(lastIndex) });
  return tokens;
}

function buildTree(tokens) {
  const root = { name: '#root', children: [] };
  const stack = [root];
  for (const token of tokens) {
    const top = stack[stack.length - 1];
    if (token.type === 'text') {
      top.children.push({ type: 'text', value: token.value });
    } else if (token.type === 'open') {
      const node = { type: 'element', name: token.name, attrs: token.attrs, children: [] };
      top.children.push(node);
      stack.push(node);
    } else if (token.type === 'close') {
      const idx = stack.map((n) => n.name).lastIndexOf(token.name);
      if (idx > 0) stack.length = idx; // pop back to (and including) the matching open tag; ignore stray closes
    }
  }
  return root;
}

function attrValue(attrs, name) {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*'([^']*)'`, 'i').exec(attrs ?? '');
  return match ? match[1] ?? match[2] : null;
}

function renderChildren(node) {
  return node.children.map((child) => render(child)).join('');
}

function render(node) {
  if (node.type === 'text') return decodeEntities(node.value);
  if (node.name === '#root') return renderChildren(node);
  if (RAW_TEXT_ELEMENTS.has(node.name)) return '';

  switch (node.name) {
    case 'br':
      return '  \n';
    case 'p':
    case 'div':
      return `${renderChildren(node)}\n\n`;
    case 'strong':
    case 'b':
      return `**${renderChildren(node)}**`;
    case 'em':
    case 'i':
      return `*${renderChildren(node)}*`;
    case 'a':
      return `[${renderChildren(node)}](${attrValue(node.attrs, 'href') ?? ''})`;
    case 'code':
      return `\`${renderChildren(node)}\``;
    case 'pre':
      return `\n\`\`\`\n${renderChildren(node).trim()}\n\`\`\`\n`;
    case 'ul':
    case 'ol':
      return renderList(node, 0);
    case 'table':
      return renderTable(node);
    default:
      return renderChildren(node);
  }
}

function listLines(node, depth) {
  const indent = '  '.repeat(depth);
  const items = node.children.filter((c) => c.type === 'element' && c.name === 'li');
  const lines = [];
  let index = 0;
  for (const li of items) {
    index++;
    const marker = node.name === 'ol' ? `${index}.` : '-';
    let text = '';
    const nestedLines = [];
    for (const child of li.children) {
      if (child.type === 'element' && (child.name === 'ul' || child.name === 'ol')) {
        nestedLines.push(...listLines(child, depth + 1));
      } else {
        text += render(child);
      }
    }
    lines.push(`${indent}${marker} ${text.trim()}`);
    lines.push(...nestedLines);
  }
  return lines;
}

function renderList(node, depth) {
  return `\n${listLines(node, depth).join('\n')}\n`;
}

function renderTable(node) {
  const rows = [];
  const collectRows = (n) => {
    for (const child of n.children) {
      if (child.type !== 'element') continue;
      if (child.name === 'tr') rows.push(child);
      else collectRows(child);
    }
  };
  collectRows(node);
  if (rows.length === 0) return '';

  const cellsOf = (row) =>
    row.children
      .filter((c) => c.type === 'element' && (c.name === 'td' || c.name === 'th'))
      .map((c) => renderChildren(c).trim().replace(/\|/g, '\\|'));

  const [headerRow, ...bodyRows] = rows;
  const header = cellsOf(headerRow);
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const row of bodyRows) lines.push(`| ${cellsOf(row).join(' | ')} |`);
  return `\n${lines.join('\n')}\n`;
}

/** Converts an HTML fragment (as stored by ADO for Description/AcceptanceCriteria/ReproSteps
 * and comments) into markdown. Returns '' for empty/nullish input. */
export function htmlToMarkdown(html) {
  if (!html) return '';
  const tree = buildTree(tokenize(html));
  // Collapse blank-line runs from block-element rendering, but never touch a trailing
  // "  \n" — that's the markdown hard line break a <br> renders as.
  return render(tree)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
