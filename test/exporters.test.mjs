import { test } from "node:test"; import assert from "node:assert/strict";
import { matrixToTSV, matrixToCSV, matrixToAOA, exportFilename } from "../lib/exporters.mjs";
const s=[["경기 일자","상대팀","결과"],["6월 12일","체코","승리"],["6월 19일","멕시코","패배"]];
test("TSV", () => assert.equal(matrixToTSV(s),"경기 일자\t상대팀\t결과\n6월 12일\t체코\t승리\n6월 19일\t멕시코\t패배"));
test("TSV 내부 치환", () => assert.equal(matrixToTSV([["a\tb","c\nd"]]),"a b\tc d"));
test("CSV", () => assert.equal(matrixToCSV([["a,b",'c"d']]),'"a,b","c""d"'));
test("AOA", () => assert.deepEqual(matrixToAOA([[1,null,"x"]]),[["1","","x"]]));
test("파일명", () => assert.equal(exportFilename("xlsx",new Date(2026,5,22)),"stella_표_20260622.xlsx"));
