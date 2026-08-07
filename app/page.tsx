"use client";

import { logout } from './actions/auth';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  UploadCloud, Database, Activity, TrendingUp, Search, 
  LayoutDashboard, FileText, AlertCircle, BarChart3, FileSpreadsheet,
  CheckCircle2, Download, ChevronDown, ChevronUp, FileCode, Edit3, ZoomIn, Link
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';

import { 
  uploadFileToB2, listFiles, deleteFileFromB2, getPublicB2Url
} from './actions/b2';

// ==========================================
// RSC-SAFE DATA TRANSFER WRAPPERS
// ==========================================
const safeUploadTextToB2 = async (text: string, fileName: string, folder: string) => {
  try {
    const formData = new FormData();
    formData.append("file", new Blob([text], { type: 'text/csv' }), fileName);
    formData.append("folder", folder);
    
    await uploadFileToB2(formData);
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
  const headers = rows[0].map(h => h.trim());
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
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white border border-slate-200 rounded-xl shadow-sm ${className}`}>{children}</div>;
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

// ==========================================
// 4. MODULE COMPONENTS (The Sidebar Items)
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
  const adSnapshots = useB2Files('ads/', refreshTrigger);

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
      await safeUploadTextToB2(toCSV(records), file.name, 'snapshots/');
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
    for (const file of adFiles) await safeUploadTextToB2(await file.text(), file.name, 'ads/');
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
                    <Button variant="danger" className="py-1 px-2 text-xs" onClick={async () => { await deleteFileFromB2(fileName, 'ads/'); setRefreshTrigger(r=>r+1); }}>Delete</Button>
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

function CatalogMonitor() {
  const [activeTab, setActiveTab] = useState('analysis');
  const [loading, setLoading] = useState(false);
  const [oldFile, setOldFile] = useState('');
  const [newFile, setNewFile] = useState('');
  const [reportNameInput, setReportNameInput] = useState('');
  const [changesList, setChangesList] = useState<any[]>([]);
  const [totalMonitored, setTotalMonitored] = useState(0);
  const [hasRun, setHasRun] = useState(false);
  
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const snapshots = useB2Files('snapshots/', refreshTrigger);
  const reportFiles = useB2Files('reports/', refreshTrigger);

  const [reportsDataFull, setReportsDataFull] = useState<any[]>([]);
  const [selectedReportName, setSelectedReportName] = useState('');
  const [dashSearch, setDashSearch] = useState('');

  useEffect(() => {
    if (snapshots.length >= 2) {
      if (!oldFile) setOldFile(snapshots[0]);
      if (!newFile) setNewFile(snapshots[snapshots.length - 1]);
    }
  }, [snapshots.length]);

  useEffect(() => {
    if (reportFiles.includes('monitoring_reports.csv')) {
      safeGetFileContent('monitoring_reports.csv', 'reports/').then(text => {
        const data = parseCSVTable(text);
        setReportsDataFull(data);
        const uniqueSet = new Set<string>();
        data.forEach(r => { if (r.current_batch) uniqueSet.add(r.current_batch); });
        const unique = Array.from(uniqueSet);
        if (unique.length > 0 && !selectedReportName) setSelectedReportName(unique[unique.length - 1]);
      });
    } else {
      setReportsDataFull([]);
    }
  }, [reportFiles.length, refreshTrigger]);

  const handleRunDeltaAnalysis = async () => {
    if (!oldFile || !newFile) return alert("Please select baseline and target snapshot files.");
    setLoading(true);

    const oldText = await safeGetFileContent(oldFile, 'snapshots/');
    const newText = await safeGetFileContent(newFile, 'snapshots/');
    
    const oldData = parseCSVTable(oldText).map(unpackRecord);
    const newData = parseCSVTable(newText).map(unpackRecord);

    const oldMap = new Map(oldData.map(r => [r.asin || r.ASIN, r]));
    const newMap = new Map(newData.map(r => [r.asin || r.ASIN, r]));

    const asinSet = new Set<string>();
    oldMap.forEach((_, key) => asinSet.add(String(key)));
    newMap.forEach((_, key) => asinSet.add(String(key)));
    const allAsins = Array.from(asinSet).filter(Boolean);
    
    const changes: any[] = [];
    const buyboxKeywords = ["buy_box", "buybox", "featured_offer", "featured_merchant"];

    allAsins.forEach(asin => {
      const oldRow = oldMap.get(asin); const newRow = newMap.get(asin);
      if (!oldRow || !newRow) return;

      if ((newRow.title || newRow.Title || '') !== (oldRow.title || oldRow.Title || '')) changes.push({ asin, field_changed: "Title", old_value: oldRow.title || oldRow.Title || '', new_value: newRow.title || newRow.Title || '' });
      if ((newRow.list_price || '') !== (oldRow.list_price || '')) changes.push({ asin, field_changed: "Price", old_value: oldRow.list_price || '', new_value: newRow.list_price || '' });
      for (let i = 1; i <= 5; i++) {
        const bpCol = `bullet_point_${i}`;
        if ((newRow[bpCol] || '') !== (oldRow[bpCol] || '')) changes.push({ asin, field_changed: `Bullet Point ${i}`, old_value: oldRow[bpCol] || '', new_value: newRow[bpCol] || '' });
      }
      
      const allKeysSet = new Set<string>();
      Object.keys(oldRow).forEach(k => allKeysSet.add(k));
      Object.keys(newRow).forEach(k => allKeysSet.add(k));
      
      allKeysSet.forEach(k => {
        if (buyboxKeywords.some(kw => k.toLowerCase().includes(kw))) {
          if ((newRow[k] || '') !== (oldRow[k] || '')) changes.push({ asin, field_changed: `Buy Box (${k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())})`, old_value: oldRow[k] || '', new_value: newRow[k] || '' });
        }
      });
    });

    setTotalMonitored(allAsins.length); setChangesList(changes); setReportNameInput(`${newFile} (vs ${oldFile})`); setHasRun(true); setLoading(false);
  };

  const changedAsinSet = new Set<string>();
  changesList.forEach(c => changedAsinSet.add(c.asin));
  const itemsChanged = changedAsinSet.size;
  const healthScore = totalMonitored > 0 ? (((totalMonitored - itemsChanged) / totalMonitored) * 100).toFixed(1) : '0';

  const handleSaveReport = async () => {
    if (!reportNameInput.trim()) return alert("Please enter a valid report name.");
    const reportRecords = changesList.map(c => ({ asin: c.asin, current_batch: reportNameInput.trim(), previous_batch: oldFile, field_changed: c.field_changed, old_value: c.old_value, new_value: c.new_value, report_notes: "" }));
    const updated = reportsDataFull.concat(reportRecords);
    await safeUploadTextToB2(toCSV(updated), 'monitoring_reports.csv', 'reports/');
    setRefreshTrigger(r => r + 1);
    alert(`Modifications saved into report '${reportNameInput.trim()}'!`);
  };

  const savedReportSet = new Set<string>();
  reportsDataFull.forEach(r => { if (r.current_batch) savedReportSet.add(r.current_batch); });
  const savedReportNames = Array.from(savedReportSet);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Catalog Listing Monitor</h2>
        <p className="text-slate-500 mt-1">Track catalog changes and view historic alerts dashboard.</p>
      </div>

      <div className="flex border-b border-slate-200">
        <button onClick={() => setActiveTab('analysis')} className={`px-4 py-2.5 text-sm font-medium border-b-2 ${activeTab === 'analysis' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>Run Delta Analysis</button>
        <button onClick={() => setActiveTab('dashboard')} className={`px-4 py-2.5 text-sm font-medium border-b-2 ${activeTab === 'dashboard' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>Analytics Dashboard</button>
      </div>

      {activeTab === 'analysis' && (
        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Compare Snapshots</h3>
            {snapshots.length < 2 ? (
              <div className="p-6 text-center text-slate-500 border border-dashed rounded-lg">No snapshots available. Please ingest at least 2 snapshot files first.</div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Baseline Snapshot (Older)</label>
                    <select className="w-full border-slate-300 p-2 border rounded-md text-sm bg-white" value={oldFile} onChange={e => setOldFile(e.target.value)}>{snapshots.map(s => <option key={s}>{s}</option>)}</select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Target Snapshot (Newer)</label>
                    <select className="w-full border-slate-300 p-2 border rounded-md text-sm bg-white" value={newFile} onChange={e => setNewFile(e.target.value)}>{snapshots.map(s => <option key={s}>{s}</option>)}</select>
                  </div>
                </div>
                <Button onClick={handleRunDeltaAnalysis} disabled={loading}>{loading ? 'Running Analysis...' : 'Run Comparison'}</Button>
              </>
            )}
          </Card>

          {hasRun && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="p-6 border-l-4 border-l-blue-500"><p className="text-slate-500 text-sm font-medium">Total ASINs</p><h3 className="text-3xl font-bold text-slate-900 mt-2">{totalMonitored}</h3></Card>
                <Card className="p-6 border-l-4 border-l-amber-500"><p className="text-slate-500 text-sm font-medium">ASINs Altered</p><h3 className="text-3xl font-bold text-slate-900 mt-2">{itemsChanged}</h3></Card>
                <Card className="p-6 border-l-4 border-l-emerald-500"><p className="text-slate-500 text-sm font-medium">Catalog Health Score</p><h3 className="text-3xl font-bold text-slate-900 mt-2">{healthScore}%</h3></Card>
              </div>

              {changesList.length > 0 ? (
                <>
                  <Card className="p-6 bg-amber-50 border-amber-200 flex justify-between items-center">
                    <p className="text-amber-900 font-medium">Detected {changesList.length} total modifications across {itemsChanged} ASINs.</p>
                    <Button onClick={() => downloadCSV(changesList, 'active_delta_report.csv')}><Download className="w-4 h-4 mr-2"/> Download Delta CSV</Button>
                  </Card>

                  <Card className="overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                      <h3 className="font-semibold text-slate-800">Detected Field Modifications</h3>
                      {changesList.length > 500 && <span className="text-xs text-slate-500 font-medium bg-slate-200 px-2 py-1 rounded-full">Previewing Top 500</span>}
                    </div>
                    <div className="overflow-x-auto max-h-[400px]">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-white border-b sticky top-0 text-slate-500">
                          <tr><th className="p-3">ASIN</th><th className="p-3">Altered Field</th><th className="p-3">Old Value</th><th className="p-3">New Value</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {changesList.slice(0, 500).map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="p-3 font-mono font-medium text-slate-900">{row.asin}</td>
                              <td className="p-3 font-medium text-slate-800">{row.field_changed}</td>
                              <td className="p-3 text-red-700 bg-red-50/50 max-w-[300px] truncate">{row.old_value || <span className="text-slate-400 italic">Empty</span>}</td>
                              <td className="p-3 text-emerald-700 bg-emerald-50/50 max-w-[300px] truncate">{row.new_value || <span className="text-slate-400 italic">Empty</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  <Card className="p-6 space-y-4">
                    <h3 className="font-semibold text-slate-800">Save Report</h3>
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                      <input type="text" value={reportNameInput} onChange={e => setReportNameInput(e.target.value)} className="flex-1 p-2 border border-slate-300 rounded-md text-sm w-full" placeholder="Report Name" />
                      <Button onClick={handleSaveReport}>Lock & Flag Modifications to Dashboard</Button>
                    </div>
                  </Card>
                </>
              ) : (
                <Card className="p-6 bg-emerald-50 border-emerald-200">
                  <p className="text-emerald-800 font-medium text-center">Catalog is perfectly synchronized. No changes detected.</p>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          <div className="flex justify-between items-end">
            <h2 className="text-xl font-bold text-slate-900">Modification Intelligence</h2>
            {savedReportNames.length > 0 && (
              <select className="border-slate-300 p-2 border rounded-md text-sm bg-white" value={selectedReportName} onChange={e => setSelectedReportName(e.target.value)}>{savedReportNames.map(s => <option key={s}>{s}</option>)}</select>
            )}
          </div>

          {savedReportNames.length === 0 ? (
            <Card className="p-12 text-center text-slate-500 border-dashed">No flagged reports available yet.</Card>
          ) : (
            (() => {
              const currentReportData = reportsDataFull.filter(r => r.current_batch === selectedReportName);
              const fieldCounts = currentReportData.reduce((acc, row) => { acc[row.field_changed] = (acc[row.field_changed] || 0) + 1; return acc; }, {} as Record<string, number>);
              const modeField = Object.keys(fieldCounts).sort((a,b) => fieldCounts[b] - fieldCounts[a])[0] || 'N/A';
              const pieData = Object.keys(fieldCounts).map(k => ({ name: k, value: fieldCounts[k] }));
              const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
              const filteredReportRows = currentReportData.filter(r => !dashSearch || Object.values(r).some(v => String(v).toLowerCase().includes(dashSearch.toLowerCase())));

              const affectedSet = new Set<string>();
              currentReportData.forEach(r => affectedSet.add(r.asin));

              return (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Card className="p-6"><p className="text-slate-500 text-sm font-medium">Affected ASINs</p><h3 className="text-3xl font-bold text-slate-900 mt-2">{affectedSet.size}</h3></Card>
                    <Card className="p-6"><p className="text-slate-500 text-sm font-medium">Total Flagged Attributes</p><h3 className="text-3xl font-bold text-slate-900 mt-2">{currentReportData.length}</h3></Card>
                    <Card className="p-6"><p className="text-slate-500 text-sm font-medium">Most Targeted Field</p><h3 className="text-3xl font-bold text-slate-900 mt-2 truncate">{modeField}</h3></Card>
                  </div>
                  <Card className="p-6">
                    <h3 className="font-semibold text-slate-800 mb-4">Distribution of Modifications</h3>
                    <div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4} dataKey="value">{pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>
                  </Card>
                  <Card className="overflow-hidden">
                    <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                      <h3 className="font-semibold text-slate-800">Deep Dive: Flagged Entries</h3>
                      <input type="text" placeholder="Search reports..." value={dashSearch} onChange={e => setDashSearch(e.target.value)} className="p-1.5 border border-slate-300 rounded-md text-sm bg-white"/>
                    </div>
                    <div className="overflow-x-auto max-h-[400px]">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-white border-b sticky top-0 text-slate-500"><tr><th className="p-3">ASIN</th><th className="p-3">Altered Field</th><th className="p-3">Old Value</th><th className="p-3">New Value</th></tr></thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {filteredReportRows.slice(0, 500).map((r, i) => (
                            <tr key={i} className="hover:bg-slate-50"><td className="p-3 font-mono font-medium">{r.asin}</td><td className="p-3">{r.field_changed}</td><td className="p-3 text-red-700 bg-red-50/50 max-w-[200px] truncate">{r.old_value}</td><td className="p-3 text-emerald-700 bg-emerald-50/50 max-w-[200px] truncate">{r.new_value}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="p-4 border-t bg-slate-50 flex justify-between items-center">
                      <Button onClick={() => downloadCSV(filteredReportRows, `${selectedReportName}_Report.csv`)}>Download Flagged Report (CSV)</Button>
                      <Button variant="danger" onClick={async () => { await safeUploadTextToB2(toCSV(reportsDataFull.filter(r => r.current_batch !== selectedReportName)), 'monitoring_reports.csv', 'reports/'); setSelectedReportName(''); setRefreshTrigger(r => r + 1); }}>Delete This Report</Button>
                    </div>
                  </Card>
                </>
              );
            })()
          )}
        </div>
      )}
    </div>
  );
}

// --- TAB 3: MASTER CATALOG ---
function MasterCatalog() {
  const [activeTab, setActiveTab] = useState('viewer');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const snapshots = useB2Files('snapshots/', refreshTrigger);
  
  const [selectedCatFiles, setSelectedCatFiles] = useState<string[]>([]);
  const [catSearch, setCatSearch] = useState('');
  const [catalogData, setCatalogData] = useState<any[]>([]);

  const [editFile, setEditFile] = useState('');
  const [editableRows, setEditableRows] = useState<Record<string, string>[]>([]);
  const [isEditLoaded, setIsEditLoaded] = useState(false);

  useEffect(() => {
    if (snapshots.length > 0 && selectedCatFiles.length === 0) setSelectedCatFiles([snapshots[snapshots.length - 1]]);
  }, [snapshots.length]);

  const loadViewerData = async () => {
    let combined: any[] = [];
    for (const s of selectedCatFiles) {
      const text = await safeGetFileContent(s, 'snapshots/');
      combined = combined.concat(parseCSVTable(text).map(unpackRecord));
    }
    setCatalogData(combined);
  };

  const handleLoadEditGrid = async () => {
    if (!editFile) return alert("Select a snapshot to edit.");
    const text = await safeGetFileContent(editFile, 'snapshots/');
    setEditableRows(parseCSVTable(text).map(unpackRecord));
    setIsEditLoaded(true);
  };

  const handleSaveEditor = async () => {
    if (!editFile) return;
    const coreCols = ["asin", "brand", "title", "list_price", "bullet_point_1"];
    const records = editableRows.map(row => {
      const rawData: Record<string, string> = {};
      Object.keys(row).forEach(k => { if (!coreCols.includes(k) && k !== 'batch_name') rawData[k] = row[k]; });
      return {
        batch_name: editFile, asin: String(row.asin || row.ASIN || ''), brand: String(row.brand || row.Brand || ''),
        title: String(row.title || row.Title || ''), list_price: String(row.list_price || ''), bullet_point_1: String(row.bullet_point_1 || ''), raw_sheet_data: JSON.stringify(rawData)
      };
    });
    await safeUploadTextToB2(toCSV(records), editFile, 'snapshots/');
    setRefreshTrigger(r => r + 1);
    alert(`Changes saved to '${editFile}'!`);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Master Catalog Workspace</h2>
        <p className="text-slate-500 mt-1">Browse, search, and edit your raw product data.</p>
      </div>

      <div className="flex border-b border-slate-200">
        <button onClick={() => setActiveTab('viewer')} className={`px-4 py-2.5 text-sm font-medium border-b-2 ${activeTab === 'viewer' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>Catalog Viewer</button>
        <button onClick={() => setActiveTab('editor')} className={`px-4 py-2.5 text-sm font-medium border-b-2 ${activeTab === 'editor' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>Live Data Editor</button>
      </div>

      {activeTab === 'viewer' && (
        <Card className="p-6">
          <h3 className="font-semibold text-slate-800 mb-4">Master Catalog Viewer</h3>
          {snapshots.length === 0 ? <div className="text-slate-500 text-center p-8 border border-dashed rounded-lg">Upload CSV in Data Ingestion first.</div> : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Files to View</label>
                  <div className="max-h-32 overflow-y-auto border border-slate-300 p-2 rounded-md space-y-1">
                    {snapshots.map(s => (
                      <label key={s} className="flex items-center space-x-2 text-sm">
                        <input type="checkbox" checked={selectedCatFiles.includes(s)} onChange={e => { if (e.target.checked) setSelectedCatFiles(prev => prev.concat([s])); else setSelectedCatFiles(prev => prev.filter(f => f !== s)); }}/>
                        <span>{s}</span>
                      </label>
                    ))}
                  </div>
                  <Button variant="outline" className="mt-2 text-xs" onClick={loadViewerData}>Load Selected Files</Button>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Search Catalog</label>
                  <input type="text" placeholder="Search loaded files..." value={catSearch} onChange={e => setCatSearch(e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-sm bg-white"/>
                </div>
              </div>
              
              {(() => {
                const filtered = catSearch ? catalogData.filter(row => Object.values(row).some(v => String(v).toLowerCase().includes(catSearch.toLowerCase()))) : catalogData;
                const headers = filtered.length > 0 ? ['batch_name', ...Object.keys(filtered[0]).filter(k => k !== 'batch_name')] : [];
                return (
                  <>
                    <div className="flex justify-between items-center mb-2">
                      <div className="text-sm font-medium text-slate-600">Total Products in View: {filtered.length}</div>
                      {filtered.length > 0 && <Button variant="outline" onClick={() => downloadCSV(filtered, 'filtered_catalog.csv')}><Download className="w-4 h-4 mr-2"/> Export View</Button>}
                    </div>
                    {filtered.length > 0 ? (
                      <div className="overflow-x-auto max-h-[500px] border border-slate-200 rounded-lg">
                        <table className="w-full text-sm text-left text-slate-600 whitespace-nowrap">
                          <thead className="bg-slate-100 sticky top-0 text-slate-700"><tr>{headers.map(h => <th key={h} className="p-2 font-semibold border-b">{h}</th>)}</tr></thead>
                          <tbody className="divide-y divide-slate-100">{filtered.slice(0, 500).map((row, i) => <tr key={i} className="hover:bg-slate-50">{headers.map(h => <td key={h} className="p-2 truncate max-w-xs">{row[h]}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                    ) : <div className="p-8 text-center text-slate-500 border border-dashed rounded-lg">No data loaded. Click "Load Selected Files".</div>}
                  </>
                );
              })()}
            </>
          )}
        </Card>
      )}

      {activeTab === 'editor' && (
        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="font-semibold text-slate-800 mb-4">Live Data Editor</h3>
            <div className="flex flex-col sm:flex-row gap-4 items-center mb-4">
              <select className="border-slate-300 p-2 border rounded-md text-sm flex-1 w-full bg-white" value={editFile} onChange={e => { setEditFile(e.target.value); setIsEditLoaded(false); }}>
                <option value="">-- Select Snapshot to Edit --</option>
                {snapshots.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <Button onClick={handleLoadEditGrid}><Edit3 className="w-4 h-4 mr-2"/> Load Editable Grid</Button>
            </div>
          </Card>

          {isEditLoaded && editableRows.length > 0 && (
            <Card className="p-6 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-slate-700">Editing Snapshot: {editFile}</span>
                <Button variant="outline" onClick={() => setEditableRows(prev => prev.concat([{ asin: "NEW_ASIN", title: "New Product Title", brand: "Brand", list_price: "0.00" }]))}>+ Add Row</Button>
              </div>

              <div className="overflow-x-auto max-h-[500px] border border-slate-200 rounded-lg">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-100 sticky top-0 text-slate-700 border-b">
                    <tr>{Object.keys(editableRows[0]).map(k => <th key={k} className="p-2 whitespace-nowrap">{k}</th>)}<th className="p-2">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {editableRows.slice(0, 500).map((row, rowIndex) => (
                      <tr key={rowIndex} className="hover:bg-slate-50">
                        {Object.keys(editableRows[0]).map(colKey => (
                          <td key={colKey} className="p-1 min-w-[120px]"><input type="text" value={row[colKey] || ''} onChange={e => { const val = e.target.value; setEditableRows(prev => prev.map((r, i) => i === rowIndex ? { ...r, [colKey]: val } : r)); }} className="w-full p-1 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-blue-500" /></td>
                        ))}
                        <td className="p-1 text-center"><Button variant="danger" onClick={() => setEditableRows(prev => prev.filter((_, i) => i !== rowIndex))} className="text-xs py-1 px-2">Del</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button onClick={handleSaveEditor}>Save Changes to Database</Button>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// --- TAB 4: ASIN DEEP DIVE ---
function AsinDeepDive() {
  const [refreshTrigger] = useState(0);
  const snapshots = useB2Files('snapshots/', refreshTrigger);
  const [ddOld, setDdOld] = useState('');
  const [ddNew, setDdNew] = useState('');
  const [ddAsin, setDdAsin] = useState('');
  const [ddShowDiffOnly, setDdShowDiffOnly] = useState(false);
  const [ddRows, setDdRows] = useState<any[] | null>(null);

  useEffect(() => {
    if (snapshots.length >= 2) {
      if (!ddOld) setDdOld(snapshots[0]);
      if (!ddNew) setDdNew(snapshots[snapshots.length - 1]);
    }
  }, [snapshots.length]);

  const handleRunDeepDive = async () => {
    if (!ddAsin.trim()) return alert("Please enter an ASIN.");
    const oldData = parseCSVTable(await safeGetFileContent(ddOld, 'snapshots/')).map(unpackRecord);
    const newData = parseCSVTable(await safeGetFileContent(ddNew, 'snapshots/')).map(unpackRecord);
    
    const oldRecord = oldData.find(r => (r.asin || r.ASIN) === ddAsin.trim()) || {};
    const newRecord = newData.find(r => (r.asin || r.ASIN) === ddAsin.trim()) || {};

    if (Object.keys(oldRecord).length === 0 && Object.keys(newRecord).length === 0) return alert(`ASIN '${ddAsin}' not found in either snapshot.`);

    const allKeysSet = new Set<string>();
    Object.keys(oldRecord).forEach(k => allKeysSet.add(k));
    Object.keys(newRecord).forEach(k => allKeysSet.add(k));
    const allKeys = Array.from(allKeysSet).sort();
    
    const buyboxKeywords = ["buy_box", "buybox", "featured_offer", "featured_merchant"];

    let comparison = allKeys.map(k => {
      const valO = String(oldRecord[k] || '');
      const valN = String(newRecord[k] || '');
      return { Field: k, "Older Value": valO, "Newer Value": valN, "Changed?": valO !== valN ? "Yes" : "No", isBuyBox: buyboxKeywords.some(kw => k.toLowerCase().includes(kw)) };
    });

    if (ddShowDiffOnly) comparison = comparison.filter(r => r["Changed?"] === "Yes");
    setDdRows(comparison);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">ASIN Deep Dive Comparison</h2>
        <p className="text-slate-500 mt-1">Granular field-by-field inspection for a single product.</p>
      </div>

      <Card className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Baseline Snapshot (Older)</label>
            <select className="w-full border-slate-300 p-2 border rounded-md bg-white text-sm" value={ddOld} onChange={e => setDdOld(e.target.value)}>{snapshots.map(s => <option key={s}>{s}</option>)}</select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Target Snapshot (Newer)</label>
            <select className="w-full border-slate-300 p-2 border rounded-md bg-white text-sm" value={ddNew} onChange={e => setDdNew(e.target.value)}>{snapshots.map(s => <option key={s}>{s}</option>)}</select>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 items-center mb-4">
          <input type="text" placeholder="Enter ASIN to inspect (e.g. B08...)" value={ddAsin} onChange={e => setDdAsin(e.target.value)} className="p-2 border border-slate-300 rounded-md text-sm flex-1 w-full"/>
          <label className="flex items-center space-x-2 text-sm text-slate-700"><input type="checkbox" checked={ddShowDiffOnly} onChange={e => setDdShowDiffOnly(e.target.checked)} className="rounded text-blue-600"/><span>Show only fields with changes</span></label>
          <Button onClick={handleRunDeepDive}><ZoomIn className="w-4 h-4 mr-2"/> Run Deep Dive</Button>
        </div>
      </Card>

      {ddRows && (
        <Card className="p-6 overflow-hidden">
          <div className="overflow-x-auto max-h-[500px] border border-slate-200 rounded-lg">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-slate-100 sticky top-0 text-slate-700 border-b">
                <tr><th className="p-2">Field</th><th className="p-2">Older Value</th><th className="p-2">Newer Value</th><th className="p-2">Changed?</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ddRows.map((r, i) => {
                  let bgClass = "hover:bg-slate-50";
                  if (r["Changed?"] === "Yes") bgClass = r.isBuyBox ? "bg-yellow-100 text-yellow-900 font-semibold" : "bg-red-50 text-red-900";
                  return <tr key={i} className={bgClass}><td className="p-2 font-medium">{r.Field}</td><td className="p-2">{r["Older Value"]}</td><td className="p-2">{r["Newer Value"]}</td><td className="p-2">{r["Changed?"]}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <Button className="mt-4" onClick={() => downloadCSV(ddRows, `${ddAsin}_deep_dive.csv`)}>Download ASIN Deep Dive (CSV)</Button>
        </Card>
      )}
    </div>
  );
}

// --- TAB 5: GLOBAL DELTA VIEW ---
function GlobalDeltaView() {
  const [refreshTrigger] = useState(0);
  const snapshots = useB2Files('snapshots/', refreshTrigger);
  const [deltaOld, setDeltaOld] = useState('');
  const [deltaNew, setDeltaNew] = useState('');
  const [deltaModifiedOnly, setDeltaModifiedOnly] = useState(false);
  const [deltaBuyboxOnly, setDeltaBuyboxOnly] = useState(false);
  const [deltaSearch, setDeltaSearch] = useState('');
  const [deltaDisplayData, setDeltaDisplayData] = useState<any[] | null>(null);

  useEffect(() => {
    if (snapshots.length >= 2) {
      if (!deltaOld) setDeltaOld(snapshots[0]);
      if (!deltaNew) setDeltaNew(snapshots[snapshots.length - 1]);
    }
  }, [snapshots.length]);

  const handleGenerateFullComparison = async () => {
    if (!deltaOld || !deltaNew) return alert("Select baseline and target snapshots.");
    
    const oldData = parseCSVTable(await safeGetFileContent(deltaOld, 'snapshots/')).map(unpackRecord);
    const newData = parseCSVTable(await safeGetFileContent(deltaNew, 'snapshots/')).map(unpackRecord);

    const oldMap = new Map(oldData.map(r => [r.asin || r.ASIN, r]));
    const newMap = new Map(newData.map(r => [r.asin || r.ASIN, r]));

    const asinSet = new Set<string>();
    oldMap.forEach((_, key) => asinSet.add(String(key)));
    newMap.forEach((_, key) => asinSet.add(String(key)));
    const mergedAsins = Array.from(asinSet).filter(Boolean);
    
    const buyboxKeywords = ["buy_box", "buybox", "featured_offer", "featured_merchant"];

    const allBaseColsSet = new Set<string>();
    oldData.forEach(r => Object.keys(r).forEach(k => { if (k.toLowerCase() !== 'asin') allBaseColsSet.add(k); }));
    newData.forEach(r => Object.keys(r).forEach(k => { if (k.toLowerCase() !== 'asin') allBaseColsSet.add(k); }));

    const allBaseCols = Array.from(allBaseColsSet);
    const bbCols = allBaseCols.filter(c => buyboxKeywords.some(kw => c.toLowerCase().includes(kw)));
    
    const coreOrder = ["title", "list_price", "brand", ...bbCols, "bullet_point_1", "bullet_point_2", "bullet_point_3", "bullet_point_4", "bullet_point_5"];

    const sortedBaseCols = coreOrder.filter(c => allBaseCols.includes(c)).concat(allBaseCols.filter(c => !coreOrder.includes(c)).sort());

    let fullRows = mergedAsins.map(asin => {
      const oldRow = oldMap.get(asin) || {};
      const newRow = newMap.get(asin) || {};
      const rowObj: Record<string, string> = { ASIN: asin };
      sortedBaseCols.forEach(col => {
        rowObj[`${col} (Old)`] = String(oldRow[col] || '');
        rowObj[`${col} (New)`] = String(newRow[col] || '');
      });
      return rowObj;
    });

    if (deltaBuyboxOnly) fullRows = fullRows.filter(row => bbCols.some(c => row[`${c} (Old)`] !== row[`${c} (New)`]));
    else if (deltaModifiedOnly) fullRows = fullRows.filter(row => sortedBaseCols.some(c => row[`${c} (Old)`] !== row[`${c} (New)`]));

    setDeltaDisplayData(fullRows);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Global Delta View</h2>
        <p className="text-slate-500 mt-1">Side-by-side wide comparison of entire catalog snapshots.</p>
      </div>

      <Card className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Baseline Snapshot (Older)</label>
            <select className="w-full border-slate-300 p-2 border rounded-md text-sm bg-white" value={deltaOld} onChange={e => setDeltaOld(e.target.value)}>{snapshots.map(s => <option key={s}>{s}</option>)}</select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Target Snapshot (Newer)</label>
            <select className="w-full border-slate-300 p-2 border rounded-md text-sm bg-white" value={deltaNew} onChange={e => setDeltaNew(e.target.value)}>{snapshots.map(s => <option key={s}>{s}</option>)}</select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <label className="flex items-center space-x-2 text-sm text-slate-700"><input type="checkbox" checked={deltaModifiedOnly} onChange={e => setDeltaModifiedOnly(e.target.checked)} className="rounded text-blue-600"/><span>Only show ASINs with changes</span></label>
          <label className="flex items-center space-x-2 text-sm text-slate-700"><input type="checkbox" checked={deltaBuyboxOnly} onChange={e => setDeltaBuyboxOnly(e.target.checked)} className="rounded text-blue-600"/><span>Only show ASINs with Buy Box changes</span></label>
        </div>
        <Button onClick={handleGenerateFullComparison}>Generate Full Comparison</Button>
      </Card>

      {deltaDisplayData && (
        <Card className="p-6 overflow-hidden">
          <div className="flex justify-between items-center mb-4">
            <span className="font-semibold text-slate-800">Total Products in View: {deltaDisplayData.length}</span>
            <input type="text" placeholder="Filter table by ASIN..." value={deltaSearch} onChange={e => setDeltaSearch(e.target.value)} className="p-1.5 border border-slate-300 rounded-md text-sm"/>
          </div>

          {(() => {
            const searchFiltered = deltaSearch ? deltaDisplayData.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(deltaSearch.toLowerCase()))) : deltaDisplayData;
            const buyboxKeywords = ["buy_box", "buybox", "featured_offer", "featured_merchant"];

            return (
              <>
                <div className="overflow-x-auto max-h-[500px] border border-slate-200 rounded-lg">
                  <table className="w-full text-sm text-left border-collapse whitespace-nowrap">
                    <thead className="bg-slate-100 sticky top-0 text-slate-700 border-b">
                      <tr>{searchFiltered.length > 0 && Object.keys(searchFiltered[0]).map(k => <th key={k} className="p-2 font-semibold">{k}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {searchFiltered.slice(0, 500).map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          {Object.entries(row).map(([key, val], j) => {
                            let isChanged = false, isBuyBox = false;
                            if (key !== 'ASIN') {
                              const baseName = key.replace(' (Old)', '').replace(' (New)', '');
                              isChanged = row[`${baseName} (Old)`] !== row[`${baseName} (New)`];
                              isBuyBox = buyboxKeywords.some(kw => baseName.toLowerCase().includes(kw));
                            }
                            let cellStyle = "p-2 truncate max-w-[200px] border-r border-slate-100 last:border-r-0";
                            if (isChanged && key !== 'ASIN') cellStyle += isBuyBox ? " bg-yellow-100 text-yellow-900 font-semibold" : " bg-red-50 text-red-900";
                            return <td key={j} className={cellStyle} title={val as string}>{val as string}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button className="mt-4" onClick={() => downloadCSV(searchFiltered, 'global_delta_catalog.csv')}>Download Global Delta Data (CSV)</Button>
              </>
            );
          })()}
        </Card>
      )}
    </div>
  );
}

// --- TAB 6: IMAGE VAULT ---
function ImageVault() {
  const [uploading, setUploading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [copied, setCopied] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const images = useB2Files('images/', refresh);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);

    for(const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", "images/");
      
      try {
        await uploadFileToB2(formData);
      } catch (err) {
        console.error(err);
      }
    }
    setUploading(false);
    setRefresh(r=>r+1);
  };

  const handleCopyLink = async (imgName: string) => {
    try {
      const url = await getPublicB2Url(imgName, 'images/');
      await navigator.clipboard.writeText(url);
      setCopied(imgName);
      setTimeout(() => setCopied(''), 2000);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">📷 Image Vault</h2>
        <p className="text-slate-500 mt-1">Upload product images directly to your B2 bucket.</p>
      </div>
      <Card className="p-8 text-center">
        <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
          <UploadCloud className="w-10 h-10 text-blue-500 mb-3" />
          <h3 className="text-lg font-semibold text-slate-800">Upload Product Photos</h3>
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleUpload}/>
        </div>
        {uploading && <p className="text-sm text-blue-600 mt-4 animate-pulse">Uploading images directly to Backblaze...</p>}
      </Card>
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Browse Uploaded Images</h3>
        {images.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {images.map(imgName => (
              <div key={imgName} className="border border-slate-200 rounded-lg overflow-hidden flex flex-col">
                <div className="h-48 bg-slate-100 flex items-center justify-center p-2">
                  <img 
                    src={`/api/b2?folder=images/&file=${encodeURIComponent(imgName)}`} 
                    alt={imgName} 
                    className="max-h-full max-w-full object-contain" 
                  />
                </div>
                <div className="p-3 bg-white flex justify-between items-center gap-2">
                  <p className="text-sm font-medium text-slate-800 truncate flex-1" title={imgName}>{imgName}</p>
                  <div className="flex space-x-1">
                    <Button variant="outline" className="text-xs px-2 py-1 flex items-center" onClick={() => handleCopyLink(imgName)}>
                      <Link className="w-3 h-3 mr-1" />
                      {copied === imgName ? 'Copied!' : 'Copy'}
                    </Button>
                    <Button variant="danger" className="text-xs px-2 py-1" onClick={async () => { await deleteFileFromB2(imgName, 'images/'); setRefresh(r=>r+1); }}>Del</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="text-center p-8 text-slate-500 border border-dashed rounded-lg">No images in vault.</div>}
      </Card>
    </div>
  );
}

// --- TAB 7: ADS ANALYSIS ---
function AdsAnalysis() {
  const [activeTab, setActiveTab] = useState('perf');
  const [refreshTrigger] = useState(0);
  const adFiles = useB2Files('ads/', refreshTrigger);

  // Filters
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([]);
  const [selectedAdGroups, setSelectedAdGroups] = useState<string[]>([]);
  const [selectedMatchTypes, setSelectedMatchTypes] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [minAcos, setMinAcos] = useState(0);

  const [cRowLimit, setCRowLimit] = useState(15);
  const [gRowLimit, setGRowLimit] = useState(15);
  const [tRowLimit, setTRowLimit] = useState(15);

  const [optSummary, setOptSummary] = useState(true);
  const [optCampaigns, setOptCampaigns] = useState(true);
  const [optAdGroups, setOptAdGroups] = useState(true);
  const [optTerms, setOptTerms] = useState(true);
  const [optRaw, setOptRaw] = useState(false);

  const [rawAdRows, setRawAdRows] = useState<Record<string, string>[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(false);

  useEffect(() => {
    const loadAdsData = async () => {
      setIsDataLoading(true);
      let combined: Record<string, string>[] = [];
      for (const fileName of adFiles) {
        const text = await safeGetFileContent(fileName, 'ads/');
        combined = combined.concat(parseCSVTable(text));
      }
      setRawAdRows(combined);
      setIsDataLoading(false);
    };
    if (adFiles.length > 0) loadAdsData();
    else setRawAdRows([]);
  }, [adFiles.length]);

  const filteredData = useMemo(() => {
    return rawAdRows.filter(row => {
      const campaign = row['Campaign Name'] || row['campaign_name'] || '';
      const adGroup = row['Ad Group Name'] || row['ad_group_name'] || '';
      const matchType = row['Match Type'] || row['match_type'] || '';
      const searchTermVal = row['Customer Search Term'] || row['customer_search_term'] || '';
      const acosVal = parseNum(row['Total Advertising Cost of Sales (ACOS)'] || row['ACOS'] || 0);

      if (selectedCampaigns.length > 0 && !selectedCampaigns.includes(campaign)) return false;
      if (selectedAdGroups.length > 0 && !selectedAdGroups.includes(adGroup)) return false;
      if (selectedMatchTypes.length > 0 && !selectedMatchTypes.includes(matchType)) return false;
      if (searchTerm && !searchTermVal.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (minAcos > 0 && acosVal < minAcos) return false;
      return true;
    });
  }, [rawAdRows, selectedCampaigns, selectedAdGroups, selectedMatchTypes, searchTerm, minAcos]);

  const aggregate = useMemo(() => {
    let totalSpend = 0, totalSales = 0, totalOrders = 0, totalImpressions = 0, totalClicks = 0;
    filteredData.forEach(row => {
      totalSpend += parseNum(row['Spend'] || row['spend']);
      totalSales += parseNum(row['7 Day Total Sales'] || row['sales']);
      totalOrders += parseNum(row['7 Day Total Orders (#)'] || row['orders']);
      totalImpressions += parseNum(row['Impressions'] || row['impressions']);
      totalClicks += parseNum(row['Clicks'] || row['clicks']);
    });
    return { 
      totalSpend, totalSales, totalOrders, totalImpressions, totalClicks, 
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
      acos: totalSales > 0 ? (totalSpend / totalSales) * 100 : 0,
      roas: totalSpend > 0 ? totalSales / totalSpend : 0
    };
  }, [filteredData]);

  const aggregateGroup = (groupByKey: string, limit: number, sortBySales = true) => {
    const map = new Map<string, any>();
    filteredData.forEach(row => {
      const keyVal = row[groupByKey] || row[groupByKey.toLowerCase()] || 'Unknown';
      if (!map.has(keyVal)) map.set(keyVal, { Spend: 0, Sales: 0, Orders: 0, Impressions: 0, Clicks: 0, Units: 0 });
      const item = map.get(keyVal)!;
      item.Spend += parseNum(row['Spend'] || row['spend']);
      item.Sales += parseNum(row['7 Day Total Sales'] || row['sales']);
      item.Orders += parseNum(row['7 Day Total Orders (#)'] || row['orders']);
      item.Impressions += parseNum(row['Impressions'] || row['impressions']);
      item.Clicks += parseNum(row['Clicks'] || row['clicks']);
    });

    return Array.from(map.entries()).map(([name, data]) => ({
      Name: name, Impressions: data.Impressions, Clicks: data.Clicks,
      CTR: data.Impressions > 0 ? (data.Clicks / data.Impressions) * 100 : 0,
      CPC: data.Clicks > 0 ? data.Spend / data.Clicks : 0,
      Spend: data.Spend, Sales: data.Sales,
      ACOS: data.Sales > 0 ? (data.Spend / data.Sales) * 100 : 0,
      ROAS: data.Spend > 0 ? data.Sales / data.Spend : 0,
      Orders: data.Orders, CVR: data.Clicks > 0 ? (data.Orders / data.Clicks) * 100 : 0
    })).sort((a, b) => sortBySales ? b.Sales - a.Sales : b.Spend - a.Spend).slice(0, limit);
  };

  const topCampaigns = useMemo(() => aggregateGroup('Campaign Name', cRowLimit, true), [filteredData, cRowLimit]);
  const topAdGroups = useMemo(() => aggregateGroup('Ad Group Name', gRowLimit, true), [filteredData, gRowLimit]);
  const topTerms = useMemo(() => aggregateGroup('Customer Search Term', tRowLimit, false), [filteredData, tRowLimit]);

  const uniqueCampaigns = useMemo(() => {
    const set = new Set<string>();
    rawAdRows.forEach(r => { const val = r['Campaign Name'] || r['campaign_name']; if(val) set.add(val); });
    return Array.from(set).sort();
  }, [rawAdRows]);

  const uniqueAdGroups = useMemo(() => {
    const set = new Set<string>();
    rawAdRows.forEach(r => { const val = r['Ad Group Name'] || r['ad_group_name']; if(val) set.add(val); });
    return Array.from(set).sort();
  }, [rawAdRows]);

  const uniqueMatchTypes = useMemo(() => {
    const set = new Set<string>();
    rawAdRows.forEach(r => { const val = r['Match Type'] || r['match_type']; if(val) set.add(val); });
    return Array.from(set).sort();
  }, [rawAdRows]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Amazon Advertising Analytics Hub</h2>
        <p className="text-slate-500 mt-1">Configure your target filters below to interact with reports uploaded via the Data Ingestion Hub.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <Card className="p-4 space-y-4 lg:col-span-1 border-slate-200">
          <h3 className="font-semibold text-slate-800 border-b pb-2 text-sm pt-2">Target Filters</h3>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Campaign Name</label>
            <select multiple className="w-full border p-1 rounded-md text-xs h-20 bg-white" onChange={e => setSelectedCampaigns(Array.from(e.target.selectedOptions, o => o.value))}>
              {uniqueCampaigns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Ad Group Name</label>
            <select multiple className="w-full border p-1 rounded-md text-xs h-20 bg-white" onChange={e => setSelectedAdGroups(Array.from(e.target.selectedOptions, o => o.value))}>
              {uniqueAdGroups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Match Type</label>
            <select multiple className="w-full border p-1 rounded-md text-xs h-16 bg-white" onChange={e => setSelectedMatchTypes(Array.from(e.target.selectedOptions, o => o.value))}>
              {uniqueMatchTypes.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Search Terms</label>
            <input type="text" className="w-full border p-1.5 rounded-md text-xs" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Filter search terms..."/>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">ACOS Threshold: {minAcos}%</label>
            <input type="range" min="0" max="100" step="5" value={minAcos} onChange={e => setMinAcos(parseInt(e.target.value))} className="w-full"/>
          </div>
        </Card>

        <div className="lg:col-span-3 space-y-6">
          <div className="flex border-b border-slate-200 overflow-x-auto">
            <button onClick={() => setActiveTab('perf')} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === 'perf' ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-slate-500'}`}>Performance Overview Workspace</button>
            <button onClick={() => setActiveTab('raw')} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === 'raw' ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-slate-500'}`}>Complete Raw Data Vault</button>
            <button onClick={() => setActiveTab('export')} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === 'export' ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-slate-500'}`}>Export Hub</button>
          </div>

          {isDataLoading ? (
            <Card className="p-12 text-center text-slate-500"><p className="animate-pulse">Loading big data from Backblaze B2...</p></Card>
          ) : rawAdRows.length === 0 ? (
            <Card className="p-12 text-center text-slate-500 border-dashed">
              <TrendingUp className="w-12 h-12 mx-auto mb-4 text-slate-300" />
              <p>Please upload an Amazon Search Term CSV report in the Data Ingestion Hub to populate this dashboard.</p>
            </Card>
          ) : (
            <>
              {activeTab === 'perf' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card className="p-4 bg-white"><p className="text-xs text-slate-500 font-medium">Total Ad Spend</p><p className="text-2xl font-bold mt-1">${aggregate.totalSpend.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</p></Card>
                    <Card className="p-4 bg-white"><p className="text-xs text-slate-500 font-medium">7 Day Total Sales</p><p className="text-2xl font-bold mt-1">${aggregate.totalSales.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</p></Card>
                    <Card className="p-4 bg-white"><p className="text-xs text-slate-500 font-medium">Combined ACOS</p><p className="text-2xl font-bold mt-1 text-amber-600">{aggregate.acos.toFixed(2)}%</p></Card>
                    <Card className="p-4 bg-white"><p className="text-xs text-slate-500 font-medium">Global ROAS</p><p className="text-2xl font-bold mt-1 text-emerald-600">{aggregate.roas.toFixed(2)}x</p></Card>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <Card className="p-4"><p className="text-xs text-slate-500 font-medium">Impressions</p><p className="text-xl font-bold mt-1">{aggregate.totalImpressions.toLocaleString()}</p></Card>
                    <Card className="p-4"><p className="text-xs text-slate-500 font-medium">Clicks</p><p className="text-xl font-bold mt-1">{aggregate.totalClicks.toLocaleString()}</p></Card>
                    <Card className="p-4"><p className="text-xs text-slate-500 font-medium">Orders</p><p className="text-xl font-bold mt-1">{aggregate.totalOrders.toLocaleString()}</p></Card>
                    <Card className="p-4"><p className="text-xs text-slate-500 font-medium">CTR</p><p className="text-xl font-bold mt-1">{aggregate.ctr.toFixed(2)}%</p></Card>
                    <Card className="p-4"><p className="text-xs text-slate-500 font-medium">CPC</p><p className="text-xl font-bold mt-1">${aggregate.cpc.toFixed(2)}</p></Card>
                  </div>

                  <Card className="p-6 space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-semibold text-slate-800">Leaderboard: Top Campaigns</h3>
                      <div className="flex items-center space-x-2 text-xs"><span>Rows: {cRowLimit}</span><input type="range" min="5" max="100" value={cRowLimit} onChange={e => setCRowLimit(parseInt(e.target.value))}/></div>
                    </div>
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-xs text-left whitespace-nowrap">
                        <thead className="bg-slate-50 border-b text-slate-700">
                          <tr><th className="p-2">Campaign Name</th><th className="p-2">Impressions</th><th className="p-2">Clicks</th><th className="p-2">CTR</th><th className="p-2">CPC</th><th className="p-2">Spend</th><th className="p-2">Sales</th><th className="p-2">ACOS</th><th className="p-2">ROAS</th><th className="p-2">Orders</th><th className="p-2">CVR</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {topCampaigns.map((r, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="p-2 font-medium">{r.Name}</td><td className="p-2">{r.Impressions.toLocaleString()}</td><td className="p-2">{r.Clicks.toLocaleString()}</td><td className="p-2">{r.CTR.toFixed(2)}%</td><td className="p-2">${r.CPC.toFixed(2)}</td><td className="p-2">${r.Spend.toFixed(2)}</td><td className="p-2 font-semibold text-slate-900">${r.Sales.toFixed(2)}</td><td className="p-2 text-amber-700">{r.ACOS.toFixed(1)}%</td><td className="p-2">{r.ROAS.toFixed(2)}</td><td className="p-2">{r.Orders}</td><td className="p-2 text-emerald-700">{r.CVR.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  <Card className="p-6 space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-semibold text-slate-800">Leaderboard: Top Ad Groups</h3>
                      <div className="flex items-center space-x-2 text-xs"><span>Rows: {gRowLimit}</span><input type="range" min="5" max="100" value={gRowLimit} onChange={e => setGRowLimit(parseInt(e.target.value))}/></div>
                    </div>
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-xs text-left whitespace-nowrap">
                        <thead className="bg-slate-50 border-b text-slate-700">
                          <tr><th className="p-2">Ad Group Name</th><th className="p-2">Impressions</th><th className="p-2">Clicks</th><th className="p-2">CTR</th><th className="p-2">CPC</th><th className="p-2">Spend</th><th className="p-2">Sales</th><th className="p-2">ACOS</th><th className="p-2">ROAS</th><th className="p-2">Orders</th><th className="p-2">CVR</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {topAdGroups.map((r, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="p-2 font-medium">{r.Name}</td><td className="p-2">{r.Impressions.toLocaleString()}</td><td className="p-2">{r.Clicks.toLocaleString()}</td><td className="p-2">{r.CTR.toFixed(2)}%</td><td className="p-2">${r.CPC.toFixed(2)}</td><td className="p-2">${r.Spend.toFixed(2)}</td><td className="p-2 font-semibold text-slate-900">${r.Sales.toFixed(2)}</td><td className="p-2 text-amber-700">{r.ACOS.toFixed(1)}%</td><td className="p-2">{r.ROAS.toFixed(2)}</td><td className="p-2">{r.Orders}</td><td className="p-2 text-emerald-700">{r.CVR.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  <Card className="p-6 space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-semibold text-slate-800">Leaderboard: Top Customer Search Terms</h3>
                      <div className="flex items-center space-x-2 text-xs"><span>Rows: {tRowLimit}</span><input type="range" min="5" max="100" value={tRowLimit} onChange={e => setTRowLimit(parseInt(e.target.value))}/></div>
                    </div>
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-xs text-left whitespace-nowrap">
                        <thead className="bg-slate-50 border-b text-slate-700">
                          <tr><th className="p-2">Customer Search Term</th><th className="p-2">Impressions</th><th className="p-2">Clicks</th><th className="p-2">CTR</th><th className="p-2">CPC</th><th className="p-2">Spend</th><th className="p-2">Sales</th><th className="p-2">ACOS</th><th className="p-2">ROAS</th><th className="p-2">Orders</th><th className="p-2">CVR</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {topTerms.map((r, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="p-2 font-medium">{r.Name}</td><td className="p-2">{r.Impressions.toLocaleString()}</td><td className="p-2">{r.Clicks.toLocaleString()}</td><td className="p-2">{r.CTR.toFixed(2)}%</td><td className="p-2">${r.CPC.toFixed(2)}</td><td className="p-2 font-semibold text-slate-900">${r.Spend.toFixed(2)}</td><td className="p-2">${r.Sales.toFixed(2)}</td><td className="p-2 text-amber-700">{r.ACOS.toFixed(1)}%</td><td className="p-2">{r.ROAS.toFixed(2)}</td><td className="p-2">{r.Orders}</td><td className="p-2 text-emerald-700">{r.CVR.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>
              )}

              {activeTab === 'raw' && (
                <Card className="p-4 space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-slate-700">Total Filtered Rows: {filteredData.length}</span>
                    <Button onClick={() => downloadCSV(filteredData, 'filtered_raw_ads.csv')}><Download className="w-4 h-4 mr-2"/> Download Raw CSV</Button>
                  </div>
                  <div className="overflow-x-auto max-h-[600px] border border-slate-200 rounded-lg">
                    <table className="w-full text-xs text-left whitespace-nowrap">
                      <thead className="bg-slate-50 border-b sticky top-0">
                        <tr>{Object.keys(filteredData[0] || {}).map(k => <th key={k} className="p-2">{k}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredData.slice(0, 200).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50">{Object.values(row).map((v: any, j) => <td key={j} className="p-2">{v}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {activeTab === 'export' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="p-6 space-y-4">
                    <h3 className="font-semibold text-slate-800">Standalone PDF Generation</h3>
                    <p className="text-sm text-slate-500">Generate a formatted executive summary for offline viewing.</p>
                    <Button onClick={() => window.print()}>Print / Save Executive Summary</Button>
                  </Card>

                  <Card className="p-6 space-y-4">
                    <h3 className="font-semibold text-slate-800">Interactive Excel Export</h3>
                    <p className="text-sm text-slate-500">Select data views to include in your exported file:</p>
                    <div className="space-y-2 text-sm">
                      <label className="flex items-center space-x-2"><input type="checkbox" checked={optSummary} onChange={e => setOptSummary(e.target.checked)}/><span>Executive Summary Metrics</span></label>
                      <label className="flex items-center space-x-2"><input type="checkbox" checked={optCampaigns} onChange={e => setOptCampaigns(e.target.checked)}/><span>Top Campaigns Leaderboard</span></label>
                      <label className="flex items-center space-x-2"><input type="checkbox" checked={optAdGroups} onChange={e => setOptAdGroups(e.target.checked)}/><span>Top Ad Groups Leaderboard</span></label>
                      <label className="flex items-center space-x-2"><input type="checkbox" checked={optTerms} onChange={e => setOptTerms(e.target.checked)}/><span>Top Search Terms Leaderboard</span></label>
                      <label className="flex items-center space-x-2"><input type="checkbox" checked={optRaw} onChange={e => setOptRaw(e.target.checked)}/><span>Filtered Raw Data</span></label>
                    </div>
                    <Button onClick={() => {
                      let exportDataset: any[] = [];
                      if (optSummary) exportDataset.push({ "Metric": "Total Spend", "Value": aggregate.totalSpend }, { "Metric": "Total Sales", "Value": aggregate.totalSales });
                      if (optCampaigns) exportDataset = exportDataset.concat(topCampaigns);
                      if (optTerms) exportDataset = exportDataset.concat(topTerms);
                      if (optRaw) exportDataset = exportDataset.concat(filteredData);
                      downloadCSV(exportDataset, 'Amazon_Advertising_Export.csv');
                    }}>Download Selected Views (CSV)</Button>
                  </Card>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- TAB 8: SEO INTELLIGENCE ---
function SeoIntelligence() {
  const [activeTab, setActiveTab] = useState('audit');
  const tabs = [
    { id: 'audit', label: 'ASIN Deep-Dive Audit' },
    { id: 'matrix', label: 'Catalog-Wide Keyword Matrix' },
    { id: 'gap', label: 'Optimization & Gap Action Plan' }
  ];

  const [refreshTrigger] = useState(0);
  const catSnapshots = useB2Files('snapshots/', refreshTrigger);
  const adSnapshots = useB2Files('ads/', refreshTrigger);

  const [selectedAdFile, setSelectedAdFile] = useState('');
  const [selectedCatFile, setSelectedCatFile] = useState('');
  const [topKwLimit, setTopKwLimit] = useState(30);
  const [ignoreAsinTerms, setIgnoreAsinTerms] = useState(true);

  const [catalogData, setCatalogData] = useState<any[]>([]);
  const [rawAdRows, setRawAdRows] = useState<any[]>([]);

  useEffect(() => {
    if (catSnapshots.length > 0 && !selectedCatFile) setSelectedCatFile(catSnapshots[catSnapshots.length - 1]);
    if (adSnapshots.length > 0 && !selectedAdFile) setSelectedAdFile(adSnapshots[adSnapshots.length - 1]);
  }, [catSnapshots.length, adSnapshots.length]);

  useEffect(() => {
    if (selectedCatFile) {
      safeGetFileContent(selectedCatFile, 'snapshots/').then(text => setCatalogData(parseCSVTable(text).map(unpackRecord)));
    }
  }, [selectedCatFile]);

  useEffect(() => {
    if (selectedAdFile) {
      safeGetFileContent(selectedAdFile, 'ads/').then(text => setRawAdRows(parseCSVTable(text)));
    }
  }, [selectedAdFile]);

  const topKwSummary = useMemo(() => {
    if (rawAdRows.length === 0) return [];
    const map = new Map<string, any>();
    
    rawAdRows.forEach(r => {
      const term = r['Customer Search Term'] || r['customer_search_term'] || r['keyword'] || '';
      if (!term) return;
      if (ignoreAsinTerms && term.toLowerCase().startsWith('b0')) return;

      if (!map.has(term)) map.set(term, { Spend: 0, Sales: 0, Clicks: 0, Orders: 0 });
      const item = map.get(term)!;
      item.Spend += parseNum(r['Spend'] || r['spend']);
      item.Sales += parseNum(r['7 Day Total Sales'] || r['Sales']);
      item.Clicks += parseNum(r['Clicks'] || r['clicks']);
      item.Orders += parseNum(r['7 Day Total Orders (#)'] || r['Orders']);
    });

    return Array.from(map.entries()).map(([term, d]) => ({
      term, Spend: d.Spend, Sales: d.Sales, Clicks: d.Clicks,
      ACOS: d.Sales > 0 ? (d.Spend / d.Sales) * 100 : 0, ROAS: d.Spend > 0 ? d.Sales / d.Spend : 0, CVR: d.Clicks > 0 ? (d.Orders / d.Clicks) * 100 : 0
    })).sort((a, b) => b.Spend - a.Spend).slice(0, topKwLimit);
  }, [rawAdRows, ignoreAsinTerms, topKwLimit]);

  // Handle Searchable ASIN Dropdowns
  const uniqueAsins = useMemo(() => {
    const set = new Set<string>();
    catalogData.forEach(r => { if(r.asin || r.ASIN) set.add(r.asin || r.ASIN); });
    return Array.from(set).sort();
  }, [catalogData]);
  
  const [selectedAuditAsin, setSelectedAuditAsin] = useState('');
  const [auditAsinSearch, setAuditAsinSearch] = useState('');
  const [showActiveListingText, setShowActiveListingText] = useState(false);

  const filteredAsins = useMemo(() => {
    if (!auditAsinSearch) return uniqueAsins;
    return uniqueAsins.filter(a => a.toLowerCase().includes(auditAsinSearch.toLowerCase()));
  }, [uniqueAsins, auditAsinSearch]);

  // Auto-select first visible ASIN after filtering
  useEffect(() => {
    if (filteredAsins.length > 0 && !filteredAsins.includes(selectedAuditAsin)) {
      setSelectedAuditAsin(filteredAsins[0]);
    } else if (uniqueAsins.length > 0 && !selectedAuditAsin) {
      setSelectedAuditAsin(uniqueAsins[0]);
    }
  }, [filteredAsins, uniqueAsins, selectedAuditAsin]);

  const selectedAsinRecord = useMemo(() => catalogData.find(r => (r.asin || r.ASIN) === selectedAuditAsin) || {}, [catalogData, selectedAuditAsin]);
  
  const fieldsDict = useMemo(() => ({
    "Title": String(selectedAsinRecord.title || selectedAsinRecord.Title || ''),
    "Brand": String(selectedAsinRecord.brand || selectedAsinRecord.Brand || ''),
    "Bullet 1": String(selectedAsinRecord.bullet_point_1 || ''),
    "Bullet 2": String(selectedAsinRecord.bullet_point_2 || ''),
    "Bullet 3": String(selectedAsinRecord.bullet_point_3 || ''),
    "Bullet 4": String(selectedAsinRecord.bullet_point_4 || ''),
    "Bullet 5": String(selectedAsinRecord.bullet_point_5 || ''),
    "Description": String(selectedAsinRecord.product_description || selectedAsinRecord.description || ''),
    "Backend Terms": String(selectedAsinRecord.generic_keywords || selectedAsinRecord.search_terms || '')
  }), [selectedAsinRecord]);

  const auditResults = useMemo(() => {
    return topKwSummary.map(kw => {
      const evalRes = evaluateKeywordCoverage(kw.term, fieldsDict);
      return { ...evalRes, Spend: kw.Spend, Sales: kw.Sales, ROAS: kw.ROAS, ACOS: kw.ACOS, CVR: kw.CVR };
    });
  }, [topKwSummary, fieldsDict]);

  const matchCounts = useMemo(() => {
    let exact = 0, broad = 0, partial = 0, missing = 0;
    auditResults.forEach(r => {
      if (r.status.includes("Exact")) exact++;
      else if (r.status.includes("Broad")) broad++;
      else if (r.status.includes("Partial")) partial++;
      else missing++;
    });
    return { exact, broad, partial, missing };
  }, [auditResults]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">In-Depth Keyword & Catalog SEO Engine</h2>
        <p className="text-slate-500 mt-1">Cross-reference top-performing ad terms against your catalog listings.</p>
      </div>

      <Card className="p-6">
        <h3 className="font-semibold text-slate-800 mb-4">1. Configuration & Data Sources</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Advertising Source (from Ingestion Hub)</label>
            <select className="w-full border p-2 rounded-md text-xs bg-white" value={selectedAdFile} onChange={e => setSelectedAdFile(e.target.value)}>
              {adSnapshots.length === 0 && <option value="">No Ad Reports found. Upload in Data Ingestion.</option>}
              {adSnapshots.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Catalog Source Snapshot</label>
            <select className="w-full border p-2 rounded-md text-xs bg-white" value={selectedCatFile} onChange={e => setSelectedCatFile(e.target.value)}>
              {catSnapshots.length === 0 && <option value="">No Catalog Snapshots found</option>}
              {catSnapshots.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Top Keywords to Audit: {topKwLimit}</label>
            <input type="range" min="5" max="200" step="5" value={topKwLimit} onChange={e => setTopKwLimit(parseInt(e.target.value))} className="w-full mb-2"/>
            <label className="flex items-center space-x-2 text-xs text-slate-700">
              <input type="checkbox" checked={ignoreAsinTerms} onChange={e => setIgnoreAsinTerms(e.target.checked)}/>
              <span>Filter out target ASINs (e.g. b0...)</span>
            </label>
          </div>
        </div>
      </Card>

      <div className="flex border-b border-slate-200 overflow-x-auto">
        <button onClick={() => setActiveTab('audit')} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === 'audit' ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-slate-500'}`}>ASIN Deep-Dive Audit</button>
        <button onClick={() => setActiveTab('matrix')} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === 'matrix' ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-slate-500'}`}>Catalog-Wide Keyword Matrix</button>
        <button onClick={() => setActiveTab('gap')} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === 'gap' ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-slate-500'}`}>Optimization Gap Action Plan</button>
      </div>

      {(catalogData.length === 0 || topKwSummary.length === 0) ? (
        <Card className="p-12 text-center text-slate-500 border-dashed">
          <Search className="w-12 h-12 mx-auto mb-4 text-slate-300" />
          <p>Please select valid Advertising and Catalog snapshots above to launch the in-depth analyzer.</p>
        </Card>
      ) : (
        <>
          {activeTab === 'audit' && (
            <div className="space-y-6">
              <Card className="p-6">
                <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
                  
                  {/* Searchable ASIN Input */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-3 w-full sm:w-auto">
                    <label className="text-sm font-semibold text-slate-700 whitespace-nowrap">Select ASIN to Inspect:</label>
                    <input 
                      type="text" 
                      placeholder="Search ASIN..." 
                      className="border p-2 rounded-md text-sm bg-white w-full sm:w-32"
                      value={auditAsinSearch}
                      onChange={e => setAuditAsinSearch(e.target.value)}
                    />
                    <select className="border p-2 rounded-md text-sm bg-white w-full sm:w-auto" value={selectedAuditAsin} onChange={e => setSelectedAuditAsin(e.target.value)}>
                      {filteredAsins.length > 0 ? (
                        filteredAsins.map(a => <option key={a} value={a}>{a}</option>)
                      ) : (
                        <option value="">No ASINs match search</option>
                      )}
                    </select>
                  </div>

                  <Button variant="outline" onClick={() => setShowActiveListingText(!showActiveListingText)}>
                    {showActiveListingText ? <ChevronUp className="w-4 h-4 mr-1"/> : <ChevronDown className="w-4 h-4 mr-1"/>} View Active Listing Copy
                  </Button>
                </div>

                {showActiveListingText && (
                  <div className="p-4 mt-4 bg-slate-50 border rounded-lg text-xs space-y-2 text-slate-700">
                    <p><strong>Title:</strong> {fieldsDict["Title"]}</p>
                    <p><strong>Brand:</strong> {fieldsDict["Brand"]}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t">
                      <div>
                        <p><strong>Bullet 1:</strong> {fieldsDict["Bullet 1"]}</p>
                        <p><strong>Bullet 2:</strong> {fieldsDict["Bullet 2"]}</p>
                        <p><strong>Bullet 3:</strong> {fieldsDict["Bullet 3"]}</p>
                      </div>
                      <div>
                        <p><strong>Bullet 4:</strong> {fieldsDict["Bullet 4"]}</p>
                        <p><strong>Bullet 5:</strong> {fieldsDict["Bullet 5"]}</p>
                        <p><strong>Backend Terms:</strong> {fieldsDict["Backend Terms"]}</p>
                      </div>
                    </div>
                  </div>
                )}
              </Card>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="p-4 bg-emerald-50/50 border-emerald-200"><p className="text-xs text-emerald-800 font-medium">🟢 Exact Phrase Matches</p><p className="text-2xl font-bold text-emerald-900 mt-1">{matchCounts.exact}</p></Card>
                <Card className="p-4 bg-amber-50/50 border-amber-200"><p className="text-xs text-amber-800 font-medium">🟡 Broad Token Matches</p><p className="text-2xl font-bold text-amber-900 mt-1">{matchCounts.broad}</p></Card>
                <Card className="p-4 bg-orange-50/50 border-orange-200"><p className="text-xs text-orange-800 font-medium">🟠 Partial Matches</p><p className="text-2xl font-bold text-orange-900 mt-1">{matchCounts.partial}</p></Card>
                <Card className="p-4 bg-red-50/50 border-red-200"><p className="text-xs text-red-800 font-medium">🔴 Completely Missing</p><p className="text-2xl font-bold text-red-900 mt-1">{matchCounts.missing}</p></Card>
              </div>

              <Card className="p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold text-slate-800">Audit Results Ledger</h3>
                  <Button onClick={() => downloadCSV(auditResults.map(r => ({ "Customer Search Term": r.keyword, "Match Status": r.status, "Exact Match Field(s)": r.exact_loc_str, "Word Coverage %": `${r.token_coverage_pct}%`, "Missing Words/Tokens": r.missing_tokens_str, "Ad Spend ($)": r.Spend, "Ad Sales ($)": r.Sales, "ACOS (%)": r.ACOS })), `${selectedAuditAsin}_keyword_audit.csv`)}>Download Audit Report</Button>
                </div>
                <div className="overflow-x-auto max-h-[500px] border border-slate-200 rounded-lg">
                  <table className="w-full text-xs text-left whitespace-nowrap">
                    <thead className="bg-slate-50 border-b text-slate-700 sticky top-0">
                      <tr><th className="p-2">Customer Search Term</th><th className="p-2">Match Status</th><th className="p-2">Exact Match Field(s)</th><th className="p-2">Coverage %</th><th className="p-2">Missing Words/Tokens</th><th className="p-2">Ad Spend</th><th className="p-2">Ad Sales</th><th className="p-2">ROAS</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {auditResults.map((r, i) => {
                        let bgStyle = r.status.includes("Exact") ? "bg-emerald-100 text-emerald-900 font-semibold" : r.status.includes("Broad") ? "bg-amber-100 text-amber-900" : r.status.includes("Partial") ? "bg-orange-100 text-orange-900" : "bg-red-100 text-red-900 font-semibold";
                        return (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="p-2 font-medium text-slate-900">{r.keyword}</td><td className={`p-2 ${bgStyle}`}>{r.status}</td><td className="p-2">{r.exact_loc_str}</td><td className="p-2">{r.token_coverage_pct}%</td><td className="p-2 text-red-600">{r.missing_tokens_str}</td><td className="p-2">${r.Spend.toFixed(2)}</td><td className="p-2">${r.Sales.toFixed(2)}</td><td className="p-2">{r.ROAS.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'matrix' && (
            <Card className="p-6 space-y-4">
              <h3 className="font-semibold text-slate-800">Catalog-Wide Keyword Coverage Matrix</h3>
              <div className="overflow-x-auto max-h-[600px] border border-slate-200 rounded-lg">
                <table className="w-full text-xs text-left whitespace-nowrap">
                  <thead className="bg-slate-100 sticky top-0 border-b">
                    <tr><th className="p-2 font-semibold border-r">ASIN</th><th className="p-2 font-semibold border-r min-w-[200px]">Title</th>{topKwSummary.map(kw => <th key={kw.term} className="p-2 font-semibold border-r">{kw.term}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {uniqueAsins.slice(0, 200).map(asin => {
                      const record = catalogData.find(r => (r.asin || r.ASIN) === asin) || {};
                      const fDict = { "Title": String(record.title || record.Title || ''), "Bullet 1": String(record.bullet_point_1 || ''), "Bullet 2": String(record.bullet_point_2 || ''), "Backend": String(record.generic_keywords || record.search_terms || '') };
                      return (
                        <tr key={asin} className="hover:bg-slate-50">
                          <td className="p-2 font-mono font-medium text-slate-900 border-r">{asin}</td><td className="p-2 truncate max-w-[250px] border-r">{fDict.Title}</td>
                          {topKwSummary.map(kw => {
                            const status = evaluateKeywordCoverage(kw.term, fDict).status;
                            let bg = status.includes("Exact") ? "bg-emerald-100 text-emerald-900" : status.includes("Broad") ? "bg-amber-100 text-amber-900" : status.includes("Partial") ? "bg-orange-100 text-orange-900" : "bg-red-100 text-red-900";
                            return <td key={kw.term} className={`p-2 text-center text-[10px] border-r ${bg}`}>{status.split(' ')[1] || 'Missing'}</td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {activeTab === 'gap' && (
            <Card className="p-6 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h3 className="font-semibold text-slate-800">SEO Action Plan: High-Spend Keyword Gaps</h3>
                
                {/* Searchable ASIN Input */}
                <div className="flex items-center space-x-2">
                  <input 
                    type="text" 
                    placeholder="Search ASIN..." 
                    className="border p-2 rounded-md text-sm bg-white w-32"
                    value={auditAsinSearch}
                    onChange={e => setAuditAsinSearch(e.target.value)}
                  />
                  <select className="border p-2 rounded-md text-sm bg-white" value={selectedAuditAsin} onChange={e => setSelectedAuditAsin(e.target.value)}>
                    {filteredAsins.length > 0 ? (
                      filteredAsins.map(a => <option key={a} value={a}>{a}</option>)
                    ) : (
                      <option value="">No match</option>
                    )}
                  </select>
                </div>
              </div>

              {(() => {
                const gaps = auditResults.filter(r => r.status.includes("Missing") || r.status.includes("Partial"));
                if (gaps.length === 0) return <div className="p-6 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg">ASIN '{selectedAuditAsin}' has 100% token coverage for all top ad terms!</div>;

                return (
                  <>
                    <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg">Found {gaps.length} keyword optimization gaps for ASIN '{selectedAuditAsin}'.</div>
                    <div className="overflow-x-auto max-h-[400px] border border-slate-200 rounded-lg">
                      <table className="w-full text-xs text-left whitespace-nowrap">
                        <thead className="bg-slate-50 border-b text-slate-700">
                          <tr><th className="p-2">Keyword</th><th className="p-2">Current Status</th><th className="p-2">Ad Spend ($)</th><th className="p-2">Ad Sales ($)</th><th className="p-2">Missing Words</th><th className="p-2">Recommended Action</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {gaps.map((r, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="p-2 font-medium text-slate-900">{r.keyword}</td><td className="p-2 text-red-700">{r.status}</td><td className="p-2">${r.Spend.toFixed(2)}</td><td className="p-2">${r.Sales.toFixed(2)}</td><td className="p-2 text-red-600 font-medium">{r.missing_tokens_str}</td><td className="p-2 font-medium text-blue-700">{r.missing_tokens.length > 0 ? `Add missing words '${r.missing_tokens_str}' to copy` : 'Add exact phrase'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Button onClick={() => downloadCSV(gaps.map(g => ({ Keyword: g.keyword, "Current Status": g.status, "Ad Spend ($)": g.Spend, "Ad Sales ($)": g.Sales, "Missing Words": g.missing_tokens_str, "Recommended Action": g.missing_tokens.length > 0 ? `Add missing words '${g.missing_tokens_str}' to copy` : 'Add exact phrase' })), `${selectedAuditAsin}_seo_copy_brief.csv`)}>Download Copy Brief (CSV)</Button>
                  </>
                );
              })()}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ==========================================
// 10. MAIN APPLICATION WRAPPER
// ==========================================
export default function Page() {
  const [activeModule, setActiveModule] = useState('ingestion');

  // New Grouped Navigation Structure
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

  // Helper function to find active label for mobile header
  const getActiveLabel = () => {
    for (const group of navGroups) {
      const found = group.items.find(item => item.id === activeModule);
      if (found) return found.label;
    }
    return '';
  };

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900">
      
      {/* Dark Sidebar Redesigned */}
      <aside className="w-64 bg-slate-900 text-white hidden md:flex flex-col shadow-xl z-10">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <LayoutDashboard className="w-6 h-6 text-blue-400" />
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">RapidRevver</span>
          </div>
          <p className="text-slate-400 text-xs mt-1">Analytics Next.js Core</p>
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
        {/* Previous navigation code... */}
        
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
            <span>Robust CSV Engine Active</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="md:hidden bg-white border-b border-slate-200 p-4 flex justify-between items-center shadow-sm z-10">
          <span className="text-xl font-bold text-slate-900">RapidRevver</span>
          <select value={activeModule} onChange={(e) => setActiveModule(e.target.value)} className="border-slate-300 p-2 border rounded-md text-sm">
            {navGroups.flatMap(g => g.items).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-[1400px] mx-auto">
            {activeModule === 'ingestion' && <DataIngestion />}
            {activeModule === 'monitor' && <CatalogMonitor />}
            {activeModule === 'catalog' && <MasterCatalog />}
            {activeModule === 'deepdive' && <AsinDeepDive />}
            {activeModule === 'global_delta' && <GlobalDeltaView />}
            {activeModule === 'images' && <ImageVault />}
            {activeModule === 'ads' && <AdsAnalysis />}
            {activeModule === 'seo' && <SeoIntelligence />}
          </div>
        </div>
      </main>
    </div>
  );
}