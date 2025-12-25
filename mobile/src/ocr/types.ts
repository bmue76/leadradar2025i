// mobile/src/ocr/types.ts

export type OcrEngine = "expo-text-extractor";

export type RecognizeTextInput = {
  base64: string; // WITHOUT data: prefix
  mimeType?: string;
  filename?: string;
};

export type RecognizeTextResult = {
  engine: OcrEngine;
  rawText: string;
  lines: string[];
  elapsedMs?: number;
  notes?: string[];
};

export type BusinessCardField = "email" | "phone" | "url" | "name" | "company";

/** Backward compatible alias (CaptureScreen uses this name) */
export type OcrFieldKey = BusinessCardField;

export type BusinessCardCandidates = {
  emails: string[];
  phones: string[];
  urls: string[];
  names: string[];
  companies: string[];
};

export type BusinessCardCore = {
  email?: string;
  phone?: string;
  url?: string;
  name?: string;
  company?: string;

  confidence?: Partial<Record<BusinessCardField, number>>;
  notes?: string[];
  candidates?: BusinessCardCandidates;
};

export type BusinessCardExtracted = BusinessCardCore & {
  extracted: BusinessCardCore;
};

export type LeadOcrMeta = {
  /**
   * CaptureScreen schreibt aktuell zusätzliche Keys (version/provider/createdAt/confidence/...).
   * Damit wir nicht bei jedem neuen Key TS-Fehler bekommen:
   */
  [k: string]: unknown;

  version?: number;
  provider?: string;
  createdAt?: string;

  /**
   * In der UI wird meta aktuell ohne engine/at geschrieben → optional für MVP/Kompat.
   * (Später können wir CaptureScreen auf engine/at setzen und wieder "required" machen.)
   */
  engine?: OcrEngine;
  at?: string; // ISO

  rawText: string;
  extracted: BusinessCardCore;

  /** some UI code keeps confidence top-level */
  confidence?: Partial<Record<BusinessCardField, number>>;

  notes?: string[];
};

/** Backward compatible alias (CaptureScreen uses this name) */
export type LeadOcrMetaV1 = LeadOcrMeta;
