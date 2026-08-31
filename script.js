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

const DB_NAME = 'sku-extractor';
const STORE_NAME = 'documents';
const ACTIVE_DOCUMENT_KEY = 'active-pdf';
// Matches IDs such as 08002P040210029174: five digits, P, then twelve digits.
const SKU_PATTERN = /\b\d{5}P\d{12}\b/gi;
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
  pageCountEl.textContent = `· ${document.pageCount} page${document.pageCount === 1 ? '' : 's'}`;
  fileBar.classList.add('show');
  renderFoundList();
  compareBtn.disabled = false;
  compareNote.textContent = 'Ready to compare';
}

compareBtn.addEventListener('click', () => {
  const inputSkus = [...new Set(
    skuInput.value.toUpperCase().match(SKU_PATTERN) || []
  )];

  if (inputSkus.length === 0) {
    compareNote.textContent = 'Paste at least one valid SKU ID to compare';
    return;
  }

  const extractedSet = new Set(extractedSkus);
  const rows = inputSkus.map(sku => ({ sku, isMatch: extractedSet.has(sku) }));
  const matchCount = rows.filter(row => row.isMatch).length;

  matchCountEl.textContent = matchCount;
  missCountEl.textContent = rows.length - matchCount;
  checkedCountEl.textContent = rows.length;
  resultList.innerHTML = rows
    .sort((a, b) => Number(b.isMatch) - Number(a.isMatch))
    .map(row => `<div class="result-row ${row.isMatch ? 'matched' : 'missed'}"><span>${escapeHtml(row.sku)}</span><span class="tag">${row.isMatch ? 'found in document' : 'not found'}</span></div>`)
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
