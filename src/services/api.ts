import type {
  AllData,
  BarisRekap,
  BarisSiswa,
  BarisSoalImpor,
  HasilImpor,
  HasilSubmit,
  HasilUjian,
  JawabanKirim,
  ModeSoal,
  MulaiSesiResponse,
  OpsiUjian,
  Peran,
  Pengaturan,
  SesiRingkas,
  UserSesi,
} from '../types';

// ============================================================
// Klien API Google Apps Script — sesuai API_CONTRACT.md:
//  - POST JSON { action, token?, ...params } ke /exec
//    dengan Content-Type text/plain (hindari preflight CORS)
//  - Envelope: { success, message, data, error }
//  - KEAMANAN: token disimpan DI MEMORI (variabel modul), TIDAK PERNAH
//    di localStorage/sessionStorage. URL backend di localStorage boleh
//    (pola aplikasi sebelumnya).
//  - Tanggal di wire: ISO yyyy-mm-dd; datetime: yyyy-MM-dd HH:mm:ss
//  - !success -> lempar Error(message) agar UI menampilkannya
// ============================================================

const LS_API = 'wwn-cbt-80.apiUrl';

/** Token sesi — HANYA di memori. Hilang saat tab ditutup. */
let tokenMem = '';

/** URL efektif hasil resolusi App: override manual > ?school=/schools.json. */
let urlEfektif = '';

export function setUrlEfektif(url: string): void {
  urlEfektif = (url || '').trim();
}

/** URL efektif saat ini (untuk beacon). */
export function getUrlEfektif(): string {
  return urlEfektif || getApiUrl();
}

function resolveUrl(): string {
  return urlEfektif || getApiUrl();
}

/** URL backend: override manual di localStorage (bila diisi). */
export function getApiUrl(): string {
  try {
    return localStorage.getItem(LS_API) || '';
  } catch {
    return '';
  }
}

export function setApiUrl(url: string): void {
  try {
    if (url) localStorage.setItem(LS_API, url);
    else localStorage.removeItem(LS_API);
  } catch {
    /* abaikan */
  }
}

function validUrl(apiUrl: string): boolean {
  return !!apiUrl && apiUrl.trim().startsWith('http');
}

/**
 * Panggil satu action backend. Token sesi otomatis disertakan bila ada.
 * Melempar Error berisi message backend bila success=false.
 */
export async function api<T>(action: string, params: object = {}): Promise<T> {
  const apiUrl = resolveUrl();
  if (!validUrl(apiUrl)) {
    throw new Error('URL backend belum dikonfigurasi. Atur di menu Konfigurasi.');
  }
  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(tokenMem ? { action, token: tokenMem, ...params } : { action, ...params }),
    });
  } catch {
    throw new Error('Gagal menghubungi backend. Periksa koneksi internet.');
  }
  if (!res.ok) throw new Error(`Server merespons HTTP ${res.status}.`);
  const json = await res.json();
  if (json.success === false) {
    throw new Error(json.message || json.error || 'Backend melaporkan kegagalan.');
  }
  return json.data as T;
}

// ---------- Sesi ----------

export function getToken(): string {
  return tokenMem;
}

export function isLoggedIn(): boolean {
  return !!tokenMem;
}

export function setToken(t: string): void {
  tokenMem = t || '';
}

/** Token hanya hidup di memori — tidak ada yang bisa diambil dari storage. */
export function bersihkanToken(): void {
  tokenMem = '';
}

export async function login(username: string, password: string): Promise<UserSesi> {
  const data = await api<{
    token: string;
    nama: string;
    username: string;
    peran: Peran;
    nis: string;
    jenjangId: string;
    kelasId: string;
  }>('login', { username: username.trim(), password });
  setToken(data.token);
  return {
    nama: data.nama,
    username: data.username,
    peran: data.peran,
    nis: data.nis || '',
    jenjangId: data.jenjangId || '',
    kelasId: data.kelasId || '',
  };
}

export async function logout(): Promise<void> {
  const t = tokenMem;
  bersihkanToken();
  if (t) {
    try {
      await api('logout', { token: t });
    } catch {
      /* sesi lokal sudah dibersihkan */
    }
  }
}

// ---------- Koneksi & inisialisasi ----------

export function ping(): Promise<{ version: string; waktu: string }> {
  return api('ping');
}

export function initDatabase(): Promise<{ sheets: string[] }> {
  return api('initDatabase');
}

export function getAllData(): Promise<AllData> {
  return api('getAllData');
}

// ---------- Master (admin) ----------

export function saveJenjang(item: { id?: string; nama: string }): Promise<{ id: string }> {
  return api('saveJenjang', item);
}

export function deleteJenjang(id: string): Promise<unknown> {
  return api('deleteJenjang', { id });
}

export function saveMapel(item: { id?: string; jenjangId: string; nama: string }): Promise<{ id: string }> {
  return api('saveMapel', item);
}

export function deleteMapel(id: string): Promise<unknown> {
  return api('deleteMapel', { id });
}

export function saveKelas(item: { id?: string; jenjangId: string; nama: string }): Promise<{ id: string }> {
  return api('saveKelas', item);
}

export function deleteKelas(id: string): Promise<unknown> {
  return api('deleteKelas', { id });
}

// ---------- Pengguna (admin) ----------

export interface SavePenggunaParams {
  id?: string;
  nama: string;
  username: string;
  peran: Peran;
  password?: string;
  nis?: string;
  jenjangId?: string;
  kelasId?: string;
  aktif?: number;
}

export function savePengguna(item: SavePenggunaParams): Promise<{ id: string }> {
  return api('savePengguna', item);
}

export function deletePengguna(id: string): Promise<unknown> {
  return api('deletePengguna', { id });
}

export function resetPassword(id: string, passwordBaru: string): Promise<unknown> {
  return api('resetPassword', { id, passwordBaru });
}

export function importSiswa(rows: BarisSiswa[]): Promise<HasilImpor> {
  return api('importSiswa', { rows });
}

// ---------- Bank soal (guru/admin) ----------

export interface SaveSoalParams {
  id?: string;
  jenjangId: string;
  mapelId: string;
  soal: string;
  opsiA: string;
  opsiB: string;
  opsiC: string;
  opsiD: string;
  opsiE?: string;
  kunci: string;
  bobot?: number;
  pembahasan?: string;
  gambarUrl?: string;
}

export function saveSoal(item: SaveSoalParams): Promise<{ id: string }> {
  return api('saveSoal', item);
}

export function deleteSoal(id: string): Promise<unknown> {
  return api('deleteSoal', { id });
}

export function importSoal(
  jenjangId: string,
  mapelId: string,
  items: BarisSoalImpor[]
): Promise<HasilImpor> {
  return api('importSoal', { jenjangId, mapelId, items });
}

export function importSoalDariForm(
  formIdOrUrl: string,
  jenjangId: string,
  mapelId: string
): Promise<{ imported: number; dilewati: { judul: string; alasan: string }[] }> {
  return api('importSoalDariForm', { formIdOrUrl, jenjangId, mapelId });
}

// ---------- Paket (guru/admin) ----------

export interface SavePaketParams {
  id?: string;
  nama: string;
  jenjangId: string;
  mapelId: string;
  kelasIds?: string[];
  modeSoal: ModeSoal;
  soalIds?: string[];
  jumlahAcak?: number;
  durasiMenit: number;
  mulai: string;
  selesai: string;
  acakSoal?: number;
  acakOpsi?: number;
  tampilSkor?: number;
  tampilPembahasan?: number;
  aktif?: number;
}

export function savePaket(item: SavePaketParams): Promise<{ id: string }> {
  return api('savePaket', item);
}

export function deletePaket(id: string): Promise<unknown> {
  return api('deletePaket', { id });
}

// ---------- Sesi ujian (siswa) ----------

export function mulaiSesi(paketId: string): Promise<MulaiSesiResponse> {
  return api('mulaiSesi', { paketId });
}

export function getSesi(sesiId: string): Promise<MulaiSesiResponse> {
  return api('getSesi', { sesiId });
}

export function batalkanSesi(sesiId: string, alasan?: string): Promise<{ status: string }> {
  return api('batalkanSesi', { sesiId, alasan });
}

export function catatPeringatan(
  sesiId: string,
  jenis: string
): Promise<{ peringatan: number; dibatalkan: boolean }> {
  return api('catatPeringatan', { sesiId, jenis });
}

export function submitJawaban(sesiId: string, jawaban: JawabanKirim[]): Promise<{ hasil: HasilSubmit }> {
  return api('submitJawaban', { sesiId, jawaban });
}

export function resetSesi(
  username: string,
  paketId: string
): Promise<{ sesiDihapus: number; hasilDihapus: number }> {
  return api('resetSesi', { username, paketId });
}

// ---------- Hasil & monitor ----------

export function rekapHasil(
  paketId: string
): Promise<{ paket: { id: string; nama: string }; rows: BarisRekap[] }> {
  return api('rekapHasil', { paketId });
}

/**
 * Hasil siswa — SELARAS dengan backend actionGetHasilSiswa:
 * data = ARRAY objek hasil (bukan { hasil:[...] }); `rincian` menempel
 * pada tiap item hasil bila paket tampilPembahasan=1 & sesi SELESAI.
 */
export function getHasilSiswa(paketId?: string): Promise<HasilUjian[]> {
  return api('getHasilSiswa', paketId ? { paketId } : {});
}

export function monitorSesi(paketId?: string): Promise<SesiRingkas[]> {
  return api('monitorSesi', paketId ? { paketId } : {});
}

// ---------- Pengaturan & upload ----------

export function savePengaturan(pengaturan: Pengaturan): Promise<unknown> {
  return api('savePengaturan', { pengaturan });
}

export function uploadLogo(dataBase64: string, mimeType: string): Promise<{ url: string; fileId: string }> {
  return api('uploadLogo', { dataBase64, mimeType });
}

export function uploadGambarSoal(
  dataBase64: string,
  mimeType: string,
  namaFile?: string
): Promise<{ url: string; fileId: string }> {
  return api('uploadGambarSoal', { dataBase64, mimeType, namaFile });
}

/**
 * Beacon pematalan sesi — untuk pagehide/beforeunload. Jawaban hanya hidup
 * di memori; beacon memastikan sesi AKTIF dibatalkan server agar tidak
 * "menggantung" saat peserta keluar/menutup tab.
 */
export function beaconBatalkanSesi(apiUrl: string, token: string, sesiId: string): boolean {
  try {
    if (!apiUrl || !apiUrl.trim().startsWith('http') || !token || !sesiId) return false;
    const data = JSON.stringify({ action: 'batalkanSesi', token, sesiId, alasan: 'keluar-aplikasi' });
    return navigator.sendBeacon(apiUrl, data);
  } catch {
    return false;
  }
}

export type { OpsiUjian };
