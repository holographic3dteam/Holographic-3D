// api.ts — SSE-based generation + regular REST calls

export function getImageUrl(path?: string | null): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const clean = path.replace(/^\//, "");
  // Encode each path segment to handle spaces/special chars in filenames
  return "/" + clean.split("/").map(s => encodeURIComponent(s)).join("/");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FactoryMatch {
  id?: number | null;
  description: string;
  file_path?: string | null;
  match_score: number;
}

export interface QualityInfo {
  clip_score: number;
  threshold: number;
  passed: boolean;
  attempts: { attempt: number; clip_score: number }[];
}

export interface AiGenerated {
  message: string;
  preview_url?: string | null;
  status: string;
  quality?: QualityInfo;
}

export interface GenerateResponse {
  status: string;
  factory_match: FactoryMatch;
  ai_generated: AiGenerated;
}

export interface SaveResponse {
  message: string;
  design_id: number;
}

export interface UploadResponse {
  message: string;
  design_id: number;
  path: string;
}

export interface MeshPaths {
  glb: string;
  stl: string;
  obj: string;
}

export interface Generate3DResponse {
  status: string;
  mesh: MeshPaths;
}

export interface SavedDesign {
  id: number;
  prompt: string;
  preview_url: string;
  savedAt: string;
  rating?: number;
  mesh?: MeshPaths;
}

// ─── SSE progress event types ──────────────────────────────────────────────────

export type ProgressEvent =
  | { type: "attempt_start"; attempt: number; max_attempts: number }
  | { type: "step"; attempt: number; max_attempts: number; step: number; total_steps: number }
  | { type: "attempt_done"; attempt: number; score: number; passed: boolean }
  | { type: "done"; result: AiGenerated }
  | { type: "factory_match"; factory_match: FactoryMatch }
  | { type: "stopped"; message: string }
  | { type: "error"; message: string };

// ─── Prompt History ────────────────────────────────────────────────────────────

const HISTORY_KEY = "holo3d_prompt_history";
const MAX_HISTORY = 10;

export interface HistoryEntry {
  prompt: string;
  savedAt: string;
  category?: string;
  selections?: Record<string, string | string[]>;
}

/** Normalize legacy string[] entries to HistoryEntry objects */
function _parseHistory(raw: string): HistoryEntry[] {
  try {
    const parsed: Array<string | HistoryEntry> = JSON.parse(raw);
    return parsed.map(item =>
      typeof item === "string"
        ? { prompt: item, savedAt: new Date(0).toISOString() }
        : item
    );
  } catch { return []; }
}

export function addToHistory(
  prompt: string,
  category?: string,
  selections?: Record<string, string | string[]>
) {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const history = raw ? _parseHistory(raw) : [];
    const filtered = history.filter((e) => e.prompt !== prompt);
    filtered.unshift({ prompt, savedAt: new Date().toISOString(), category, selections });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, MAX_HISTORY)));
  } catch {}
}

/** Returns plain prompt strings — for backward-compat use only. */
export function getHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return _parseHistory(raw).map(e => e.prompt);
  } catch { return []; }
}

/** Returns full history entries including timestamps and selections. */
export function getHistoryFull(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return _parseHistory(raw);
  } catch { return []; }
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function handleAuthError(res: Response): void {
  if (res.status === 401) {
    localStorage.removeItem("holo3d_logged_in");
    throw new Error("Session expired — please log in again.");
  }
}

// ─── SSE Generate ──────────────────────────────────────────────────────────────

let _activeES: EventSource | null = null;
let _activeReject: ((reason: Error) => void) | null = null;
let _aborted = false; // global flag to block stale retry timers after stop

export async function abortGeneration() {
  _aborted = true;
  // 1. Close SSE connection on frontend
  if (_activeES) {
    _activeES.close();
    _activeES = null;
  }
  // 2. Reject the promise so calling code gets __aborted__
  if (_activeReject) {
    _activeReject(new Error("__aborted__"));
    _activeReject = null;
  }
  // 3. Tell backend to stop too — so GPU stops working
  try {
    await fetch("/api/stop", { method: "POST" });
  } catch {
    // Backend might not be reachable — ignore
  }
}

export async function checkBackendReady(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    return data.ready === true;
  } catch { return false; }
}

export function generateDesign(
  prompt: string,
  onProgress?: (event: ProgressEvent) => void,
  seed?: number,
  steps?: number,
): Promise<GenerateResponse> {
  // Close any previous connection first
  if (_activeES) {
    _activeES.close();
    _activeES = null;
  }

  _aborted = false; // reset on each new generation

  return new Promise((resolve, reject) => {
    _activeReject = reject;

    const params = new URLSearchParams({ prompt });
    if (seed  !== undefined) params.set("seed",  String(seed));
    if (steps !== undefined) params.set("steps", String(steps));
    const url = `/api/generate?${params.toString()}`;

    let aiGenerated: AiGenerated | null = null;
    let factoryMatch: FactoryMatch | null = null;
    let errorRetries = 0;
    const MAX_ERROR_RETRIES = 3;
    let settled = false;

    const cleanup = () => {
      if (_activeES) { _activeES.close(); _activeES = null; }
      _activeReject = null;
      if (silenceTimer) clearTimeout(silenceTimer);
    };

    // Reject if the connection goes silent for >5 minutes (model crash, network drop, etc.)
    const SILENCE_TIMEOUT_MS = 5 * 60 * 1000;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    const resetSilenceTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        cleanup();
        if (!settled) { settled = true; reject(new Error("Generation timed out — no response for 5 minutes. Please try again.")); }
      }, SILENCE_TIMEOUT_MS);
    };

    const onMessage = (e: MessageEvent) => {
      resetSilenceTimer();
      errorRetries = 0; // successful message = connection is healthy
      let event: ProgressEvent;
      try { event = JSON.parse(e.data); } catch { return; }

      onProgress?.(event);

      if (event.type === "done") {
        aiGenerated = event.result;
        if (factoryMatch !== null) {
          cleanup();
          if (!settled) { settled = true; resolve({ status: "success", factory_match: factoryMatch, ai_generated: aiGenerated }); }
        }
      }

      if (event.type === "factory_match") {
        factoryMatch = event.factory_match;
        if (aiGenerated !== null) {
          cleanup();
          if (!settled) { settled = true; resolve({ status: "success", factory_match: factoryMatch, ai_generated: aiGenerated }); }
        }
      }

      if (event.type === "stopped") {
        cleanup();
        if (!settled) { settled = true; reject(new Error("__aborted__")); }
      }

      if (event.type === "error") {
        cleanup();
        if (!settled) { settled = true; reject(new Error(event.message)); }
      }
    };

    const onError = function (this: EventSource) {
      if (settled) return;
      // If the server rejected the connection (e.g. 401 auth error),
      // readyState is CLOSED — don't retry, surface the error immediately
      if (this.readyState === EventSource.CLOSED) {
        cleanup();
        if (!settled) {
          settled = true;
          // Clear stale login state so user gets redirected to login
          localStorage.removeItem("holo3d_logged_in");
          reject(new Error("Session expired — please log in again."));
        }
        return;
      }
      errorRetries++;
      if (errorRetries > MAX_ERROR_RETRIES) {
        cleanup();
        if (!settled) { settled = true; reject(new Error("Connection to generation service lost. Please try again.")); }
        return;
      }
      // Close broken connection and retry after a short delay
      // This handles browser tab backgrounding that temporarily kills SSE
      if (_activeES) _activeES.close();
      setTimeout(() => {
        if (settled || _aborted) return; // don't retry if user stopped
        const retryEs = new EventSource(url);
        _activeES = retryEs;
        retryEs.onmessage = onMessage;
        retryEs.onerror = onError.bind(retryEs);
        resetSilenceTimer();
      }, 2000);
    };

    const es = new EventSource(url);
    _activeES = es;
    es.onmessage = onMessage;
    es.onerror = onError.bind(es);
    resetSilenceTimer();
  });
}

// ─── 3D generation ─────────────────────────────────────────────────────────────

interface ThreeDStatus {
  status: "processing" | "completed" | "error";
  mesh: MeshPaths | null;
  error: string | null;
}

// 3D (shape + texture painting) takes several minutes, so it runs as a
// background job on the server. We start it, then poll — the connection never
// stays open for the whole run, which is what fixes the "Failed to fetch" timeout.
export async function generate3D(
  prompt: string,
  preview_url: string,
  steps: number = 20,
): Promise<Generate3DResponse> {
  const res = await fetch("/api/generate_3d", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, preview_url, steps }),
  });
  handleAuthError(res);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "3D generation failed");

  const jobId: string = data.job_id;
  if (!jobId) throw new Error("Server did not return a job id");

  let consecutiveErrors = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2500));
    let job: ThreeDStatus;
    try {
      const s = await fetch(`/api/generate_3d_status/${jobId}`);
      handleAuthError(s);
      job = await s.json();
      if (!s.ok) throw new Error((job as unknown as { error?: string }).error || "3D generation failed");
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      if (consecutiveErrors >= 8) throw err;
      continue;
    }

    if (job.status === "processing") continue;
    if (job.status === "error") throw new Error(job.error || "3D generation failed");
    return { status: job.status, mesh: job.mesh as MeshPaths };
  }
}

// ─── Edit Design (ControlNet img2img) ─────────────────────────────────────────

export interface EditDesignResponse {
  message: string;
  preview_url: string;
  status: string;
}

interface EditStatus {
  status: "processing" | "completed" | "error";
  step: number;
  total: number;
  preview_url: string | null;
  error: string | null;
  message: string;
}

// Edit runs as a background job on the server (inference takes minutes). We
// start the job, then poll its status so the connection never has to stay open
// for the whole run — this is what fixes the old "Failed to fetch" timeout.
export async function editDesign(
  image_path: string,
  prompt: string,
  output_name?: string,
  onProgress?: (step: number, total: number) => void,
): Promise<EditDesignResponse> {
  const res = await fetch("/api/edit-design", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_path, prompt, output_name }),
  });
  handleAuthError(res);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Edit failed");

  const jobId: string = data.job_id;
  if (!jobId) throw new Error("Server did not return a job id");

  // Poll until the job finishes. Each poll is a fast, short-lived request.
  // Tolerate transient network blips (ngrok hiccups, brief drops) — only give
  // up after several consecutive failures, so a single blip won't surface as
  // a spurious "Failed to fetch".
  let consecutiveErrors = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));

    let job: EditStatus;
    try {
      const s = await fetch(`/api/edit-status/${jobId}`);
      handleAuthError(s);
      job = await s.json();
      if (!s.ok) throw new Error((job as unknown as { error?: string }).error || "Edit failed");
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      if (consecutiveErrors >= 8) throw err;   // ~16s of failures → really down
      continue;
    }

    if (job.status === "processing") {
      onProgress?.(job.step, job.total);
      continue;
    }
    if (job.status === "error") throw new Error(job.error || "Edit failed");
    // completed
    onProgress?.(job.total, job.total);
    return {
      message: job.message,
      preview_url: job.preview_url as string,
      status: job.status,
    };
  }
}

// ─── Save ──────────────────────────────────────────────────────────────────────

export async function saveDesign(
  prompt: string,
  preview_url: string
): Promise<SaveResponse> {
  const res = await fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, preview_url }),
  });
  handleAuthError(res);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Save failed");
  return data;
}

// ─── Delete ────────────────────────────────────────────────────────────────────

export async function deleteDesign(design_id: number): Promise<void> {
  const res = await fetch(`/api/save/${design_id}`, {
    method: "DELETE",
    credentials: "include",
  });
  handleAuthError(res);
  // 404 = the row isn't in the DB (e.g. an older localStorage-only design).
  // Treat delete as idempotent: the goal (it's gone) is already met.
  if (res.status === 404) return;
  if (!res.ok) {
    // Error body may not be JSON (e.g. a 500 HTML page from the proxy) — fall
    // back to the status so the real cause surfaces instead of a crash.
    let msg = `Delete failed (HTTP ${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch { /* non-JSON body */ }
    throw new Error(msg);
  }
}

// ─── Rate ──────────────────────────────────────────────────────────────────────

export async function rateDesign(design_id: number, rating: number): Promise<void> {
  const res = await fetch(`/api/save/${design_id}/rate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating }),
  });
  handleAuthError(res);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Rating failed");
  }
}

// ─── Factory upload ────────────────────────────────────────────────────────────

export async function uploadProduct(
  file: File,
  description: string
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("description", description);
  const res = await fetch("/api/factory/upload", { method: "POST", body: formData });
  handleAuthError(res);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data;
}

// ─── Saved designs (DB) ────────────────────────────────────────────────────────

export async function getSavedDesignsFromDB(): Promise<SavedDesign[]> {
  const res = await fetch("/api/save");
  handleAuthError(res);
  if (!res.ok) throw new Error("Failed to load saved designs");
  const data: Array<{
    id: number; prompt: string; preview_url: string;
    rating?: number; savedAt: string;
  }> = await res.json();
  return data.map(d => ({ ...d, mesh: getSavedDesigns().find(s => s.id === d.id)?.mesh }));
}

// ─── Saved designs (localStorage) ─────────────────────────────────────────────

const SAVED_KEY = "holo3d_saved_designs";

export function getSavedDesigns(): SavedDesign[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function persistSavedDesign(design: SavedDesign) {
  const saved = getSavedDesigns();
  const idx = saved.findIndex((d) => d.id === design.id);
  if (idx >= 0) saved[idx] = design;
  else saved.unshift(design);
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
}

export function removeSavedDesign(id: number) {
  const saved = getSavedDesigns().filter((d) => d.id !== id);
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
}

export function updateSavedDesignRating(id: number, rating: number) {
  const saved = getSavedDesigns();
  const d = saved.find((x) => x.id === id);
  if (d) { d.rating = rating; localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); }
}

export function updateSavedDesignMesh(id: number, mesh: MeshPaths) {
  const saved = getSavedDesigns();
  const d = saved.find((x) => x.id === id);
  if (d) { d.mesh = mesh; localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); }
}