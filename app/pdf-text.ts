type PdfTextItem = {
  str: string;
  transform: number[];
};

type PositionedText = {
  text: string;
  x: number;
  y: number;
};

function isHorizontalText(transform: number[]) {
  const [scaleX = 0, skewY = 0] = transform;
  const magnitude = Math.hypot(scaleX, skewY);
  if (!magnitude) return true;
  // Normal invoice text is horizontal. Diagonal watermark text has a large
  // skew component and otherwise gets interleaved with genuine row content.
  return Math.abs(skewY) / magnitude <= 0.12;
}

export function pdfTextRows(items: PdfTextItem[]) {
  const positioned: PositionedText[] = items.flatMap((item) => {
    if (!item.str.trim() || !isHorizontalText(item.transform)) return [];
    return [{ text: item.str.trim(), x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 }];
  }).sort((left, right) => Math.abs(right.y - left.y) > 2 ? right.y - left.y : left.x - right.x);

  const rows: { y: number; items: { text: string; x: number }[] }[] = [];
  positioned.forEach((item) => {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
    if (row) row.items.push({ text: item.text, x: item.x });
    else rows.push({ y: item.y, items: [{ text: item.text, x: item.x }] });
  });

  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) => row.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(" "))
    .join("\n");
}
