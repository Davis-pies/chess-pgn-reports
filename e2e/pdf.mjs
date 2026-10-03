// Reading back what the browser printed. page.pdf() prints the page as Chrome
// prints it -- it fires beforeprint, lays the report out on paper and breaks
// it into pages -- so the PDF is the one place a test can see where the page
// breaks fell. pdf.js reads its text back with each run's page and position.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Every run of text in the PDF, in the order the pages draw them:
// { str, page, x, y, size }, with y measured down from the top of the page
// and everything in points.
export async function pdfText(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { height } = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    for (const it of items) {
      const str = it.str.trim();
      if (!str) continue;
      out.push({ str, page: p, x: it.transform[4], y: height - it.transform[5], size: it.height });
    }
  }
  return { pages: doc.numPages, items: out };
}
