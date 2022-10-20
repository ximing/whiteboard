/** Width and height for a text box. Width grows with the longest line, up to a cap. Height fits the lines. */
export function measureTextBox(text: string, fontSize: number, bold?: boolean): { width: number; height: number } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `${bold ? '600 ' : ''}${fontSize}px Figtree, sans-serif`;
  if (ctx) ctx.font = font;
  const paragraphs = text.split('\n');
  let widest = 48;
  let lines = 0;
  for (const paragraph of paragraphs) {
    const width = ctx ? ctx.measureText(paragraph || ' ').width : paragraph.length * fontSize * 0.55;
    widest = Math.max(widest, width + 16);
    lines += 1;
  }
  return {
    width: Math.min(560, Math.max(48, widest)),
    height: Math.max(28, lines * fontSize * 1.25 + 12),
  };
}

/** Height of a sticky whose width stays fixed while the note wraps. */
export function measureStickyHeight(text: string, width: number, fontSize: number): number {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.font = `${fontSize}px Figtree, sans-serif`;
  const maxWidth = Math.max(24, width - 20);
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let line = words[0];
    for (const word of words.slice(1)) {
      const trial = `${line} ${word}`;
      const measured = ctx ? ctx.measureText(trial).width : trial.length * fontSize * 0.5;
      if (measured > maxWidth) {
        lines += 1;
        line = word;
      } else line = trial;
    }
    lines += 1;
  }
  return Math.max(72, lines * fontSize * 1.25 + 20);
}
