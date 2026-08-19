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
    const res = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': 'text/csv' } });
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
// 2. CONSTANTS & SCHEMAS
// ==========================================
const CATALOG_HEADERS = [
  "Run", "ASIN", "Brand", "Al's Listing SKU", "RR Listing SKU", "Keystone PN", 
  "Category", "Avg/mo (top 3)", "URL", "bought_in_past_month", "best_seller_main_category", 
  "best_seller_main_rank", "best_seller_category_1", "best_seller_rank_1", 
  "best_seller_category_2", "best_seller_rank_2", "rating", "reviews_count", 
  "badge", "title", "brand_name", "bullet_point_1", "bullet_point_2", 
  "bullet_point_3", "bullet_point_4", "bullet_point_5", "brand_story", 
  "a_plus_content", "a_plus_content_code", "a_plus_content_type", "description", 
  "release_date", "country_of_origin", "part_number", "model", "box_content", 
  "color_name", "material_type", "availability", "list_price", "shipping_cost", 
  "fastest_delivery", "categories", "categories_links", "image_1_source", 
  "image_2_source", "image_3_source", "image_4_source", "image_5_source", 
  "image_6_source", "image_7_source", "image_8_source", "image_9_source", 
  "image_10_source", "item_dimensions_unit_of_measure", "item_height", 
  "item_height_unit_of_measure", "item_length", "item_length_unit_of_measure", 
  "item_width", "item_width_unit_of_measure", "item_weight", "item_weight_unit_of_measure", 
  "package_height", "package_length", "package_width", "package_dimensions_unit_of_measure", 
  "package_weight", "package_weight_unit_of_measure", "item_name", "metaKeywords"
];

const ADS_LEADERBOARD_HEADERS = [
  "Start Date", "End Date", "Portfolio name", "Currency", "Campaign Name", 
  "Ad Group Name", "Retailer", "Country", "Targeting", "Match Type", 
  "Customer Search Term", "Impressions", "Clicks", "Click-Thru Rate (CTR)", 
  "Cost Per Click (CPC)", "Spend", "7 Day Total Sales", 
  "Total Advertising Cost of Sales (ACOS)", "Total Return on Advertising Spend (ROAS)", 
  "7 Day Total Orders (#)", "7 Day Total Units (#)", "7 Day Conversion Rate", 
  "7 Day Advertised SKU Units (#)", "7 Day Other SKU Units (#)", 
  "7 Day Advertised SKU Sales", "7 Day Other SKU Sales"
];

const PRODUCT_CATEGORIES = [
  { id: 'global', label: '🌍 Global Master Sheet', file: 'N/A' },
  { id: 'wheel_skins', label: 'Wheel Skins', file: 'masterlist_wheel_skins.csv' },
  { id: 'hubcaps', label: 'Hubcaps', file: 'masterlist_hubcaps.csv' },
  { id: 'center_caps', label: 'Center Caps', file: 'masterlist_center_caps.csv' },
  { id: 'grille_inserts', label: 'Grille Inserts', file: 'masterlist_grille_inserts.csv' }
];

const CATEGORY_SCHEMAS: Record<string, any[]> = {
  wheel_skins: [
    { group: "Shared Data", color: "bg-slate-800", text: "text-white", subgroups: [{ name: "General", color: "bg-slate-200", text: "text-slate-800", cols: ["Part No", "Part TYpe Jobber", "Status", "Fitment Info", "FTP QTY", "Jobber Price"] }, { name: "Keywords Detail Page", color: "bg-slate-300", text: "text-slate-800", cols: ["Cost Price", "Cost Price = 8%", "Product Type", "item Type Keyword", "Hollander/Part Code", "Material", "Number of Items", "Color/ Finish", "Size for Bullet", "Installation Type", "Pattern"] }, { name: "Keywords for Attribute", color: "bg-slate-200", text: "text-slate-800", cols: ["Compatible With", "Material", "Number of Items", "Exterior Finish", "Color", "Size for Attribute", "Size Digit", "Model Brand Part Fits", "OEM Equivalent Part Number", "Retention Attrbute", "Pattern", "Included Components"] }, { name: "Weight and Dimensions", color: "bg-slate-300", text: "text-slate-800", cols: ["Generic Keywords", "Item Length", "Item Package Length", "Package Length Unit", "Item Package Width", "Package Width Unit", "Item Package Height", "Package Height Unit", "Package Weight"] }, { name: "Fitment Info", color: "bg-slate-200", text: "text-slate-800", cols: ["Package Weight Unit", "Fitment Type"] }] },
    { group: "OxGord", color: "bg-blue-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-blue-100", text: "text-blue-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "Fuel Rider", color: "bg-red-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-red-100", text: "text-red-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "MUA", color: "bg-purple-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-purple-100", text: "text-purple-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "Walmart", color: "bg-sky-500", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-sky-100", text: "text-sky-900", cols: ["GTIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "eBay", color: "bg-emerald-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-emerald-100", text: "text-emerald-900", cols: ["SKU", "GTIN"] }] },
    { group: "Amazon -OxGord", color: "bg-amber-500", text: "text-white", subgroups: [{ name: "Listing Data", color: "bg-amber-100", text: "text-amber-900", cols: ["Listing Notes", "Live Date", "QTY", "Price", "Shipping Tepmlate", "Business Price", "Title Length", "Product Name", "Title", "Description", "Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4", "Bullet 5", "Hero Image", "Image 1", "Image 2", "Image 3", "Image 4", "Image 5"] }] },
    { group: "Ride And Rover", color: "bg-indigo-600", text: "text-white", subgroups: [{ name: "Financials", color: "bg-indigo-100", text: "text-indigo-900", cols: ["Cost", "Shipping", "Shopify Fee", "Advertising", "Returns Allow", "Margin General P", "Margin Loyalty", "Margin Distributor", "General Price", "Loyalty Price", "Distributor Price"] }] }
  ],
  hubcaps: [
    { group: "Shared Data", color: "bg-slate-800", text: "text-white", subgroups: [{ name: "General", color: "bg-slate-200", text: "text-slate-800", cols: ["Part no", "part type jobber", "status", "fitment info", "FTP QTY", "Jobber Price", "Cost Price"] }, { name: "Keywords Detail Page", color: "bg-slate-300", text: "text-slate-800", cols: ["Product type", "item type keyword", "Hollander/Part Code", "material", "number of items", "color/finish", "size for bullet", "installation type", "pattern"] }, { name: "Keywords for Attribute", color: "bg-slate-200", text: "text-slate-800", cols: ["material", "number of items", "exterior finish", "color", "size for attribute", "size digit", "model brand part fits", "OEM Equivalent Part Number", "retention attribute", "pattern", "included components", "generic keywords"] }, { name: "Weight and Dimensions", color: "bg-slate-300", text: "text-slate-800", cols: ["item length", "item package length", "package length unit", "item package width", "package width unit", "item package height", "package height unit", "package weight", "package weight unit"] }, { name: "Fitment Info", color: "bg-slate-200", text: "text-slate-800", cols: ["fitment type", "fitment for SEO", "make for SEO", "model for SEO", "vehicle category", "number of fitment"] }] },
    { group: "OxGord", color: "bg-blue-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-blue-100", text: "text-blue-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "Fuel Rider", color: "bg-red-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-red-100", text: "text-red-900", cols: ["ASIN", "Main Listing SKU", "MPN"] }] },
    { group: "MUA", color: "bg-purple-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-purple-100", text: "text-purple-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "Walmart", color: "bg-sky-500", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-sky-100", text: "text-sky-900", cols: ["GTIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "eBay", color: "bg-emerald-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-emerald-100", text: "text-emerald-900", cols: ["SKU", "GTIN"] }] },
    { group: "Amazon -OxGord", color: "bg-amber-500", text: "text-white", subgroups: [{ name: "Listing Data", color: "bg-amber-100", text: "text-amber-900", cols: ["Listing Notes", "Live Date", "QTY", "Price", "Shipping Tepmlate", "Business Price", "Title Length", "Product Name", "Title", "Description", "Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4", "Bullet 5", "Hero Image", "Image 1", "Image 2", "Image 3", "Image 4", "Image 5"] }] }
  ],
  center_caps: [
    { group: "Shared Data", color: "bg-slate-800", text: "text-white", subgroups: [{ name: "General", color: "bg-slate-200", text: "text-slate-800", cols: ["Part no", "part type jobber", "status", "fitment info", "FTP QTY", "Jobber Price", "Cost Price"] }, { name: "Keywords Detail Page", color: "bg-slate-300", text: "text-slate-800", cols: ["cost price", "Product type", "item type keyword", "Hollander/Part Code", "material", "number of items", "color/finish", "size for bullet", "installation type", "pattern"] }, { name: "Keywords for Attribute", color: "bg-slate-200", text: "text-slate-800", cols: ["compatible with", "material", "number of items", "exterior finish", "color", "size for attribute", "finish code", "model brand part fits", "OEM Equivalent Part Number", "retention attribute", "pattern", "included components", "generic keywords"] }, { name: "Weight and Dimensions", color: "bg-slate-300", text: "text-slate-800", cols: ["item length", "item package length", "package length unit", "item package width", "package width unit", "item package height", "package height unit", "package weight", "package weight unit"] }, { name: "Fitment Info", color: "bg-slate-200", text: "text-slate-800", cols: ["fitment type"] }] },
    { group: "OxGord", color: "bg-blue-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-blue-100", text: "text-blue-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "Fuel Rider", color: "bg-red-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-red-100", text: "text-red-900", cols: ["ASIN", "Main Listing SKU", "MPN"] }] },
    { group: "MUA", color: "bg-purple-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-purple-100", text: "text-purple-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "Walmart", color: "bg-sky-500", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-sky-100", text: "text-sky-900", cols: ["GTIN", "Main Listing", "SKU", "MPN"] }] },
    { group: "eBay", color: "bg-emerald-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-emerald-100", text: "text-emerald-900", cols: ["SKU", "GTIN"] }] },
    { group: "Amazon -OxGord", color: "bg-amber-500", text: "text-white", subgroups: [{ name: "Listing Data", color: "bg-amber-100", text: "text-amber-900", cols: ["Listing Notes", "Live Date", "QTY", "Price", "Shipping Tepmlate", "Business Price", "Title Length", "Product Name", "Title", "Description", "Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4", "Bullet 5", "Hero Image", "Image 1", "Image 2", "Image 3", "Image 4", "Image 5"] }] }
  ]
};

CATEGORY_SCHEMAS['global'] = [
  { group: "Shared Data", color: "bg-slate-800", text: "text-white", subgroups: [{ name: "General", color: "bg-slate-200", text: "text-slate-800", cols: ["Part No", "Part no", "Part TYpe Jobber", "part type jobber", "Status", "status", "Fitment Info", "fitment info", "FTP QTY", "Jobber Price", "Cost Price"] }, { name: "Keywords Detail Page", color: "bg-slate-300", text: "text-slate-800", cols: ["Product Type", "Product type", "item Type Keyword", "item type keyword", "Hollander/Part Code", "Material", "material", "Number of Items", "number of items", "Color/ Finish", "color/finish", "Size for Bullet", "size for bullet", "Installation Type", "installation type", "Pattern", "pattern"] }, { name: "Keywords for Attribute", color: "bg-slate-200", text: "text-slate-800", cols: ["Compatible With", "compatible with", "Exterior Finish", "exterior finish", "Color", "color", "Size for Attribute", "size for attribute", "Size Digit", "size digit", "finish code", "Model Brand Part Fits", "model brand part fits", "OEM Equivalent Part Number", "Retention Attrbute", "retention attribute", "Included Components", "included components", "Generic Keywords", "generic keywords"] }, { name: "Weight and Dimensions", color: "bg-slate-300", text: "text-slate-800", cols: ["Item Length", "item length", "Item Package Length", "item package length", "Package Length Unit", "package length unit", "Item Package Width", "item package width", "Package Width Unit", "package width unit", "Item Package Height", "item package height", "Package Height Unit", "package height unit", "Package Weight", "package weight", "Package Weight Unit", "package weight unit"] }, { name: "Fitment Info", color: "bg-slate-200", text: "text-slate-800", cols: ["Fitment Type", "fitment type", "fitment for SEO", "make for SEO", "model for SEO", "vehicle category", "number of fitment"] }] },
  { group: "OxGord", color: "bg-blue-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-blue-100", text: "text-blue-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
  { group: "Fuel Rider", color: "bg-red-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-red-100", text: "text-red-900", cols: ["ASIN", "Main Listing", "Main Listing SKU", "SKU", "MPN"] }] },
  { group: "MUA", color: "bg-purple-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-purple-100", text: "text-purple-900", cols: ["ASIN", "Main Listing", "SKU", "MPN"] }] },
  { group: "Walmart", color: "bg-sky-500", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-sky-100", text: "text-sky-900", cols: ["GTIN", "Main Listing", "SKU", "MPN"] }] },
  { group: "eBay", color: "bg-emerald-600", text: "text-white", subgroups: [{ name: "Identifiers", color: "bg-emerald-100", text: "text-emerald-900", cols: ["SKU", "GTIN"] }] },
  { group: "Amazon -OxGord", color: "bg-amber-500", text: "text-white", subgroups: [{ name: "Listing Data", color: "bg-amber-100", text: "text-amber-900", cols: ["Listing Notes", "Live Date", "QTY", "Price", "Shipping Tepmlate", "Business Price", "Title Length", "Product Name", "Title", "Description", "Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4", "Bullet 5", "Hero Image", "Image 1", "Image 2", "Image 3", "Image 4", "Image 5"] }] },
  { group: "Ride And Rover", color: "bg-indigo-600", text: "text-white", subgroups: [{ name: "Financials", color: "bg-indigo-100", text: "text-indigo-900", cols: ["Cost", "Shipping", "Shopify Fee", "Advertising", "Returns Allow", "Margin General P", "Margin Loyalty", "Margin Distributor", "General Price", "Loyalty Price", "Distributor Price"] }] }
];

// ==========================================
// SEO MATCHING ENGINE
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
// 4. MODULE: DATA INGESTION
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
      CATALOG_HEADERS.slice(0, 10).forEach(h => { 
        const found = Object.keys(row).find(k => k.toLowerCase() === h.toLowerCase());
        obj[h] = found ? row[found] : '';
      });
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
        const obj: any = { batch_name: file.name };
        CATALOG_HEADERS.forEach(h => {
          const found = Object.keys(row).find(k => k.toLowerCase() === h.toLowerCase());
          obj[h] = found ? String(row[found] || '') : '';
        });
        return obj;
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

// ==========================================
// 5. MODULE: IMAGE VAULT 
// ==========================================
function ImageVault() {
  const [uploading, setUploading] = useState(false);
  const [isDeletingAlbum, setIsDeletingAlbum] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [copiedKey, setCopiedKey] = useState('');
  const [copiedAll, setCopiedAll] = useState<string | false>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const imagesWithDetails = useB2FilesWithDetails('images/', refresh);

  const [activeAlbum, setActiveAlbum] = useState<string | null>(null);
  const [localAlbums, setLocalAlbums] = useState<string[]>([]);
  
  const [newAlbumName, setNewAlbumName] = useState('');
  const [newAlbumCategory, setNewAlbumCategory] = useState(''); 
  const [albumCategoryFilter, setAlbumCategoryFilter] = useState('All');

  const [albumSearch, setAlbumSearch] = useState('');
  const [imageSearch, setImageSearch] = useState('');
  const [imageSortOrder, setImageSortOrder] = useState<'recent' | 'asc' | 'desc'>('recent');

  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false); 
  
  const [dragMode, setDragMode] = useState<'select' | 'deselect' | null>(null);

  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusText, setUploadStatusText] = useState('');

  const [editingAlbum, setEditingAlbum] = useState<string | null>(null);
  const [editAlbumText, setEditAlbumText] = useState('');
  const [editingImage, setEditingImage] = useState<string | null>(null);
  const [editImageText, setEditImageText] = useState('');

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadedBatchLinks, setUploadedBatchLinks] = useState<{name: string, link1: string, link2: string}[] | null>(null);

  useEffect(() => {
    const handleMouseUp = () => setDragMode(null);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const albumData = useMemo(() => {
    const data: Record<string, {name: string, date: number}[]> = {};
    imagesWithDetails.forEach(file => {
      const parts = file.name.split('/');
      if (parts.length > 1) {
        const album = parts[0];
        const fileName = parts.slice(1).join('/');
        if (!data[album]) data[album] = [];
        if (fileName) data[album].push({ name: fileName, date: file.date });
      } else {
        const album = 'Uncategorized';
        if (!data[album]) data[album] = [];
        if (file.name) data[album].push({ name: file.name, date: file.date });
      }
    });

    localAlbums.forEach(la => { if (!data[la]) data[la] = []; });
    return data;
  }, [imagesWithDetails, localAlbums]);

  const albums = Object.keys(albumData).sort();

  const getDualLinks = async (imgName: string, targetAlbum: string) => {
    const folderPrefix = targetAlbum === 'Uncategorized' ? 'images/' : `images/${targetAlbum}/`;
    const baseUrl = await getPublicB2Url(imgName, folderPrefix);
    const urlObj = new URL(baseUrl);
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
    const bucketName = pathSegments[0] || 'rapid-revver';
    const objectPath = pathSegments.slice(1).join('/');

    return {
      link1: `https://${bucketName}.s3.us-west-004.backblazeb2.com/${objectPath}`,
      link2: `https://s3.us-west-004.backblazeb2.com/${bucketName}/${objectPath}`
    };
  };

  const handleCopyMarketplaceLink = async (imgName: string, targetAlbum: string, mp: '1' | '2' | 'ALL') => {
    try {
      const { link1, link2 } = await getDualLinks(imgName, targetAlbum);
      let textToCopy = '';
      if (mp === 'ALL') {
        textToCopy = `Link 1:\n${link1}\n\nLink 2:\n${link2}`;
      } else {
        textToCopy = mp === '1' ? link1 : link2;
      }
      await navigator.clipboard.writeText(textToCopy);
      setCopiedKey(`${imgName}_${mp}`);
      setTimeout(() => setCopiedKey(''), 2000);
    } catch (err) { console.error("Failed to copy", err); }
  };

  const handleQueueFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setPendingFiles(prev => [...prev, ...files]);
  };

  const handleBatchUpload = async () => {
    if (pendingFiles.length === 0 || !activeAlbum) return;
    
    setUploading(true);
    setUploadProgress(0);
    
    const folderPrefix = activeAlbum === 'Uncategorized' ? 'images/' : `images/${activeAlbum}/`;
    const successfulUploads: {name: string, link1: string, link2: string}[] = [];
    const totalFiles = pendingFiles.length;

    for (let i = 0; i < totalFiles; i++) {
      const file = pendingFiles[i];
      setUploadStatusText(`Uploading ${i + 1} of ${totalFiles} - ${file.name}`);
      setUploadProgress((i / totalFiles) * 100);

      const interval = setInterval(() => {
        setUploadProgress(prev => {
          const maxForThisFile = ((i + 1) / totalFiles) * 100 - 2;
          if (prev >= maxForThisFile) return prev;
          return prev + 2;
        });
      }, 150);

      try {
        const contentType = file.type || 'application/octet-stream';
        const url = await getPresignedUploadUrl(file.name, folderPrefix, contentType);
        const res = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': contentType }});
        if (res.ok) {
          const { link1, link2 } = await getDualLinks(file.name, activeAlbum);
          successfulUploads.push({ name: file.name, link1, link2 });
        }
      } catch (err) { 
        console.error("Batch upload error", file.name, err); 
      }
      clearInterval(interval);
    }

    setUploadProgress(100);
    setUploadStatusText('Finalizing batch...');

    setTimeout(() => {
      setPendingFiles([]);
      setUploading(false);
      setUploadProgress(0);
      setRefresh(r => r + 1);
      if (successfulUploads.length > 0) {
        setUploadedBatchLinks(successfulUploads);
      } else {
        alert("Upload failed. Please check your network connection and try again.");
      }
    }, 600);
  };

  const handleCopyAllLinks = async (targetAlbum: string, type: '1' | '2' | 'ALL') => {
    try {
      const imagesToCopy = albumData[targetAlbum] || [];
      const urlsToCopy = await Promise.all(imagesToCopy.map(async (img) => {
        const { link1, link2 } = await getDualLinks(img.name, targetAlbum);
        if (type === 'ALL') return `${img.name}:\nL1: ${link1}\nL2: ${link2}\n`;
        return type === '1' ? link1 : link2;
      }));

      await navigator.clipboard.writeText(urlsToCopy.join('\n'));
      setCopiedAll(type);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch (err) { console.error("Failed to copy all links", err); }
  };

  const filteredAlbums = useMemo(() => {
    let filtered = albums;
    if (albumCategoryFilter !== 'All') {
      filtered = filtered.filter(a => a.startsWith(`[${albumCategoryFilter}]`));
    }
    if (albumSearch.trim()) {
      const terms = albumSearch.toLowerCase().split(/\s+/).filter(Boolean);
      filtered = filtered.filter(a => {
        const searchable = a.toLowerCase().replace(/[-_\[\]]/g, ' ');
        return terms.every(term => searchable.includes(term));
      });
    }
    return filtered;
  }, [albums, albumSearch, albumCategoryFilter]);

  const globalFilteredImages = useMemo(() => {
    if (!albumSearch.trim()) return [];
    const terms = albumSearch.toLowerCase().split(/\s+/).filter(Boolean);
    const results: { album: string, name: string, date: number }[] = [];
    
    Object.entries(albumData).forEach(([album, imgs]) => {
      if (albumCategoryFilter !== 'All' && !album.startsWith(`[${albumCategoryFilter}]`)) {
        return;
      }
      for (const img of imgs) {
        const searchable = img.name.toLowerCase().replace(/[-_.]/g, ' ');
        const match = terms.every(term => img.name.toLowerCase().includes(term) || searchable.includes(term));
        if (match) {
          results.push({ album, name: img.name, date: img.date });
        }
      }
    });
    
    return results.sort((a, b) => {
      if (imageSortOrder === 'recent') return b.date - a.date;
      if (imageSortOrder === 'asc') return a.name.localeCompare(b.name);
      return b.name.localeCompare(a.name);
    });
  }, [albumData, albumSearch, imageSortOrder, albumCategoryFilter]);

  const handleCreateAlbum = () => {
    if (!newAlbumName.trim() || !newAlbumCategory) return;
    const cleanName = newAlbumName.trim().replace(/[^a-zA-Z0-9-_ \s]/g, '_'); 
    const finalName = newAlbumCategory === 'None' ? cleanName : `[${newAlbumCategory}] ${cleanName}`;
    if (!localAlbums.includes(finalName) && !albums.includes(finalName)) {
      setLocalAlbums([...localAlbums, finalName]);
    }
    setNewAlbumName('');
    setNewAlbumCategory(''); 
  };

  const handleRenameAlbum = async (oldAlbumName: string) => {
    if (!editAlbumText.trim() || editAlbumText === oldAlbumName) {
      setEditingAlbum(null);
      return;
    }
    const newName = editAlbumText.trim().replace(/[^a-zA-Z0-9-_ \s\[\]]/g, '_');
    if (localAlbums.includes(oldAlbumName) && (!albumData[oldAlbumName] || albumData[oldAlbumName].length === 0)) {
      setLocalAlbums(prev => prev.map(a => a === oldAlbumName ? newName : a));
      setEditingAlbum(null);
      return;
    }
    setIsDeletingAlbum(true); 
    const res = await renameAlbumInB2(oldAlbumName, newName);
    setIsDeletingAlbum(false);
    if (res.success) {
      setLocalAlbums(prev => prev.map(a => a === oldAlbumName ? newName : a));
      setEditingAlbum(null);
      setRefresh(r => r + 1);
    } else {
      alert("Failed to rename album: " + res.error);
    }
  };

  const handleDeleteAlbum = async (albumName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation(); 
    const imagesInAlbum = albumData[albumName] || [];
    if (imagesInAlbum.length > 0) {
      const confirmDelete = window.confirm(`Are you sure you want to delete the album "${albumName}" AND all ${imagesInAlbum.length} images inside it? This cannot be undone.`);
      if (!confirmDelete) return;
      setIsDeletingAlbum(true);
      const folderPrefix = `images/${albumName}/`;
      for (const img of imagesInAlbum) {
        await deleteFileFromB2(img.name, folderPrefix);
      }
      setIsDeletingAlbum(false);
    } else {
      const confirmDelete = window.confirm(`Remove empty album "${albumName}"?`);
      if (!confirmDelete) return;
    }
    setLocalAlbums(prev => prev.filter(a => a !== albumName));
    if (activeAlbum === albumName) setActiveAlbum(null);
    setRefresh(r => r + 1);
  };

  const handleRenameImage = async (oldName: string, targetAlbum: string) => {
    if (!editImageText.trim() || editImageText === oldName) {
      setEditingImage(null);
      return;
    }
    const oldExt = oldName.includes('.') ? oldName.split('.').pop() : '';
    let newName = editImageText.trim().replace(/[^a-zA-Z0-9-_ \.\(\)]/g, '_');
    if (oldExt && !newName.endsWith(`.${oldExt}`)) {
      newName += `.${oldExt}`;
    }
    const folderPrefix = targetAlbum === 'Uncategorized' ? 'images/' : `images/${targetAlbum}/`;
    setUploading(true);
    const res = await renameImageInB2(oldName, newName, folderPrefix);
    setUploading(false);
    if (res.success) {
      setEditingImage(null);
      setRefresh(r => r + 1);
    } else {
      alert("Failed to rename image: " + res.error);
    }
  };

  const handleDeleteImage = async (imgName: string, targetAlbum: string) => {
    const folderPrefix = targetAlbum === 'Uncategorized' ? 'images/' : `images/${targetAlbum}/`;
    await deleteFileFromB2(imgName, folderPrefix);
    setRefresh(r => r + 1);
  };

  const cycleSortOrder = () => {
    if (imageSortOrder === 'recent') setImageSortOrder('asc');
    else if (imageSortOrder === 'asc') setImageSortOrder('desc');
    else setImageSortOrder('recent');
  };

  const handleDownloadZip = async (imageKeys: string[], zipName: string) => {
    if (imageKeys.length === 0) return;
    setIsDownloading(true);

    try {
      const zip = new JSZip();

      for (const uniqueKey of imageKeys) {
        const parts = uniqueKey.split('/');
        const album = parts[0];
        const name = parts.slice(1).join('/');
        const folderPrefix = album === 'Uncategorized' ? 'images/' : `images/${album}/`;

        const proxyUrl = `/api/b2?folder=${encodeURIComponent(folderPrefix)}&file=${encodeURIComponent(name)}`;
        const res = await fetch(proxyUrl);
        const blob = await res.blob();
        
        zip.file(name, blob);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = zipName;
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      link.remove();
      
    } catch (err) {
      console.error("Zip download failed", err);
      alert("Failed to create ZIP file. Ensure JSZip is installed correctly.");
    }
    
    setIsDownloading(false);
    setSelectedImages([]); 
  };

  const handleMouseDown = (e: React.MouseEvent, key: string, isSelected: boolean) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const newMode = isSelected ? 'deselect' : 'select';
    setDragMode(newMode);
    if (newMode === 'select') setSelectedImages(prev => [...prev, key]);
    else setSelectedImages(prev => prev.filter(k => k !== key));
  };

  const handleMouseEnter = (key: string, isSelected: boolean) => {
    if (dragMode === 'select' && !isSelected) setSelectedImages(prev => [...prev, key]);
    else if (dragMode === 'deselect' && isSelected) setSelectedImages(prev => prev.filter(k => k !== key));
  };

  if (!activeAlbum) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500 relative">
        {expandedImage && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-sm animate-in fade-in" onClick={() => setExpandedImage(null)}>
            <div className="relative max-w-7xl max-h-screen p-2 flex items-center justify-center" onClick={e => e.stopPropagation()}>
              <button onClick={() => setExpandedImage(null)} className="absolute -top-4 -right-4 bg-white rounded-full p-2 text-slate-800 shadow-xl hover:bg-slate-200 transition-colors z-[110]">
                <X className="w-6 h-6" />
              </button>
              <img src={expandedImage} alt="Expanded View" className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" />
            </div>
          </div>
        )}

        {/* 🚀 BATCH UPLOAD COMPLETE MODAL */}
        {uploadedBatchLinks && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden border border-slate-200">
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div className="flex items-center space-x-2 text-emerald-600"><CheckCircle2 className="w-6 h-6" /><h3 className="font-bold text-lg text-slate-800">Batch Upload Complete ({uploadedBatchLinks.length} Images)</h3></div>
                <button onClick={() => setUploadedBatchLinks(null)} className="p-1 hover:bg-slate-200 rounded-full text-slate-400"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 overflow-y-auto flex-1 bg-white space-y-4">
                <p className="text-xs text-slate-500">Links successfully generated for your masterlists:</p>
                <div className="space-y-3">
                  {uploadedBatchLinks.map((item, i) => (
                    <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-2">
                      <span className="font-bold text-slate-800 block truncate">{item.name}</span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div className="flex items-center justify-between bg-white p-2 rounded border">
                          <span className="font-semibold text-blue-600 truncate text-[10px] pr-2">{item.link1}</span>
                          <button onClick={() => { navigator.clipboard.writeText(item.link1); setCopiedKey(`${item.name}_1_BATCH`); setTimeout(() => setCopiedKey(''), 2000); }} className="text-[10px] text-slate-600 hover:text-blue-600 font-bold whitespace-nowrap">
                            {copiedKey === `${item.name}_1_BATCH` ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                        <div className="flex items-center justify-between bg-white p-2 rounded border">
                          <span className="font-semibold text-amber-600 truncate text-[10px] pr-2">{item.link2}</span>
                          <button onClick={() => { navigator.clipboard.writeText(item.link2); setCopiedKey(`${item.name}_2_BATCH`); setTimeout(() => setCopiedKey(''), 2000); }} className="text-[10px] text-slate-600 hover:text-amber-600 font-bold whitespace-nowrap">
                            {copiedKey === `${item.name}_2_BATCH` ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end space-x-2">
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end space-x-3">
                <Button variant="outline" onClick={() => setUploadedBatchLinks(null)}>Close</Button>
                <div className="flex items-center bg-white border border-slate-300 rounded-md overflow-hidden">
                  <span className="text-[10px] font-bold text-slate-500 px-2 py-1.5 bg-slate-50 border-r border-slate-300 uppercase tracking-wider hidden sm:inline-block">Copy Batch:</span>
                  <button onClick={() => { navigator.clipboard.writeText(uploadedBatchLinks.map(l => l.link1).join('\n')); setCopiedAll('BATCH_1'); setTimeout(() => setCopiedAll(false), 2000); }} className={`px-3 py-1.5 text-[10px] font-bold border-r border-slate-200 transition-colors ${copiedAll === 'BATCH_1' ? 'bg-emerald-500 text-white' : 'hover:bg-slate-100 text-slate-700'}`}>Link 1s</button>
                  <button onClick={() => { navigator.clipboard.writeText(uploadedBatchLinks.map(l => l.link2).join('\n')); setCopiedAll('BATCH_2'); setTimeout(() => setCopiedAll(false), 2000); }} className={`px-3 py-1.5 text-[10px] font-bold border-r border-slate-200 transition-colors ${copiedAll === 'BATCH_2' ? 'bg-emerald-500 text-white' : 'hover:bg-slate-100 text-slate-700'}`}>Link 2s</button>
                  <button onClick={() => { navigator.clipboard.writeText(uploadedBatchLinks.map(l => `${l.name}:\nL1: ${l.link1}\nL2: ${l.link2}\n`).join('\n')); setCopiedAll('BATCH_ALL'); setTimeout(() => setCopiedAll(false), 2000); }} className={`px-3 py-1.5 text-[10px] font-bold transition-colors ${copiedAll === 'BATCH_ALL' ? 'bg-emerald-500 text-white' : 'hover:bg-slate-100 text-slate-700'}`}>Both Links</button>
                </div>
              </div>
              </div>
            </div>
          </div>
        )}

        <div>
          <h2 className="text-2xl font-bold text-slate-900">📷 Image Vault</h2>
          <p className="text-slate-500 mt-1">Organize, batch upload, and search your entire media library.</p>
        </div>

        <Card className="p-6">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
            
            <div className="flex flex-col sm:flex-row items-center space-y-3 sm:space-y-0 sm:space-x-4 w-full lg:w-auto">
              <h3 className="text-lg font-semibold text-slate-800 mr-2">Your Albums</h3>
              <select value={albumCategoryFilter} onChange={e => setAlbumCategoryFilter(e.target.value)} className="border border-slate-300 p-2 rounded-md text-sm bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium text-slate-700 w-full sm:w-auto">
                <option value="All">All Categories</option>
                <option value="FR">FR</option>
                <option value="OX">OX</option>
                <option value="SOT">SOT</option>
                <option value="MUA">MUA</option>
              </select>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="Search albums globally..." value={albumSearch} onChange={e => { setAlbumSearch(e.target.value); setSelectedImages([]); }} className="border border-slate-300 p-2 pl-9 rounded-md text-sm bg-white w-full focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
              </div>
            </div>

            <div className="flex items-center space-x-2 w-full sm:w-auto bg-slate-50 p-1.5 rounded-lg border border-slate-200">
              <select value={newAlbumCategory} onChange={e => setNewAlbumCategory(e.target.value)} className="border border-slate-300 p-1.5 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all w-32">
                <option value="" disabled>Category...</option>
                <option value="None">No Category</option>
                <option value="FR">FR</option>
                <option value="OX">OX</option>
                <option value="SOT">SOT</option>
                <option value="MUA">MUA</option>
              </select>
              <input type="text" placeholder="New Album Name" value={newAlbumName} onChange={e => setNewAlbumName(e.target.value)} className="border border-slate-300 p-1.5 rounded-md text-sm bg-white flex-1 sm:w-48 outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
              <Button onClick={handleCreateAlbum} disabled={isDeletingAlbum || !newAlbumCategory || !newAlbumName.trim()}><Plus className="w-4 h-4 mr-1"/> Create</Button>
            </div>

          </div>

          {albums.length > 0 ? (
            filteredAlbums.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredAlbums.map(album => {
                  const previewImage = albumData[album]?.[0]?.name;
                  const folderPrefix = album === 'Uncategorized' ? 'images/' : `images/${album}/`;
                  return (
                    <Card key={album} onClick={() => { if(editingAlbum !== album) { setActiveAlbum(album); setImageSearch(''); setSelectedImages([]); } }} className={`cursor-pointer hover:border-blue-400 hover:shadow-md transition-all group relative flex flex-col overflow-hidden ${isDeletingAlbum ? 'opacity-50 pointer-events-none' : ''}`}>
                      {album !== 'Uncategorized' && (
                        <div className="absolute top-2 right-2 flex space-x-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); setEditingAlbum(album); setEditAlbumText(album); }} className="p-1.5 bg-white/80 backdrop-blur-sm text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-full shadow-sm" title="Rename Album"><Edit3 className="w-4 h-4" /></button>
                          <button onClick={(e) => handleDeleteAlbum(album, e)} className="p-1.5 bg-white/80 backdrop-blur-sm text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-full shadow-sm" title="Delete Album"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      )}
                      <div className="h-36 bg-slate-100 flex items-center justify-center overflow-hidden border-b border-slate-100 relative">
                        {previewImage ? (
                          <>
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/20 to-transparent z-0 pointer-events-none" />
                            <img src={`/api/b2?folder=${encodeURIComponent(folderPrefix)}&file=${encodeURIComponent(previewImage)}`} alt={`Preview of ${album}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                          </>
                        ) : <Folder className="w-12 h-12 text-blue-300 group-hover:text-blue-400 transition-colors" />}
                      </div>
                      <div className="p-4 text-center bg-white">
                        {editingAlbum === album ? (
                          <div className="flex items-center space-x-1" onClick={e => e.stopPropagation()}>
                            <input autoFocus type="text" className="w-full text-sm border p-1 rounded focus:ring-1 focus:ring-blue-500 outline-none" value={editAlbumText} onChange={e => setEditAlbumText(e.target.value)} onKeyDown={e => { if(e.key === 'Enter') handleRenameAlbum(album); if(e.key === 'Escape') setEditingAlbum(null); }} />
                            <button onClick={() => handleRenameAlbum(album)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Check className="w-4 h-4"/></button>
                            <button onClick={() => setEditingAlbum(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4"/></button>
                          </div>
                        ) : (
                          <><h4 className="font-semibold text-slate-800 break-words truncate" title={album}>{album}</h4><p className="text-xs text-slate-500 mt-1">{albumData[album].length} images</p></>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : <div className="text-center p-8 text-slate-500 border border-dashed rounded-lg bg-slate-50">No albums match "{albumSearch}".</div>
          ) : <div className="text-center p-12 text-slate-500 border border-dashed rounded-lg">No albums yet. Create one above to get started.</div>}
        </Card>

        {albumSearch.trim() && (
          <Card className="p-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <div className="flex items-center space-x-3"><h3 className="text-lg font-semibold text-slate-800">Global Image Results</h3><span className="text-sm font-medium text-slate-500">{globalFilteredImages.length} found</span></div>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                {selectedImages.length > 0 ? (
                  <div className="flex items-center space-x-2 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
                    <span className="text-sm font-semibold text-blue-800">{selectedImages.length} selected</span>
                    <Button variant="outline" className="bg-white text-xs py-1 px-2" onClick={() => setSelectedImages([])}>Cancel</Button>
                    <Button className="text-xs py-1 px-3 bg-blue-600 hover:bg-blue-700" disabled={isDownloading} onClick={() => handleDownloadZip(selectedImages, 'Global_Search_Images.zip')}><Download className="w-3 h-3 mr-1.5" /> {isDownloading ? 'Zipping...' : 'Download as ZIP'}</Button>
                  </div>
                ) : globalFilteredImages.length > 0 && <Button variant="outline" onClick={() => setSelectedImages(globalFilteredImages.map(img => `${img.album}/${img.name}`))} className="bg-white text-xs py-1.5">Select All</Button>}
                {globalFilteredImages.length > 0 && <Button variant="outline" onClick={cycleSortOrder} className="bg-white text-xs py-1.5 whitespace-nowrap">{imageSortOrder === 'recent' ? 'Sort: Recent First' : imageSortOrder === 'asc' ? 'Sort: A-Z' : 'Sort: Z-A'}</Button>}
              </div>
            </div>
            {globalFilteredImages.length > 0 ? (
              <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {globalFilteredImages.map(imgObj => {
                  const folderPrefix = imgObj.album === 'Uncategorized' ? 'images/' : `images/${imgObj.album}/`;
                  const uniqueImgKey = `${imgObj.album}/${imgObj.name}`;
                  const imgUrl = `/api/b2?folder=${encodeURIComponent(folderPrefix)}&file=${encodeURIComponent(imgObj.name)}`;
                  const isSelected = selectedImages.includes(uniqueImgKey);
                  return (
                    <div key={uniqueImgKey} onMouseDown={(e) => handleMouseDown(e, uniqueImgKey, isSelected)} onMouseEnter={() => handleMouseEnter(uniqueImgKey, isSelected)} className={`border rounded-lg overflow-hidden flex flex-col bg-white group transition-colors cursor-pointer select-none ${isSelected ? 'border-blue-500 ring-2 ring-blue-500' : 'border-slate-200'}`}>
                      <div className="h-40 bg-slate-100 flex items-center justify-center p-2 relative overflow-hidden">
                        <div className="absolute top-2 left-2 z-20 bg-white/90 rounded backdrop-blur-sm p-1 shadow-sm"><input type="checkbox" checked={isSelected} readOnly className="w-4 h-4 rounded border-slate-300 text-blue-600 pointer-events-none" /></div>
                        <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={(e) => { e.stopPropagation(); setExpandedImage(imgUrl); }} className="p-1.5 bg-white/90 backdrop-blur-sm text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded shadow-sm" title="Expand Image"><ZoomIn className="w-4 h-4" /></button></div>
                        <img src={imgUrl} alt={imgObj.name} className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300 pointer-events-none" loading="lazy" />
                      </div>
                      <div className="p-3 border-t border-slate-100 space-y-3 flex-1 flex flex-col justify-between" onClick={e => e.stopPropagation()}>
                        {editingImage === uniqueImgKey ? (
                          <div className="flex items-center space-x-1"><input autoFocus type="text" className="w-full text-xs border p-1 rounded focus:ring-1 focus:ring-blue-500 outline-none" value={editImageText} onChange={e => setEditImageText(e.target.value)} onKeyDown={e => { if(e.key === 'Enter') handleRenameImage(imgObj.name, imgObj.album); if(e.key === 'Escape') setEditingImage(null); }} /><button onClick={() => handleRenameImage(imgObj.name, imgObj.album)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Check className="w-3 h-3"/></button><button onClick={() => setEditingImage(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-3 h-3"/></button></div>
                        ) : (
                          <div className="flex flex-col gap-1 group/title cursor-pointer" onClick={() => { setEditingImage(uniqueImgKey); setEditImageText(imgObj.name.includes('.') ? imgObj.name.substring(0, imgObj.name.lastIndexOf('.')) : imgObj.name); }}>
                            <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">{imgObj.album}</span>
                            <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-slate-800 truncate" title={imgObj.name}>{imgObj.name}</p><Edit3 className="w-3 h-3 text-slate-300 opacity-0 group-hover/title:opacity-100 transition-opacity flex-shrink-0" /></div>
                          </div>
                        )}
                        <div className="flex space-x-2 w-full"><Button variant="secondary" className="flex-1 text-xs py-1.5 px-2 flex items-center justify-center" onClick={() => handleCopyMarketplaceLink(imgObj.name, imgObj.album, 'ALL')}><Link className="w-3 h-3 mr-1.5" /> Copy</Button><Button variant="danger" className="text-xs py-1.5 px-2.5" onClick={() => handleDeleteImage(imgObj.name, imgObj.album)}><Trash2 className="w-3 h-3" /></Button></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <div className="text-center p-8 text-slate-500 border border-dashed rounded-lg bg-slate-50">No images contain "{albumSearch}".</div>}
          </Card>
        )}
      </div>
    );
  }

  const currentImages = albumData[activeAlbum] || [];
  const sortedFilteredImages = (() => {
    let imgs = [...currentImages];
    if (imageSearch.trim()) {
      const terms = imageSearch.toLowerCase().split(/\s+/).filter(Boolean);
      imgs = imgs.filter(img => {
        const searchable = img.name.toLowerCase().replace(/[-_.]/g, ' ');
        return terms.every(term => img.name.toLowerCase().includes(term) || searchable.includes(term));
      });
    }
    return imgs.sort((a, b) => {
      if (imageSortOrder === 'recent') return b.date - a.date;
      if (imageSortOrder === 'asc') return a.name.localeCompare(b.name);
      return b.name.localeCompare(a.name);
    });
  })();

  return (
    <div className="space-y-6 animate-in fade-in duration-500 relative">
      {expandedImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-sm animate-in fade-in" onClick={() => setExpandedImage(null)}>
          <div className="relative max-w-7xl max-h-screen p-2 flex items-center justify-center" onClick={e => e.stopPropagation()}>
            <button onClick={() => setExpandedImage(null)} className="absolute -top-4 -right-4 bg-white rounded-full p-2 text-slate-800 shadow-xl hover:bg-slate-200 transition-colors z-[110]"><X className="w-6 h-6" /></button>
            <img src={expandedImage} alt="Expanded View" className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" />
          </div>
        </div>
      )}

      {/* 🚀 BATCH UPLOAD COMPLETE MODAL */}
      {uploadedBatchLinks && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden border border-slate-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div className="flex items-center space-x-2 text-emerald-600"><CheckCircle2 className="w-6 h-6" /><h3 className="font-bold text-lg text-slate-800">Batch Upload Complete ({uploadedBatchLinks.length} Images)</h3></div>
              <button onClick={() => setUploadedBatchLinks(null)} className="p-1 hover:bg-slate-200 rounded-full text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 bg-white space-y-4">
              <p className="text-xs text-slate-500">Links successfully generated for your masterlists:</p>
              <div className="space-y-3">
                {uploadedBatchLinks.map((item, i) => (
                  <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-2">
                    <span className="font-bold text-slate-800 block truncate">{item.name}</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="flex items-center justify-between bg-white p-2 rounded border">
                        <span className="font-semibold text-blue-600 truncate text-[10px] pr-2">{item.link1}</span>
                        <button onClick={() => { navigator.clipboard.writeText(item.link1); setCopiedKey(`${item.name}_1_BATCH`); setTimeout(() => setCopiedKey(''), 2000); }} className="text-[10px] text-slate-600 hover:text-blue-600 font-bold whitespace-nowrap">
                          {copiedKey === `${item.name}_1_BATCH` ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <div className="flex items-center justify-between bg-white p-2 rounded border">
                        <span className="font-semibold text-amber-600 truncate text-[10px] pr-2">{item.link2}</span>
                        <button onClick={() => { navigator.clipboard.writeText(item.link2); setCopiedKey(`${item.name}_2_BATCH`); setTimeout(() => setCopiedKey(''), 2000); }} className="text-[10px] text-slate-600 hover:text-amber-600 font-bold whitespace-nowrap">
                          {copiedKey === `${item.name}_2_BATCH` ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end space-x-2">
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end space-x-3">
              <Button variant="outline" onClick={() => setUploadedBatchLinks(null)}>Close</Button>
              <div className="flex items-center bg-white border border-slate-300 rounded-md overflow-hidden">
                <span className="text-[10px] font-bold text-slate-500 px-2 py-1.5 bg-slate-50 border-r border-slate-300 uppercase tracking-wider hidden sm:inline-block">Copy Batch:</span>
                <button onClick={() => { navigator.clipboard.writeText(uploadedBatchLinks.map(l => l.link1).join('\n')); setCopiedAll('BATCH_1'); setTimeout(() => setCopiedAll(false), 2000); }} className={`px-3 py-1.5 text-[10px] font-bold border-r border-slate-200 transition-colors ${copiedAll === 'BATCH_1' ? 'bg-emerald-500 text-white' : 'hover:bg-slate-100 text-slate-700'}`}>Link 1s</button>
                <button onClick={() => { navigator.clipboard.writeText(uploadedBatchLinks.map(l => l.link2).join('\n')); setCopiedAll('BATCH_2'); setTimeout(() => setCopiedAll(false), 2000); }} className={`px-3 py-1.5 text-[10px] font-bold border-r border-slate-200 transition-colors ${copiedAll === 'BATCH_2' ? 'bg-emerald-500 text-white' : 'hover:bg-slate-100 text-slate-700'}`}>Link 2s</button>
                <button onClick={() => { navigator.clipboard.writeText(uploadedBatchLinks.map(l => `${l.name}:\nL1: ${l.link1}\nL2: ${l.link2}\n`).join('\n')); setCopiedAll('BATCH_ALL'); setTimeout(() => setCopiedAll(false), 2000); }} className={`px-3 py-1.5 text-[10px] font-bold transition-colors ${copiedAll === 'BATCH_ALL' ? 'bg-emerald-500 text-white' : 'hover:bg-slate-100 text-slate-700'}`}>Both Links</button>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <button onClick={() => { setActiveAlbum(null); setPendingFiles([]); setImageSearch(''); setSelectedImages([]); }} className="p-2 hover:bg-slate-200 rounded-full transition-colors"><ArrowLeft className="w-6 h-6 text-slate-600" /></button>
          <div><h2 className="text-2xl font-bold text-slate-900">{activeAlbum}</h2><p className="text-slate-500 mt-1">Manage images in this album.</p></div>
        </div>
        <div className="flex items-center space-x-3">
          {currentImages.length > 0 && <Button variant="outline" onClick={() => handleDownloadZip(currentImages.map(img => `${activeAlbum}/${img.name}`), `${activeAlbum}_Archive.zip`)} disabled={isDownloading} className="bg-white border-blue-200 text-blue-700 hover:bg-blue-50 whitespace-nowrap"><Download className="w-4 h-4 mr-2" /> {isDownloading ? 'Zipping...' : 'Download Entire Album'}</Button>}
          {activeAlbum !== 'Uncategorized' && <Button variant="danger" onClick={() => handleDeleteAlbum(activeAlbum)} disabled={isDeletingAlbum}><Trash2 className="w-4 h-4 mr-2" /> {isDeletingAlbum ? 'Deleting...' : 'Delete Album'}</Button>}
        </div>
      </div>

      <Card className="p-6">
        <h3 className="font-semibold text-slate-800 mb-4">Stage Files for Upload</h3>
        <div className={`border-2 border-dashed border-slate-300 rounded-xl transition-colors ${uploading ? 'bg-slate-50' : 'hover:bg-slate-100 cursor-pointer'}`}>
          {uploading ? (
            <div className="p-8 flex flex-col items-center justify-center min-h-[160px]">
              <UploadCloud className="w-10 h-10 mb-4 text-blue-600 animate-bounce" />
              <p className="font-semibold text-slate-700 text-sm mb-1">{uploadStatusText}</p>
              <div className="w-full max-w-md mt-4 animate-in slide-in-from-bottom-2 fade-in">
                <div className="h-2.5 w-full bg-slate-200 rounded-full overflow-hidden shadow-inner"><div className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out" style={{ width: `${Math.min(uploadProgress, 100)}%` }} /></div>
                <div className="flex justify-between mt-2 text-[10px] text-slate-500 font-bold uppercase tracking-wider"><span>{uploadProgress >= 100 ? 'Complete' : 'Uploading...'}</span><span>{Math.round(Math.min(uploadProgress, 100))}%</span></div>
              </div>
            </div>
          ) : (
            <div className="p-8 flex flex-col items-center justify-center" onClick={() => fileInputRef.current?.click()}><UploadCloud className="w-10 h-10 text-blue-500 mb-3" /><p className="text-slate-700 font-medium">Click to select files</p><p className="text-xs text-slate-500 mt-1">Files will be queued below before uploading</p><input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleQueueFiles}/></div>
          )}
        </div>
        {!uploading && pendingFiles.length > 0 && (
          <div className="mt-6 space-y-4 animate-in fade-in">
            <div className="flex justify-between items-center border-b pb-2"><h4 className="text-sm font-semibold text-slate-700">{pendingFiles.length} files queued</h4><Button onClick={handleBatchUpload}>Upload Batch</Button></div>
            <div className="max-h-48 overflow-y-auto space-y-2 pr-2">
              {pendingFiles.map((f, i) => (
                <div key={i} className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-200 text-sm">
                  <div className="flex items-center space-x-2 truncate"><ImageIcon className="w-4 h-4 text-slate-400 flex-shrink-0" /><span className="truncate">{f.name}</span><span className="text-xs text-slate-400">({(f.size / 1024).toFixed(1)} KB)</span></div>
                  <button onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))} className="p-1 hover:bg-red-100 rounded text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
          <div className="flex items-center space-x-3"><h3 className="text-lg font-semibold text-slate-800">Uploaded Images</h3><span className="text-sm font-medium text-slate-500">{sortedFilteredImages.length} items</span></div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {currentImages.length > 0 && <div className="relative w-full sm:w-64 mr-2"><Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" /><input type="text" placeholder="Find image..." value={imageSearch} onChange={e => { setImageSearch(e.target.value); setSelectedImages([]); }} className="border border-slate-300 p-1.5 pl-9 rounded-md text-sm bg-white w-full focus:ring-2 focus:ring-blue-500 outline-none transition-all" /></div>}
            {selectedImages.length > 0 ? (
              <div className="flex items-center space-x-2 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200"><span className="text-sm font-semibold text-blue-800">{selectedImages.length} selected</span><Button variant="outline" className="bg-white text-xs py-1 px-2" onClick={() => setSelectedImages([])}>Cancel</Button><Button className="text-xs py-1 px-3 bg-blue-600 hover:bg-blue-700" disabled={isDownloading} onClick={() => handleDownloadZip(selectedImages, `${activeAlbum}_Selection.zip`)}><Download className="w-3 h-3 mr-1.5" /> {isDownloading ? 'Zipping...' : 'Download as ZIP'}</Button></div>
            ) : sortedFilteredImages.length > 0 && <Button variant="outline" onClick={() => setSelectedImages(sortedFilteredImages.map(img => `${activeAlbum}/${img.name}`))} className="bg-white text-xs py-1.5">Select All</Button>}
            {currentImages.length > 0 && <Button variant="outline" onClick={cycleSortOrder} className="bg-white text-xs py-1.5 whitespace-nowrap">{imageSortOrder === 'recent' ? 'Sort: Recent First' : imageSortOrder === 'asc' ? 'Sort: A-Z' : 'Sort: Z-A'}</Button>}
            {currentImages.length > 0 && (
              <div className="flex items-center bg-white border border-slate-300 rounded-md overflow-hidden">
                <span className="text-[10px] font-bold text-slate-500 px-2 py-1.5 bg-slate-50 border-r border-slate-300 uppercase tracking-wider hidden sm:inline-block">Copy Album:</span>
                <button onClick={() => handleCopyAllLinks(activeAlbum, '1')} className={`px-3 py-1.5 text-[10px] font-bold border-r border-slate-200 transition-colors ${copiedAll === '1' ? 'bg-emerald-500 text-white' : 'hover:bg-slate-100 text-slate-700'}`}>Link 1s</button>
                <button onClick={() => handleCopyAllLinks(activeAlbum, '2')} className={`px-3 py-1.5 text-[10px] font-bold border-r border-slate-200 transition-colors ${copiedAll === '2' ? 'bg-emerald-500 text-white' : 'hover:bg-slate-100 text-slate-700'}`}>Link 2s</button>
                <button onClick={() => handleCopyAllLinks(activeAlbum, 'ALL')} className={`px-3 py-1.5 text-[10px] font-bold transition-colors ${copiedAll === 'ALL' ? 'bg-emerald-500 text-white' : 'hover:bg-slate-100 text-slate-700'}`}>Both Links</button>
              </div>
            )}
          </div>
        </div>
        
        {currentImages.length > 0 ? (
          sortedFilteredImages.length > 0 ? (
            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
              {sortedFilteredImages.map(imgObj => {
                const imgName = imgObj.name;
                const folderPrefix = activeAlbum === 'Uncategorized' ? 'images/' : `images/${activeAlbum}/`;
                const uniqueImgKey = `${activeAlbum}/${imgName}`;
                const imgUrl = `/api/b2?folder=${encodeURIComponent(folderPrefix)}&file=${encodeURIComponent(imgName)}`;
                const isSelected = selectedImages.includes(uniqueImgKey);
                return (
                  <div key={uniqueImgKey} onMouseDown={(e) => handleMouseDown(e, uniqueImgKey, isSelected)} onMouseEnter={() => handleMouseEnter(uniqueImgKey, isSelected)} className={`border rounded-lg overflow-hidden flex flex-col bg-white group transition-colors cursor-pointer select-none ${isSelected ? 'border-blue-500 ring-2 ring-blue-500' : 'border-slate-200'}`}>
                    <div className="h-40 bg-slate-100 flex items-center justify-center p-2 relative overflow-hidden">
                      <div className="absolute top-2 left-2 z-20 bg-white/90 rounded backdrop-blur-sm p-1 shadow-sm"><input type="checkbox" checked={isSelected} readOnly className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 pointer-events-none" /></div>
                      <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={(e) => { e.stopPropagation(); setExpandedImage(imgUrl); }} className="p-1.5 bg-white/90 backdrop-blur-sm text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded shadow-sm" title="Expand Image"><ZoomIn className="w-4 h-4" /></button></div>
                      <img src={imgUrl} alt={imgName} className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300 pointer-events-none" loading="lazy" />
                    </div>
                    
                    <div className="p-3 border-t border-slate-100 space-y-2 flex-1 flex flex-col justify-between" onClick={e => e.stopPropagation()}>
                      {editingImage === uniqueImgKey ? (
                        <div className="flex items-center space-x-1"><input autoFocus type="text" className="w-full text-xs border p-1 rounded focus:ring-1 focus:ring-blue-500 outline-none" value={editImageText} onChange={e => setEditImageText(e.target.value)} onKeyDown={e => { if(e.key === 'Enter') handleRenameImage(imgName, activeAlbum); if(e.key === 'Escape') setEditingImage(null); }} /><button onClick={() => handleRenameImage(imgName, activeAlbum)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Check className="w-3 h-3"/></button><button onClick={() => setEditingImage(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-3 h-3"/></button></div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 group/title cursor-pointer" onClick={() => { setEditingImage(uniqueImgKey); setEditImageText(imgName.includes('.') ? imgName.substring(0, imgName.lastIndexOf('.')) : imgName); }}>
                          <p className="text-xs font-medium text-slate-800 truncate" title={imgName}>{imgName}</p>
                          <Edit3 className="w-3 h-3 text-slate-300 opacity-0 group-hover/title:opacity-100 transition-opacity flex-shrink-0" />
                        </div>
                      )}

                      <div className="space-y-1 mt-auto">
                        <div className="grid grid-cols-2 gap-1">
                          <button onClick={() => handleCopyMarketplaceLink(imgName, activeAlbum, '1')} className={`py-1 text-[10px] font-bold rounded border transition-colors ${copiedKey === `${imgName}_1` ? 'bg-emerald-500 text-white' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`}>Link 1</button>
                          <button onClick={() => handleCopyMarketplaceLink(imgName, activeAlbum, '2')} className={`py-1 text-[10px] font-bold rounded border transition-colors ${copiedKey === `${imgName}_2` ? 'bg-emerald-500 text-white' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'}`}>Link 2</button>
                        </div>
                        <div className="flex space-x-1">
                          <button onClick={() => handleCopyMarketplaceLink(imgName, activeAlbum, 'ALL')} className="flex-1 py-1 text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200 transition-colors">{copiedKey === `${imgObj.name}_ALL` ? 'Copied Both!' : 'Copy Both Links'}</button>
                          <button onClick={() => handleDeleteImage(imgName, activeAlbum)} className="px-2 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded border border-red-200 transition-colors"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <div className="text-center p-8 text-slate-500 border border-dashed rounded-lg bg-slate-50">No images match the search "{imageSearch}".</div>
        ) : <div className="text-center p-12 text-slate-500 border border-dashed rounded-lg bg-slate-50">Album is empty. Queue and upload files above.</div>}
      </Card>
    </div>
  );
}

// ==========================================
// 7. MODULE: MASTERLIST WORKSPACE
// ==========================================
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

  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set());
  const [showColumnFilter, setShowColumnFilter] = useState(false);

  const activeCatObj = PRODUCT_CATEGORIES.find(c => c.id === activeCategory)!;

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

  useEffect(() => {
    setSelectedRows(new Set());
    setVisibleColumns(new Set(flattenedSchemaCols.map((c: any) => c.dataKey)));
    setShowColumnFilter(false);
  }, [activeCategory, flattenedSchemaCols]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setUploadProgress(0);

      if (activeCategory === 'global') {
        setLoadingText('Stitching Global Database...');
        const allData: any[] = [];
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

  const toggleRow = (index: number) => {
    const newSet = new Set(selectedRows);
    if (newSet.has(index)) newSet.delete(index); else newSet.add(index);
    setSelectedRows(newSet);
  };

  const toggleColumn = (key: string) => {
    const newSet = new Set(visibleColumns);
    if (newSet.has(key)) newSet.delete(key); else newSet.add(key);
    setVisibleColumns(newSet);
  };

  const handleSmartExport = () => {
    const rowsToExport = selectedRows.size > 0 ? filteredData.filter((_, i) => selectedRows.has(i)) : filteredData;
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
                if (colsToRender.length === 0) return null; 

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
                
                <tr>
                  {schemaWithKeys.flatMap((g, gIndex) => g.subgroups.map((sg: any, sgIndex: number) => {
                    const visibleSgCols = sg.colsWithKey.filter((c:any) => visibleColumns.has(c.dataKey));
                    if (visibleSgCols.length === 0) return null;
                    return <th key={`${g.group}-${sg.name}-${gIndex}-${sgIndex}`} colSpan={visibleSgCols.length} className={`p-1 text-center text-[10px] border-r border-b border-slate-300 font-semibold ${sg.color} ${sg.text}`}>{sg.name || 'Data'}</th>
                  }))}
                </tr>

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
// 8. MODULE: MASTER CATALOG
// ==========================================
function MasterCatalog() {
  const [activeTab, setActiveTab] = useState('viewer');
  const [viewMode, setViewMode] = useState('catalog');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  const snapshots = useB2Files('snapshots/', refreshTrigger);
  const adSnapshots = useB2Files('marketing/', refreshTrigger);
  
  const [selectedCatFiles, setSelectedCatFiles] = useState<string[]>([]);
  const [selectedAdFiles, setSelectedAdFiles] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewerData, setViewerData] = useState<any[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const [editFile, setEditFile] = useState('');
  const [editableRows, setEditableRows] = useState<Record<string, string>[]>([]);
  const [isEditLoaded, setIsEditLoaded] = useState(false);

  useEffect(() => {
    if (snapshots.length > 0 && selectedCatFiles.length === 0) setSelectedCatFiles([snapshots[snapshots.length - 1]]);
    if (adSnapshots.length > 0 && selectedAdFiles.length === 0) setSelectedAdFiles([adSnapshots[adSnapshots.length - 1]]);
  }, [snapshots.length, adSnapshots.length]);

  const loadViewerData = async () => {
    setIsLoadingData(true);
    let combined: any[] = [];
    
    if (viewMode === 'catalog') {
      for (const s of selectedCatFiles) {
        const text = await safeGetFileContent(s, 'snapshots/');
        combined = combined.concat(parseCSVTable(text).map(unpackRecord));
      }
    } else {
      for (const s of selectedAdFiles) {
        const text = await safeGetFileContent(s, 'marketing/');
        combined = combined.concat(parseCSVTable(text));
      }
    }

    setViewerData(combined);
    setIsLoadingData(false);
  };

  const handleLoadEditGrid = async () => {
    if (!editFile) return alert("Select a snapshot to edit.");
    const text = await safeGetFileContent(editFile, 'snapshots/');
    setEditableRows(parseCSVTable(text).map(unpackRecord));
    setIsEditLoaded(true);
  };

  const handleSaveEditor = async () => {
    if (!editFile) return alert("Please select a file.");
    const records = editableRows.map(row => {
      const obj: Record<string, string> = { batch_name: editFile };
      CATALOG_HEADERS.forEach(h => {
        obj[h] = String(row[h] || '');
      });
      return obj;
    });
    await safeUploadTextToB2(toCSV(records), editFile, 'snapshots/');
    setRefreshTrigger(r => r + 1);
    alert(`Changes saved to '${editFile}'!`);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Master Catalog Workspace</h2>
        <p className="text-slate-500 mt-1">Browse, search, and manage your raw data files.</p>
      </div>

      <div className="flex border-b border-slate-200">
        <button onClick={() => setActiveTab('viewer')} className={`px-4 py-2.5 text-sm font-medium border-b-2 ${activeTab === 'viewer' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>Data Viewer</button>
        <button onClick={() => setActiveTab('editor')} className={`px-4 py-2.5 text-sm font-medium border-b-2 ${activeTab === 'editor' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>Live Catalog Editor</button>
      </div>

      {activeTab === 'viewer' && (
        <Card className="p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 border-b pb-4">
            <h3 className="font-semibold text-slate-800">Master Data Viewer</h3>
            
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button 
                onClick={() => { setViewMode('catalog'); setViewerData([]); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'catalog' ? 'bg-white shadow-sm text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Catalog Snapshots
              </button>
              <button 
                onClick={() => { setViewMode('ads'); setViewerData([]); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'ads' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Advertising Reports
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Files to View ({viewMode === 'catalog' ? 'Catalog' : 'Ads'})
              </label>
              
              <div className="max-h-32 overflow-y-auto border border-slate-300 p-2 rounded-md space-y-1 bg-white">
                {viewMode === 'catalog' ? (
                  snapshots.length === 0 ? <span className="text-xs text-slate-400 italic">No catalog files available.</span> :
                  snapshots.map(s => (
                    <label key={s} className="flex items-center space-x-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={selectedCatFiles.includes(s)} onChange={e => { if (e.target.checked) setSelectedCatFiles(prev => prev.concat([s])); else setSelectedCatFiles(prev => prev.filter(f => f !== s)); }} className="rounded text-blue-600 focus:ring-blue-500"/>
                      <span className="truncate">{s}</span>
                    </label>
                  ))
                ) : (
                  adSnapshots.length === 0 ? <span className="text-xs text-slate-400 italic">No ad reports available.</span> :
                  adSnapshots.map(s => (
                    <label key={s} className="flex items-center space-x-2 text-sm cursor-pointer text-emerald-800">
                      <input type="checkbox" checked={selectedAdFiles.includes(s)} onChange={e => { if (e.target.checked) setSelectedAdFiles(prev => prev.concat([s])); else setSelectedAdFiles(prev => prev.filter(f => f !== s)); }} className="rounded text-emerald-600 focus:ring-emerald-500"/>
                      <span className="truncate">{s}</span>
                    </label>
                  ))
                )}
              </div>
              <Button onClick={loadViewerData} disabled={isLoadingData} className={`mt-2 text-xs w-full sm:w-auto ${viewMode === 'ads' ? 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500' : ''}`}>
                {isLoadingData ? 'Loading...' : 'Load Selected Files'}
              </Button>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Search Loaded Data</label>
              <input type="text" placeholder="Search rows..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-sm bg-white"/>
            </div>
          </div>
          
          {(() => {
            const filtered = searchQuery ? viewerData.filter(row => Object.values(row).some(v => String(v).toLowerCase().includes(searchQuery.toLowerCase()))) : viewerData;
            
            const headers = filtered.length > 0 ? Object.keys(filtered[0]) : [];
            
            return (
              <>
                <div className="flex justify-between items-center mb-2">
                  <div className="text-sm font-medium text-slate-600">Total Rows in View: {filtered.length}</div>
                  {filtered.length > 0 && <Button variant="outline" onClick={() => downloadCSV(filtered, `${viewMode}_export.csv`)}><Download className="w-4 h-4 mr-2"/> Export View</Button>}
                </div>
                {filtered.length > 0 ? (
                  <div className="overflow-x-auto max-h-[500px] border border-slate-200 rounded-lg shadow-sm">
                    <table className="w-full text-sm text-left text-slate-600 whitespace-nowrap">
                      <thead className={`sticky top-0 text-slate-700 ${viewMode === 'ads' ? 'bg-emerald-50' : 'bg-slate-100'}`}>
                        <tr>
                          {headers.map(h => <th key={h} className="p-2 font-semibold border-b">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {filtered.slice(0, 500).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            {headers.map(h => <td key={h} className="p-2 truncate max-w-xs">{row[h]}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-500 border border-dashed rounded-lg bg-slate-50">
                    No data loaded. Select files and click &quot;Load Selected Files&quot;.
                  </div>
                )}
              </>
            );
          })()}
        </Card>
      )}

      {activeTab === 'editor' && (
        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="font-semibold text-slate-800 mb-4">Live Data Editor (Catalog Only)</h3>
            <div className="flex flex-col sm:flex-row gap-4 items-center mb-4">
              <select className="border-slate-300 p-2 border rounded-md text-sm flex-1 w-full bg-white" value={editFile} onChange={e => { setEditFile(e.target.value); setIsEditLoaded(false); }}>
                <option value="">-- Select Catalog Snapshot to Edit --</option>
                {snapshots.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <Button onClick={handleLoadEditGrid}><Edit3 className="w-4 h-4 mr-2"/> Load Editable Grid</Button>
            </div>
          </Card>

          {isEditLoaded && editableRows.length > 0 && (
            <Card className="p-6 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-slate-700">Editing Snapshot: {editFile}</span>
                <Button variant="outline" onClick={() => {
                  const newRow: any = {};
                  CATALOG_HEADERS.forEach(h => newRow[h] = '');
                  newRow.ASIN = 'NEW_ASIN';
                  setEditableRows(prev => prev.concat([newRow]));
                }}>+ Add Row</Button>
              </div>

              <div className="overflow-x-auto max-h-[500px] border border-slate-200 rounded-lg">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-100 sticky top-0 text-slate-700 border-b">
                    <tr>{CATALOG_HEADERS.map(k => <th key={k} className="p-2 whitespace-nowrap">{k}</th>)}<th className="p-2">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {editableRows.slice(0, 500).map((row, rowIndex) => (
                      <tr key={rowIndex} className="hover:bg-slate-50">
                        {CATALOG_HEADERS.map(colKey => (
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

// ==========================================
// 9. MODULE: ASIN DEEP DIVE
// ==========================================
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

    const buyboxKeywords = ["buy_box", "buybox", "featured_offer", "featured_merchant"];

    let comparison = CATALOG_HEADERS.map(k => {
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

// ==========================================
// 10. MODULE: GLOBAL DELTA VIEW
// ==========================================
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

    let fullRows = mergedAsins.map(asin => {
      const oldRow = oldMap.get(asin) || {};
      const newRow = newMap.get(asin) || {};
      const rowObj: Record<string, string> = { ASIN: asin };
      CATALOG_HEADERS.forEach(col => {
        const oldVal = Object.keys(oldRow).find(k => k.toLowerCase() === col.toLowerCase());
        const newVal = Object.keys(newRow).find(k => k.toLowerCase() === col.toLowerCase());
        rowObj[`${col} (Old)`] = String(oldVal ? oldRow[oldVal] : '');
        rowObj[`${col} (New)`] = String(newVal ? newRow[newVal] : '');
      });
      return rowObj;
    });

    if (deltaBuyboxOnly) {
      const bbCols = CATALOG_HEADERS.filter(c => buyboxKeywords.some(kw => c.toLowerCase().includes(kw)));
      fullRows = fullRows.filter(row => bbCols.some(c => row[`${c} (Old)`] !== row[`${c} (New)`]));
    } else if (deltaModifiedOnly) {
      fullRows = fullRows.filter(row => CATALOG_HEADERS.some(c => row[`${c} (Old)`] !== row[`${c} (New)`]));
    }

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

// ==========================================
// 11. MODULE: ADS ANALYSIS
// ==========================================
const applyAdsColFilters = (data: any[], filters: Record<string, string>) => {
  return data.filter(row => {
    return Object.entries(filters).every(([key, filterValue]) => {
      if (!filterValue) return true;
      const rawVal = row[key];
      const strVal = String(rawVal === null || rawVal === undefined ? '' : rawVal).toLowerCase();
      const search = filterValue.toLowerCase().trim();

      if (search.startsWith('>')) {
        const num = parseFloat(search.substring(1));
        const valNum = typeof rawVal === 'number' ? rawVal : parseFloat(strVal.replace(/[^0-9.-]+/g,""));
        return !isNaN(valNum) && valNum > num;
      }
      if (search.startsWith('<')) {
        const num = parseFloat(search.substring(1));
        const valNum = typeof rawVal === 'number' ? rawVal : parseFloat(strVal.replace(/[^0-9.-]+/g,""));
        return !isNaN(valNum) && valNum < num;
      }
      if (search.startsWith('=')) {
        const num = parseFloat(search.substring(1));
        const valNum = typeof rawVal === 'number' ? rawVal : parseFloat(strVal.replace(/[^0-9.-]+/g,""));
        return !isNaN(valNum) && valNum === num;
      }

      return strVal.includes(search);
    });
  });
};

function AdsAnalysis() {
  const [activeTab, setActiveTab] = useState('perf');
  const [refreshTrigger] = useState(0);
  const adFiles = useB2Files('marketing/', refreshTrigger);

  const [selectedAdFiles, setSelectedAdFiles] = useState<string[]>([]);
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

  const [campaignColFilters, setCampaignColFilters] = useState<Record<string, string>>({});
  const [adGroupColFilters, setAdGroupColFilters] = useState<Record<string, string>>({});
  const [termColFilters, setTermColFilters] = useState<Record<string, string>>({});
  const [rawColFilters, setRawColFilters] = useState<Record<string, string>>({});

  const [sortConfigs, setSortConfigs] = useState<Record<string, {key: string, dir: 'asc'|'desc'}>>({
    campaigns: { key: '7 Day Total Sales', dir: 'desc' },
    adgroups: { key: '7 Day Total Sales', dir: 'desc' },
    terms: { key: 'Spend', dir: 'desc' },
    raw: { key: '', dir: 'asc' }
  });

  const [visibleAdColumns, setVisibleAdColumns] = useState<Set<string>>(new Set([
    'Campaign Name', 'Match Type', 'Targeting', 'Impressions', 'Clicks', 
    'Click-Thru Rate (CTR)', 'Cost Per Click (CPC)', 'Spend', '7 Day Total Sales', 'Total Advertising Cost of Sales (ACOS)', 
    'Total Return on Advertising Spend (ROAS)', '7 Day Total Orders (#)', '7 Day Total Units (#)', '7 Day Conversion Rate'
  ]));
  const [showAdColumnFilter, setShowAdColumnFilter] = useState(false);
  const visibleHeaders = ADS_LEADERBOARD_HEADERS.filter(col => visibleAdColumns.has(col));

  const handleSort = (table: string, key: string) => {
    setSortConfigs(prev => {
      const current = prev[table];
      let newDir: 'asc'|'desc' = 'desc';
      if (current?.key === key) {
        newDir = current.dir === 'asc' ? 'desc' : 'asc';
      }
      return { ...prev, [table]: { key, dir: newDir } };
    });
  };

  const sortData = (data: any[], sortCfg: {key: string, dir: 'asc'|'desc'}) => {
    if (!sortCfg || !sortCfg.key) return data;
    return [...data].sort((a, b) => {
      let valA = a[sortCfg.key];
      let valB = b[sortCfg.key];

      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      const cleanA = String(valA).replace(/[$%,]/g, '').trim();
      const cleanB = String(valB).replace(/[$%,]/g, '').trim();
      const numA = Number(cleanA);
      const numB = Number(cleanB);

      if (cleanA !== '' && cleanB !== '' && !isNaN(numA) && !isNaN(numB)) {
        return sortCfg.dir === 'asc' ? numA - numB : numB - numA;
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      if (strA < strB) return sortCfg.dir === 'asc' ? -1 : 1;
      if (strA > strB) return sortCfg.dir === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const SortIcon = ({ table, colKey }: { table: string, colKey: string }) => {
    const cfg = sortConfigs[table];
    if (cfg?.key !== colKey) return <span className="text-slate-300 ml-1 text-[10px]">↕</span>;
    return <span className="text-blue-600 ml-1 text-[12px] font-black">{cfg.dir === 'asc' ? '↑' : '↓'}</span>;
  };

  useEffect(() => {
    if (adFiles.length > 0 && selectedAdFiles.length === 0) {
      setSelectedAdFiles([adFiles[adFiles.length - 1]]);
    }
  }, [adFiles.length]);

  useEffect(() => {
    const loadAdsData = async () => {
      if (selectedAdFiles.length === 0) {
        setRawAdRows([]);
        return;
      }
      
      setIsDataLoading(true);
      let combined: Record<string, string>[] = [];
      for (const fileName of selectedAdFiles) {
        const text = await safeGetFileContent(fileName, 'marketing/');
        combined = combined.concat(parseCSVTable(text));
      }
      setRawAdRows(combined);
      setIsDataLoading(false);
    };
    
    loadAdsData();
  }, [selectedAdFiles]);

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
      let keyVal = row[groupByKey];
      if (!keyVal) {
        const foundKey = Object.keys(row).find(k => k.toLowerCase() === groupByKey.toLowerCase());
        keyVal = foundKey ? row[foundKey] : 'Unknown';
      }
      if (!keyVal) keyVal = 'Unknown';

      if (!map.has(keyVal)) {
        const initObj: any = {};
        ADS_LEADERBOARD_HEADERS.forEach(h => {
          if (["Start Date", "End Date", "Portfolio name", "Currency", "Campaign Name", "Ad Group Name", "Retailer", "Country", "Targeting", "Match Type", "Customer Search Term"].includes(h)) {
            let val = row[h];
            if (val === undefined) {
              const foundK = Object.keys(row).find(k => k.toLowerCase() === h.toLowerCase());
              val = foundK ? row[foundK] : '';
            }
            initObj[h] = val || '';
          } else {
            initObj[h] = 0; 
          }
        });
        map.set(keyVal, initObj);
      }
      
      const item = map.get(keyVal)!;
      const getRowVal = (headerName: string) => {
        if (row[headerName] !== undefined) return parseNum(row[headerName]);
        const foundK = Object.keys(row).find(k => k.toLowerCase() === headerName.toLowerCase());
        return foundK ? parseNum(row[foundK]) : 0;
      };

      item['Impressions'] += getRowVal('Impressions');
      item['Clicks'] += getRowVal('Clicks');
      item['Spend'] += getRowVal('Spend');
      item['7 Day Total Sales'] += getRowVal('7 Day Total Sales');
      item['7 Day Total Orders (#)'] += getRowVal('7 Day Total Orders (#)');
      item['7 Day Total Units (#)'] += getRowVal('7 Day Total Units (#)');
      item['7 Day Advertised SKU Units (#)'] += getRowVal('7 Day Advertised SKU Units (#)');
      item['7 Day Other SKU Units (#)'] += getRowVal('7 Day Other SKU Units (#)');
      item['7 Day Advertised SKU Sales'] += getRowVal('7 Day Advertised SKU Sales');
      item['7 Day Other SKU Sales'] += getRowVal('7 Day Other SKU Sales');
    });

    return Array.from(map.entries()).map(([name, data]) => {
      const imps = data['Impressions'];
      const clicks = data['Clicks'];
      const spend = data['Spend'];
      const sales = data['7 Day Total Sales'];
      const orders = data['7 Day Total Orders (#)'];

      data['Click-Thru Rate (CTR)'] = imps > 0 ? (clicks / imps) * 100 : 0;
      data['Cost Per Click (CPC)'] = clicks > 0 ? spend / clicks : 0;
      data['Total Advertising Cost of Sales (ACOS)'] = sales > 0 ? (spend / sales) * 100 : 0;
      data['Total Return on Advertising Spend (ROAS)'] = spend > 0 ? sales / spend : 0;
      data['7 Day Conversion Rate'] = clicks > 0 ? (orders / clicks) * 100 : 0;

      // Use the correct internal name field based on what is being aggregated
      if (groupByKey === 'Campaign Name') data['Campaign Name'] = name;
      else if (groupByKey === 'Ad Group Name') data['Ad Group Name'] = name;
      else if (groupByKey === 'Customer Search Term') data['Customer Search Term'] = name;

      return data;
    }).sort((a, b) => sortBySales ? b['7 Day Total Sales'] - a['7 Day Total Sales'] : b['Spend'] - a['Spend']).slice(0, limit);
  };

  const topCampaignsRaw = useMemo(() => aggregateGroup('Campaign Name', cRowLimit, true), [filteredData, cRowLimit]);
  const topAdGroupsRaw = useMemo(() => aggregateGroup('Ad Group Name', gRowLimit, true), [filteredData, gRowLimit]);
  const topTermsRaw = useMemo(() => aggregateGroup('Customer Search Term', tRowLimit, false), [filteredData, tRowLimit]);

  const finalCampaigns = useMemo(() => applyAdsColFilters(topCampaignsRaw, campaignColFilters), [topCampaignsRaw, campaignColFilters]);
  const finalAdGroups = useMemo(() => applyAdsColFilters(topAdGroupsRaw, adGroupColFilters), [topAdGroupsRaw, adGroupColFilters]);
  const finalTerms = useMemo(() => applyAdsColFilters(topTermsRaw, termColFilters), [topTermsRaw, termColFilters]);
  const finalRawData = useMemo(() => applyAdsColFilters(filteredData, rawColFilters), [filteredData, rawColFilters]);

  const sortedCampaigns = useMemo(() => sortData(finalCampaigns, sortConfigs.campaigns), [finalCampaigns, sortConfigs.campaigns]);
  const sortedAdGroups = useMemo(() => sortData(finalAdGroups, sortConfigs.adgroups), [finalAdGroups, sortConfigs.adgroups]);
  const sortedTerms = useMemo(() => sortData(finalTerms, sortConfigs.terms), [finalTerms, sortConfigs.terms]);
  const sortedRawData = useMemo(() => sortData(finalRawData, sortConfigs.raw), [finalRawData, sortConfigs.raw]);

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

  const renderAdValue = (col: string, val: any) => {
    if (typeof val === 'number') {
      if (col.includes('Rate') || col.includes('(CTR)') || col.includes('(ACOS)')) return `${val.toFixed(2)}%`;
      if (col.includes('Spend') || col.includes('Sales') || col.includes('(CPC)')) return `$${val.toFixed(2)}`;
      if (col.includes('(ROAS)')) return val.toFixed(2);
      return val.toLocaleString();
    }
    return val || '';
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Amazon Advertising Analytics Hub</h2>
        <p className="text-slate-500 mt-1">Configure your target filters below to interact with reports uploaded via the Data Ingestion Hub.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <Card className="p-4 space-y-4 lg:col-span-1 border-slate-200">
          
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Source Reports</label>
            <div className="max-h-28 overflow-y-auto border border-slate-300 p-2 rounded-md space-y-1 bg-white">
              {adFiles.length === 0 && <span className="text-[10px] text-slate-400 italic">No ad reports found. Upload in Ingestion Hub.</span>}
              {adFiles.map(s => (
                <label key={s} className="flex items-center space-x-2 text-xs cursor-pointer text-emerald-800">
                  <input 
                    type="checkbox" 
                    checked={selectedAdFiles.includes(s)} 
                    onChange={e => { 
                      if (e.target.checked) setSelectedAdFiles(prev => prev.concat([s])); 
                      else setSelectedAdFiles(prev => prev.filter(f => f !== s)); 
                    }} 
                    className="rounded text-emerald-600 focus:ring-emerald-500 w-3 h-3"
                  />
                  <span className="truncate">{s}</span>
                </label>
              ))}
            </div>
          </div>

          <h3 className="font-semibold text-slate-800 border-b pb-2 text-sm pt-2">Global Filters</h3>
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
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-200 pb-2 mb-4 gap-4">
            <div className="flex overflow-x-auto w-full sm:w-auto space-x-2">
              <button onClick={() => setActiveTab('perf')} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === 'perf' ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-slate-500'}`}>Performance Overview</button>
              <button onClick={() => setActiveTab('raw')} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === 'raw' ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-slate-500'}`}>Raw Data Vault</button>
              <button onClick={() => setActiveTab('export')} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === 'export' ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-slate-500'}`}>Export Hub</button>
            </div>
            
            {activeTab === 'perf' && (
              <div className="relative z-30">
                <Button variant="secondary" onClick={() => setShowAdColumnFilter(!showAdColumnFilter)} className="bg-white">
                  <List className="w-4 h-4 mr-2" /> Metrics ({visibleAdColumns.size}/{ADS_LEADERBOARD_HEADERS.length})
                </Button>
                {showAdColumnFilter && (
                  <div className="absolute right-0 top-12 bg-white border border-slate-200 shadow-xl rounded-lg p-4 w-64 max-h-[400px] flex flex-col animate-in slide-in-from-top-2">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="font-bold text-slate-800">Show Metrics</h4>
                      <div className="flex space-x-2">
                        <button onClick={() => setVisibleAdColumns(new Set(ADS_LEADERBOARD_HEADERS))} className="text-xs text-blue-600 hover:underline">All</button>
                        <button onClick={() => setVisibleAdColumns(new Set(['Campaign Name', 'Ad Group Name', 'Customer Search Term']))} className="text-xs text-slate-500 hover:underline">Clear</button>
                      </div>
                    </div>
                    <div className="overflow-y-auto flex-1 space-y-2 pr-2">
                      {ADS_LEADERBOARD_HEADERS.map(col => (
                        <label key={col} className="flex items-center space-x-2 text-xs text-slate-700 hover:bg-slate-50 p-1 rounded cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={visibleAdColumns.has(col)} 
                            onChange={() => {
                              const next = new Set(visibleAdColumns);
                              if (next.has(col)) next.delete(col);
                              else next.add(col);
                              setVisibleAdColumns(next);
                            }}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="truncate" title={col}>{col}</span>
                        </label>
                      ))}
                    </div>
                    <Button onClick={() => setShowAdColumnFilter(false)} className="mt-3 w-full py-1.5 text-xs">Apply</Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {isDataLoading ? (
            <Card className="p-12 text-center text-slate-500"><p className="animate-pulse">Loading big data from Backblaze B2...</p></Card>
          ) : rawAdRows.length === 0 ? (
            <Card className="p-12 text-center text-slate-500 border-dashed bg-slate-50">
              <TrendingUp className="w-12 h-12 mx-auto mb-4 text-slate-300" />
              <p>Please select at least one Ad Report from the "Source Reports" panel to analyze.</p>
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

                  <p className="text-[10px] text-slate-500 italic text-right px-2">💡 Pro tip: Use <strong>&gt;</strong> or <strong>&lt;</strong> in the column filters below (e.g., &gt;50)</p>

                  {/* CAMPAIGN LEADERBOARD */}
                  <Card className="p-6 space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-semibold text-slate-800">Leaderboard: Top Campaigns</h3>
                      <div className="flex items-center space-x-2 text-xs"><span>Rows: {cRowLimit}</span><input type="range" min="5" max="100" value={cRowLimit} onChange={e => setCRowLimit(parseInt(e.target.value))}/></div>
                    </div>
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-xs text-left whitespace-nowrap">
                        <thead className="bg-slate-50 border-b text-slate-700">
                          <tr>
                            {visibleHeaders.map(col => (
                              <th key={col} className="p-2 cursor-pointer hover:bg-slate-200 select-none transition-colors" onClick={() => handleSort('campaigns', col)}>
                                <div className="flex items-center">
                                  {col} <SortIcon table="campaigns" colKey={col} />
                                </div>
                              </th>
                            ))}
                          </tr>
                          <tr className="bg-slate-100">
                            {visibleHeaders.map(col => (
                              <th key={`filter-${col}`} className="p-1 border-t border-slate-200">
                                <input type="text" placeholder="Filter..." className="w-full min-w-[50px] p-1 text-[10px] border border-slate-300 rounded font-normal bg-white" value={campaignColFilters[col] || ''} onChange={e => setCampaignColFilters(prev => ({...prev, [col]: e.target.value}))} />
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {sortedCampaigns.map((r, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              {visibleHeaders.map(col => (
                                <td key={col} className="p-2 truncate max-w-[200px]">{renderAdValue(col, r[col])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  {/* AD GROUPS LEADERBOARD */}
                  <Card className="p-6 space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-semibold text-slate-800">Leaderboard: Top Ad Groups</h3>
                      <div className="flex items-center space-x-2 text-xs"><span>Rows: {gRowLimit}</span><input type="range" min="5" max="100" value={gRowLimit} onChange={e => setGRowLimit(parseInt(e.target.value))}/></div>
                    </div>
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-xs text-left whitespace-nowrap">
                        <thead className="bg-slate-50 border-b text-slate-700">
                          <tr>
                            {visibleHeaders.map(col => (
                              <th key={col} className="p-2 cursor-pointer hover:bg-slate-200 select-none transition-colors" onClick={() => handleSort('adgroups', col)}>
                                <div className="flex items-center">
                                  {col} <SortIcon table="adgroups" colKey={col} />
                                </div>
                              </th>
                            ))}
                          </tr>
                          <tr className="bg-slate-100">
                            {visibleHeaders.map(col => (
                              <th key={`filter-${col}`} className="p-1 border-t border-slate-200">
                                <input type="text" placeholder="Filter..." className="w-full min-w-[50px] p-1 text-[10px] border border-slate-300 rounded font-normal bg-white" value={adGroupColFilters[col] || ''} onChange={e => setAdGroupColFilters(prev => ({...prev, [col]: e.target.value}))} />
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {sortedAdGroups.map((r, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              {visibleHeaders.map(col => (
                                <td key={col} className="p-2 truncate max-w-[200px]">{renderAdValue(col, r[col])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  {/* TERMS LEADERBOARD */}
                  <Card className="p-6 space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-semibold text-slate-800">Leaderboard: Top Customer Search Terms</h3>
                      <div className="flex items-center space-x-2 text-xs"><span>Rows: {tRowLimit}</span><input type="range" min="5" max="100" value={tRowLimit} onChange={e => setTRowLimit(parseInt(e.target.value))}/></div>
                    </div>
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-xs text-left whitespace-nowrap">
                        <thead className="bg-slate-50 border-b text-slate-700">
                          <tr>
                            {visibleHeaders.map(col => (
                              <th key={col} className="p-2 cursor-pointer hover:bg-slate-200 select-none transition-colors" onClick={() => handleSort('terms', col)}>
                                <div className="flex items-center">
                                  {col} <SortIcon table="terms" colKey={col} />
                                </div>
                              </th>
                            ))}
                          </tr>
                          <tr className="bg-slate-100">
                            {visibleHeaders.map(col => (
                              <th key={`filter-${col}`} className="p-1 border-t border-slate-200">
                                <input type="text" placeholder="Filter..." className="w-full min-w-[50px] p-1 text-[10px] border border-slate-300 rounded font-normal bg-white" value={termColFilters[col] || ''} onChange={e => setTermColFilters(prev => ({...prev, [col]: e.target.value}))} />
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {sortedTerms.map((r, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              {visibleHeaders.map(col => (
                                <td key={col} className="p-2 truncate max-w-[200px]">{renderAdValue(col, r[col])}</td>
                              ))}
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
                    <span className="text-sm font-semibold text-slate-700">Total Filtered Rows: {finalRawData.length}</span>
                    <Button onClick={() => downloadCSV(finalRawData, 'filtered_raw_ads.csv')}><Download className="w-4 h-4 mr-2"/> Download Raw CSV</Button>
                  </div>
                  <div className="overflow-x-auto max-h-[600px] border border-slate-200 rounded-lg">
                    <table className="w-full text-xs text-left whitespace-nowrap">
                      <thead className="bg-slate-50 border-b sticky top-0 z-10 shadow-sm">
                        <tr>
                          {ADS_LEADERBOARD_HEADERS.map(k => (
                            <th key={k} className="p-2 text-slate-700 cursor-pointer hover:bg-slate-200 select-none transition-colors" onClick={() => handleSort('raw', k)}>
                              <div className="flex items-center">
                                {k} <SortIcon table="raw" colKey={k} />
                              </div>
                            </th>
                          ))}
                        </tr>
                        <tr className="bg-slate-100">
                          {ADS_LEADERBOARD_HEADERS.map(k => (
                            <th key={`filter-${k}`} className="p-1 border-t border-slate-200">
                              <input 
                                type="text" 
                                placeholder={`Filter...`} 
                                className="w-full min-w-[60px] p-1 text-[10px] border border-slate-300 rounded font-normal bg-white"
                                value={rawColFilters[k] || ''}
                                onChange={e => setRawColFilters(prev => ({...prev, [k]: e.target.value}))}
                              />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {sortedRawData.slice(0, 200).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            {ADS_LEADERBOARD_HEADERS.map(k => (
                              <td key={k} className="p-2 truncate max-w-[200px]">{renderAdValue(k, row[k] !== undefined ? row[k] : (row[k.toLowerCase()] !== undefined ? row[k.toLowerCase()] : ''))}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {sortedRawData.length > 200 && <div className="text-center text-xs text-slate-400 p-2">Showing first 200 rows. Use export to view all.</div>}
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
                    <p className="text-sm text-slate-500">Select data views to include in your exported file (filters apply!):</p>
                    <div className="space-y-2 text-sm">
                      <label className="flex items-center space-x-2"><input type="checkbox" checked={optSummary} onChange={e => setOptSummary(e.target.checked)}/><span>Executive Summary Metrics</span></label>
                      <label className="flex items-center space-x-2"><input type="checkbox" checked={optCampaigns} onChange={e => setOptCampaigns(e.target.checked)}/><span>Filtered Campaigns Leaderboard</span></label>
                      <label className="flex items-center space-x-2"><input type="checkbox" checked={optAdGroups} onChange={e => setOptAdGroups(e.target.checked)}/><span>Filtered Ad Groups Leaderboard</span></label>
                      <label className="flex items-center space-x-2"><input type="checkbox" checked={optTerms} onChange={e => setOptTerms(e.target.checked)}/><span>Filtered Search Terms Leaderboard</span></label>
                      <label className="flex items-center space-x-2"><input type="checkbox" checked={optRaw} onChange={e => setOptRaw(e.target.checked)}/><span>Filtered Raw Data</span></label>
                    </div>
                    <Button onClick={() => {
                      let exportDataset: any[] = [];
                      if (optSummary) exportDataset.push({ "Metric": "Total Spend", "Value": aggregate.totalSpend }, { "Metric": "Total Sales", "Value": aggregate.totalSales });
                      
                      const filterColumnsForExport = (data: any[]) => data.map(row => {
                        const obj: any = {};
                        visibleHeaders.forEach(col => { obj[col] = row[col]; });
                        return obj;
                      });

                      if (optCampaigns) exportDataset = exportDataset.concat(filterColumnsForExport(sortedCampaigns));
                      if (optAdGroups) exportDataset = exportDataset.concat(filterColumnsForExport(sortedAdGroups));
                      if (optTerms) exportDataset = exportDataset.concat(filterColumnsForExport(sortedTerms));
                      if (optRaw) exportDataset = exportDataset.concat(sortedRawData);
                      
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

// ==========================================
// 12. MODULE: SEO INTELLIGENCE
// ==========================================
function SeoIntelligence() {
  const [activeTab, setActiveTab] = useState('audit');
  const [refreshTrigger] = useState(0);
  const catSnapshots = useB2Files('snapshots/', refreshTrigger);
  const adSnapshots = useB2Files('marketing/', refreshTrigger);

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
      safeGetFileContent(selectedAdFile, 'marketing/').then(text => setRawAdRows(parseCSVTable(text)));
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
// 13. MODULE: CATALOG MONITOR
// ==========================================
function CatalogMonitor() {
  const [refreshTrigger] = useState(0);
  const snapshots = useB2Files('snapshots/', refreshTrigger);
  const [cmOld, setCmOld] = useState('');
  const [cmNew, setCmNew] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<any>(null);

  // New interactive column filter states
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(CATALOG_HEADERS));
  const [showColumnFilter, setShowColumnFilter] = useState(false);

  useEffect(() => {
    if (snapshots.length >= 2) {
      if (!cmOld) setCmOld(snapshots[0]);
      if (!cmNew) setCmNew(snapshots[snapshots.length - 1]);
    }
  }, [snapshots.length]);

  const runAnalysis = async () => {
    if (!cmOld || !cmNew) return alert("Select both a Baseline and a Target snapshot.");
    setIsAnalyzing(true);
    
    const oldData = parseCSVTable(await safeGetFileContent(cmOld, 'snapshots/')).map(unpackRecord);
    const newData = parseCSVTable(await safeGetFileContent(cmNew, 'snapshots/')).map(unpackRecord);

    const oldMap = new Map(oldData.map(r => [r.asin || r.ASIN, r]));
    
    const changeLog: any[] = [];
    const columnChangeCounts: Record<string, number> = {};
    let totalAnalyzed = 0;
    const affectedAsins = new Set<string>();

    const getField = (row: any, header: string) => {
      const found = Object.keys(row).find(k => k.toLowerCase() === header.toLowerCase());
      return found ? String(row[found] || '').trim() : undefined;
    };

    newData.forEach(newRow => {
      const asin = newRow.asin || newRow.ASIN;
      if (!asin) return;
      const oldRow = oldMap.get(asin);
      if (!oldRow) return;

      totalAnalyzed++;
      let hasChange = false;

      CATALOG_HEADERS.forEach(col => {
        if (col.toLowerCase() === 'asin' || col.toLowerCase() === 'run') return; 

        const oldVal = getField(oldRow, col);
        const newVal = getField(newRow, col);

        if (oldVal !== undefined && newVal !== undefined && oldVal !== newVal) {
          hasChange = true;
          columnChangeCounts[col] = (columnChangeCounts[col] || 0) + 1;

          changeLog.push({ 
            ASIN: asin, 
            "Flag Type": col, 
            "Baseline (Old)": oldVal, 
            "Target (New)": newVal 
          });
        }
      });

      if (hasChange) affectedAsins.add(asin);
    });

    setResults({
      totalAnalyzed,
      totalFlags: changeLog.length,
      affectedAsinsCount: affectedAsins.size,
      columnChangeCounts,
      changeLog
    });
    setIsAnalyzing(false);
  };

  // Apply the interactive filter to the change log instantly (saves processing power)
  const filteredChangeLog = useMemo(() => {
    if (!results) return [];
    return results.changeLog.filter((row: any) => visibleColumns.has(row["Flag Type"]));
  }, [results, visibleColumns]);

  // Re-aggregate the pie chart dynamically based on the filtered change log
  const filteredPieData = useMemo(() => {
    if (!results) return [];
    const tempCounts: Record<string, number> = {};
    filteredChangeLog.forEach((row: any) => {
      tempCounts[row["Flag Type"]] = (tempCounts[row["Flag Type"]] || 0) + 1;
    });
    return Object.entries(tempCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a: any, b: any) => b.value - a.value);
  }, [filteredChangeLog]);

  const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#0ea5e9', '#6366f1', '#84cc16', '#eab308'];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Catalog Monitor & Alert Dashboard</h2>
        <p className="text-slate-500 mt-1">Automatically detect unauthorized changes across all 71 catalog data points.</p>
      </div>

      <Card className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Baseline Snapshot (Safe State)</label>
            <select className="w-full border-slate-300 p-2 border rounded-md bg-white text-sm" value={cmOld} onChange={e => setCmOld(e.target.value)}>
              {snapshots.length === 0 && <option value="">No snapshots found</option>}
              {snapshots.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Target Snapshot (Current State)</label>
            <select className="w-full border-slate-300 p-2 border rounded-md bg-white text-sm" value={cmNew} onChange={e => setCmNew(e.target.value)}>
              {snapshots.length === 0 && <option value="">No snapshots found</option>}
              {snapshots.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-start border-t pt-4 mt-2">
          <Button onClick={runAnalysis} disabled={isAnalyzing} className="w-full sm:w-auto">
            {isAnalyzing ? 'Scanning Catalog...' : 'Run Full Catalog Scan'}
          </Button>
        </div>
      </Card>

      {results && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="p-6 flex flex-col items-center justify-center bg-blue-50/50 border-blue-200">
              <p className="text-sm font-bold text-blue-800 uppercase tracking-wider">Total ASINs Scanned</p>
              <p className="text-5xl font-black text-blue-600 mt-2">{results.totalAnalyzed}</p>
            </Card>
            <Card className="p-6 flex flex-col items-center justify-center bg-red-50/50 border-red-200">
              <p className="text-sm font-bold text-red-800 uppercase tracking-wider">Visible Flags</p>
              <p className="text-5xl font-black text-red-600 mt-2">{filteredChangeLog.length}</p>
            </Card>
            <Card className="p-6 flex flex-col items-center justify-center bg-amber-50/50 border-amber-200">
              <p className="text-sm font-bold text-amber-800 uppercase tracking-wider">Affected Listings</p>
              <p className="text-5xl font-black text-amber-600 mt-2">{new Set(filteredChangeLog.map((r: any) => r.ASIN)).size}</p>
            </Card>
          </div>

          {filteredChangeLog.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="p-6 lg:col-span-1 flex flex-col items-center">
                <h3 className="font-bold text-slate-800 mb-4 w-full border-b pb-2">Flag Distribution</h3>
                <div className="w-full h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={filteredPieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value">
                        {filteredPieData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                      <Legend verticalAlign="bottom" height={72} wrapperStyle={{ fontSize: '12px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-6 lg:col-span-2 flex flex-col">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 border-b pb-2 gap-4">
                  <h3 className="font-bold text-slate-800">Catalog Change Ledger</h3>
                  
                  <div className="flex items-center space-x-2 relative">
                    <Button variant="secondary" onClick={() => setShowColumnFilter(!showColumnFilter)} className="bg-white border text-xs py-1.5 px-3">
                      <List className="w-3 h-3 mr-2" /> Filter Flags ({visibleColumns.size}/{CATALOG_HEADERS.length})
                    </Button>
                    
                    {showColumnFilter && (
                      <div className="absolute right-[110px] top-10 bg-white border border-slate-200 shadow-xl rounded-lg p-4 w-72 max-h-96 flex flex-col animate-in slide-in-from-top-2 z-50">
                        <div className="flex justify-between items-center mb-3">
                          <h4 className="font-bold text-slate-800">Attributes to Monitor</h4>
                          <div className="flex space-x-2">
                            <button onClick={() => setVisibleColumns(new Set(CATALOG_HEADERS))} className="text-xs text-blue-600 hover:underline">All</button>
                            <button onClick={() => setVisibleColumns(new Set())} className="text-xs text-slate-500 hover:underline">Clear</button>
                          </div>
                        </div>
                        <div className="overflow-y-auto flex-1 space-y-2 pr-2 text-left">
                          {CATALOG_HEADERS.map(col => (
                            <label key={col} className="flex items-center space-x-2 text-xs text-slate-700 hover:bg-slate-50 p-1 rounded cursor-pointer">
                              <input 
                                type="checkbox" 
                                checked={visibleColumns.has(col)} 
                                onChange={() => {
                                  const next = new Set(visibleColumns);
                                  if (next.has(col)) next.delete(col);
                                  else next.add(col);
                                  setVisibleColumns(next);
                                }}
                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="truncate" title={col}>{col}</span>
                            </label>
                          ))}
                        </div>
                        <Button onClick={() => setShowColumnFilter(false)} className="mt-3 w-full py-1.5 text-xs">Apply Filters</Button>
                      </div>
                    )}

                    <Button onClick={() => downloadCSV(filteredChangeLog, `catalog_monitor_flags.csv`)} className="py-1.5 px-3 text-xs"><Download className="w-3 h-3 mr-1" /> Export</Button>
                  </div>
                </div>

                <div className="overflow-x-auto flex-1 max-h-[350px]">
                  <table className="w-full text-xs text-left whitespace-nowrap">
                    <thead className="bg-slate-50 sticky top-0 shadow-sm text-slate-700">
                      <tr><th className="p-2">ASIN</th><th className="p-2">Flagged Column</th><th className="p-2">Baseline (Safe)</th><th className="p-2">Target (Current)</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredChangeLog.map((r: any, i: number) => {
                        let rowColor = 'hover:bg-slate-50';
                        if (r["Flag Type"].toLowerCase().includes('price') || r["Flag Type"].toLowerCase().includes('cost')) rowColor = 'bg-amber-50 hover:bg-amber-100 text-amber-900';
                        if (r["Flag Type"].toLowerCase().includes('buy box') || r["Flag Type"].toLowerCase().includes('badge')) rowColor = 'bg-purple-50 hover:bg-purple-100 text-purple-900 font-medium';
                        return (
                          <tr key={i} className={rowColor}>
                            <td className="p-2 font-mono font-bold text-slate-800">{r.ASIN}</td>
                            <td className="p-2 font-semibold">{r["Flag Type"]}</td>
                            <td className="p-2 truncate max-w-[200px] text-emerald-700">{r["Baseline (Old)"]}</td>
                            <td className="p-2 truncate max-w-[200px] text-red-700">{r["Target (New)"]}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ) : (
            <Card className="p-12 text-center text-slate-500 border-dashed bg-emerald-50">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-emerald-500" />
              <h2 className="text-xl font-bold text-emerald-800 mb-2">Catalog is Secure</h2>
              <p className="text-emerald-700">No unauthorized changes were detected for your selected attributes between the snapshots.</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ==========================================
// 14. MAIN APPLICATION WRAPPER
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