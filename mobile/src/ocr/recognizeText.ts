// mobile/src/ocr/recognizeText.ts
import * as FileSystem from "expo-file-system/legacy";
import { extractTextFromImage, isSupported } from "expo-text-extractor";
import type { RecognizeTextInput, RecognizeTextResult } from "./types";

function stripDataPrefix(b64: string): string {
  const s = String(b64 || "").trim();
  if (!s) return "";
  if (s.startsWith("data:")) {
    const idx = s.indexOf(",");
    if (idx >= 0) return s.slice(idx + 1);
  }
  return s;
}

function getBase64EncodingValue() {
  return ((FileSystem as any).EncodingType?.Base64 ?? "base64") as any;
}

function safeCacheDir(): string {
  return String(FileSystem.cacheDirectory || FileSystem.documentDirectory || "");
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function writeTempJpgFromBase64(base64: string): Promise<string> {
  const dir = safeCacheDir();
  if (!dir) throw new Error("No cacheDirectory/documentDirectory available for OCR temp file.");

  const uri = `${dir}lr-ocr-${randomId()}.jpg`;
  await FileSystem.writeAsStringAsync(uri, stripDataPrefix(base64), {
    encoding: getBase64EncodingValue(),
  } as any);

  return uri;
}

async function deleteLocalFile(uri: string) {
  try {
    await (FileSystem as any).deleteAsync(uri, { idempotent: true });
  } catch {
    // ignore
  }
}

function normalizeLines(lines: any): string[] {
  const safeLines = Array.isArray(lines) ? lines.map((l) => String(l || "")).filter(Boolean) : [];
  return safeLines;
}

/**
 * On-device OCR from business card (base64).
 */
export async function recognizeTextFromBusinessCard(input: RecognizeTextInput): Promise<RecognizeTextResult> {
  const t0 = Date.now();

  if (!isSupported) {
    throw new Error("OCR not supported on this device/runtime (expo-text-extractor: isSupported=false).");
  }

  const base64 = stripDataPrefix(input.base64 || "");
  if (!base64) throw new Error("No image base64 provided for OCR.");

  const tmpUri = await writeTempJpgFromBase64(base64);

  try {
    const lines = normalizeLines(await extractTextFromImage(tmpUri));
    const rawText = lines.join("\n").trim();

    return {
      engine: "expo-text-extractor",
      rawText,
      lines,
      elapsedMs: Date.now() - t0,
      notes: ["source=base64", "tempFile=cache"],
    };
  } finally {
    await deleteLocalFile(tmpUri);
  }
}

/**
 * Backward compatible API:
 * - CaptureScreen currently calls `recognizeText(tmpUri)` (string URI)
 * - Later we can switch to `recognizeText({ base64: card.base64 })`
 */
export async function recognizeText(input: string | RecognizeTextInput): Promise<RecognizeTextResult> {
  const t0 = Date.now();

  if (!isSupported) {
    throw new Error("OCR not supported on this device/runtime (expo-text-extractor: isSupported=false).");
  }

  if (typeof input === "string") {
    const uri = String(input || "").trim();
    if (!uri) throw new Error("No image uri provided for OCR.");

    const lines = normalizeLines(await extractTextFromImage(uri));
    const rawText = lines.join("\n").trim();

    return {
      engine: "expo-text-extractor",
      rawText,
      lines,
      elapsedMs: Date.now() - t0,
      notes: ["source=uri"],
    };
  }

  return recognizeTextFromBusinessCard(input);
}
