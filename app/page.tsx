"use client";

import { logout } from './actions/auth';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import JSZip from 'jszip';

import { 
  UploadCloud, Database, Activity, TrendingUp, Search, 
  LayoutDashboard, FileText, AlertCircle, BarChart3, FileSpreadsheet,
  CheckCircle2, Download, ChevronDown, ChevronUp, FileCode, Edit3, ZoomIn, Link,
  Folder, ArrowLeft, Trash2, Plus, Image as ImageIcon, X, Unlock, Check,
  List, ShoppingCart, Store, ShoppingBag
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';

import { 
  listFiles, deleteFileFromB2, getPublicB2Url, getPresignedUploadUrl, 
  unlockBackblazeCors, renameImageInB2, renameAlbumInB2, listFilesWithDetails 
} from './actions/b2';

// ==========================================
// RSC-SAFE DATA TRANSFER WRAPPERS
// ==========================================
const safeUploadTextToB2 = async (text: string, fileName: string, folder: string) => {
  try {
    const file = new Blob([text], { type: 'text/csv' });
    const url = await getPresignedUploadUrl(fileName, folder, 'text/csv');
    
    const res = await fetch(url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': 'text/csv' }
    });
    
    if (!res.ok) throw new Error("Upload blocked by cloud storage.");
    return true;
  } catch (error) {
    console.error("Upload error:", error);
    return false;
  }
};

const safeGetFileContent = async (fileName: string, folder: string) => {
  try {
    const res = await fetch(`/api/b2?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(fileName)}`);
    if (!res.ok) return "";
    return await res.text();
  } catch (error) {
    console.error("Download error:", error);
    return "";
  }
};

// ==========================================
// 1. MEMORY-SAFE CSV ENGINE
// ==========================================
const parseCSVTable = (text: string): Record<string, string>[] => {
  if (!text) return [];
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') { currentCell += '"'; i++; } 
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentCell); currentCell = '';
    } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
      if (char === '\r') i++;
      currentRow.push(currentCell);
      if (currentRow.some(cell => cell.trim() !== '')) rows.push(currentRow);
      currentRow = []; currentCell = '';
    } else {
      currentCell += char;
    }
  }
  
  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell);
    if (currentRow.some(cell => cell.trim() !== '')) rows.push(currentRow);
  }

  if (rows.length < 2) return []; 
  
  //UPGRADED: Intelligent Duplicate Column Handler
  const rawHeaders = rows[0].map(h => h.trim() || 'Empty');
  const headers: string[] = [];
  const headerCounts: Record<string, number> = {};

  rawHeaders.forEach(h => {
    if (headerCounts[h]) {
      headers.push(`${h}_${headerCounts[h]}`);
      headerCounts[h]++;
    } else {
      headers.push(h);
      headerCounts[h] = 1;
    }
  });

  return rows.slice(1).map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i].trim() : ''; });
    return obj;
  });
};

const toCSV = (data: Record<string, any>[]): string => {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  let csv = headers.join(',') + '\n';
  
  const rows = data.map(row => {
    return headers.map(h => {
      const val = row[h] === null || row[h] === undefined ? '' : String(row[h]);
      return `"${val.replace(/"/g, '""')}"`;
    }).join(',');
  });
  
  return csv + rows.join('\n');
};

const downloadCSV = (data: Record<string, any>[], filename: string) => {
  if (!data || data.length === 0) return alert("No data available to download.");
  const csv = toCSV(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = filename; link.click();
};

const parseJson = (x: any): Record<string, any> => {
  if (typeof x === 'object' && x !== null) return x;
  if (typeof x === 'string' && x.trim() !== '') {
    try { return JSON.parse(x); } catch (e) { return {}; }
  }
  return {};
};

const parseNum = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const clean = String(val).replace(/[$%,]/g, '').trim();
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
};

const unpackRecord = (row: Record<string, string>): Record<string, string> => {
  const rawData = parseJson(row.raw_sheet_data || '{}');
  const result: Record<string, string> = Object.assign({}, rawData);
  Object.keys(row).forEach(k => {
    if (k !== 'raw_sheet_data' && k !== 'id' && k !== 'created_at') result[k] = row[k];
  });
  return result;
};

// ==========================================
// 2. SEO MATCHING ENGINE
// ==========================================
interface MatchResult {
  keyword: string; status: string; exact_locations: string[]; exact_loc_str: string;
  token_coverage_pct: number; missing_tokens: string[]; missing_tokens_str: string;
}

const evaluateKeywordCoverage = (kwPhrase: string, fieldsDict: Record<string, string>): MatchResult => {
  const cleanKw = String(kwPhrase).toLowerCase().trim();
  const kwTokens = cleanKw.match(/\b\w+\b/g)?.filter(t => t.length > 1) || [];

  if (kwTokens.length === 0) {
    return { keyword: kwPhrase, status: "Invalid Keyword", exact_locations: [], exact_loc_str: "None", token_coverage_pct: 0, missing_tokens: [], missing_tokens_str: "None" };
  }

  const exactLocations: string[] = [];
  let fieldTextCombined = "";
  Object.entries(fieldsDict).forEach(([label, text]) => {
    if (text && typeof text === 'string') {
      const cleanText = text.toLowerCase();
      fieldTextCombined += " " + cleanText;
      if (cleanText.includes(cleanKw)) exactLocations.push(label);
    }
  });

  const foundTokens = new Set<string>();
  const missingTokens: string[] = [];
  kwTokens.forEach(token => {
    const regex = new RegExp(`\\b${token}\\b`);
    if (regex.test(fieldTextCombined)) foundTokens.add(token); else missingTokens.push(token);
  });

  const coveragePct = Math.round((foundTokens.size / kwTokens.length) * 100 * 10) / 10;
  let status = exactLocations.length > 0 ? "🟢 Exact Match" : coveragePct === 100 ? "🟡 Broad Match (All Words Present)" : coveragePct > 0 ? `🟠 Partial Match (${foundTokens.size}/${kwTokens.length} Words)` : "🔴 Missing (0% Coverage)";

  return {
    keyword: kwPhrase, status, exact_locations: exactLocations, exact_loc_str: exactLocations.length > 0 ? exactLocations.join(", ") : "None",
    token_coverage_pct: coveragePct, missing_tokens: missingTokens,
    missing_tokens_str: missingTokens.length > 0 ? missingTokens.join(", ") : "None"
  };
};

// ==========================================
// 3. BASE UI COMPONENTS & CUSTOM HOOKS
// ==========================================
function Card({ children, className = '', onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`bg-white border border-slate-200 rounded-xl shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function Button({ children, onClick, variant = 'primary', className = '', disabled = false }: any) {
  const baseStyle = "px-4 py-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-sm";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500",
    secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200 focus:ring-slate-500",
    outline: "border border-slate-300 text-slate-700 hover:bg-slate-50 focus:ring-slate-500",
    danger: "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 focus:ring-red-500"
  };
  return <button onClick={onClick} disabled={disabled} className={`${baseStyle} ${variants[variant as keyof typeof variants]} ${className}`}>{children}</button>;
}

function useB2Files(folder: string, refreshTrigger: number) {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => { listFiles(folder).then(setFiles); }, [folder, refreshTrigger]);
  return files;
}

function useB2FilesWithDetails(folder: string, refreshTrigger: number) {
  const [files, setFiles] = useState<{name: string, date: number}[]>([]);
  useEffect(() => { 
    listFilesWithDetails(folder).then(res => setFiles(res as {name: string, date: number}[])); 
  }, [folder, refreshTrigger]);
  return files;
}

// ==========================================
// 4. MODULE COMPONENTS
// ==========================================
function DataIngestion() {
  const [catFiles, setCatFiles] = useState<File[]>([]);
  const [isCatUploading, setIsCatUploading] = useState(false);
  const [catParsedData, setCatParsedData] = useState<any[] | null>(null);
  const catFileInputRef = useRef<HTMLInputElement>(null);
  const TOP_LEVEL_COLS = ['ASIN', 'Brand', 'title', 'list_price', 'bullet_point_1'];

  const [adFiles, setAdFiles] = useState<File[]>([]);
  const [isAdUploading, setIsAdUploading] = useState(false);
  const [adParsedData, setAdParsedData] = useState<any[] | null>(null);
  const adFileInputRef = useRef<HTMLInputElement>(null);

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const catSnapshots = useB2Files('snapshots/', refreshTrigger);
  const adSnapshots = useB2Files('marketing/', refreshTrigger);

  const handleCatFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setCatFiles(files);
    const text = await files[0].text();
    const parsedDataFull = parseCSVTable(text);
    const preview = parsedDataFull.slice(0, 5).map(row => {
      const obj: Record<string, string> = {};
      Object.keys(row).forEach(h => { if (TOP_LEVEL_COLS.includes(h) || h.toLowerCase() === 'asin') obj[h] = row[h]; });
      return obj;
    });
    setCatParsedData(preview);
  };

  const handleCatUpload = async () => {
    if (catFiles.length === 0) return;
    setIsCatUploading(true);
    for (const file of catFiles) {
      const text = await file.text();
      const rawRows = parseCSVTable(text);
      const records = rawRows.map(row => {
        const rawData: Record<string, string> = {};
        Object.keys(row).forEach(k => { if (!TOP_LEVEL_COLS.includes(k) && k.toLowerCase() !== 'asin') rawData[k] = row[k]; });
        return {
          batch_name: file.name, asin: String(row.ASIN || row.asin || ''), brand: String(row.Brand || row.brand || ''),
          title: String(row.title || row.Title || ''), list_price: String(row.list_price || ''), bullet_point_1: String(row.bullet_point_1 || ''),
          raw_sheet_data: JSON.stringify(rawData)
        };
      });
      const success = await safeUploadTextToB2(toCSV(records), file.name, 'snapshots/');
      if (!success) {
        alert("Upload failed. Please try again or contact the administrator.");
        setIsCatUploading(false);
        return;
      }
    }
    setIsCatUploading(false); setCatFiles([]); setCatParsedData(null); setRefreshTrigger(prev => prev + 1);
  };

  const handleAdFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setAdFiles(files);
    const text = await files[0].text();
    setAdParsedData(parseCSVTable(text).slice(0, 5));
  };

  const handleAdUpload = async () => {
    if (adFiles.length === 0) return;
    setIsAdUploading(true);
    for (const file of adFiles) {
      const success = await safeUploadTextToB2(await file.text(), file.name, 'marketing/');
      if (!success) {
        alert("Upload failed. Please try again or contact the administrator.");
        setIsAdUploading(false);
        return;
      }
    }
    setIsAdUploading(false); setAdFiles([]); setAdParsedData(null); setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Data Ingestion Hub</h2>
        <p className="text-slate-500 mt-1">Centralized upload center for your Catalog Snapshots and Advertising Reports.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="flex items-center space-x-2 mb-4"><Database className="w-5 h-5 text-blue-600"/><h3 className="text-lg font-semibold text-slate-800">Catalog & Listing Snapshots</h3></div>
          <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center justify-center text-center bg-slate-50 hover:bg-slate-100 cursor-pointer" onClick={() => catFileInputRef.current?.click()}>
            <UploadCloud className="w-10 h-10 text-blue-500 mb-3" />
            <p className="text-slate-700 font-medium">Upload Amazon Catalog CSVs</p>
            <input type="file" ref={catFileInputRef} className="hidden" accept=".csv" multiple onChange={handleCatFileChange} />
          </div>

          {catFiles.length > 0 && (
            <div className="mt-4 border border-slate-200 rounded-lg p-4">
              <div className="flex justify-between items-start mb-4">
                <div><p className="font-semibold text-slate-800 text-sm truncate">{catFiles.length} file(s) selected</p></div>
                <Button onClick={handleCatUpload} disabled={isCatUploading}>{isCatUploading ? `Processing...` : 'Save to DB'}</Button>
              </div>
              {catParsedData && !isCatUploading && (
                <div className="mt-2 overflow-x-auto border rounded-lg">
                  <table className="w-full text-xs text-left text-slate-500">
                    <thead className="text-slate-700 bg-slate-50 border-b"><tr>{Object.keys(catParsedData[0]).map(k => <th key={k} className="p-2">{k}</th>)}</tr></thead>
                    <tbody>{catParsedData.map((row, i) => <tr key={i} className="border-b">{Object.values(row).map((val: any, j) => <td key={j} className="p-2 truncate max-w-[120px]">{val}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-center space-x-2 mb-4"><TrendingUp className="w-5 h-5 text-emerald-600"/><h3 className="text-lg font-semibold text-slate-800">Advertising Reports</h3></div>
          <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center justify-center text-center bg-slate-50 hover:bg-slate-100 cursor-pointer" onClick={() => adFileInputRef.current?.click()}>
            <UploadCloud className="w-10 h-10 text-emerald-500 mb-3" />
            <p className="text-slate-700 font-medium">Upload Amazon Search Term Reports</p>
            <input type="file" ref={adFileInputRef} className="hidden" accept=".csv" multiple onChange={handleAdFileChange} />
          </div>

          {adFiles.length > 0 && (
            <div className="mt-4 border border-slate-200 rounded-lg p-4">
              <div className="flex justify-between items-start mb-4">
                <div><p className="font-semibold text-slate-800 text-sm truncate">{adFiles.length} file(s) selected</p></div>
                <Button onClick={handleAdUpload} disabled={isAdUploading} className="bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500">{isAdUploading ? `Processing...` : 'Save to DB'}</Button>
              </div>
              {adParsedData && !isAdUploading && (
                <div className="mt-2 overflow-x-auto border rounded-lg">
                  <table className="w-full text-xs text-left text-slate-500 whitespace-nowrap">
                    <thead className="text-slate-700 bg-slate-50 border-b"><tr>{Object.keys(adParsedData[0]).map(k => <th key={k} className="p-2">{k}</th>)}</tr></thead>
                    <tbody>{adParsedData.map((row, i) => <tr key={i} className="border-b">{Object.values(row).map((val: any, j) => <td key={j} className="p-2">{val}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Manage Uploaded Files</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h4 className="font-medium text-slate-700 border-b pb-2 mb-3">Catalog Snapshots</h4>
            {catSnapshots.length > 0 ? (
              <div className="space-y-2">
                {catSnapshots.map(fileName => (
                  <div key={fileName} className="flex justify-between items-center p-2 border border-slate-200 rounded-lg bg-slate-50">
                    <div className="flex items-center space-x-2 text-sm"><FileText className="text-slate-400 w-4 h-4" /><span className="truncate max-w-[200px]">{fileName}</span></div>
                    <Button variant="danger" className="py-1 px-2 text-xs" onClick={async () => { await deleteFileFromB2(fileName, 'snapshots/'); setRefreshTrigger(r=>r+1); }}>Delete</Button>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-slate-400 italic">No snapshots stored.</p>}
          </div>

          <div>
            <h4 className="font-medium text-slate-700 border-b pb-2 mb-3">Advertising Reports</h4>
            {adSnapshots.length > 0 ? (
              <div className="space-y-2">
                {adSnapshots.map(fileName => (
                  <div key={fileName} className="flex justify-between items-center p-2 border border-slate-200 rounded-lg bg-slate-50">
                    <div className="flex items-center space-x-2 text-sm"><TrendingUp className="text-slate-400 w-4 h-4" /><span className="truncate max-w-[200px]">{fileName}</span></div>
                    <Button variant="danger" className="py-1 px-2 text-xs" onClick={async () => { await deleteFileFromB2(fileName, 'marketing/'); setRefreshTrigger(r=>r+1); }}>Delete</Button>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-slate-400 italic">No ad reports stored.</p>}
          </div>
        </div>
      </Card>
    </div>
  );
}

// --- TAB 9: UNIFIED MASTERLIST WORKSPACE ---

const CATEGORY_SCHEMAS: Record<string, any[]> = {
  wheel_skins: [
    {
      group: "Shared Data", color: "bg-slate-800", text: "text-white",
      subgroups: [
        { name: "General", color: "bg-slate-200", text: "text-slate-800", cols: ["Part No", "Part TYpe Jobber", "Status", "Fitment Info", "FTP QTY", "Jobber Price"] },
        { name: "Keywords Detail Page", color: "bg-slate-300", text: "text-slate-800", cols: ["Cost Price", "Cost Price = 8%", "Product Type", "item Type Keyword", "Hollander/Part Code", "Material", "Number of Items", "Color/ Finish", "Size for Bullet", "Installation Type", "Pattern"] },
        { name: "Keywords for Attribute", color: "bg-slate-200", text: "text-slate-800", cols: ["Compatible With", "Material", "Number of Items", "Exterior Finish", "Color", "Size for Attribute", "Size Digit", "Model Brand Part Fits", "OEM Equivalent Part Number", "Retention Attrbute", "Pattern", "Included Components"] },
        { name: "Weight and Dimensions", color: "bg-slate-300", text: "text-slate-800", cols: ["Generic Keywords", "Item Length", "Item Package Length", "Package Length Unit", "Item Package Width", "Package Width Unit", "Item Package Height", "Package Height Unit", "Package Weight"] },
        { name: "Fitment Info", color: "bg-slate-200", text: "text-slate-800", cols: ["Package Weight Unit", "Fitment Type"] }
      ]
    },
    { group: "OxGord", color: "bg-blue-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-blue-100", text: "text-blue-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "Fuel Rider", color: "bg-red-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-red-100", text: "text-red-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "MUA", color: "bg-purple-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-purple-100", text: "text-purple-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "Walmart", color: "bg-sky-500", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-sky-100", text: "text-sky-900", cols: ["GTIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "eBay", color: "bg-emerald-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-emerald-100", text: "text-emerald-900", cols: ["SKU", "GTIN"] }] },
    { group: "Amazon -OxGord", color: "bg-amber-500", text: "text-white", subgroups: [{ name: "Listing Data", color: "bg-amber-100", text: "text-amber-900", cols: ["Listing Notes", "Live Date", "QTY", "Price", "Shipping Tepmlate", "Business Price", "Title Length", "Product Name", "Title", "Description", "Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4", "Bullet 5", "Hero Image", "Image 1", "Image 2", "Image 3", "Image 4", "Image 5"] }] },
    { group: "Ride And Rover", color: "bg-indigo-600", text: "text-white", subgroups: [{ name: "Financials", color: "bg-indigo-100", text: "text-indigo-900", cols: ["Cost", "Shipping", "Shopify Fee", "Advertising", "Returns Allow", "Margin General P", "Margin Loyalty", "Margin Distributor", "General Price", "Loyalty Price", "Distributor Price"] }] }
  ],
  hubcaps: [
    {
      group: "Shared Data", color: "bg-slate-800", text: "text-white",
      subgroups: [
        { name: "General", color: "bg-slate-200", text: "text-slate-800", cols: ["Part no", "part type jobber", "status", "fitment info", "FTP QTY", "Jobber Price", "Cost Price"] },
        { name: "Keywords Detail Page", color: "bg-slate-300", text: "text-slate-800", cols: ["Product type", "item type keyword", "Hollander/Part Code", "material", "number of items", "color/finish", "size for bullet", "installation type", "pattern"] },
        { name: "Keywords for Attribute", color: "bg-slate-200", text: "text-slate-800", cols: ["material", "number of items", "exterior finish", "color", "size for attribute", "size digit", "model brand part fits", "OEM Equivalent Part Number", "retention attribute", "pattern", "included components", "generic keywords"] },
        { name: "Weight and Dimensions", color: "bg-slate-300", text: "text-slate-800", cols: ["item length", "item package length", "package length unit", "item package width", "package width unit", "item package height", "package height unit", "package weight", "package weight unit"] },
        { name: "Fitment Info", color: "bg-slate-200", text: "text-slate-800", cols: ["fitment type", "fitment for SEO", "make for SEO", "model for SEO", "vehicle category", "number of fitment"] }
      ]
    },
    { group: "OxGord", color: "bg-blue-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-blue-100", text: "text-blue-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "Fuel Rider", color: "bg-red-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-red-100", text: "text-red-900", cols: ["ASIN", "Main Listing SKU", "MPN"] }] },
    { group: "MUA", color: "bg-purple-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-purple-100", text: "text-purple-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "Walmart", color: "bg-sky-500", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-sky-100", text: "text-sky-900", cols: ["GTIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "eBay", color: "bg-emerald-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-emerald-100", text: "text-emerald-900", cols: ["SKU", "GTIN"] }] },
    { group: "Amazon -OxGord", color: "bg-amber-500", text: "text-white", subgroups: [{ name: "Listing Data", color: "bg-amber-100", text: "text-amber-900", cols: ["Listing Notes", "Live Date", "QTY", "Price", "Shipping Tepmlate", "Business Price", "Title Length", "Product Name", "Title", "Description", "Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4", "Bullet 5", "Hero Image", "Image 1", "Image 2", "Image 3", "Image 4", "Image 5"] }] }
  ],
  center_caps: [
    {
      group: "Shared Data", color: "bg-slate-800", text: "text-white",
      subgroups: [
        { name: "General", color: "bg-slate-200", text: "text-slate-800", cols: ["Part no", "part type jobber", "status", "fitment info", "FTP QTY", "Jobber Price", "Cost Price"] },
        { name: "Keywords Detail Page", color: "bg-slate-300", text: "text-slate-800", cols: ["cost price", "Product type", "item type keyword", "Hollander/Part Code", "material", "number of items", "color/finish", "size for bullet", "installation type", "pattern"] },
        { name: "Keywords for Attribute", color: "bg-slate-200", text: "text-slate-800", cols: ["compatible with", "material", "number of items", "exterior finish", "color", "size for attribute", "finish code", "model brand part fits", "OEM Equivalent Part Number", "retention attribute", "pattern", "included components", "generic keywords"] },
        { name: "Weight and Dimensions", color: "bg-slate-300", text: "text-slate-800", cols: ["item length", "item package length", "package length unit", "item package width", "package width unit", "item package height", "package height unit", "package weight", "package weight unit"] },
        { name: "Fitment Info", color: "bg-slate-200", text: "text-slate-800", cols: ["fitment type"] }
      ]
    },
    { group: "OxGord", color: "bg-blue-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-blue-100", text: "text-blue-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "Fuel Rider", color: "bg-red-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-red-100", text: "text-red-900", cols: ["ASIN", "Main Listing SKU", "MPN"] }] },
    { group: "MUA", color: "bg-purple-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-purple-100", text: "text-purple-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "Walmart", color: "bg-sky-500", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-sky-100", text: "text-sky-900", cols: ["GTIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "eBay", color: "bg-emerald-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-emerald-100", text: "text-emerald-900", cols: ["SKU", "GTIN"] }] },
    { group: "Amazon -OxGord", color: "bg-amber-500", text: "text-white", subgroups: [{ name: "Listing Data", color: "bg-amber-100", text: "text-amber-900", cols: ["Listing Notes", "Live Date", "QTY", "Price", "Shipping Tepmlate", "Business Price", "Title Length", "Product Name", "Title", "Description", "Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4", "Bullet 5", "Hero Image", "Image 1", "Image 2", "Image 3", "Image 4", "Image 5"] }] }
  ]
};

// 🚀 GLOBAL SUPERSET SCHEMA (Combines all possible columns for the Global view)
CATEGORY_SCHEMAS['global'] = [
  {
    group: "Shared Data", color: "bg-slate-800", text: "text-white",
    subgroups: [
      { name: "General", color: "bg-slate-200", text: "text-slate-800", cols: ["Part No", "Part no", "Part TYpe Jobber", "part type jobber", "Status", "status", "Fitment Info", "fitment info", "FTP QTY", "Jobber Price", "Cost Price"] },
      { name: "Keywords Detail Page", color: "bg-slate-300", text: "text-slate-800", cols: ["Product Type", "Product type", "item Type Keyword", "item type keyword", "Hollander/Part Code", "Material", "material", "Number of Items", "number of items", "Color/ Finish", "color/finish", "Size for Bullet", "size for bullet", "Installation Type", "installation type", "Pattern", "pattern"] },
      { name: "Keywords for Attribute", color: "bg-slate-200", text: "text-slate-800", cols: ["Compatible With", "compatible with", "Exterior Finish", "exterior finish", "Color", "color", "Size for Attribute", "size for attribute", "Size Digit", "size digit", "finish code", "Model Brand Part Fits", "model brand part fits", "OEM Equivalent Part Number", "Retention Attrbute", "retention attribute", "Included Components", "included components", "Generic Keywords", "generic keywords"] },
      { name: "Weight and Dimensions", color: "bg-slate-300", text: "text-slate-800", cols: ["Item Length", "item length", "Item Package Length", "item package length", "Package Length Unit", "package length unit", "Item Package Width", "item package width", "Package Width Unit", "package width unit", "Item Package Height", "item package height", "Package Height Unit", "package height unit", "Package Weight", "package weight", "Package Weight Unit", "package weight unit"] },
      { name: "Fitment Info", color: "bg-slate-200", text: "text-slate-800", cols: ["Fitment Type", "fitment type", "fitment for SEO", "make for SEO", "model for SEO", "vehicle category", "number of fitment"] }
    ]
  },
  { group: "OxGord", color: "bg-blue-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-blue-100", text: "text-blue-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
  { group: "Fuel Rider", color: "bg-red-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-red-100", text: "text-red-900", cols: ["ASIN", "Main Listing", "Main Listing SKU", "SKU", "MPN"] }] },
  { group: "MUA", color: "bg-purple-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-purple-100", text: "text-purple-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
  { group: "Walmart", color: "bg-sky-500", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-sky-100", text: "text-sky-900", cols: ["GTIN", "Main Listing", "SKU", "MPN"] }] },
  { group: "eBay", color: "bg-emerald-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-emerald-100", text: "text-emerald-900", cols: ["SKU", "GTIN"] }] },
  { group: "Amazon -OxGord", color: "bg-amber-500", text: "text-white", subgroups: [{ name: "Listing Data", color: "bg-amber-100", text: "text-amber-900", cols: ["Listing Notes", "Live Date", "QTY", "Price", "Shipping Tepmlate", "Business Price", "Title Length", "Product Name", "Title", "Description", "Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4", "Bullet 5", "Hero Image", "Image 1", "Image 2", "Image 3", "Image 4", "Image 5"] }] },
  { group: "Ride And Rover", color: "bg-indigo-600", text: "text-white", subgroups: [{ name: "Financials", color: "bg-indigo-100", text: "text-indigo-900", cols: ["Cost", "Shipping", "Shopify Fee", "Advertising", "Returns Allow", "Margin General P", "Margin Loyalty", "Margin Distributor", "General Price", "Loyalty Price", "Distributor Price"] }] }
];

const PRODUCT_CATEGORIES = [
  { id: 'global', label: '🌍 Global Master Sheet', file: 'N/A' }, // NEW GLOBAL TAB
  { id: 'wheel_skins', label: 'Wheel Skins', file: 'masterlist_wheel_skins.csv' },
  { id: 'hubcaps', label: 'Hubcaps', file: 'masterlist_hubcaps.csv' },
  { id: 'center_caps', label: 'Center Caps', file: 'masterlist_center_caps.csv' },
  { id: 'grille_inserts', label: 'Grille Inserts', file: 'masterlist_grille_inserts.csv' }
];

function MasterlistWorkspace() {
  const [activeCategory, setActiveCategory] = useState(PRODUCT_CATEGORIES[0].id);
  const [dataCache, setDataCache] = useState<Record<string, any[]>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Record<string, string> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);

  // 🎯 NEW: DATA EXTRACTION STATES (Rows & Columns)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set());
  const [showColumnFilter, setShowColumnFilter] = useState(false);

  const activeCatObj = PRODUCT_CATEGORIES.find(c => c.id === activeCategory)!;

  // Dynamically generate the schema & keys for the active tab
  const { schemaWithKeys, flattenedSchemaCols } = useMemo(() => {
    const rawSchema = CATEGORY_SCHEMAS[activeCategory]?.length > 0 
      ? CATEGORY_SCHEMAS[activeCategory] 
      : CATEGORY_SCHEMAS['wheel_skins'];

    const headerCounts: Record<string, number> = {};
    const keysSchema = rawSchema.map(g => ({
      ...g,
      subgroups: g.subgroups.map((sg: any) => ({
        ...sg,
        colsWithKey: sg.cols.map((c: string) => {
          const baseName = c.trim();
          let key = baseName;
          if (headerCounts[baseName]) { key = `${baseName}_${headerCounts[baseName]}`; headerCounts[baseName]++; } 
          else { headerCounts[baseName] = 1; }
          return { name: baseName, dataKey: key };
        })
      }))
    }));

    const flatCols = keysSchema.flatMap(g => g.subgroups.flatMap((sg: any) => sg.colsWithKey));
    return { schemaWithKeys: keysSchema, flattenedSchemaCols: flatCols };
  }, [activeCategory]);

  // Reset Row/Column selection when changing tabs
  useEffect(() => {
    setSelectedRows(new Set());
    setVisibleColumns(new Set(flattenedSchemaCols.map((c: any) => c.dataKey)));
    setShowColumnFilter(false);
  }, [activeCategory, flattenedSchemaCols]);

  // Load Database from Cloud
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setUploadProgress(0);

      if (activeCategory === 'global') {
        // Stitch everything together!
        setLoadingText('Stitching Global Database...');
        const allData: any[] = []; // <--- FIXED TYPE ISSUE HERE
        for (const cat of PRODUCT_CATEGORIES.filter(c => c.id !== 'global')) {
          const text = await safeGetFileContent(cat.file, 'masterlists/');
          if (text) allData.push(...parseCSVTable(text));
        }
        setDataCache(prev => ({ ...prev, global: allData }));
      } else {
        setLoadingText(`Fetching ${activeCatObj.label} from cloud...`);
        const text = await safeGetFileContent(activeCatObj.file, 'masterlists/');
        if (text) setDataCache(prev => ({ ...prev, [activeCategory]: parseCSVTable(text) }));
        else setDataCache(prev => ({ ...prev, [activeCategory]: [] }));
      }
      setLoading(false);
    };
    loadData();
  }, [activeCategory, refreshTrigger]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (activeCategory === 'global') return alert("You cannot upload directly to the Global tab. Please upload to a specific category.");
    
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setLoading(true); setUploadProgress(5); setLoadingText('Reading CSV file locally...');
    const text = await files[0].text();

    setLoadingText('Uploading securely to Backblaze...');
    const interval = setInterval(() => {
      setUploadProgress(prev => { if (prev >= 90) return prev; return prev + Math.floor(Math.random() * 8) + 2; });
    }, 300);

    const success = await safeUploadTextToB2(text, activeCatObj.file, 'masterlists/');
    clearInterval(interval);

    if (success) {
      setUploadProgress(100); setLoadingText('Processing and rendering database...');
      setTimeout(() => {
        setDataCache(prev => ({ ...prev, [activeCategory]: parseCSVTable(text) }));
        setLoading(false); setUploadProgress(0);
        alert(`✅ ${activeCatObj.label} Masterlist successfully updated!`);
        setRefreshTrigger(prev => prev + 1);
      }, 600);
    } else {
      setLoading(false); setUploadProgress(0); alert("❌ Upload failed. Please try again.");
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const currentData = dataCache[activeCategory] || [];
  const filteredData = searchQuery ? currentData.filter(row => Object.values(row).some(v => String(v).toLowerCase().includes(searchQuery.toLowerCase()))) : currentData;

  // 🎯 Toggle Row Selection
  const toggleRow = (index: number) => {
    const newSet = new Set(selectedRows);
    if (newSet.has(index)) newSet.delete(index); else newSet.add(index);
    setSelectedRows(newSet);
  };

  // 🎯 Toggle Column Selection
  const toggleColumn = (key: string) => {
    const newSet = new Set(visibleColumns);
    if (newSet.has(key)) newSet.delete(key); else newSet.add(key);
    setVisibleColumns(newSet);
  };

  // 🎯 Smart Export Logic (Exports ONLY visible columns for ONLY selected rows)
  const handleSmartExport = () => {
    const rowsToExport = selectedRows.size > 0 ? filteredData.filter((_, i) => selectedRows.has(i)) : filteredData;
    
    // Reconstruct data dict with only visible columns
    const optimizedData = rowsToExport.map(row => {
      const obj: any = {};
      flattenedSchemaCols.forEach((col: any) => {
        if (visibleColumns.has(col.dataKey)) {
          obj[col.name] = row[col.dataKey] || '';
        }
      });
      return obj;
    });

    downloadCSV(optimizedData, `${activeCategory}_export.csv`);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 relative">
      
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-slate-200 rounded-md flex items-center justify-center"><List className="w-6 h-6 text-slate-400" /></div>
                <div>
                  <h3 className="font-bold text-lg text-slate-900">{selectedProduct['Part No'] || selectedProduct['Part no'] || selectedProduct['ASIN'] || 'Product Details'}</h3>
                  <p className="text-xs text-slate-500">{activeCatObj.label} Catalog Profile</p>
                </div>
              </div>
              <button onClick={() => setSelectedProduct(null)} className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-white space-y-6">
              {schemaWithKeys.map(group => {
                const colsToRender = group.subgroups.flatMap((sg: any) => sg.colsWithKey).filter((c:any) => visibleColumns.has(c.dataKey));
                if (colsToRender.length === 0) return null; // Don't show empty groups

                return (
                  <div key={group.group} className="border border-slate-200 rounded-lg overflow-hidden">
                    <h4 className={`text-xs font-bold p-2 uppercase tracking-wider ${group.color} ${group.text}`}>{group.group}</h4>
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-slate-50">
                      {colsToRender.map((colObj: any) => {
                        const value = selectedProduct[colObj.dataKey];
                        if (!value) return null;
                        const isImage = colObj.name.toLowerCase().includes('image') && String(value).startsWith('http');
                        return (
                          <div key={colObj.dataKey} className="flex flex-col border-b border-slate-200 pb-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">{colObj.name}</span>
                            {isImage ? (
                              <a href={value as string} target="_blank" rel="noreferrer" className="block mt-1.5 hover:opacity-80 transition-opacity" title="Click to open full size">
                                <img src={value as string} alt={colObj.name} className="h-20 w-auto rounded-md border border-slate-200 shadow-sm object-contain bg-white" loading="lazy" />
                              </a>
                            ) : <span className="text-xs text-slate-800 break-words font-medium">{value as string}</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <Button onClick={() => setSelectedProduct(null)}>Close Viewer</Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Data Extraction & Masterlists</h2>
          <p className="text-slate-500 mt-1">Use the Global Tab to select specific rows and columns across your entire database.</p>
        </div>
        
        {activeCategory !== 'global' && (
          <>
            <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleFileUpload} />
            <Button onClick={() => fileInputRef.current?.click()} disabled={loading}>
              <UploadCloud className="w-4 h-4 mr-2" /> Overwrite {activeCatObj.label}
            </Button>
          </>
        )}
      </div>

      {/* 🟢 CATEGORY TABS */}
      <div className="flex border-b border-slate-200 overflow-x-auto mt-2">
        {PRODUCT_CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => { setActiveCategory(cat.id); setSearchQuery(''); }}
            className={`px-5 py-3 text-sm font-medium border-b-2 whitespace-nowrap flex items-center transition-colors ${
              activeCategory === cat.id 
              ? (cat.id === 'global' ? 'border-purple-600 text-purple-700 font-bold bg-purple-50' : 'border-blue-600 text-blue-700 font-bold bg-blue-50/50') 
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <Card className="p-6 relative">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-4">
          <div className="flex items-center space-x-3">
            <span className="text-sm font-medium text-slate-600">Showing {filteredData.length} records</span>
            {selectedRows.size > 0 && (
              <span className="text-xs font-bold bg-blue-100 text-blue-800 px-2 py-1 rounded-md">{selectedRows.size} Rows Selected</span>
            )}
          </div>
          
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <input 
              type="text" 
              placeholder={`Search ${activeCatObj.label}...`} 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
              className="w-full sm:w-64 p-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500"
            />
            
            <Button variant="secondary" onClick={() => setShowColumnFilter(!showColumnFilter)} className="relative">
              <List className="w-4 h-4 mr-2" /> Columns ({visibleColumns.size}/{flattenedSchemaCols.length})
            </Button>

            <Button variant="outline" onClick={handleSmartExport} className="border-blue-200 text-blue-700 hover:bg-blue-50">
              <Download className="w-4 h-4 mr-2"/> Export Selected
            </Button>
          </div>
        </div>

        {/* ⚙️ COLUMN VISIBILITY FILTER MODAL */}
        {showColumnFilter && (
          <div className="absolute top-20 right-6 z-40 bg-white border border-slate-200 shadow-xl rounded-lg p-4 w-80 max-h-96 flex flex-col animate-in slide-in-from-top-2">
            <div className="flex justify-between items-center mb-3">
              <h4 className="font-bold text-slate-800">Filter Columns</h4>
              <div className="flex space-x-2">
                <button onClick={() => setVisibleColumns(new Set(flattenedSchemaCols.map((c:any)=>c.dataKey)))} className="text-xs text-blue-600 hover:underline">All</button>
                <button onClick={() => setVisibleColumns(new Set())} className="text-xs text-slate-500 hover:underline">Clear</button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 space-y-2 pr-2">
              {schemaWithKeys.map(g => (
                <div key={g.group} className="mb-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{g.group}</p>
                  {g.subgroups.flatMap((sg:any) => sg.colsWithKey).map((colObj: any) => (
                    <label key={colObj.dataKey} className="flex items-center space-x-2 text-xs text-slate-700 hover:bg-slate-50 p-1 rounded cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={visibleColumns.has(colObj.dataKey)} 
                        onChange={() => toggleColumn(colObj.dataKey)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="truncate" title={colObj.name}>{colObj.name}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <Button onClick={() => setShowColumnFilter(false)} className="mt-3 w-full py-1.5 text-xs">Apply Filters</Button>
          </div>
        )}

        {loading ? (
          <div className="p-16 flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl bg-slate-50 min-h-[300px]">
            {activeCategory === 'global' ? <Database className="w-12 h-12 mb-4 text-purple-600 animate-pulse" /> : <UploadCloud className="w-12 h-12 mb-4 text-blue-600 animate-bounce" />}
            <p className="font-semibold text-slate-700 text-lg">{loadingText}</p>
            {uploadProgress > 0 && (
              <div className="w-full max-w-md mt-6">
                <div className="h-2.5 w-full bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-blue-600 rounded-full transition-all duration-300" style={{ width: `${Math.min(uploadProgress, 100)}%` }}/></div>
                <div className="flex justify-between mt-2 text-xs text-slate-500 font-bold uppercase tracking-wider"><span>Uploading...</span><span>{Math.min(uploadProgress, 100)}%</span></div>
              </div>
            )}
          </div>
        ) : filteredData.length === 0 ? (
          <div className="text-center p-12 text-slate-500 border border-dashed rounded-lg bg-slate-50">
            <List className="w-12 h-12 mx-auto mb-4 text-slate-300" />
            <p>No database loaded for {activeCatObj.label}.</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[700px] border border-slate-200 rounded-lg shadow-sm">
            <table className="w-full text-sm text-left text-slate-600 whitespace-nowrap border-collapse">
              <thead className="bg-slate-100 sticky top-0 z-20">
                {/* TIER 1: TOP LEVEL GROUPS */}
                <tr>
                  <th className="p-2 border-r border-b border-slate-300 bg-slate-100 sticky left-0 z-30 shadow-[1px_0_0_0_#cbd5e1] text-center" rowSpan={3}>
                    <input type="checkbox" onChange={(e) => {
                      if(e.target.checked) setSelectedRows(new Set(filteredData.map((_, i) => i)));
                      else setSelectedRows(new Set());
                    }} checked={selectedRows.size === filteredData.length && filteredData.length > 0} className="rounded border-slate-300" />
                  </th>
                  <th className="p-2 border-r border-b border-slate-300 bg-slate-100 sticky left-[36px] z-30 shadow-[1px_0_0_0_#cbd5e1]" rowSpan={3}>Action</th>
                  {schemaWithKeys.map(g => {
                    const visibleGroupCols = g.subgroups.flatMap((sg:any) => sg.colsWithKey).filter((c:any) => visibleColumns.has(c.dataKey));
                    if (visibleGroupCols.length === 0) return null;
                    return <th key={g.group} colSpan={visibleGroupCols.length} className={`p-2 text-center text-xs border-r border-slate-300 font-bold ${g.color} ${g.text}`}>{g.group}</th>
                  })}
                </tr>
                
                {/* TIER 2: SUB GROUPS */}
                <tr>
                  {schemaWithKeys.flatMap((g, gIndex) => g.subgroups.map((sg: any, sgIndex: number) => {
                    const visibleSgCols = sg.colsWithKey.filter((c:any) => visibleColumns.has(c.dataKey));
                    if (visibleSgCols.length === 0) return null;
                    return <th key={`${g.group}-${sg.name}-${gIndex}-${sgIndex}`} colSpan={visibleSgCols.length} className={`p-1 text-center text-[10px] border-r border-b border-slate-300 font-semibold ${sg.color} ${sg.text}`}>{sg.name || 'Data'}</th>
                  }))}
                </tr>

                {/* TIER 3: ACTUAL COLUMN NAMES */}
                <tr>
                  {flattenedSchemaCols.filter((c:any) => visibleColumns.has(c.dataKey)).map((colObj: any) => (
                    <th key={colObj.dataKey} className="p-2 text-[10px] font-semibold border-r border-b border-slate-300 bg-white truncate max-w-[150px]" title={colObj.name}>{colObj.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredData.slice(0, 500).map((row, rowIndex) => (
                  <tr key={rowIndex} className={`hover:bg-slate-50 transition-colors ${selectedRows.has(rowIndex) ? 'bg-blue-50/50' : ''}`}>
                    <td className="p-2 border-r border-slate-200 bg-white group-hover:bg-slate-50 sticky left-0 z-10 shadow-[1px_0_0_0_#e2e8f0] text-center">
                       <input type="checkbox" checked={selectedRows.has(rowIndex)} onChange={() => toggleRow(rowIndex)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                    </td>
                    <td className="p-2 border-r border-slate-200 bg-white group-hover:bg-slate-50 sticky left-[36px] z-10 shadow-[1px_0_0_0_#e2e8f0]">
                      <Button variant="secondary" className="text-[10px] py-1 px-3 w-full whitespace-nowrap" onClick={() => setSelectedProduct(row)}>
                        <ZoomIn className="w-3 h-3 mr-1" /> View Details
                      </Button>
                    </td>
                    
                    {flattenedSchemaCols.filter((c:any) => visibleColumns.has(c.dataKey)).map((colObj: any) => {
                      const val = String(row[colObj.dataKey] || '');
                      const isImage = colObj.name.toLowerCase().includes('image') && val.startsWith('http');
                      const isStatusActive = colObj.name.toLowerCase() === 'status' && val.toLowerCase() === 'active';

                      return (
                        <td key={colObj.dataKey} className="p-2 truncate max-w-[150px] border-r border-slate-100 text-[11px]" title={val}>
                          {isImage ? (
                            <img src={val} alt="thumb" className="w-8 h-8 object-cover rounded border border-slate-200" loading="lazy" />
                          ) : isStatusActive ? (
                            <span className="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded-full font-semibold">{val}</span>
                          ) : (
                            val
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredData.length > 500 && (
              <div className="p-3 text-center text-xs text-slate-500 bg-slate-50 border-t border-slate-200">
                Showing top 500 results. Use the search bar to find specific items.
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ==========================================
// PLACEHOLDER: CATALOG MONITOR (To satisfy TS checks)
// ==========================================
function CatalogMonitor() {
  return (
    <Card className="p-12 text-center text-slate-500">
      <Activity className="w-12 h-12 mx-auto mb-4 text-slate-300" />
      <h2 className="text-xl font-bold text-slate-700 mb-2">Catalog Monitor</h2>
      <p>This module is currently active but waiting for configuration data.</p>
    </Card>
  );
}

// ==========================================
// 10. MAIN APPLICATION WRAPPER
// ==========================================
export default function Page() {
  const [activeModule, setActiveModule] = useState('ingestion');

  const navGroups = [
    {
      title: 'Data Management',
      items: [
        { id: 'ingestion', label: 'Data Ingestion', icon: Database },
        { id: 'images', label: 'Image Vault', icon: UploadCloud },
      ]
    },
    {
      title: 'Catalog Intelligence',
      items: [
        { id: 'masterlist', label: 'Marketplace Masterlists', icon: List },
        { id: 'catalog', label: 'Master Catalog', icon: FileText },
        { id: 'monitor', label: 'Catalog Monitor', icon: Activity },
        { id: 'deepdive', label: 'ASIN Deep Dive', icon: ZoomIn },
        { id: 'global_delta', label: 'Global Delta View', icon: FileSpreadsheet },
      ]
    },
    {
      title: 'Growth & Marketing',
      items: [
        { id: 'ads', label: 'Ads Analysis', icon: TrendingUp },
        { id: 'seo', label: 'SEO Intelligence', icon: Search },
      ]
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900">
      
      <aside className="w-64 bg-slate-900 text-white hidden md:flex flex-col shadow-xl z-10">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <LayoutDashboard className="w-6 h-6 text-blue-400" />
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">Rapid Revver</span>
          </div>
          <p className="text-slate-400 text-xs mt-1">Analytics</p>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto">
          {navGroups.map((group, idx) => (
            <div key={idx} className="mb-6 px-3">
              <h3 className="px-3 mb-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                {group.title}
              </h3>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeModule === item.id;
                  return (
                    <li key={item.id}>
                      <button onClick={() => setActiveModule(item.id)} className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-colors text-sm font-medium ${isActive ? 'bg-blue-600 text-white shadow-md' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
                        <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        
        <div className="p-4 mt-auto">
          <button 
            onClick={async () => {
              await logout();
              window.location.href = '/login';
            }} 
            className="w-full flex justify-center items-center py-2 text-sm text-slate-400 border border-slate-700 rounded-lg hover:bg-slate-800 hover:text-white transition-colors"
          >
            Log Out
          </button>
        </div>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center space-x-2 text-xs text-slate-400 bg-slate-800 p-2 rounded-lg">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>CSV Engine Active</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="md:hidden bg-white border-b border-slate-200 p-4 flex justify-between items-center shadow-sm z-10">
          <span className="text-xl font-bold text-slate-900">Rapid Revver</span>
          <select value={activeModule} onChange={(e) => setActiveModule(e.target.value)} className="border-slate-300 p-2 border rounded-md text-sm">
            {navGroups.flatMap(g => g.items).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-[1400px] mx-auto">
            {activeModule === 'ingestion' && <DataIngestion />}
            {activeModule === 'images' && <ImageVault />}
            {activeModule === 'masterlist' && <MasterlistWorkspace />}
            {activeModule === 'catalog' && <MasterCatalog />}
            {activeModule === 'monitor' && <CatalogMonitor />}
            {activeModule === 'deepdive' && <AsinDeepDive />}
            {activeModule === 'global_delta' && <GlobalDeltaView />}
            {activeModule === 'ads' && <AdsAnalysis />}
            {activeModule === 'seo' && <SeoIntelligence />}
          </div>
        </div>
      </main>
    </div>
  );
}