import { PDFDocument } from 'pdf-lib';
import { App, TFile, requestUrl } from 'obsidian';

export interface PdfExtractedMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string[];
  creationDate: string | null;
  modificationDate: string | null;
  creator: string;
  producer: string;
  pageCount: number | null;
}

export const EMPTY_PDF_METADATA: PdfExtractedMetadata = {
  title: '', author: '', subject: '', keywords: [],
  creationDate: null, modificationDate: null,
  creator: '', producer: '', pageCount: null,
};

const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;
const ISBN_RE = /\b(?:ISBN[-\s:]*)?((?:97[89][-\s]?)?(?:\d[-\s]?){9}[\dXx])\b/;

export class PdfMetadataExtractor {
  constructor(private app: App) {}

  async extract(file: TFile): Promise<PdfExtractedMetadata> {
    try {
      const arrayBuffer = await this.app.vault.readBinary(file);

      const pdfDoc = await PDFDocument.load(arrayBuffer, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
      });

      const rawKeywords = pdfDoc.getKeywords()?.trim() ?? '';

      return {
        title: pdfDoc.getTitle()?.trim() ?? '',
        author: pdfDoc.getAuthor()?.trim() ?? '',
        subject: pdfDoc.getSubject()?.trim() ?? '',
        keywords: rawKeywords
          ? rawKeywords.split(/[,;]/).map(k => k.trim()).filter(k => k.length > 0)
          : [],
        creationDate: pdfDoc.getCreationDate()?.toISOString().split('T')[0] ?? null,
        modificationDate: pdfDoc.getModificationDate()?.toISOString().split('T')[0] ?? null,
        creator: pdfDoc.getCreator()?.trim() ?? '',
        producer: pdfDoc.getProducer()?.trim() ?? '',
        pageCount: pdfDoc.getPageCount(),
      };
    } catch (err) {
      console.warn(`[Att Meta Map] Could not read PDF metadata from ${file.path}:`, err);
      return { ...EMPTY_PDF_METADATA };
    }
  }

  /**
   * Look for a DOI or ISBN in the embedded metadata first, then — only if
   * Obsidian's own PDF engine is reachable — in the text of the first pages.
   * The text pass is best effort; a missing engine just means metadata only.
   */
  async findIdentifiers(
    file: TFile, meta: PdfExtractedMetadata,
  ): Promise<{ doi: string; isbn: string }> {
    const haystack = [
      file.basename, meta.title, meta.subject, meta.keywords.join(' '),
    ].join('\n');

    let doi = DOI_RE.exec(haystack)?.[0] ?? '';
    let isbn = ISBN_RE.exec(haystack)?.[1]?.replace(/[-\s]/g, '') ?? '';

    if (!doi || !isbn) {
      const text = await this.readFirstPagesText(file, 2);
      if (text) {
        if (!doi) doi = DOI_RE.exec(text)?.[0] ?? '';
        if (!isbn) isbn = ISBN_RE.exec(text)?.[1]?.replace(/[-\s]/g, '') ?? '';
      }
    }

    return { doi: doi.replace(/[.,;)]+$/, ''), isbn };
  }

  private async readFirstPagesText(file: TFile, pages: number): Promise<string> {
    interface TextItem { str?: string }
    interface PdfPage { getTextContent(): Promise<{ items: TextItem[] }> }
    interface PdfDoc { numPages: number; getPage(n: number): Promise<PdfPage> }
    interface PdfJsLib { getDocument(src: { data: ArrayBuffer }): { promise: Promise<PdfDoc> } }

    const lib = (window as unknown as { pdfjsLib?: PdfJsLib }).pdfjsLib;
    if (!lib?.getDocument) return '';

    try {
      const data = await this.app.vault.readBinary(file);
      const doc = await lib.getDocument({ data }).promise;
      const limit = Math.min(pages, doc.numPages);
      const chunks: string[] = [];
      for (let i = 1; i <= limit; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        chunks.push(content.items.map(item => item.str ?? '').join(' '));
      }
      return chunks.join('\n');
    } catch (err) {
      console.warn(`[Att Meta Map] Could not read PDF text from ${file.path}:`, err);
      return '';
    }
  }
}

export interface LookupResult {
  title: string;
  author: string;
  year: string;
}

export const EMPTY_LOOKUP: LookupResult = { title: '', author: '', year: '' };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function parseCrossRefLookup(value: unknown): LookupResult {
  const work = record(record(value)?.message);
  if (!work) return { ...EMPTY_LOOKUP };

  const titles = Array.isArray(work.title) ? work.title : [];
  const authors = Array.isArray(work.author)
    ? work.author.flatMap(value => {
      const author = record(value);
      if (!author) return [];
      const name = optionalString(author.name);
      if (name) return [name];
      const combined = [optionalString(author.family), optionalString(author.given)]
        .filter(Boolean).join(', ');
      return combined ? [combined] : [];
    })
    : [];
  const issued = record(work.issued);
  const dateParts = issued && Array.isArray(issued['date-parts']) ? issued['date-parts'] : [];
  const firstDate = Array.isArray(dateParts[0]) ? dateParts[0] : [];
  const year = typeof firstDate[0] === 'number' ? String(firstDate[0]) : '';

  return {
    title: optionalString(titles[0]),
    author: authors.join('; '),
    year,
  };
}

export async function lookupDoi(doi: string): Promise<LookupResult> {
  try {
    const response = await requestUrl(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    return parseCrossRefLookup(response.json);
  } catch {
    return { ...EMPTY_LOOKUP };
  }
}

export function parseOpenLibraryLookup(value: unknown): LookupResult {
  const data = record(value);
  if (!data) return { ...EMPTY_LOOKUP };
  const publishDate = optionalString(data.publish_date);
  return {
    title: optionalString(data.title),
    author: optionalString(data.by_statement),
    year: /\b(1[5-9]\d{2}|20\d{2})\b/.exec(publishDate)?.[1] ?? '',
  };
}

export async function lookupIsbn(isbn: string): Promise<LookupResult> {
  try {
    const response = await requestUrl(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
    return parseOpenLibraryLookup(response.json);
  } catch {
    return { ...EMPTY_LOOKUP };
  }
}
