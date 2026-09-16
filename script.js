/* global pdfjsLib */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fileBar = document.getElementById('fileBar');
const fname = document.getElementById('fname');
const pageCountEl = document.getElementById('pageCount');
const changeFileBtn = document.getElementById('changeFile');
const foundList = document.getElementById('foundList');
const foundSub = document.getElementById('foundSub');
const skuInput = document.getElementById('skuInput');
const compareBtn = document.getElementById('compareBtn');
const compareNote = document.getElementById('compareNote');
const resultsPanel = document.getElementById('results');
const resultList = document.getElementById('resultList');
const matchCountEl = document.getElementById('matchCount');
const missCountEl = document.getElementById('missCount');
const checkedCountEl = document.getElementById('checkedCount');
const extractedSkuInput = document.getElementById('extractedSkuInput');
const usePastedSkusBtn = document.getElementById('usePastedSkusBtn');
const pastedSkuNote = document.getElementById('pastedSkuNote');
const compareFileInput = document.getElementById('compareFileInput');
const uploadCompareFileBtn = document.getElementById('uploadCompareFileBtn');
const compareFileNote = document.getElementById('compareFileNote');

const DB_NAME = 'sku-extractor';
const STORE_NAME = 'documents';
const ACTIVE_DOCUMENT_KEY = 'active-pdf';
// Matches IDs such as 08002P040210029174: five digits, P, then twelve digits.
const SKU_PATTERN = /\b\d{5}P\d{12}\b/gi;
// Allows a SKU prefix such as 02056P0324 in the Compare field.
const SKU_PREFIX_PATTERN = /\b\d{5}P\d+\b/gi;
let extractedSkus = [];

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', event => {
  event.preventDefault();
  dropzone.classList.remove('drag');
  if (event.dataTransfer.files.length) handleFile(event.dataTransfer.files[0]);
});
fileInput.addEventListener('change', event => {
  if (event.target.files.length) handleFile(event.target.files[0]);
  fileInput.value = '';
});
changeFileBtn.addEventListener('click', event => {
  event.stopPropagation();
  fileInput.click();
});
usePastedSkusBtn.addEventListener('click', usePastedSkus);
uploadCompareFileBtn.addEventListener('click', () => compareFileInput.click());
compareFileInput.addEventListener('change', async event => {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  await loadComparisonDocument(file);
});

async function handleFile(file) {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    alert('Please choose a PDF file.');
    return;
  }

  setLoading(file.name);
  try {
    const data = await file.arrayBuffer();
    const result = await extractSkus(data);
    await saveActiveDocument({ name: file.name, data, ...result });
    showDocument({ name: file.name, ...result });
  } catch (error) {
    console.error(error);
    foundSub.textContent = 'Could not read this PDF.';
    foundList.innerHTML = '<div class="empty">Please upload a valid, text-based PDF.</div>';
  }
}

async function extractSkus(data) {
  const pdf = await pdfjsLib.getDocument({ data: data.slice(0) }).promise;
  const skus = new Set();
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    const matches = pageText.match(SKU_PATTERN) || [];
    matches.forEach(sku => skus.add(sku.toUpperCase()));
  }
  return { pageCount: pdf.numPages, skus: [...skus].sort() };
}

function setLoading(name) {
  fname.textContent = name;
  pageCountEl.textContent = '· Reading…';
  fileBar.classList.add('show');
  foundSub.textContent = 'Scanning for SKU IDs…';
  foundList.innerHTML = '<div class="placeholder">Scanning for SKU IDs…</div>';
}

function showDocument(document) {
  extractedSkus = document.skus;
  fname.textContent = document.name;
  pageCountEl.textContent = document.pageCount
    ? `· ${document.pageCount} page${document.pageCount === 1 ? '' : 's'}`
    : '· Pasted SKU IDs';
  fileBar.classList.add('show');
  renderFoundList();
  compareBtn.disabled = false;
  compareNote.textContent = 'Ready to compare';
}

async function usePastedSkus() {
  const skus = [...new Set(extractedSkuInput.value.toUpperCase().match(SKU_PATTERN) || [])].sort();
  if (skus.length === 0) {
    pastedSkuNote.textContent = 'Paste at least one full SKU ID, such as 08002P040210029174.';
    return;
  }

  const document = { name: 'Pasted SKU IDs', pageCount: 0, skus };
  try {
    await saveActiveDocument(document);
    pastedSkuNote.textContent = `${skus.length} unique SKU ID${skus.length === 1 ? '' : 's'} loaded and saved.`;
  } catch (error) {
    console.error(error);
    pastedSkuNote.textContent = `${skus.length} unique SKU IDs loaded for this session.`;
  }
  showDocument(document);
}

async function loadComparisonDocument(file) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isText = file.type.startsWith('text/') || /\.(txt|csv)$/i.test(file.name);
  if (!isPdf && !isText) {
    compareFileNote.textContent = 'Please choose a PDF, TXT, or CSV document.';
    return;
  }

  uploadCompareFileBtn.disabled = true;
  compareFileNote.textContent = `Reading ${file.name}…`;
  try {
    let documentText;
    if (isPdf) {
      documentText = await extractTextFromPdf(await file.arrayBuffer());
    } else {
      documentText = await file.text();
    }

    const values = [...new Set(documentText.toUpperCase().match(SKU_PREFIX_PATTERN) || [])];
    if (values.length === 0) {
      compareFileNote.textContent = `No SKU IDs or prefixes found in ${file.name}.`;
      return;
    }
    skuInput.value = values.join('\n');
    compareFileNote.textContent = `${values.length} SKU ID${values.length === 1 ? '' : 's'} or prefix${values.length === 1 ? '' : 'es'} loaded from ${file.name}.`;
  } catch (error) {
    console.error(error);
    compareFileNote.textContent = `Could not read ${file.name}.`;
  } finally {
    uploadCompareFileBtn.disabled = false;
  }
}

async function extractTextFromPdf(data) {
  const pdf = await pdfjsLib.getDocument({ data: data.slice(0) }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    pages.push(textContent.items.map(item => item.str).join(' '));
  }
  return pages.join('\n');
}

compareBtn.addEventListener('click', () => {
  const inputSkus = [...new Set(skuInput.value.toUpperCase().match(SKU_PREFIX_PATTERN) || [])];

  if (inputSkus.length === 0) {
    compareNote.textContent = 'Paste at least one SKU ID or SKU prefix to compare';
    return;
  }

  const matchedSkus = new Set();
  const missingQueries = [];
  inputSkus.forEach(query => {
    const matches = extractedSkus.filter(sku => sku.startsWith(query));
    if (matches.length === 0) missingQueries.push(query);
    matches.forEach(sku => matchedSkus.add(sku));
  });
  const rows = [
    ...[...matchedSkus].sort().map(sku => ({ sku, isMatch: true })),
    ...missingQueries.map(sku => ({ sku, isMatch: false }))
  ];

  matchCountEl.textContent = matchedSkus.size;
  missCountEl.textContent = missingQueries.length;
  checkedCountEl.textContent = inputSkus.length;
  resultList.innerHTML = rows
    .map(row => `<div class="result-row ${row.isMatch ? 'matched' : 'missed'}"><span>${escapeHtml(row.sku)}</span><span class="tag">${row.isMatch ? 'found' : 'no match'}</span></div>`)
    .join('');
  resultsPanel.classList.add('show');
  resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function renderFoundList() {
  if (extractedSkus.length === 0) {
    foundSub.textContent = 'Total: 0 SKU IDs';
    foundList.innerHTML = '<div class="empty">No matching SKU IDs were found in this document.</div>';
    return;
  }
  foundSub.textContent = `Total: ${extractedSkus.length} unique SKU ID${extractedSkus.length === 1 ? '' : 's'}`;
  foundList.innerHTML = extractedSkus.map(sku => `<div class="row">${escapeHtml(sku)}</div>`).join('');
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveActiveDocument(document) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(document, ACTIVE_DOCUMENT_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function loadActiveDocument() {
  try {
    const db = await openDatabase();
    const document = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(ACTIVE_DOCUMENT_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (document) showDocument(document);
  } catch (error) {
    console.warn('Could not restore the saved PDF.', error);
  }
}

loadActiveDocument();
