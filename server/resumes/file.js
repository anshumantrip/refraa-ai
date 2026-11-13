import yauzl from 'yauzl';
import { SaxesParser } from 'saxes';
import { DocumentError } from './errors.js';

export const pdfMime = 'application/pdf';
export const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const textLimit = 250_000;
const xmlLimit = 5 * 1024 ** 2;
const wordNamespaces = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main']);

export function safeFilename(name) {
  return name.split(/[\\/]/u).at(-1).normalize('NFKC').replace(/[\p{C}]/gu, '').trim().slice(0, 180);
}

export async function inspectFile(bytes, name) {
  if (/\.pdf$/i.test(name) && /^%PDF-\d\.\d/.test(bytes.subarray(0, 12).toString('ascii'))) return pdfMime;
  if (/\.docx$/i.test(name) && bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) {
    await readWordPart(bytes, false);
    return docxMime;
  }
  throw new DocumentError('File signature does not match a supported PDF or DOCX.');
}

function readWordPart(bytes, extract) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) => {
      const invalid = () => {
        zip?.close();
        reject(new DocumentError('DOCX is corrupt, encrypted, or exceeds safe extraction limits.'));
      };
      if (error || zip.entryCount > 2000) return invalid();
      const parts = new Map();
      let expanded = 0;
      zip.on('error', invalid);
      zip.on('entry', entry => {
        expanded += entry.uncompressedSize;
        if (expanded > 100 * 1024 ** 2 || entry.generalPurposeBitFlag & 1 ||
            /(?:^|\/)vbaProject\.bin$/i.test(entry.fileName)) return invalid();
        if (['word/document.xml', '[Content_Types].xml'].includes(entry.fileName)) {
          if (parts.has(entry.fileName) || entry.uncompressedSize > xmlLimit) return invalid();
          parts.set(entry.fileName, entry);
        }
        zip.readEntry();
      });
      zip.on('end', () => {
        if (parts.size !== 2) return invalid();
        if (!extract) { zip.close(); return resolve(); }
        // The archive must stay open until the document stream is consumed.
        zip.openReadStream(parts.get('word/document.xml'), (streamError, stream) => {
          if (streamError) return invalid();
          const chunks = [];
          let size = 0;
          stream.on('error', invalid);
          stream.on('data', chunk => {
            size += chunk.length;
            if (size > xmlLimit) { stream.destroy(); invalid(); }
            else chunks.push(chunk);
          });
          stream.on('end', () => { zip.close(); resolve(Buffer.concat(chunks).toString('utf8')); });
        });
      });
      zip.readEntry();
    });
  });
}

async function docxText(bytes) {
  const xml = await readWordPart(bytes, true);
  let output = '';
  let textDepth = 0;
  const parser = new SaxesParser({ xmlns: true });
  const append = value => {
    if (output.length + value.length > textLimit) throw new DocumentError('Document text exceeds the extraction limit.');
    output += value;
  };
  parser.on('doctype', () => { throw new DocumentError('XML document types are not allowed.'); });
  parser.on('opentag', tag => {
    if (!wordNamespaces.has(tag.uri)) return;
    if (tag.local === 't') textDepth++;
    if (tag.local === 'br' || tag.local === 'tab') append(tag.local === 'tab' ? ' ' : '\n');
  });
  parser.on('text', value => { if (textDepth) append(value); });
  parser.on('closetag', tag => {
    if (!wordNamespaces.has(tag.uri)) return;
    if (tag.local === 't') textDepth--;
    if (tag.local === 'p') append('\n');
  });
  try { parser.write(xml).close(); }
  catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError('DOCX document XML is invalid.');
  }
  return output;
}

async function pdfText(bytes) {
  const { getDocument, PasswordException } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false, disableFontFace: true,
    useSystemFonts: false, stopAtErrors: true, verbosity: 0, maxImageSize: 4_000_000 });
  let output = '';
  try {
    const document = await task.promise;
    if (document.numPages > 100) throw new DocumentError('PDF exceeds the 100-page extraction limit.');
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const { items } = await page.getTextContent();
      let lastY;
      for (const item of items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform?.[5];
        if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 2 && !output.endsWith('\n')) output += '\n';
        output += item.str + (item.hasEOL ? '\n' : ' ');
        if (output.length > textLimit) throw new DocumentError('Document text exceeds the extraction limit.');
        lastY = y;
      }
      output += '\n';
      page.cleanup();
    }
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    if ((typeof PasswordException === 'function' && error instanceof PasswordException) || error.name === 'PasswordException') {
      throw new DocumentError('Password-protected PDFs cannot be processed.');
    }
    throw new DocumentError('PDF could not be read. It may be corrupt.');
  } finally { await task.destroy(); }
  return output;
}

export async function extractText(bytes, mime) {
  if (mime !== pdfMime && mime !== docxMime) throw new DocumentError('Unsupported document type.');
  const text = (await (mime === pdfMime ? pdfText(bytes) : docxText(bytes))).replaceAll('\0', '').trim();
  if (!text && mime === pdfMime) throw new DocumentError('No readable text was found. OCR may be required.', 'ocr_required');
  if (!text) throw new DocumentError('No readable text was found in the DOCX.');
  return text;
}
