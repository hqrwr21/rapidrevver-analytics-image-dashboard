export type ImageBrand = "OxGord" | "MotorUp" | "FuelRider";
export type BulkAction = "delete" | "download" | "get_links";

export const IMAGE_BUCKETS: Record<ImageBrand, string> = {
  OxGord: "oxgord-media",
  MotorUp: "motorup-media",
  FuelRider: "fuelrider-media",
};

export type CatalogImage = {
  /** Path under images/, usually "Album/file.jpg". */
  name: string;
  bucket?: string;
};

export type IndexedImage = {
  album: string;
  fileName: string;
  brand: ImageBrand;
  bucket: string;
  core: string;
};

export type BulkRowStatus = "found" | "not_found" | "invalid";

export type ParsedBulkRow = {
  line: number;
  partNumber: string;
  brandRaw: string;
  albumRaw: string;
  actionRaw: string;
  brand: ImageBrand | null;
  album: string;
  action: BulkAction | null;
  core: string;
  errors: string[];
};

export type BulkMatch = IndexedImage & { id: string };

export type BulkPreviewRow = ParsedBulkRow & {
  status: BulkRowStatus;
  duplicate: boolean;
  deleteAllAlbums: boolean;
  matches: BulkMatch[];
};

const PACK_TOKEN = /^(?:x[14]|x|1pc|01pc|4pcs|set\d*|pc)$/i;

/** Case-insensitive key with spaces, dashes, dots, and underscores removed. */
export function normalizePartNumber(value: string): string {
  return value.toLowerCase().replace(/[\s.\-_]+/g, "");
}

function isAsin(token: string): boolean {
  return /^B0[A-Z0-9]{8}$/i.test(token);
}

/**
 * Core part number for a stored file name.
 * Strips the extension, a leading "FR " token, a leading ASIN when another
 * part follows it, pack suffixes (X1/X4, -X-1pc, 1pc, set), and _2-style
 * copy indexes. The result is exact-match normalized, not a substring.
 */
export function corePartNumber(fileName: string): string {
  const baseName = fileName.split("/").pop() || fileName;
  let name = baseName.replace(/\.[^.]+$/, "").trim();
  name = name.replace(/\s*\(\d{1,2}\)\s*$/, "");
  while (/(?:[\s_]+)\d{1,2}$/.test(name)) name = name.replace(/(?:[\s_]+)\d{1,2}$/, "");
  name = name.replace(/^FR[\s._-]+/i, "");

  const tokens = name.split(/[\s._-]+/).filter(Boolean);
  while (tokens.length > 1 && PACK_TOKEN.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  if (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    const stripped = last.replace(/x[14]$/i, "");
    if (stripped.length >= 2 && stripped !== last) {
      const withoutFinishX = stripped.replace(/x$/i, "");
      tokens[tokens.length - 1] = withoutFinishX.length >= 2 ? withoutFinishX : stripped;
    }
  }
  if (tokens.length > 1 && isAsin(tokens[0])) tokens.shift();

  return normalizePartNumber(tokens.join(""));
}

export function parseAction(value: string): BulkAction | null {
  const compact = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "delete") return "delete";
  if (compact === "download") return "download";
  if (compact === "getlinks") return "get_links";
  return null;
}

export function parseBrand(value: string): ImageBrand | null | "invalid" {
  const compact = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!compact) return null;
  if (compact === "fuelrider" || compact === "fr" || compact === "fuelridermedia") return "FuelRider";
  if (compact === "motorup" || compact === "mua" || compact === "motorupmedia") return "MotorUp";
  if (compact === "oxgord" || compact === "ox" || compact === "oxgordmedia") return "OxGord";
  return "invalid";
}

export function parseCsv(text: string): string[][] {
  let source = text;
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  return rows;
}

function headerName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function parseBulkCsv(text: string): { rows: ParsedBulkRow[]; error?: string } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], error: "The CSV is empty." };
  const headers = table[0].map(headerName);
  const partIndex = headers.findIndex((header) =>
    ["part_number", "partnumber", "part_no", "part", "part_num"].includes(header),
  );
  const brandIndex = headers.findIndex((header) => header === "brand");
  const actionIndex = headers.findIndex((header) => header === "action");
  const albumIndex = headers.findIndex((header) =>
    ["album_name", "album", "folder", "albumname"].includes(header),
  );
  if (partIndex === -1 || actionIndex === -1) {
    return { rows: [], error: "CSV needs part_number and action columns." };
  }

  const rows: ParsedBulkRow[] = [];
  table.slice(1).forEach((cells, index) => {
    if (cells.every((cell) => cell.trim() === "")) return;
    const partNumber = (cells[partIndex] || "").trim();
    const brandRaw = brandIndex >= 0 ? (cells[brandIndex] || "").trim() : "";
    const actionRaw = (cells[actionIndex] || "").trim();
    const albumRaw = albumIndex >= 0 ? (cells[albumIndex] || "").trim() : "";
    const brand = parseBrand(brandRaw);
    const action = parseAction(actionRaw);
    const errors: string[] = [];
    if (!partNumber) errors.push("Missing part number");
    if (!action) errors.push(`Unrecognized action "${actionRaw || ""}"`);
    if (brand === "invalid") errors.push(`Unrecognized brand "${brandRaw}"`);
    rows.push({
      line: index + 2,
      partNumber,
      brandRaw,
      albumRaw,
      actionRaw,
      brand: brand === "invalid" ? null : brand,
      album: albumRaw,
      action,
      core: partNumber ? normalizePartNumber(partNumber) : "",
      errors,
    });
  });
  if (rows.length === 0) return { rows: [], error: "No data rows found." };
  return { rows };
}

export function brandForImage(album: string, bucket?: string): ImageBrand {
  if (bucket === IMAGE_BUCKETS.FuelRider || album.includes("[FR]")) return "FuelRider";
  if (bucket === IMAGE_BUCKETS.MotorUp || album.includes("[MUA]")) return "MotorUp";
  return "OxGord";
}

export function indexCatalog(files: CatalogImage[]): IndexedImage[] {
  return files.flatMap((file) => {
    const raw = file.name || "";
    if (!raw || raw.endsWith("/")) return [];
    const slash = raw.lastIndexOf("/");
    const album = slash >= 0 ? raw.slice(0, slash) : "Uncategorized";
    const fileName = slash >= 0 ? raw.slice(slash + 1) : raw;
    if (!fileName) return [];
    const brand = brandForImage(album, file.bucket);
    return [{
      album,
      fileName,
      brand,
      bucket: file.bucket || IMAGE_BUCKETS[brand],
      core: corePartNumber(fileName),
    }];
  });
}

export function previewBulkRows(rows: ParsedBulkRow[], catalog: IndexedImage[]): BulkPreviewRow[] {
  const byCore = new Map<string, IndexedImage[]>();
  catalog.forEach((image) => {
    const list = byCore.get(image.core);
    if (list) list.push(image);
    else byCore.set(image.core, [image]);
  });

  const seen = new Map<string, number>();
  rows.forEach((row) => {
    const key = `${row.core}|${row.brand || "*"}|${row.album.toLowerCase() || "*"}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  });

  return rows.map((row) => {
    const key = `${row.core}|${row.brand || "*"}|${row.album.toLowerCase() || "*"}`;
    const duplicate = (seen.get(key) || 0) > 1;
    const deleteAllAlbums = row.action === "delete" && row.album.trim() === "";
    if (row.errors.length > 0 || !row.action || !row.core) {
      return { ...row, status: "invalid", duplicate, deleteAllAlbums, matches: [] };
    }
    const albumQuery = row.album.trim().toLowerCase();
    const matches = (byCore.get(row.core) || [])
      .filter((image) => (row.brand ? image.brand === row.brand : true))
      .filter((image) => (albumQuery ? image.album.toLowerCase() === albumQuery : true))
      .map((image, index) => ({
        ...image,
        id: `${row.line}-${index}-${image.bucket}-${image.album}-${image.fileName}`,
      }));
    return {
      ...row,
      status: matches.length > 0 ? "found" : "not_found",
      duplicate,
      deleteAllAlbums,
      matches,
    };
  });
}

export function templateCsv(): string {
  return [
    "part_number,brand,action,album_name",
    "44115S,FuelRider,delete,[FR] Hubcaps",
    "GI127,,get_links,",
    "IMP369,OxGord,download,",
  ].join("\n");
}

export function dualLinks(image: Pick<IndexedImage, "album" | "fileName" | "bucket">): { link1: string; link2: string } {
  const safeAlbum = image.album === "Uncategorized" ? "" : `${encodeURIComponent(image.album)}/`;
  const objectPath = `images/${safeAlbum}${encodeURIComponent(image.fileName)}`;
  return {
    link1: `https://${image.bucket}.s3.us-west-004.backblazeb2.com/${objectPath}`,
    link2: `https://s3.us-west-004.backblazeb2.com/${image.bucket}/${objectPath}`,
  };
}
