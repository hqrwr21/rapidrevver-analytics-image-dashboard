"use client";

import React, { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import JSZip from "jszip";
import { AlertTriangle, Download, FileSpreadsheet, UploadCloud } from "lucide-react";
import { deleteFileFromB2 } from "../actions/b2";
import {
  dualLinks,
  indexCatalog,
  parseBulkCsv,
  previewBulkRows,
  templateCsv,
  type BulkAction,
  type BulkMatch,
  type BulkPreviewRow,
  type CatalogImage,
} from "../../lib/image-bulk";
import { Button, Card } from "./ui";

type EditableRow = BulkPreviewRow & {
  included: boolean;
  fileOn: Record<string, boolean>;
};

type ResultLine = {
  line: number;
  partNumber: string;
  brand: string;
  albumName: string;
  action: string;
  file: string;
  matchedAlbum: string;
  matchedBrand: string;
  result: "success" | "failure" | "skipped";
  reason: string;
};

const ACTION_OPTIONS: { value: BulkAction; label: string }[] = [
  { value: "delete", label: "delete" },
  { value: "download", label: "download" },
  { value: "get_links", label: "get_links" },
];

function toEditable(rows: BulkPreviewRow[]): EditableRow[] {
  return rows.map((row) => ({
    ...row,
    included: row.status === "found",
    fileOn: Object.fromEntries(row.matches.map((match) => [match.id, true])),
  }));
}

function selectedMatches(row: EditableRow): BulkMatch[] {
  if (!row.included || !row.action) return [];
  return row.matches.filter((match) => row.fileOn[match.id]);
}

function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resultsCsv(lines: ResultLine[]): string {
  const header = "line,part_number,brand,album_name,action,file,matched_album,matched_brand,result,reason";
  const body = lines.map((line) =>
    [line.line, line.partNumber, line.brand, line.albumName, line.action, line.file, line.matchedAlbum, line.matchedBrand, line.result, line.reason]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header, ...body].join("\n");
}

export default function ImageBulkActions({
  imagesWithDetails,
  onChanged,
}: {
  imagesWithDetails: CatalogImage[];
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileLabel, setFileLabel] = useState("");
  const [parseError, setParseError] = useState("");
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ResultLine[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [links, setLinks] = useState<{ name: string; album: string; link1: string; link2: string }[] | null>(null);

  const catalog = useMemo(() => indexCatalog(imagesWithDetails || []), [imagesWithDetails]);

  const chosen = useMemo(() => rows.flatMap((row) => selectedMatches(row).map((match) => ({ row, match }))), [rows]);
  const deleteCount = chosen.filter((item) => item.row.action === "delete").length;

  const applyPreview = (text: string, label: string) => {
    const parsed = parseBulkCsv(text);
    setFileLabel(label);
    setResults(null);
    setLinks(null);
    if (parsed.error) {
      setParseError(parsed.error);
      setRows([]);
      return;
    }
    setParseError("");
    setRows(toEditable(previewBulkRows(parsed.rows, catalog)));
  };

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    applyPreview(await file.text(), file.name);
    event.target.value = "";
  };

  const setRow = (line: number, update: (row: EditableRow) => EditableRow) => {
    setRows((current) => current.map((row) => (row.line === line ? update(row) : row)));
  };

  const run = async () => {
    if (deleteCount > 0 && confirmText !== "DELETE") {
      setConfirmOpen(true);
      return;
    }
    setConfirmOpen(false);
    setRunning(true);
    const report: ResultLine[] = [];
    const zip = new JSZip();
    let zipCount = 0;
    const linkRows: { name: string; album: string; link1: string; link2: string }[] = [];

    for (const row of rows) {
      const brand = row.brand || "";
      if (row.status === "invalid") {
        report.push({ line: row.line, partNumber: row.partNumber, brand, albumName: row.album, action: row.actionRaw, file: "", matchedAlbum: "", matchedBrand: "", result: "failure", reason: row.errors.join("; ") });
        continue;
      }
      if (row.status === "not_found") {
        report.push({ line: row.line, partNumber: row.partNumber, brand, albumName: row.album, action: row.action || row.actionRaw, file: "", matchedAlbum: "", matchedBrand: "", result: "failure", reason: "No matching files" });
        continue;
      }
      for (const match of row.matches) {
        const base = { line: row.line, partNumber: row.partNumber, brand, albumName: row.album, action: row.action || "", file: match.fileName, matchedAlbum: match.album, matchedBrand: match.brand };
        if (!row.included || !row.fileOn[match.id] || !row.action) {
          report.push({ ...base, result: "skipped", reason: "Unticked before run" });
          continue;
        }
        if (row.action === "delete") {
          try {
            const folder = match.album === "Uncategorized" ? "images/" : `images/${match.album}/`;
            await deleteFileFromB2(match.fileName, folder);
            report.push({ ...base, result: "success", reason: "Deleted" });
          } catch (error) {
            report.push({ ...base, result: "failure", reason: error instanceof Error ? error.message : "Delete failed" });
          }
        } else if (row.action === "download") {
          try {
            const folder = match.album === "Uncategorized" ? "images/" : `images/${match.album}/`;
            const url = `/api/b2?bucket=${encodeURIComponent(match.bucket)}&folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(match.fileName)}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Download failed (${response.status})`);
            zip.file(`${match.brand}/${match.album}/${match.fileName}`, await response.blob());
            zipCount += 1;
            report.push({ ...base, result: "success", reason: "Added to ZIP" });
          } catch (error) {
            report.push({ ...base, result: "failure", reason: error instanceof Error ? error.message : "Download failed" });
          }
        } else {
          const pair = dualLinks(match);
          linkRows.push({ name: match.fileName, album: match.album, ...pair });
          report.push({ ...base, result: "success", reason: "Links generated" });
        }
      }
    }

    if (zipCount > 0) {
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "image-bulk-download.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }
    if (linkRows.length > 0) setLinks(linkRows);
    if (report.some((line) => line.action === "delete" && line.result === "success")) onChanged();
    setResults(report);
    setConfirmText("");
    setRunning(false);
  };

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-6">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Bulk actions</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Upload a CSV of part numbers to delete duplicates, download matches, or copy links. A blank album applies the row to every album. The library is listed once, then matched in memory.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button variant="outline" onClick={() => downloadText("image-bulk-template.csv", templateCsv())}>
            <Download className="mr-2 h-4 w-4" /> Download template
          </Button>
          <Button onClick={() => fileRef.current?.click()}>
            <UploadCloud className="mr-2 h-4 w-4" /> Upload CSV
          </Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          {fileLabel ? <span className="truncate text-sm text-slate-500">{fileLabel}</span> : null}
        </div>
        {catalog.length === 0 ? (
          <p className="text-sm text-amber-700">The image library has not loaded yet. Wait for it, then upload the CSV again so matches can be found.</p>
        ) : (
          <p className="text-sm text-slate-500">{catalog.length.toLocaleString()} images indexed across the brand buckets.</p>
        )}
        {parseError ? <p className="text-sm font-medium text-red-700" role="alert">{parseError}</p> : null}
      </Card>

      {rows.length > 0 ? (
        <Card className="space-y-4 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-800">Preview</h3>
              <p className="mt-1 text-sm text-slate-500">
                {rows.filter((row) => row.status === "found").length} found, {rows.filter((row) => row.status === "not_found").length} not found, {rows.filter((row) => row.status === "invalid").length} invalid. {chosen.length} files selected.
              </p>
            </div>
            <Button onClick={run} disabled={running || chosen.length === 0}>
              {running ? "Running..." : `Run ${chosen.length} file${chosen.length === 1 ? "" : "s"}`}
            </Button>
          </div>
          {rows.some((row) => row.deleteAllAlbums && row.included) ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Red rows delete from every album. Untick them or set an album if that is not what you want.</span>
            </div>
          ) : null}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2">Use</th>
                  <th className="p-2">Part</th>
                  <th className="p-2">Brand</th>
                  <th className="p-2">Album</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Matches</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const danger = row.deleteAllAlbums;
                  return (
                    <tr key={row.line} className={danger ? "bg-red-50" : "border-t border-slate-100"}>
                      <td className="p-2 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Include row ${row.line}`}
                          checked={row.included}
                          disabled={row.status !== "found"}
                          onChange={(event) => setRow(row.line, (current) => ({
                            ...current,
                            included: event.target.checked,
                            fileOn: Object.fromEntries(current.matches.map((match) => [match.id, event.target.checked])),
                          }))}
                        />
                      </td>
                      <td className="p-2 align-top font-medium text-slate-900">
                        {row.partNumber || "—"}
                        {row.duplicate ? <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-amber-700">Duplicate row</span> : null}
                      </td>
                      <td className="p-2 align-top text-slate-600">{row.brand || "All brands"}</td>
                      <td className={`p-2 align-top ${danger ? "font-semibold text-red-700" : "text-slate-600"}`}>{row.album || "All albums"}</td>
                      <td className="p-2 align-top">
                        <select
                          aria-label={`Action for ${row.partNumber || "row"}`}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1"
                          value={row.action || ""}
                          onChange={(event) => {
                            const action = event.target.value as BulkAction;
                            setRow(row.line, (current) => {
                              const errors = current.errors.filter((error) => !error.startsWith("Unrecognized action"));
                              const status = errors.length > 0 ? "invalid" : current.matches.length > 0 ? "found" : current.core ? "not_found" : "invalid";
                              return {
                                ...current,
                                action,
                                errors,
                                status,
                                deleteAllAlbums: action === "delete" && current.album.trim() === "",
                                included: status === "found" ? true : false,
                              };
                            });
                          }}
                        >
                          {!row.action ? <option value="">Invalid</option> : null}
                          {ACTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </td>
                      <td className="p-2 align-top">
                        <span className={`rounded-full px-2 py-0.5 font-semibold ${row.status === "found" ? "bg-emerald-100 text-emerald-800" : row.status === "invalid" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                          {row.status === "not_found" ? "not found" : row.status === "invalid" ? "invalid" : "found"}
                        </span>
                        {row.errors.length > 0 ? <span className="mt-1 block text-red-700">{row.errors.join("; ")}</span> : null}
                      </td>
                      <td className="p-2 align-top">
                        <p className="mb-1 font-medium text-slate-700">{row.matches.length} file{row.matches.length === 1 ? "" : "s"}</p>
                        {row.matches.length > 0 ? (
                          <ul className="max-h-36 space-y-1 overflow-y-auto pr-1">
                            {row.matches.map((match) => (
                              <li key={match.id} className="flex items-start gap-2">
                                <input
                                  type="checkbox"
                                  aria-label={`${match.fileName} in ${match.album}`}
                                  checked={!!row.fileOn[match.id]}
                                  onChange={(event) => setRow(row.line, (current) => {
                                    const fileOn = { ...current.fileOn, [match.id]: event.target.checked };
                                    return { ...current, fileOn, included: Object.values(fileOn).some(Boolean) };
                                  })}
                                />
                                <span>
                                  <span className="font-medium text-slate-800">{match.fileName}</span>
                                  <span className="block text-slate-500">{match.brand} · {match.album}</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {results ? (
        <Card className="space-y-3 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-800">Results</h3>
              <p className="mt-1 text-sm text-slate-500">
                {results.filter((line) => line.result === "success").length} succeeded, {results.filter((line) => line.result === "failure").length} failed, {results.filter((line) => line.result === "skipped").length} skipped.
              </p>
            </div>
            <Button variant="outline" onClick={() => downloadText("image-bulk-results.csv", resultsCsv(results))}>
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Download results CSV
            </Button>
          </div>
          <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2">Line</th>
                  <th className="p-2">Part</th>
                  <th className="p-2">File</th>
                  <th className="p-2">Result</th>
                  <th className="p-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {results.map((line, index) => (
                  <tr key={`${line.line}-${line.file}-${index}`} className="border-t border-slate-100">
                    <td className="p-2">{line.line}</td>
                    <td className="p-2 font-medium text-slate-800">{line.partNumber}</td>
                    <td className="p-2 text-slate-600">{line.file || "—"}</td>
                    <td className={`p-2 font-semibold ${line.result === "success" ? "text-emerald-700" : line.result === "failure" ? "text-red-700" : "text-slate-500"}`}>{line.result}</td>
                    <td className="p-2 text-slate-600">{line.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {confirmOpen ? createPortal(
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-title">
            <h3 id="bulk-delete-title" className="text-lg font-semibold text-slate-900">Delete {deleteCount} file{deleteCount === 1 ? "" : "s"}?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">Only ticked files are deleted. This cannot be undone. Type DELETE to confirm.</p>
            <input
              aria-label="Type DELETE to confirm"
              className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="DELETE"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setConfirmOpen(false); setConfirmText(""); }}>Cancel</Button>
              <Button variant="danger" disabled={confirmText !== "DELETE" || running} onClick={run}>Delete files</Button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      {links ? createPortal(
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-4 backdrop-blur-sm sm:pt-6">
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 p-5">
              <h3 className="text-lg font-semibold text-slate-800">Links generated ({links.length})</h3>
              <button type="button" aria-label="Close links" className="rounded-full p-1 text-slate-400 hover:bg-slate-200" onClick={() => setLinks(null)}>×</button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto bg-white p-6">
              {links.map((item, index) => (
                <div key={`${item.album}-${item.name}-${index}`} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                  <span className="block truncate font-bold text-slate-800">{item.album} / {item.name}</span>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div className="flex items-center justify-between rounded border bg-white p-2">
                      <span className="truncate pr-2 text-[10px] font-semibold text-blue-600">{item.link1}</span>
                      <button type="button" className="whitespace-nowrap text-[10px] font-bold text-slate-600 hover:text-blue-600" onClick={() => navigator.clipboard.writeText(item.link1)}>Copy</button>
                    </div>
                    <div className="flex items-center justify-between rounded border bg-white p-2">
                      <span className="truncate pr-2 text-[10px] font-semibold text-amber-600">{item.link2}</span>
                      <button type="button" className="whitespace-nowrap text-[10px] font-bold text-slate-600 hover:text-amber-600" onClick={() => navigator.clipboard.writeText(item.link2)}>Copy</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 p-4">
              <Button variant="outline" onClick={() => setLinks(null)}>Close</Button>
              <Button variant="outline" onClick={() => downloadText("image-bulk-links.csv", ["file,album,link_1,link_2", ...links.map((item) => `"${item.name.replace(/"/g, '""')}","${item.album.replace(/"/g, '""')}","${item.link1}","${item.link2}"`)].join("\n"))}>
                Export links CSV
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
