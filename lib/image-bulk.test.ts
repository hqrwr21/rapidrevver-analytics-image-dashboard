import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  corePartNumber,
  indexCatalog,
  normalizePartNumber,
  parseBulkCsv,
  previewBulkRows,
  type CatalogImage,
} from "./image-bulk.ts";

describe("normalizePartNumber", () => {
  it("ignores case, spaces, dashes, dots, and underscores", () => {
    assert.equal(normalizePartNumber("44115-S"), "44115s");
    assert.equal(normalizePartNumber("44115 S"), "44115s");
    assert.equal(normalizePartNumber("44115_S"), "44115s");
    assert.equal(normalizePartNumber("44115.S"), "44115s");
    assert.equal(normalizePartNumber("44115S"), "44115s");
  });
});

describe("corePartNumber", () => {
  const same = (file: string, part: string) => {
    assert.equal(corePartNumber(file), normalizePartNumber(part), file);
  };

  it("strips pack suffixes but keeps the finish code", () => {
    same("44115SX1.jpg", "44115S");
    same("44115SX4.jpg", "44115S");
    same("44115S.jpg", "44115S");
    same("54816BLK_X4.jpg", "54816BLK");
    same("IMP445BLKx4.jpg", "IMP445BLK");
    same("images/[FR] Hubcaps/44115SX1.jpg", "44115S");
  });

  it("does not treat a longer number as the same part", () => {
    assert.notEqual(corePartNumber("441150.jpg"), normalizePartNumber("44115"));
    assert.notEqual(corePartNumber("44115SX1.jpg"), normalizePartNumber("44115"));
    assert.equal(corePartNumber("441150.jpg"), "441150");
  });

  it("strips 1pc pack markers, copy indexes, FR, and a leading ASIN", () => {
    same("IMP369-X-1pc.jpg", "IMP369");
    same("IMP365-BLK-1pc.jpg", "IMP365BLK");
    same("1516Sx1_2.jpg", "1516S");
    same("IMP347XX1_1.jpg", "IMP347");
    same("IMP369XX1.jpg", "IMP369");
    same("IMP369-X-4pcs.jpg", "IMP369");
    same("FR GI127.jpg", "GI127");
    same("GI127X1.jpg", "GI127");
    same("B07C8FX1PW B86314S.jpg", "B86314S");
    same("B07KBF8Y54 x4 2.jpg", "B07KBF8Y54");
    same("B0CLXV43G6.jpg", "B0CLXV43G6");
    same("1215X1.jpg", "1215");
    same("1215.jpg", "1215");
  });
});

describe("parseBulkCsv", () => {
  it("accepts BOM, quotes, blank rows, header case, and get links", () => {
    const csv = "\uFEFFpart Number, Brand, Action, Album Name\n" +
      "44115S, FuelRider, Delete, \"[FR] Hubcaps\"\n" +
      "\n" +
      "\"GI 127\",, get links,\n" +
      "IMP369, NotABrand, download,\n";
    const parsed = parseBulkCsv(csv);
    assert.equal(parsed.error, undefined);
    assert.equal(parsed.rows.length, 3);
    assert.equal(parsed.rows[0].core, "44115s");
    assert.equal(parsed.rows[0].brand, "FuelRider");
    assert.equal(parsed.rows[0].action, "delete");
    assert.equal(parsed.rows[0].album, "[FR] Hubcaps");
    assert.equal(parsed.rows[1].action, "get_links");
    assert.equal(parsed.rows[1].core, "gi127");
    assert.equal(parsed.rows[1].brand, null);
    assert.equal(parsed.rows[2].errors.some((error) => error.includes("brand")), true);
  });
});

describe("previewBulkRows", () => {
  const catalog: CatalogImage[] = [
    { name: "[FR] Hubcaps/44115SX1.jpg", bucket: "fuelrider-media" },
    { name: "[FR] Hubcaps/44115SX4.jpg", bucket: "fuelrider-media" },
    { name: "[FR] Hubcaps Before and After/44115S.jpg", bucket: "fuelrider-media" },
    { name: "[FR] Hubcaps/441150X1.jpg", bucket: "fuelrider-media" },
    { name: "[FR] Grille Inserts/FR GI127.jpg", bucket: "fuelrider-media" },
    { name: "[FR] Grille Inserts/GI127X1.jpg", bucket: "fuelrider-media" },
    { name: "OPH Wheel Simulators and Trim Rings/44115SX1.jpg", bucket: "oxgord-media" },
    { name: "[MUA] MUA Impostors/IMP369-X-1pc.jpg", bucket: "motorup-media" },
  ];

  it("matches the core part across albums and respects brand and album filters", () => {
    const parsed = parseBulkCsv([
      "part_number,brand,action,album_name",
      "44115S,FuelRider,delete,",
      "44115S,FuelRider,delete,[FR] Hubcaps",
      "44115,,get_links,",
      "GI127,,download,",
      "44115S,FuelRider,delete,",
      "NOPE,OxGord,download,",
    ].join("\n"));
    const indexed = indexCatalog(catalog);
    const preview = previewBulkRows(parsed.rows, indexed);
    assert.equal(preview[0].status, "found");
    assert.equal(preview[0].matches.length, 3);
    assert.equal(preview[0].deleteAllAlbums, true);
    assert.equal(preview[0].duplicate, true);
    assert.equal(preview[1].matches.length, 2);
    assert.equal(preview[1].matches.every((match) => match.album === "[FR] Hubcaps"), true);
    assert.equal(preview[2].status, "not_found");
    assert.equal(preview[3].matches.map((match) => match.fileName).sort().join(","), "FR GI127.jpg,GI127X1.jpg");
    assert.equal(preview[4].duplicate, true);
    assert.equal(preview[5].status, "not_found");
  });
});
