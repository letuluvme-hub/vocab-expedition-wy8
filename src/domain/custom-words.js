export function parseCustomWords(text) {
  const words=[];let bad=0;
  for(const line of text.split('\n')) {
    const l=line.trim();if(!l)continue;
    const match=l.match(/^([A-Za-z][A-Za-z'’-]*(?:[ ][A-Za-z'’-]+)*)\s*[,，]\s*(.+)$/)
      ||l.match(/^([A-Za-z][A-Za-z'’-]*(?:[ ][A-Za-z'’-]+)*)\s+([\s\S]+)$/);
    if(!match){bad++;continue}
    words.push({w:match[1].trim(),z:match[2].trim()});
  }
  return {words,bad};
}
