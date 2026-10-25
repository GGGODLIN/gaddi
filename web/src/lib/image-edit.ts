// The phone's half of "edit, then upload". Pure on purpose: the composer decides WHEN a file
// may leave, and these functions only answer whether a canvas exists, whether this file is one
// the editor should see, how crop and annotation geometry behave in normalised [0, 1] image
// coordinates, and whether a save payload is a real image. Nothing here talks to the network or
// to a pane.

import { attachmentKind, rejectAttachment } from "@/lib/attachments";
import type { UploadCapability } from "@/lib/types";

export const EDITOR_TOOLS = {
  crop: "crop",
  pen: "pen",
  ellipse: "ellipse",
  arrow: "arrow",
} as const;

export type EditorTool = (typeof EDITOR_TOOLS)[keyof typeof EDITOR_TOOLS];

export const DEFAULT_ANNOTATION_COLOR = "#ef4444";
export const MIN_CROP_SPAN = 0.05;

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FULL_CROP: CropBox = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

export type CropHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e" | "move" | "new";

export interface PenAnnotation {
  kind: "pen";
  points: readonly NormalizedPoint[];
  color: string;
}

export interface BoxAnnotation {
  kind: "ellipse" | "arrow";
  start: NormalizedPoint;
  end: NormalizedPoint;
  color: string;
}

export type EditorAnnotation = PenAnnotation | BoxAnnotation;

export interface EditorSnapshot {
  crop: CropBox;
  annotations: readonly EditorAnnotation[];
}

export interface EditorHistory {
  crop: CropBox;
  annotations: readonly EditorAnnotation[];
  undoStack: readonly EditorSnapshot[];
  redoStack: readonly EditorSnapshot[];
}

export const INITIAL_EDITOR_HISTORY: EditorHistory = {
  crop: FULL_CROP,
  annotations: [],
  undoStack: [],
  redoStack: [],
};

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function isFullCrop(crop: CropBox): boolean {
  return (
    Math.abs(crop.x) < 1e-4 &&
    Math.abs(crop.y) < 1e-4 &&
    Math.abs(crop.width - 1) < 1e-4 &&
    Math.abs(crop.height - 1) < 1e-4
  );
}

export function sameCropBox(a: CropBox, b: CropBox): boolean {
  return (
    Math.abs(a.x - b.x) < 1e-4 &&
    Math.abs(a.y - b.y) < 1e-4 &&
    Math.abs(a.width - b.width) < 1e-4 &&
    Math.abs(a.height - b.height) < 1e-4
  );
}

export function clampCropBox(crop: CropBox): CropBox {
  const width = Math.max(MIN_CROP_SPAN, Math.min(1, Number.isFinite(crop.width) ? crop.width : 1));
  const height = Math.max(MIN_CROP_SPAN, Math.min(1, Number.isFinite(crop.height) ? crop.height : 1));
  const x = Math.max(0, Math.min(1 - width, Number.isFinite(crop.x) ? crop.x : 0));
  const y = Math.max(0, Math.min(1 - height, Number.isFinite(crop.y) ? crop.y : 0));
  return { x, y, width, height };
}

export function hitCropHandle(
  crop: CropBox,
  pt: NormalizedPoint,
  radiusX = 0.06,
  radiusY = 0.06,
): CropHandle {
  const left = crop.x;
  const right = crop.x + crop.width;
  const top = crop.y;
  const bottom = crop.y + crop.height;

  const nearLeft = Math.abs(pt.x - left) <= radiusX;
  const nearRight = Math.abs(pt.x - right) <= radiusX;
  const nearTop = Math.abs(pt.y - top) <= radiusY;
  const nearBottom = Math.abs(pt.y - bottom) <= radiusY;
  const withinX = pt.x >= left - radiusX && pt.x <= right + radiusX;
  const withinY = pt.y >= top - radiusY && pt.y <= bottom + radiusY;

  if (nearLeft && nearTop) return "nw";
  if (nearRight && nearTop) return "ne";
  if (nearLeft && nearBottom) return "sw";
  if (nearRight && nearBottom) return "se";
  if (nearTop && withinX) return "n";
  if (nearBottom && withinX) return "s";
  if (nearLeft && withinY) return "w";
  if (nearRight && withinY) return "e";
  if (pt.x >= left && pt.x <= right && pt.y >= top && pt.y <= bottom) return "move";
  return "new";
}

export function applyCropDrag(
  handle: CropHandle,
  startCrop: CropBox,
  startPt: NormalizedPoint,
  currentPt: NormalizedPoint,
): CropBox {
  const p0 = { x: clampUnit(startPt.x), y: clampUnit(startPt.y) };
  const p1 = { x: clampUnit(currentPt.x), y: clampUnit(currentPt.y) };
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;

  if (handle === "move") {
    return clampCropBox({
      x: startCrop.x + dx,
      y: startCrop.y + dy,
      width: startCrop.width,
      height: startCrop.height,
    });
  }

  if (handle === "new") {
    const x0 = Math.min(p0.x, p1.x);
    const y0 = Math.min(p0.y, p1.y);
    const w = Math.max(MIN_CROP_SPAN, Math.abs(p1.x - p0.x));
    const h = Math.max(MIN_CROP_SPAN, Math.abs(p1.y - p0.y));
    return clampCropBox({ x: x0, y: y0, width: w, height: h });
  }

  let left = startCrop.x;
  let right = startCrop.x + startCrop.width;
  let top = startCrop.y;
  let bottom = startCrop.y + startCrop.height;

  if (handle === "nw" || handle === "sw" || handle === "w") {
    left = Math.max(0, Math.min(right - MIN_CROP_SPAN, left + dx));
  }
  if (handle === "ne" || handle === "se" || handle === "e") {
    right = Math.min(1, Math.max(left + MIN_CROP_SPAN, right + dx));
  }
  if (handle === "nw" || handle === "ne" || handle === "n") {
    top = Math.max(0, Math.min(bottom - MIN_CROP_SPAN, top + dy));
  }
  if (handle === "sw" || handle === "se" || handle === "s") {
    bottom = Math.min(1, Math.max(top + MIN_CROP_SPAN, bottom + dy));
  }

  return clampCropBox({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

export function commitCropChange(history: EditorHistory, nextCrop: CropBox): EditorHistory {
  const clamped = clampCropBox(nextCrop);
  if (sameCropBox(history.crop, clamped)) return history;
  return {
    crop: clamped,
    annotations: history.annotations,
    undoStack: [...history.undoStack, { crop: history.crop, annotations: history.annotations }],
    redoStack: [],
  };
}

export function commitAnnotation(history: EditorHistory, annotation: EditorAnnotation): EditorHistory {
  if (annotation.kind === "pen" && annotation.points.length === 0) return history;
  if (annotation.kind !== "pen") {
    const dist = Math.hypot(annotation.end.x - annotation.start.x, annotation.end.y - annotation.start.y);
    if (dist < 0.005) return history;
  }
  return {
    crop: history.crop,
    annotations: [...history.annotations, annotation],
    undoStack: [...history.undoStack, { crop: history.crop, annotations: history.annotations }],
    redoStack: [],
  };
}

export function undoEditor(history: EditorHistory): EditorHistory {
  const prev = history.undoStack[history.undoStack.length - 1];
  if (prev === undefined) return history;
  return {
    crop: prev.crop,
    annotations: prev.annotations,
    undoStack: history.undoStack.slice(0, -1),
    redoStack: [...history.redoStack, { crop: history.crop, annotations: history.annotations }],
  };
}

export function redoEditor(history: EditorHistory): EditorHistory {
  const next = history.redoStack[history.redoStack.length - 1];
  if (next === undefined) return history;
  return {
    crop: next.crop,
    annotations: next.annotations,
    undoStack: [...history.undoStack, { crop: history.crop, annotations: history.annotations }],
    redoStack: history.redoStack.slice(0, -1),
  };
}

export function canUndoEditor(history: EditorHistory): boolean {
  return history.undoStack.length > 0;
}

export function canRedoEditor(history: EditorHistory): boolean {
  return history.redoStack.length > 0;
}

export function isEditorDirty(history: EditorHistory): boolean {
  return !isFullCrop(history.crop) || history.annotations.length > 0;
}

export function resetEditor(history: EditorHistory): EditorHistory {
  if (!isEditorDirty(history)) return history;
  return {
    crop: FULL_CROP,
    annotations: [],
    undoStack: [...history.undoStack, { crop: history.crop, annotations: history.annotations }],
    redoStack: [],
  };
}

export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: EditorAnnotation,
  width: number,
  height: number,
): void {
  if (!("beginPath" in ctx) || width <= 0 || height <= 0) return;
  const strokeWidth = Math.max(2, Math.round(Math.min(width, height) * 0.008));
  ctx.save?.();
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (annotation.kind === "pen") {
    const first = annotation.points[0];
    if (first !== undefined) {
      ctx.beginPath();
      ctx.moveTo(first.x * width, first.y * height);
      if (annotation.points.length === 1) {
        ctx.lineTo(first.x * width + 0.5, first.y * height + 0.5);
      } else {
        for (let i = 1; i < annotation.points.length; i++) {
          const pt = annotation.points[i]!;
          ctx.lineTo(pt.x * width, pt.y * height);
        }
      }
      ctx.stroke();
    }
    ctx.restore?.();
    return;
  }

  const x0 = annotation.start.x * width;
  const y0 = annotation.start.y * height;
  const x1 = annotation.end.x * width;
  const y1 = annotation.end.y * height;

  if (annotation.kind === "ellipse") {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const rx = Math.max(1, Math.abs(x1 - x0) / 2);
    const ry = Math.max(1, Math.abs(y1 - y0) / 2);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore?.();
    return;
  }

  // Arrow: shaft + two head wings.
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const headLen = Math.max(10, strokeWidth * 3.5);
  const wingAngle = Math.PI / 6;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - headLen * Math.cos(angle - wingAngle), y1 - headLen * Math.sin(angle - wingAngle));
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - headLen * Math.cos(angle + wingAngle), y1 - headLen * Math.sin(angle + wingAngle));
  ctx.stroke();
  ctx.restore?.();
}

export function exportEditedCanvas(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  crop: CropBox,
  annotations: readonly EditorAnnotation[],
  makeCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): HTMLCanvasElement | null {
  const fullW = Math.max(1, Math.round(naturalWidth));
  const fullH = Math.max(1, Math.round(naturalHeight));
  const clamped = clampCropBox(crop);
  const sx = Math.max(0, Math.min(fullW - 1, Math.round(clamped.x * fullW)));
  const sy = Math.max(0, Math.min(fullH - 1, Math.round(clamped.y * fullH)));
  const sw = Math.max(1, Math.min(fullW - sx, Math.round(clamped.width * fullW)));
  const sh = Math.max(1, Math.min(fullH - sy, Math.round(clamped.height * fullH)));

  const stage = makeCanvas();
  stage.width = fullW;
  stage.height = fullH;
  const stageCtx = stage.getContext("2d");
  if (stageCtx === null) return null;
  stageCtx.drawImage?.(source, 0, 0, fullW, fullH);
  for (const ann of annotations) {
    drawAnnotation(stageCtx, ann, fullW, fullH);
  }

  if (sx === 0 && sy === 0 && sw === fullW && sh === fullH) {
    return stage;
  }

  const out = makeCanvas();
  out.width = sw;
  out.height = sh;
  const outCtx = out.getContext("2d");
  if (outCtx === null) return null;
  outCtx.drawImage?.(stage, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/** The pane an edit was opened against. A confirm for a different pair must not upload. */
export interface EditTarget {
  paneId: string;
  scopeId: string;
}

export function sameEditTarget(open: EditTarget, current: EditTarget): boolean {
  return open.paneId === current.paneId && open.scopeId === current.scopeId;
}

/**
 * Whether this browser can host the editor. A missing 2D context is the failure, not a guess
 * about the user agent: jsdom and a locked-down webview both land here, and the composer then
 * says so instead of uploading the original or pretending the edit worked.
 */
export function canvasAvailable(): boolean {
  try {
    return document.createElement("canvas").getContext("2d") !== null;
  } catch {
    return false;
  }
}

/** An image the bridge would accept, and only then. A refusal still belongs to `rejectAttachment`. */
export function isEditableImage(file: File, limits: UploadCapability): boolean {
  return attachmentKind(file, limits) === "image" && rejectAttachment(file, limits) === null;
}

export interface SavedImagePayload {
  name?: string;
  extension?: string;
  mimeType?: string;
  fullName?: string;
  imageBase64?: string;
  imageCanvas?: HTMLCanvasElement;
}

const MIME_EXTENSION = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

export function extensionForMime(mime: string): string | null {
  const key = mime.toLowerCase();
  switch (key) {
    case "image/png":
    case "image/jpeg":
    case "image/jpg":
    case "image/webp":
    case "image/gif":
      return MIME_EXTENSION[key];
    default:
      return null;
  }
}

/** Keep the operator's file stem and wear the extension the bytes actually are. */
export function fileNameForMime(originalName: string, mime: string): string {
  const ext = extensionForMime(mime);
  if (ext === null) return originalName;
  const slash = Math.max(originalName.lastIndexOf("/"), originalName.lastIndexOf("\\"));
  const base = slash >= 0 ? originalName.slice(slash + 1) : originalName;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return `${stem === "" ? "image" : stem}.${ext}`;
}

function usableDataUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "data:,") return null;
  return trimmed;
}

function canvasDataUrl(canvas: HTMLCanvasElement | undefined): string | null {
  if (canvas === undefined || canvas.width === 0 || canvas.height === 0) return null;
  try {
    return usableDataUrl(canvas.toDataURL("image/png"));
  } catch {
    return null;
  }
}

function bytesFromDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (match === null) return null;
  const mime = match[1]?.toLowerCase() ?? "";
  if (!mime.startsWith("image/")) return null;
  if (extensionForMime(mime) === null) return null;
  let binary: string;
  try {
    binary = atob((match[2] ?? "").replace(/\s/g, ""));
  } catch {
    return null;
  }
  if (binary.length === 0) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime, bytes };
}

/**
 * A new File, or null when the save carried nothing we can upload. The original File is never
 * written; callers keep it for the cancel path.
 */
export function savedImageToFile(saved: SavedImagePayload, originalName: string): File | null {
  const dataUrl = usableDataUrl(saved.imageBase64) ?? canvasDataUrl(saved.imageCanvas);
  if (dataUrl === null) return null;
  const parsed = bytesFromDataUrl(dataUrl);
  if (parsed === null) return null;
  // A fresh ArrayBuffer, not the view's `ArrayBufferLike` buffer: the File constructor's
  // BlobPart type does not accept a SharedArrayBuffer.
  const copy = new ArrayBuffer(parsed.bytes.byteLength);
  new Uint8Array(copy).set(parsed.bytes);
  return new File([copy], fileNameForMime(originalName, parsed.mime), { type: parsed.mime });
}
