/**
 * BACKEND — Aplikasi CBT Try Out TKA (wwn-cbt-80)
 * Google Apps Script + Google Sheets + Google Drive (+ Google Forms opsional)
 *
 * Fitur:
 *  - Auth: login username+password (hash SHA-256 + garam), token sesi 7 hari,
 *    peran admin > guru > siswa.
 *  - Master: Jenjang, Mapel, Kelas (CRUD, tolak hapus bila dipakai).
 *  - Pengguna: CRUD admin/guru/siswa + reset password + impor siswa massal.
 *  - Bank soal: CRUD + impor massal + impor dari Google Form (kuis).
 *  - Paket try out: mode manual / acak, jendela waktu, batas kelas.
 *  - Sesi ujian: mulai (acak soal per siswa), get, batalkan (idempotent,
 *    aman untuk sendBeacon), catat peringatan (auto-batal di ambang),
 *    submit jawaban (PENILAIAN DIHITUNG DI SERVER), reset sesi.
 *  - Hasil & monitor: rekap per paket, hasil per siswa (rincian+pembahasan
 *    hanya bila paket mengizinkan), monitor sesi live.
 *  - Pengaturan: identitas + ambang peringatan + flag; upload logo &
 *    gambar soal ke Google Drive.
 *
 * CARA PAKAI (untuk pemula):
 *  1. Buat Google Spreadsheet baru (mis. "Database CBT TKA").
 *  2. Buka menu Extensions > Apps Script. HAPUS seluruh isi editor,
 *     lalu PASTE seluruh isi file ini. Simpan.
 *  3. Tambahkan file manifest: di editor pilih Project Settings (ikon roda gigi)
 *     > centang "Show appsscript.json manifest file in editor", lalu buka file
 *     appsscript.json yang muncul dan GANTI seluruh isinya dengan file
 *     backend/appsscript.json dari repo ini. (Dibutuhkan agar upload ke Google
 *     Drive dan impor Google Form mendapat izin yang cukup.)
 *  4. (Hanya jika memakai upload / impor Form) Jalankan fungsi
 *     "authorizeDriveAccess" dan/atau "authorizeFormsAccess" dari editor,
 *     lalu setujui izin Google.
 *  5. Deploy > New deployment > Web app:
 *     - Execute as: Me
 *     - Who has access: Anyone
 *     Setiap ada perubahan kode: Deploy > Manage deployments > New version.
 *  6. Salin URL /exec ke menu Konfigurasi di aplikasi web,
 *     lalu klik "Inisialisasi Database".
 *
 * Sheet yang dibuat (10): Pengaturan, Pengguna, Jenjang, Mapel, Kelas,
 * BankSoal, Paket, SesiUjian, Hasil, LogAktivitas
 *
 * KONTRAK API: docs/API_CONTRACT.md (sumber kebenaran — implementasi ini
 * mengikutinya).
 *
 * CATATAN PENTING:
 *  - Envelope respons SELALU: {success, message?, data?, error?}.
 *  - Format TANGGAL di wire: yyyy-MM-dd; DATETIME: yyyy-MM-dd HH:mm:ss.
 *    (Tampilan dd/mm/yyyy diurus frontend.)
 *  - Password TIDAK PERNAH disimpan plaintext: SHA-256(garam + password).
 *    Hash/garam/token TIDAK PERNAH dikirim ke frontend.
 *  - Kunci jawaban & pembahasan TIDAK PERNAH dikirim ke siswa.
 *  - Penilaian submitJawaban DIHITUNG DI SERVER dari kunci BankSoal.
 *  - Token sesi kedaluwarsa 7 hari; logout menghapus token.
 *  - Akun bawaan: admin / admin123 (admin), guru / guru123 (guru).
 *    SEGERA ganti kata sandi setelah inisialisasi!
 */

var APP_VERSION = '1.0.0';

// ============================================================
// KONFIGURASI SHEET (satu sumber kebenaran untuk nama & header)
// ============================================================
var SHEET_PENGATURAN = 'Pengaturan';
var SHEET_PENGGUNA = 'Pengguna';
var SHEET_JENJANG = 'Jenjang';
var SHEET_MAPEL = 'Mapel';
var SHEET_KELAS = 'Kelas';
var SHEET_BANKSOAL = 'BankSoal';
var SHEET_PAKET = 'Paket';
var SHEET_SESI = 'SesiUjian';
var SHEET_HASIL = 'Hasil';
var SHEET_LOG = 'LogAktivitas';

var SEMUA_SHEET = [SHEET_PENGATURAN, SHEET_PENGGUNA, SHEET_JENJANG,
  SHEET_MAPEL, SHEET_KELAS, SHEET_BANKSOAL, SHEET_PAKET, SHEET_SESI,
  SHEET_HASIL, SHEET_LOG];

var HEADERS = {};
HEADERS[SHEET_PENGATURAN] = ['Kunci', 'Nilai'];
HEADERS[SHEET_PENGGUNA] = ['ID', 'Nama', 'Username', 'PasswordHash',
  'PasswordSalt', 'Peran', 'NIS', 'JenjangID', 'KelasID', 'Token',
  'TokenKedaluwarsa', 'Aktif'];
HEADERS[SHEET_JENJANG] = ['ID', 'Nama', 'DibuatPada'];
HEADERS[SHEET_MAPEL] = ['ID', 'JenjangID', 'Nama', 'DibuatPada'];
HEADERS[SHEET_KELAS] = ['ID', 'JenjangID', 'Nama', 'DibuatPada'];
HEADERS[SHEET_BANKSOAL] = ['ID', 'JenjangID', 'MapelID', 'Soal', 'OpsiA',
  'OpsiB', 'OpsiC', 'OpsiD', 'OpsiE', 'Kunci', 'Bobot', 'Pembahasan',
  'GambarUrl', 'DibuatPada', 'DibuatOleh'];
HEADERS[SHEET_PAKET] = ['ID', 'Nama', 'JenjangID', 'MapelID', 'KelasIDsJSON',
  'ModeSoal', 'SoalIDsJSON', 'JumlahAcak', 'DurasiMenit', 'Mulai', 'Selesai',
  'AcakSoal', 'AcakOpsi', 'TampilSkor', 'TampilPembahasan', 'Aktif',
  'DibuatPada', 'DibuatOleh'];
HEADERS[SHEET_SESI] = ['ID', 'PaketID', 'Username', 'WaktuMulai',
  'WaktuSelesai', 'Status', 'Peringatan', 'SoalIDsJSON', 'DibuatPada'];
HEADERS[SHEET_HASIL] = ['ID', 'SesiID', 'PaketID', 'Username', 'NamaSiswa',
  'Kelas', 'JawabanJSON', 'Benar', 'Salah', 'Kosong', 'Skor', 'TotalBobot',
  'Nilai', 'WaktuSubmit'];
HEADERS[SHEET_LOG] = ['ID', 'Waktu', 'Username', 'SesiID', 'Jenis', 'Detail'];

var DEFAULT_PENGATURAN = [
  ['namaSekolah', 'Madrasah Contoh'],
  ['alamatSekolah', ''],
  ['telepon', ''],
  ['namaKepala', ''],
  ['logoUrl', ''],
  ['ambangPeringatan', '3'],
  ['wajibFullscreen', '1'],
  ['izinkanUlangSetelahBatal', '0']
];

// Kunci pengaturan yang boleh diubah via savePengaturan (kunci lain diabaikan)
var KUNCI_PENGATURAN = ['namaSekolah', 'alamatSekolah', 'telepon',
  'namaKepala', 'logoUrl', 'ambangPeringatan', 'wajibFullscreen',
  'izinkanUlangSetelahBatal'];

var PERAN_VALID = ['admin', 'guru', 'siswa'];
var PERAN_RANK = { siswa: 1, guru: 2, admin: 3 };
var TOKEN_MASA_BERLAKU_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari
var MODE_SOAL_VALID = ['manual', 'acak'];
var KUNCI_VALID = ['A', 'B', 'C', 'D', 'E'];
var STATUS_SESI_VALID = ['AKTIF', 'SELESAI', 'BATAL'];

// Batas ukuran upload gambar (base64 murni, jumlah karakter). ~2 MB.
var MAX_GAMBAR_BASE64 = 2800000;
var NAMA_FOLDER_LOGO = 'Logo wwn-cbt-80';
var NAMA_FOLDER_GAMBAR_SOAL = 'Gambar Soal wwn-cbt-80';

// ============================================================
// HELPER UMUM
// ============================================================
function asString(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function asInt(v, def) {
  var n = parseInt(asString(v), 10);
  return isNaN(n) ? (def === undefined ? 0 : def) : n;
}

/** Flag 0/1 yang pemaaf: terima 0/1/'0'/'1'/true/false; selainnya default. */
function asFlag(v, def) {
  if (v === undefined || v === null) return def;
  var s = asString(v).toLowerCase();
  if (s === '1' || s === 'true') return 1;
  if (s === '0' || s === 'false') return 0;
  return def;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sekarangISODateTime() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Sel spreadsheet -> string. Tahan terhadap sel tanggal Google Sheets
 * (dibaca sebagai objek Date) maupun string biasa.
 */
function selKeString(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  return asString(v);
}

/** Sel tanggal -> ISO yyyy-mm-dd (tahan terhadap objek Date). */
function tanggalKeISO(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return asString(v);
}

/** JSON.parse yang aman: gagal -> nilai default. */
function parseJSONLunak(s, def) {
  try {
    var v = JSON.parse(asString(s));
    return (v === undefined || v === null) ? def : v;
  } catch (e) {
    return def;
  }
}

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

/** Baca semua baris data (tanpa header) sebagai array 2D. */
function readRows(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var lastCol = sheet.getLastColumn();
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
}

/** Cari nomor baris (1-based, termasuk header) yang kolomnya == nilai. -1 jika tidak ada. */
function findRowNum(sheet, colIdx, value) {
  var rows = readRows(sheet);
  var cari = asString(value);
  for (var i = 0; i < rows.length; i++) {
    if (asString(rows[i][colIdx - 1]) === cari) return i + 2;
  }
  return -1;
}

/** Hitung baris yang kolomnya == nilai (untuk cek "dipakai"). */
function hitungPakai(sheet, colIdx, value) {
  var rows = readRows(sheet);
  var cari = asString(value);
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    if (asString(rows[i][colIdx - 1]) === cari) n++;
  }
  return n;
}

/** Cari baris (array) berdasarkan kolom ID (kolom 1). null jika tidak ada. */
function cariBarisById(ss, namaSheet, id) {
  var sheet = ss.getSheetByName(namaSheet);
  if (!sheet) return null;
  var rowNum = findRowNum(sheet, 1, id);
  if (rowNum < 0) return null;
  return sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
}

/** Hapus baris-baris (nomor 1-based) dari sheet, dari bawah ke atas. */
function hapusBarisList(sheet, rowNums) {
  rowNums.sort(function (a, b) { return b - a; });
  for (var i = 0; i < rowNums.length; i++) {
    sheet.deleteRow(rowNums[i]);
  }
}

/** Parse 'yyyy-MM-dd HH:mm:ss' -> Date. null jika format/tanggal tak valid. */
function parseDatetime(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(asString(s));
  if (!m) return null;
  var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (isNaN(d.getTime())) return null;
  if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 ||
      d.getDate() !== +m[3] || d.getHours() !== +m[4] ||
      d.getMinutes() !== +m[5] || d.getSeconds() !== +m[6]) return null;
  return d;
}

function formatDatetime(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function tambahMenit(d, menit) {
  return new Date(d.getTime() + menit * 60000);
}

/** Acak salinan array (Fisher-Yates). */
function acakArray(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// ============================================================
// PASSWORD (hash + garam) & TOKEN SESI
// ============================================================
function hashPassword(password, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + String(password)
  );
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    hex += ('0' + b.toString(16)).slice(-2);
  }
  return hex;
}

/**
 * Ambil pengguna dari token sesi. Mengembalikan objek pengguna (tanpa
 * hash/garam/token) atau null jika token tidak valid / kedaluwarsa /
 * akun nonaktif.
 * Kolom Pengguna: ID=1, Nama=2, Username=3, PasswordHash=4, PasswordSalt=5,
 * Peran=6, NIS=7, JenjangID=8, KelasID=9, Token=10, TokenKedaluwarsa=11,
 * Aktif=12.
 */
function getUserFromToken(ss, token) {
  token = asString(token);
  if (!token) return null;
  var sheet = ss.getSheetByName(SHEET_PENGGUNA);
  if (!sheet) return null;
  var rows = readRows(sheet);
  var now = Date.now();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (asString(r[9]) === token) {
      var exp = Number(r[10]) || 0;
      if (exp < now) return null; // kedaluwarsa
      if (asString(r[11]) !== '1') return null; // akun dinonaktifkan
      return {
        id: asString(r[0]),
        nama: asString(r[1]),
        username: asString(r[2]),
        peran: asString(r[5]),
        nis: asString(r[6]),
        jenjangId: asString(r[7]),
        kelasId: asString(r[8])
      };
    }
  }
  return null;
}

/**
 * Wajibkan autentikasi token. peranMin: 'admin' | 'guru' | 'siswa'
 * (hirarki: admin > guru > siswa).
 * Mengembalikan {ok:true, user} atau {ok:false, message}.
 */
function butuhLogin(ss, payload, peranMin) {
  var token = asString(payload && payload.token);
  var user = getUserFromToken(ss, token);
  if (!user) {
    return { ok: false, message: 'Sesi berakhir, silakan login ulang' };
  }
  var rankUser = PERAN_RANK[user.peran] || 0;
  var rankMin = PERAN_RANK[peranMin] || 0;
  if (rankUser < rankMin) {
    var msg = peranMin === 'admin'
      ? 'Aksi ini hanya boleh dilakukan oleh admin.'
      : 'Aksi ini hanya boleh dilakukan oleh guru atau admin.';
    return { ok: false, message: msg };
  }
  return { ok: true, user: user };
}

/** Hapus token dari sheet (logout). */
function hapusToken(ss, token) {
  token = asString(token);
  if (!token) return;
  var sheet = ss.getSheetByName(SHEET_PENGGUNA);
  if (!sheet) return;
  var rowNum = findRowNum(sheet, 10, token);
  if (rowNum > 0) {
    sheet.getRange(rowNum, 10).setValue('');
    sheet.getRange(rowNum, 11).setValue('');
  }
}

/**
 * Pembungkus aksi ber-token: autentikasi dulu, baru jalankan fn(user).
 * fn mengembalikan objek {success,...}; dibungkus jadi TextOutput JSON.
 */
function denganAuth(ss, payload, peranMin, fn) {
  var auth = butuhLogin(ss, payload, peranMin);
  if (!auth.ok) return jsonResponse({ success: false, message: auth.message });
  try {
    return jsonResponse(fn(auth.user));
  } catch (err) {
    return jsonResponse({ success: false, error: 'aksi: ' + err.message });
  }
}

// ============================================================
// PENGATURAN
// ============================================================
function getSettings(ss) {
  var sheet = getOrCreateSheet(ss, SHEET_PENGATURAN);
  var rows = readRows(sheet);
  var out = {};
  for (var i = 0; i < DEFAULT_PENGATURAN.length; i++) {
    out[DEFAULT_PENGATURAN[i][0]] = DEFAULT_PENGATURAN[i][1];
  }
  for (var j = 0; j < rows.length; j++) {
    var k = asString(rows[j][0]);
    if (k) out[k] = asString(rows[j][1]);
  }
  out.ambangPeringatan = asInt(out.ambangPeringatan, 3);
  out.wajibFullscreen = asFlag(out.wajibFullscreen, 1);
  out.izinkanUlangSetelahBatal = asFlag(out.izinkanUlangSetelahBatal, 0);
  return out;
}

function setSetting(ss, kunci, nilai) {
  var sheet = getOrCreateSheet(ss, SHEET_PENGATURAN);
  var rowNum = findRowNum(sheet, 1, kunci);
  if (rowNum > 0) sheet.getRange(rowNum, 2).setValue(nilai);
  else sheet.appendRow([kunci, nilai]);
}

/** Catat satu baris ke LogAktivitas. */
function catatLog(ss, username, sesiId, jenis, detail) {
  try {
    var sheet = getOrCreateSheet(ss, SHEET_LOG);
    sheet.appendRow([Utilities.getUuid(), sekarangISODateTime(),
      asString(username), asString(sesiId), asString(jenis), asString(detail)]);
  } catch (e) {}
}

// ============================================================
// MAPPER BARIS -> OBJEK (camelCase, tanpa rahasia)
// ============================================================
function jenjangKeObjek(r) {
  return { id: asString(r[0]), nama: asString(r[1]) };
}

function mapelKeObjek(r) {
  return { id: asString(r[0]), jenjangId: asString(r[1]), nama: asString(r[2]) };
}

function kelasKeObjek(r) {
  return { id: asString(r[0]), jenjangId: asString(r[1]), nama: asString(r[2]) };
}

function penggunaKePublik(r) {
  return {
    id: asString(r[0]), nama: asString(r[1]), username: asString(r[2]),
    peran: asString(r[5]), nis: asString(r[6]), jenjangId: asString(r[7]),
    kelasId: asString(r[8]), aktif: asInt(r[11], 1)
  };
}

/** BankSoal LENGKAP (dengan kunci & pembahasan) — hanya untuk guru/admin. */
function bankSoalKeObjek(r) {
  return {
    id: asString(r[0]), jenjangId: asString(r[1]), mapelId: asString(r[2]),
    soal: asString(r[3]), opsiA: asString(r[4]), opsiB: asString(r[5]),
    opsiC: asString(r[6]), opsiD: asString(r[7]), opsiE: asString(r[8]),
    kunci: asString(r[9]), bobot: asInt(r[10], 1),
    pembahasan: asString(r[11]), gambarUrl: asString(r[12]),
    dibuatPada: selKeString(r[13])
  };
}

/**
 * Paket. untukSiswa=true -> buang field sensitif (soalIds, dibuatOleh);
 * jumlahSoal selalu dikirim.
 */
function paketKeObjek(r, untukSiswa) {
  var modeSoal = asString(r[5]);
  var soalIds = parseJSONLunak(r[6], []);
  if (!Array.isArray(soalIds)) soalIds = [];
  var jumlahSoal = modeSoal === 'manual' ? soalIds.length : asInt(r[7], 0);
  var o = {
    id: asString(r[0]), nama: asString(r[1]),
    jenjangId: asString(r[2]), mapelId: asString(r[3]),
    kelasIds: parseJSONLunak(r[4], []),
    modeSoal: modeSoal,
    jumlahAcak: asInt(r[7], 0),
    durasiMenit: asInt(r[8], 60),
    mulai: selKeString(r[9]), selesai: selKeString(r[10]),
    acakSoal: asInt(r[11], 1), acakOpsi: asInt(r[12], 1),
    tampilSkor: asInt(r[13], 1), tampilPembahasan: asInt(r[14], 1),
    aktif: asInt(r[15], 1),
    jumlahSoal: jumlahSoal
  };
  if (!Array.isArray(o.kelasIds)) o.kelasIds = [];
  if (!untukSiswa) {
    o.soalIds = soalIds;
    o.dibuatOleh = asString(r[17]);
  }
  return o;
}

function sesiKeObjek(r, petaPaket, petaPengguna, petaKelas) {
  var uname = asString(r[2]);
  var pg = petaPengguna[uname] || {};
  return {
    id: asString(r[0]), paketId: asString(r[1]),
    namaPaket: petaPaket[asString(r[1])] || '',
    username: uname,
    namaSiswa: pg.nama || uname,
    kelas: petaKelas[pg.kelasId] || '',
    waktuMulai: selKeString(r[3]), waktuSelesai: selKeString(r[4]),
    status: asString(r[5]), peringatan: asInt(r[6], 0)
  };
}

function hasilKeObjek(r, petaPaket, petaPengguna, petaKelas) {
  var uname = asString(r[3]);
  var pg = petaPengguna[uname] || {};
  return {
    id: asString(r[0]), sesiId: asString(r[1]), paketId: asString(r[2]),
    namaPaket: petaPaket[asString(r[2])] || '',
    username: uname,
    namaSiswa: asString(r[4]) || pg.nama || uname,
    kelas: asString(r[5]) || petaKelas[pg.kelasId] || '',
    benar: asInt(r[7], 0), salah: asInt(r[8], 0), kosong: asInt(r[9], 0),
    skor: asInt(r[10], 0), totalBobot: asInt(r[11], 0),
    nilai: asInt(r[12], 0), waktuSubmit: selKeString(r[13])
  };
}

/** Baca seluruh sheet lalu petakan tiap baris. [] jika sheet belum ada. */
function bacaSemua(ss, namaSheet, mapper) {
  var sheet = ss.getSheetByName(namaSheet);
  if (!sheet) return [];
  var rows = readRows(sheet);
  var out = [];
  for (var i = 0; i < rows.length; i++) out.push(mapper(rows[i]));
  return out;
}

/** Peta bantu untuk nama: {paketId->nama}, {username->{nama,kelasId}}, {kelasId->nama}. */
function bangunPeta(ss) {
  var petaPaket = {}, petaPengguna = {}, petaKelas = {};
  var rp = readRows(ss.getSheetByName(SHEET_PAKET));
  for (var i = 0; i < rp.length; i++) petaPaket[asString(rp[i][0])] = asString(rp[i][1]);
  var ru = readRows(ss.getSheetByName(SHEET_PENGGUNA));
  for (var j = 0; j < ru.length; j++) {
    petaPengguna[asString(ru[j][2])] = {
      nama: asString(ru[j][1]), kelasId: asString(ru[j][8])
    };
  }
  var rk = readRows(ss.getSheetByName(SHEET_KELAS));
  for (var k = 0; k < rk.length; k++) petaKelas[asString(rk[k][0])] = asString(rk[k][2]);
  return { paket: petaPaket, pengguna: petaPengguna, kelas: petaKelas };
}

// ============================================================
// ENTRY POINT
// ============================================================
function doGet(e) {
  try {
    return jsonResponse({
      success: true,
      data: { service: 'wwn-cbt-80', version: APP_VERSION }
    });
  } catch (err) {
    return jsonResponse({ success: false, error: 'doGet: ' + err.message });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    // Baca postData.contents TANPA mengasumsikan content-type
    // (penting untuk navigator.sendBeacon yang memakai text/plain).
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = payload.action || '';
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    switch (action) {
      // ---- publik ----
      case 'ping':
        return jsonResponse({
          success: true,
          data: { version: APP_VERSION, waktu: sekarangISODateTime() }
        });

      case 'initDatabase':
        initializeAllSheets(ss);
        return jsonResponse({
          success: true,
          message: '10 sheet database berhasil diinisialisasi.',
          data: { sheets: SEMUA_SHEET.slice() }
        });

      case 'login':
        return jsonResponse(actionLogin(ss, payload.username, payload.password));

      case 'logout':
        hapusToken(ss, payload.token);
        return jsonResponse({ success: true, message: 'Berhasil keluar.' });

      // ---- butuh login (semua peran) ----
      case 'getAllData':
        return denganAuth(ss, payload, 'siswa', function (user) {
          return actionGetAllData(ss, user);
        });

      // ---- master (admin) ----
      case 'saveJenjang':
        return denganAuth(ss, payload, 'admin', function () {
          return actionSaveJenjang(ss, payload);
        });
      case 'deleteJenjang':
        return denganAuth(ss, payload, 'admin', function () {
          return actionDeleteJenjang(ss, payload);
        });
      case 'saveMapel':
        return denganAuth(ss, payload, 'admin', function () {
          return actionSaveMapel(ss, payload);
        });
      case 'deleteMapel':
        return denganAuth(ss, payload, 'admin', function () {
          return actionDeleteMapel(ss, payload);
        });
      case 'saveKelas':
        return denganAuth(ss, payload, 'admin', function () {
          return actionSaveKelas(ss, payload);
        });
      case 'deleteKelas':
        return denganAuth(ss, payload, 'admin', function () {
          return actionDeleteKelas(ss, payload);
        });

      // ---- pengguna (admin) ----
      case 'savePengguna':
        return denganAuth(ss, payload, 'admin', function () {
          return actionSavePengguna(ss, payload);
        });
      case 'deletePengguna':
        return denganAuth(ss, payload, 'admin', function (user) {
          return actionDeletePengguna(ss, user, payload);
        });
      case 'resetPassword':
        return denganAuth(ss, payload, 'admin', function () {
          return actionResetPassword(ss, payload);
        });
      case 'importSiswa':
        return denganAuth(ss, payload, 'admin', function () {
          return actionImportSiswa(ss, payload.rows);
        });

      // ---- bank soal (guru/admin) ----
      case 'saveSoal':
        return denganAuth(ss, payload, 'guru', function (user) {
          return actionSaveSoal(ss, user, payload);
        });
      case 'deleteSoal':
        return denganAuth(ss, payload, 'guru', function () {
          return actionDeleteSoal(ss, payload);
        });
      case 'importSoal':
        return denganAuth(ss, payload, 'guru', function (user) {
          return actionImportSoal(ss, user, payload);
        });
      case 'importSoalDariForm':
        return denganAuth(ss, payload, 'guru', function (user) {
          return actionImportSoalDariForm(ss, user, payload);
        });

      // ---- paket (guru/admin) ----
      case 'savePaket':
        return denganAuth(ss, payload, 'guru', function (user) {
          return actionSavePaket(ss, user, payload);
        });
      case 'deletePaket':
        return denganAuth(ss, payload, 'guru', function () {
          return actionDeletePaket(ss, payload);
        });

      // ---- sesi ujian (semua peran login) ----
      case 'mulaiSesi':
        return denganAuth(ss, payload, 'siswa', function (user) {
          return actionMulaiSesi(ss, user, payload);
        });
      case 'getSesi':
        return denganAuth(ss, payload, 'siswa', function (user) {
          return actionGetSesi(ss, user, payload);
        });
      case 'batalkanSesi':
        return denganAuth(ss, payload, 'siswa', function (user) {
          return actionBatalkanSesi(ss, user, payload);
        });
      case 'catatPeringatan':
        return denganAuth(ss, payload, 'siswa', function (user) {
          return actionCatatPeringatan(ss, user, payload);
        });
      case 'submitJawaban':
        return denganAuth(ss, payload, 'siswa', function (user) {
          return actionSubmitJawaban(ss, user, payload);
        });
      case 'resetSesi':
        return denganAuth(ss, payload, 'guru', function (user) {
          return actionResetSesi(ss, user, payload);
        });

      // ---- hasil & monitor ----
      case 'rekapHasil':
        return denganAuth(ss, payload, 'guru', function () {
          return actionRekapHasil(ss, payload);
        });
      case 'getHasilSiswa':
        return denganAuth(ss, payload, 'siswa', function (user) {
          return actionGetHasilSiswa(ss, user, payload);
        });
      case 'monitorSesi':
        return denganAuth(ss, payload, 'guru', function () {
          return actionMonitorSesi(ss, payload);
        });

      // ---- pengaturan & upload ----
      case 'savePengaturan':
        return denganAuth(ss, payload, 'admin', function () {
          return actionSavePengaturan(ss, payload);
        });
      case 'uploadLogo':
        return denganAuth(ss, payload, 'admin', function () {
          return actionUploadLogo(ss, payload);
        });
      case 'uploadGambarSoal':
        return denganAuth(ss, payload, 'guru', function () {
          return actionUploadGambarSoal(ss, payload);
        });

      default:
        return jsonResponse({ success: false, message: 'Aksi tidak dikenal: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: 'doPost: ' + err.message });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// ============================================================
// INISIALISASI DATABASE (publik, idempotent)
// ============================================================
function pastikanHeader(sheet, name) {
  var headers = HEADERS[name];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    var existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0].map(asString);
    var perlu = false;
    for (var i = 0; i < headers.length; i++) {
      if (existing[i] !== headers[i]) { perlu = true; break; }
    }
    if (perlu) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  try { sheet.setFrozenRows(1); } catch (e) {}
}

function seedAkun(ss, id, nama, username, password, peran) {
  var sheet = ss.getSheetByName(SHEET_PENGGUNA);
  if (findRowNum(sheet, 3, username) >= 0) return; // sudah ada -> idempotent
  var salt = Utilities.getUuid();
  sheet.appendRow([id, nama, username, hashPassword(password, salt), salt,
    peran, '', '', '', '', '', 1]);
}

function seedJenjang(ss, id, nama) {
  var sheet = ss.getSheetByName(SHEET_JENJANG);
  if (findRowNum(sheet, 2, nama) >= 0) return; // sudah ada -> idempotent
  if (findRowNum(sheet, 1, id) >= 0) return;
  sheet.appendRow([id, nama, sekarangISODateTime()]);
}

function seedMapel(ss, id, jenjangId, nama) {
  var sheet = ss.getSheetByName(SHEET_MAPEL);
  var rows = readRows(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (asString(rows[i][1]) === jenjangId && asString(rows[i][2]) === nama) return;
  }
  sheet.appendRow([id, jenjangId, nama, sekarangISODateTime()]);
}

function initializeAllSheets(ss) {
  for (var i = 0; i < SEMUA_SHEET.length; i++) {
    var sheet = getOrCreateSheet(ss, SEMUA_SHEET[i]);
    pastikanHeader(sheet, SEMUA_SHEET[i]);
  }

  // Seed pengaturan bawaan (hanya kunci yang belum ada)
  var ps = ss.getSheetByName(SHEET_PENGATURAN);
  for (var j = 0; j < DEFAULT_PENGATURAN.length; j++) {
    if (findRowNum(ps, 1, DEFAULT_PENGATURAN[j][0]) < 0) {
      ps.appendRow([DEFAULT_PENGATURAN[j][0], DEFAULT_PENGATURAN[j][1]]);
    }
  }

  // Seed jenjang
  seedJenjang(ss, 'JJG-MTS', 'MTs/SMP');
  seedJenjang(ss, 'JJG-SMA', 'MA/SMA/SMK');

  // Seed mapel contoh per jenjang
  var mapelSeed = ['Literasi Bahasa Indonesia', 'Literasi Bahasa Inggris',
    'Penalaran Matematika'];
  for (var jj = 0; jj < 2; jj++) {
    var jid = jj === 0 ? 'JJG-MTS' : 'JJG-SMA';
    var pref = jj === 0 ? 'MTS' : 'SMA';
    for (var mm = 0; mm < mapelSeed.length; mm++) {
      seedMapel(ss, 'SEED-MAPEL-' + pref + '-' + (mm + 1), jid, mapelSeed[mm]);
    }
  }

  // Seed 2 akun bawaan (hanya jika username belum ada)
  seedAkun(ss, 'USER-ADMIN', 'Administrator', 'admin', 'admin123', 'admin');
  seedAkun(ss, 'USER-GURU', 'Guru', 'guru', 'guru123', 'guru');
}

/** Jalankan manual dari editor untuk memberi izin Google Drive. */
function authorizeDriveAccess() {
  DriveApp.getRootFolder();
  SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Otorisasi Drive OK.');
}

/** Jalankan manual dari editor untuk memberi izin Google Forms. */
function authorizeFormsAccess() {
  try { FormsApp.getActiveForm(); } catch (e) {}
  Logger.log('Otorisasi Forms OK. (Abaikan error form aktif — izin sudah diminta.)');
}

// ============================================================
// AUTH: LOGIN
// ============================================================
function actionLogin(ss, username, password) {
  try {
    username = asString(username);
    password = asString(password);
    if (!username || !password) {
      return { success: false, message: 'Username dan kata sandi wajib diisi.' };
    }
    var sheet = ss.getSheetByName(SHEET_PENGGUNA);
    if (!sheet) return { success: false, message: 'Database belum diinisialisasi.' };
    var rows = readRows(sheet);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (asString(r[2]).toLowerCase() !== username.toLowerCase()) continue;
      // Tolak jika akun nonaktif — pesan sama (jangan bocorkan alasannya)
      if (asString(r[11]) !== '1') {
        return { success: false, message: 'Username atau kata sandi salah' };
      }
      var cocok = hashPassword(password, asString(r[4])) === asString(r[3]);
      if (!cocok) {
        return { success: false, message: 'Username atau kata sandi salah' };
      }
      var token = Utilities.getUuid();
      sheet.getRange(i + 2, 10).setValue(token);
      sheet.getRange(i + 2, 11).setValue(Date.now() + TOKEN_MASA_BERLAKU_MS);
      return {
        success: true,
        message: 'Login berhasil. Selamat datang, ' + asString(r[1]) + '!',
        data: {
          token: token,
          nama: asString(r[1]),
          username: asString(r[2]),
          peran: asString(r[5]),
          nis: asString(r[6]),
          jenjangId: asString(r[7]),
          kelasId: asString(r[8])
        }
      };
    }
    return { success: false, message: 'Username atau kata sandi salah' };
  } catch (err) {
    return { success: false, error: 'login: ' + err.message };
  }
}

// ============================================================
// GET ALL DATA (butuh login; filter menurut peran)
// ============================================================
function actionGetAllData(ss, user) {
  try {
    var peran = user.peran;
    var peta = bangunPeta(ss);
    var now = sekarangISODateTime();

    // --- pengguna ---
    var pengguna;
    if (peran === 'admin') {
      pengguna = bacaSemua(ss, SHEET_PENGGUNA, penggunaKePublik);
    } else if (peran === 'guru') {
      var semua = bacaSemua(ss, SHEET_PENGGUNA, penggunaKePublik);
      pengguna = [];
      for (var i = 0; i < semua.length; i++) {
        if (semua[i].peran === 'guru' || semua[i].peran === 'siswa') pengguna.push(semua[i]);
      }
    } else {
      pengguna = [];
    }

    // --- bankSoal: siswa TIDAK PERNAH menerima kunci/pembahasan ---
    var bankSoal = peran === 'siswa'
      ? []
      : bacaSemua(ss, SHEET_BANKSOAL, bankSoalKeObjek);

    // --- paket ---
    var semuaPaket = readRows(ss.getSheetByName(SHEET_PAKET));
    var paket = [];
    for (var j = 0; j < semuaPaket.length; j++) {
      var rp = semuaPaket[j];
      var untukSiswa = peran === 'siswa';
      if (untukSiswa) {
        if (asInt(rp[15], 1) !== 1) continue;                       // aktif=1
        var mulai = selKeString(rp[9]);
        var selesai = selKeString(rp[10]);
        if (!(mulai <= now && now <= selesai)) continue;            // jendela waktu
        if (asString(rp[2]) !== user.jenjangId) continue;           // jenjang cocok
        var kelasIds = parseJSONLunak(rp[4], []);
        if (!Array.isArray(kelasIds)) kelasIds = [];
        if (kelasIds.length > 0 && kelasIds.indexOf(user.kelasId) < 0) continue;
      }
      paket.push(paketKeObjek(rp, untukSiswa));
    }

    // --- sesi ---
    var semuaSesi = readRows(ss.getSheetByName(SHEET_SESI));
    var sesi = [];
    for (var k = 0; k < semuaSesi.length; k++) {
      if (peran === 'siswa' && asString(semuaSesi[k][2]) !== user.username) continue;
      sesi.push(sesiKeObjek(semuaSesi[k], peta.paket, peta.pengguna, peta.kelas));
    }

    // --- hasil ---
    var semuaHasil = readRows(ss.getSheetByName(SHEET_HASIL));
    var hasil = [];
    for (var m = 0; m < semuaHasil.length; m++) {
      if (peran === 'siswa' && asString(semuaHasil[m][3]) !== user.username) continue;
      hasil.push(hasilKeObjek(semuaHasil[m], peta.paket, peta.pengguna, peta.kelas));
    }

    return {
      success: true,
      data: {
        pengaturan: getSettings(ss),
        jenjang: bacaSemua(ss, SHEET_JENJANG, jenjangKeObjek),
        mapel: bacaSemua(ss, SHEET_MAPEL, mapelKeObjek),
        kelas: bacaSemua(ss, SHEET_KELAS, kelasKeObjek),
        pengguna: pengguna,
        bankSoal: bankSoal,
        paket: paket,
        sesi: sesi,
        hasil: hasil
      }
    };
  } catch (err) {
    return { success: false, error: 'getAllData: ' + err.message };
  }
}

// ============================================================
// MASTER: JENJANG / MAPEL / KELAS (admin)
// ============================================================
function actionSaveJenjang(ss, p) {
  var nama = asString(p.nama);
  if (!nama) return { success: false, message: 'Nama jenjang wajib diisi.' };
  var sheet = ss.getSheetByName(SHEET_JENJANG);
  var id = asString(p.id);
  if (id) {
    var rowNum = findRowNum(sheet, 1, id);
    if (rowNum < 0) return { success: false, message: 'Jenjang tidak ditemukan.' };
    sheet.getRange(rowNum, 2).setValue(nama);
    return { success: true, message: 'Jenjang berhasil diubah.', data: { id: id } };
  }
  var baru = Utilities.getUuid();
  sheet.appendRow([baru, nama, sekarangISODateTime()]);
  return { success: true, message: 'Jenjang berhasil disimpan.', data: { id: baru } };
}

function actionDeleteJenjang(ss, p) {
  var id = asString(p.id);
  if (!id) return { success: false, message: 'ID jenjang wajib diisi.' };
  var sheet = ss.getSheetByName(SHEET_JENJANG);
  if (findRowNum(sheet, 1, id) < 0) {
    return { success: false, message: 'Jenjang tidak ditemukan.' };
  }
  var pakai = [];
  if (hitungPakai(ss.getSheetByName(SHEET_MAPEL), 2, id) > 0) pakai.push('mapel');
  if (hitungPakai(ss.getSheetByName(SHEET_KELAS), 2, id) > 0) pakai.push('kelas');
  if (hitungPakai(ss.getSheetByName(SHEET_BANKSOAL), 2, id) > 0) pakai.push('bank soal');
  if (hitungPakai(ss.getSheetByName(SHEET_PAKET), 3, id) > 0) pakai.push('paket');
  if (pakai.length > 0) {
    return { success: false, message: 'Jenjang tidak dapat dihapus karena masih dipakai di: ' + pakai.join(', ') + '.' };
  }
  sheet.deleteRow(findRowNum(sheet, 1, id));
  return { success: true, message: 'Jenjang berhasil dihapus.' };
}

function actionSaveMapel(ss, p) {
  var nama = asString(p.nama);
  var jenjangId = asString(p.jenjangId);
  if (!nama) return { success: false, message: 'Nama mapel wajib diisi.' };
  if (!jenjangId) return { success: false, message: 'Jenjang wajib dipilih.' };
  if (findRowNum(ss.getSheetByName(SHEET_JENJANG), 1, jenjangId) < 0) {
    return { success: false, message: 'Jenjang tidak ditemukan.' };
  }
  var sheet = ss.getSheetByName(SHEET_MAPEL);
  var id = asString(p.id);
  if (id) {
    var rowNum = findRowNum(sheet, 1, id);
    if (rowNum < 0) return { success: false, message: 'Mapel tidak ditemukan.' };
    sheet.getRange(rowNum, 2, 1, 2).setValues([[jenjangId, nama]]);
    return { success: true, message: 'Mapel berhasil diubah.', data: { id: id } };
  }
  var baru = Utilities.getUuid();
  sheet.appendRow([baru, jenjangId, nama, sekarangISODateTime()]);
  return { success: true, message: 'Mapel berhasil disimpan.', data: { id: baru } };
}

function actionDeleteMapel(ss, p) {
  var id = asString(p.id);
  if (!id) return { success: false, message: 'ID mapel wajib diisi.' };
  var sheet = ss.getSheetByName(SHEET_MAPEL);
  if (findRowNum(sheet, 1, id) < 0) {
    return { success: false, message: 'Mapel tidak ditemukan.' };
  }
  var pakai = [];
  if (hitungPakai(ss.getSheetByName(SHEET_BANKSOAL), 3, id) > 0) pakai.push('bank soal');
  if (hitungPakai(ss.getSheetByName(SHEET_PAKET), 4, id) > 0) pakai.push('paket');
  if (pakai.length > 0) {
    return { success: false, message: 'Mapel tidak dapat dihapus karena masih dipakai di: ' + pakai.join(', ') + '.' };
  }
  sheet.deleteRow(findRowNum(sheet, 1, id));
  return { success: true, message: 'Mapel berhasil dihapus.' };
}

function actionSaveKelas(ss, p) {
  var nama = asString(p.nama);
  var jenjangId = asString(p.jenjangId);
  if (!nama) return { success: false, message: 'Nama kelas wajib diisi.' };
  if (!jenjangId) return { success: false, message: 'Jenjang wajib dipilih.' };
  if (findRowNum(ss.getSheetByName(SHEET_JENJANG), 1, jenjangId) < 0) {
    return { success: false, message: 'Jenjang tidak ditemukan.' };
  }
  var sheet = ss.getSheetByName(SHEET_KELAS);
  var id = asString(p.id);
  if (id) {
    var rowNum = findRowNum(sheet, 1, id);
    if (rowNum < 0) return { success: false, message: 'Kelas tidak ditemukan.' };
    sheet.getRange(rowNum, 2, 1, 2).setValues([[jenjangId, nama]]);
    return { success: true, message: 'Kelas berhasil diubah.', data: { id: id } };
  }
  var baru = Utilities.getUuid();
  sheet.appendRow([baru, jenjangId, nama, sekarangISODateTime()]);
  return { success: true, message: 'Kelas berhasil disimpan.', data: { id: baru } };
}

function actionDeleteKelas(ss, p) {
  var id = asString(p.id);
  if (!id) return { success: false, message: 'ID kelas wajib diisi.' };
  var sheet = ss.getSheetByName(SHEET_KELAS);
  if (findRowNum(sheet, 1, id) < 0) {
    return { success: false, message: 'Kelas tidak ditemukan.' };
  }
  var pakai = [];
  if (hitungPakai(ss.getSheetByName(SHEET_PENGGUNA), 9, id) > 0) pakai.push('pengguna');
  if (paketPakaiKelas(ss, id)) pakai.push('paket');
  if (pakai.length > 0) {
    return { success: false, message: 'Kelas tidak dapat dihapus karena masih dipakai di: ' + pakai.join(', ') + '.' };
  }
  sheet.deleteRow(findRowNum(sheet, 1, id));
  return { success: true, message: 'Kelas berhasil dihapus.' };
}

/** true jika ada Paket yang KelasIDsJSON-nya memuat kelasId. */
function paketPakaiKelas(ss, kelasId) {
  var rows = readRows(ss.getSheetByName(SHEET_PAKET));
  for (var i = 0; i < rows.length; i++) {
    var ids = parseJSONLunak(rows[i][4], []);
    if (Array.isArray(ids) && ids.indexOf(kelasId) >= 0) return true;
  }
  return false;
}

// ============================================================
// PENGGUNA (admin)
// ============================================================
function cariPenggunaByUsername(ss, username, kecualiId) {
  var rows = readRows(ss.getSheetByName(SHEET_PENGGUNA));
  var cari = asString(username).toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (asString(rows[i][2]).toLowerCase() === cari &&
        asString(rows[i][0]) !== asString(kecualiId)) {
      return { rowNum: i + 2, row: rows[i] };
    }
  }
  return null;
}

function actionSavePengguna(ss, p) {
  try {
    var nama = asString(p.nama);
    var username = asString(p.username);
    var peran = asString(p.peran).toLowerCase();
    var password = p.password === undefined || p.password === null ? '' : String(p.password);
    var nis = asString(p.nis);
    var jenjangId = asString(p.jenjangId);
    var kelasId = asString(p.kelasId);
    var id = asString(p.id);

    if (!nama) return { success: false, message: 'Nama wajib diisi.' };
    if (!username) return { success: false, message: 'Username wajib diisi.' };
    if (PERAN_VALID.indexOf(peran) < 0) {
      return { success: false, message: 'Peran tidak valid (admin/guru/siswa).' };
    }
    if (cariPenggunaByUsername(ss, username, id)) {
      return { success: false, message: 'Username sudah dipakai.' };
    }

    if (peran === 'siswa') {
      if (!nis) return { success: false, message: 'NIS wajib diisi untuk peran siswa.' };
      if (!jenjangId) return { success: false, message: 'Jenjang wajib dipilih untuk siswa.' };
      if (!kelasId) return { success: false, message: 'Kelas wajib dipilih untuk siswa.' };
      if (findRowNum(ss.getSheetByName(SHEET_JENJANG), 1, jenjangId) < 0) {
        return { success: false, message: 'Jenjang tidak ditemukan.' };
      }
      var kelasRow = cariBarisById(ss, SHEET_KELAS, kelasId);
      if (!kelasRow) return { success: false, message: 'Kelas tidak ditemukan.' };
      if (asString(kelasRow[1]) !== jenjangId) {
        return { success: false, message: 'Kelas tidak berada pada jenjang yang dipilih.' };
      }
      if (!password && !id) password = nis; // default password siswa = NIS
    }

    var sheet = ss.getSheetByName(SHEET_PENGGUNA);
    if (id) {
      // --- update ---
      var rowNum = findRowNum(sheet, 1, id);
      if (rowNum < 0) return { success: false, message: 'Pengguna tidak ditemukan.' };
      var lama = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
      var hashLama = asString(lama[3]);
      var saltLama = asString(lama[4]);
      var aktifLama = asInt(lama[11], 1);
      var aktif = (p.aktif === undefined || p.aktif === null) ? aktifLama : asFlag(p.aktif, aktifLama);
      var hashBaru = hashLama, saltBaru = saltLama;
      if (password) {
        saltBaru = Utilities.getUuid();
        hashBaru = hashPassword(password, saltBaru);
      }
      sheet.getRange(rowNum, 2, 1, 11).setValues([[
        nama, username, hashBaru, saltBaru, peran, nis, jenjangId, kelasId,
        asString(lama[9]), asString(lama[10]), aktif
      ]]);
      return { success: true, message: 'Pengguna berhasil diubah.', data: { id: id } };
    }

    // --- tambah ---
    if (!password) {
      // peran siswa sudah dapat default = NIS di atas; admin/guru wajib isi
      return { success: false, message: 'Password wajib diisi untuk peran admin/guru.' };
    }
    var salt = Utilities.getUuid();
    var baru = Utilities.getUuid();
    sheet.appendRow([baru, nama, username, hashPassword(password, salt), salt,
      peran, nis, jenjangId, kelasId, '', '', 1]);
    return { success: true, message: 'Pengguna berhasil disimpan.', data: { id: baru } };
  } catch (err) {
    return { success: false, error: 'savePengguna: ' + err.message };
  }
}

function actionDeletePengguna(ss, user, p) {
  try {
    var id = asString(p.id);
    if (!id) return { success: false, message: 'ID pengguna wajib diisi.' };
    if (id === user.id) {
      return { success: false, message: 'Tidak dapat menghapus akun sendiri.' };
    }
    var sheet = ss.getSheetByName(SHEET_PENGGUNA);
    var rowNum = findRowNum(sheet, 1, id);
    if (rowNum < 0) return { success: false, message: 'Pengguna tidak ditemukan.' };
    var target = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (asString(target[5]) === 'admin') {
      var rows = readRows(sheet);
      var jumlahAdmin = 0;
      for (var i = 0; i < rows.length; i++) {
        if (asString(rows[i][5]) === 'admin' && asString(rows[i][11]) === '1') jumlahAdmin++;
      }
      if (jumlahAdmin <= 1) {
        return { success: false, message: 'Tidak dapat menghapus admin terakhir.' };
      }
    }
    sheet.deleteRow(rowNum);
    return { success: true, message: 'Pengguna berhasil dihapus.' };
  } catch (err) {
    return { success: false, error: 'deletePengguna: ' + err.message };
  }
}

function actionResetPassword(ss, p) {
  try {
    var id = asString(p.id);
    var passwordBaru = p.passwordBaru === undefined || p.passwordBaru === null
      ? '' : String(p.passwordBaru);
    if (!id) return { success: false, message: 'ID pengguna wajib diisi.' };
    if (!passwordBaru) {
      return { success: false, message: 'Kata sandi baru wajib diisi.' };
    }
    var sheet = ss.getSheetByName(SHEET_PENGGUNA);
    var rowNum = findRowNum(sheet, 1, id);
    if (rowNum < 0) return { success: false, message: 'Pengguna tidak ditemukan.' };
    var salt = Utilities.getUuid();
    sheet.getRange(rowNum, 4, 1, 2).setValues([[hashPassword(passwordBaru, salt), salt]]);
    // Paksa login ulang: kosongkan token
    sheet.getRange(rowNum, 10, 1, 2).setValues([['', '']]);
    return { success: true, message: 'Kata sandi berhasil direset.', data: { id: id } };
  } catch (err) {
    return { success: false, error: 'resetPassword: ' + err.message };
  }
}

/**
 * Cari kelas berdasarkan NAMA (case-insensitive). Jika namaJenjang diberikan,
 * cari pada jenjang itu; jika tidak, ambil kelas pertama yang namanya cocok.
 * Mengembalikan {id, jenjangId, nama} atau null.
 */
function cariKelasByNama(ss, namaKelas, namaJenjang) {
  var cari = asString(namaKelas).toLowerCase();
  var petaJenjang = {}; // nama lower -> id
  if (namaJenjang) {
    var rj = readRows(ss.getSheetByName(SHEET_JENJANG));
    for (var j = 0; j < rj.length; j++) {
      petaJenjang[asString(rj[j][1]).toLowerCase()] = asString(rj[j][0]);
    }
  }
  var rk = readRows(ss.getSheetByName(SHEET_KELAS));
  for (var i = 0; i < rk.length; i++) {
    if (asString(rk[i][2]).toLowerCase() !== cari) continue;
    var jid = asString(rk[i][1]);
    if (namaJenjang) {
      var jidCari = petaJenjang[asString(namaJenjang).toLowerCase()];
      if (!jidCari || jid !== jidCari) continue;
    }
    return { id: asString(rk[i][0]), jenjangId: jid, nama: asString(rk[i][2]) };
  }
  return null;
}

function actionImportSiswa(ss, rows) {
  var hasil = { imported: 0, updated: 0, errors: [] };
  try {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { success: false, message: 'Data baris kosong.' };
    }
    var sheet = ss.getSheetByName(SHEET_PENGGUNA);
    for (var i = 0; i < rows.length; i++) {
      var baris = i + 1;
      var nama = asString(rows[i] && rows[i].nama);
      var nis = asString(rows[i] && rows[i].nis);
      var namaKelas = asString(rows[i] && rows[i].kelas);
      var namaJenjang = asString(rows[i] && rows[i].jenjang);
      var username = asString(rows[i] && rows[i].username);
      var password = rows[i] && rows[i].password !== undefined && rows[i].password !== null
        ? String(rows[i].password) : '';
      if (!nama) { hasil.errors.push({ baris: baris, pesan: 'Nama wajib diisi.' }); continue; }
      if (!nis) { hasil.errors.push({ baris: baris, pesan: 'NIS wajib diisi.' }); continue; }
      if (!namaKelas) { hasil.errors.push({ baris: baris, pesan: 'Kelas wajib diisi.' }); continue; }

      var kelas = cariKelasByNama(ss, namaKelas, namaJenjang || '');
      if (!kelas) {
        hasil.errors.push({ baris: baris, pesan: 'Kelas "' + namaKelas + '" tidak ditemukan.' });
        continue;
      }

      var usernameAkhir = username || nis;
      var duplikat = cariPenggunaByUsername(ss, usernameAkhir, '');
      // Duplikat ditentukan dari NIS (case-insensitive)
      var adaNis = null;
      var semuaRows = readRows(sheet);
      for (var d = 0; d < semuaRows.length; d++) {
        if (asString(semuaRows[d][6]).toLowerCase() === nis.toLowerCase()) {
          adaNis = { rowNum: d + 2, row: semuaRows[d] };
          break;
        }
      }
      if (adaNis && duplikat && asString(duplikat.row[0]) !== asString(adaNis.row[0])) {
        hasil.errors.push({ baris: baris, pesan: 'Username "' + usernameAkhir + '" sudah dipakai pengguna lain.' });
        continue;
      }

      if (adaNis) {
        // Duplikat NIS -> UPDATE (nama/kelas/akun)
        var rn = adaNis.rowNum;
        sheet.getRange(rn, 2, 1, 2).setValues([[nama, usernameAkhir]]);
        sheet.getRange(rn, 7, 1, 3).setValues([[nis, kelas.jenjangId, kelas.id]]);
        if (password) {
          var saltU = Utilities.getUuid();
          sheet.getRange(rn, 4, 1, 2).setValues([[hashPassword(password, saltU), saltU]]);
        }
        hasil.updated++;
      } else {
        if (duplikat) {
          hasil.errors.push({ baris: baris, pesan: 'Username "' + usernameAkhir + '" sudah dipakai.' });
          continue;
        }
        var salt = Utilities.getUuid();
        var passAkhir = password || nis;
        sheet.appendRow([Utilities.getUuid(), nama, usernameAkhir,
          hashPassword(passAkhir, salt), salt, 'siswa',
          nis, kelas.jenjangId, kelas.id, '', '', 1]);
        hasil.imported++;
      }
    }
    return {
      success: true,
      message: 'Impor selesai: ' + hasil.imported + ' baru, ' + hasil.updated +
        ' diperbarui, ' + hasil.errors.length + ' gagal.',
      data: hasil
    };
  } catch (err) {
    return { success: false, error: 'importSiswa: ' + err.message };
  }
}

// ============================================================
// BANK SOAL (guru/admin)
// ============================================================
/**
 * Validasi satu butir soal. Mengembalikan {ok:true, data:{...}} atau
 * {ok:false, message}. data berisi field yang sudah dibersihkan.
 */
function validasiSoal(ss, p) {
  var jenjangId = asString(p.jenjangId);
  var mapelId = asString(p.mapelId);
  var soal = asString(p.soal);
  var opsi = [asString(p.opsiA), asString(p.opsiB), asString(p.opsiC),
    asString(p.opsiD), asString(p.opsiE)];
  var kunci = asString(p.kunci).toUpperCase();
  var bobot = p.bobot === undefined || p.bobot === null || p.bobot === ''
    ? 1 : asInt(p.bobot, -1);
  var pembahasan = asString(p.pembahasan);
  var gambarUrl = asString(p.gambarUrl);

  if (!jenjangId) return { ok: false, message: 'Jenjang wajib dipilih.' };
  if (!mapelId) return { ok: false, message: 'Mapel wajib dipilih.' };
  if (findRowNum(ss.getSheetByName(SHEET_JENJANG), 1, jenjangId) < 0) {
    return { ok: false, message: 'Jenjang tidak ditemukan.' };
  }
  if (findRowNum(ss.getSheetByName(SHEET_MAPEL), 1, mapelId) < 0) {
    return { ok: false, message: 'Mapel tidak ditemukan.' };
  }
  if (!soal) return { ok: false, message: 'Teks soal wajib diisi.' };
  var namaOpsi = ['A', 'B', 'C', 'D'];
  for (var i = 0; i < 4; i++) {
    if (!opsi[i]) return { ok: false, message: 'Opsi ' + namaOpsi[i] + ' wajib diisi.' };
  }
  if (KUNCI_VALID.indexOf(kunci) < 0) {
    return { ok: false, message: 'Kunci tidak valid (A-E).' };
  }
  var idxKunci = KUNCI_VALID.indexOf(kunci);
  if (!opsi[idxKunci]) {
    return { ok: false, message: 'Kunci ' + kunci + ' menunjuk ke opsi yang kosong.' };
  }
  if (bobot < 1) return { ok: false, message: 'Bobot harus bilangan bulat >= 1.' };

  return {
    ok: true,
    data: {
      jenjangId: jenjangId, mapelId: mapelId, soal: soal,
      opsiA: opsi[0], opsiB: opsi[1], opsiC: opsi[2], opsiD: opsi[3], opsiE: opsi[4],
      kunci: kunci, bobot: bobot, pembahasan: pembahasan, gambarUrl: gambarUrl
    }
  };
}

function actionSaveSoal(ss, user, p) {
  try {
    var v = validasiSoal(ss, p);
    if (!v.ok) return { success: false, message: v.message };
    var d = v.data;
    var sheet = ss.getSheetByName(SHEET_BANKSOAL);
    var id = asString(p.id);
    if (id) {
      var rowNum = findRowNum(sheet, 1, id);
      if (rowNum < 0) return { success: false, message: 'Soal tidak ditemukan.' };
      sheet.getRange(rowNum, 2, 1, 12).setValues([[
        d.jenjangId, d.mapelId, d.soal, d.opsiA, d.opsiB, d.opsiC, d.opsiD,
        d.opsiE, d.kunci, d.bobot, d.pembahasan, d.gambarUrl
      ]]);
      return { success: true, message: 'Soal berhasil diubah.', data: { id: id } };
    }
    var baru = Utilities.getUuid();
    sheet.appendRow([baru, d.jenjangId, d.mapelId, d.soal, d.opsiA, d.opsiB,
      d.opsiC, d.opsiD, d.opsiE, d.kunci, d.bobot, d.pembahasan, d.gambarUrl,
      sekarangISODateTime(), user.username]);
    return { success: true, message: 'Soal berhasil disimpan.', data: { id: baru } };
  } catch (err) {
    return { success: false, error: 'saveSoal: ' + err.message };
  }
}

/** true jika ada Paket mode manual yang SoalIDsJSON-nya memuat soalId. */
function paketManualPakaiSoal(ss, soalId) {
  var rows = readRows(ss.getSheetByName(SHEET_PAKET));
  for (var i = 0; i < rows.length; i++) {
    if (asString(rows[i][5]) !== 'manual') continue;
    var ids = parseJSONLunak(rows[i][6], []);
    if (Array.isArray(ids) && ids.indexOf(soalId) >= 0) return true;
  }
  return false;
}

function actionDeleteSoal(ss, p) {
  try {
    var id = asString(p.id);
    if (!id) return { success: false, message: 'ID soal wajib diisi.' };
    var sheet = ss.getSheetByName(SHEET_BANKSOAL);
    if (findRowNum(sheet, 1, id) < 0) {
      return { success: false, message: 'Soal tidak ditemukan.' };
    }
    if (paketManualPakaiSoal(ss, id)) {
      return { success: false, message: 'Soal tidak dapat dihapus karena dipakai paket mode manual.' };
    }
    sheet.deleteRow(findRowNum(sheet, 1, id));
    return { success: true, message: 'Soal berhasil dihapus.' };
  } catch (err) {
    return { success: false, error: 'deleteSoal: ' + err.message };
  }
}

function actionImportSoal(ss, user, p) {
  var hasil = { imported: 0, errors: [] };
  try {
    var jenjangId = asString(p.jenjangId);
    var mapelId = asString(p.mapelId);
    var items = p.items;
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, message: 'Data soal kosong.' };
    }
    var sheet = ss.getSheetByName(SHEET_BANKSOAL);
    for (var i = 0; i < items.length; i++) {
      var baris = i + 1;
      var it = items[i] || {};
      it.jenjangId = it.jenjangId || jenjangId;
      it.mapelId = it.mapelId || mapelId;
      var v = validasiSoal(ss, it);
      if (!v.ok) {
        hasil.errors.push({ baris: baris, pesan: v.message });
        continue;
      }
      var d = v.data;
      sheet.appendRow([Utilities.getUuid(), d.jenjangId, d.mapelId, d.soal,
        d.opsiA, d.opsiB, d.opsiC, d.opsiD, d.opsiE, d.kunci, d.bobot,
        d.pembahasan, d.gambarUrl, sekarangISODateTime(), user.username]);
      hasil.imported++;
    }
    return {
      success: true,
      message: 'Impor selesai: ' + hasil.imported + ' soal diimpor, ' +
        hasil.errors.length + ' gagal.',
      data: hasil
    };
  } catch (err) {
    return { success: false, error: 'importSoal: ' + err.message };
  }
}

/**
 * Impor soal dari Google Form (mode kuis). Hanya berjalan di Apps Script;
 * di lingkungan tanpa FormsApp (mis. diuji di node) kembalikan error ramah.
 */
function actionImportSoalDariForm(ss, user, p) {
  try {
    if (typeof FormsApp === 'undefined') {
      return { success: false, message: 'Impor Google Form hanya bisa dijalankan di Apps Script.' };
    }
    var formIdOrUrl = asString(p.formIdOrUrl);
    var jenjangId = asString(p.jenjangId);
    var mapelId = asString(p.mapelId);
    if (!formIdOrUrl) {
      return { success: false, message: 'ID atau URL Google Form wajib diisi.' };
    }
    if (!jenjangId || findRowNum(ss.getSheetByName(SHEET_JENJANG), 1, jenjangId) < 0) {
      return { success: false, message: 'Jenjang tidak ditemukan.' };
    }
    if (!mapelId || findRowNum(ss.getSheetByName(SHEET_MAPEL), 1, mapelId) < 0) {
      return { success: false, message: 'Mapel tidak ditemukan.' };
    }

    // Ambil ID form dari URL (.../d/<ID>/...) atau pakai ID mentah
    var m = formIdOrUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    var formId = m ? m[1] : formIdOrUrl;
    var form;
    try {
      form = FormsApp.openById(formId);
    } catch (e0) {
      return { success: false, message: 'Google Form tidak ditemukan atau tidak dapat diakses.' };
    }

    var items = form.getItems();
    var sheet = ss.getSheetByName(SHEET_BANKSOAL);
    var imported = 0;
    var dilewati = [];
    var huruf = ['A', 'B', 'C', 'D', 'E'];

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var judul = '';
      try { judul = asString(item.getTitle()); } catch (e1) {}
      if (!judul) judul = 'Soal ke-' + (i + 1);

      if (item.getType() !== FormsApp.ItemType.MULTIPLE_CHOICE) {
        dilewati.push({ judul: judul, alasan: 'Bukan soal pilihan ganda.' });
        continue;
      }
      var choices = [];
      try { choices = item.asMultipleChoiceItem().getChoices(); } catch (e2) {}
      if (!choices || choices.length < 2) {
        dilewati.push({ judul: judul, alasan: 'Jumlah opsi kurang dari 2.' });
        continue;
      }
      if (choices.length > 5) {
        dilewati.push({ judul: judul, alasan: 'Jumlah opsi lebih dari 5.' });
        continue;
      }
      var kunciIdx = -1;
      var kunciGanda = false;
      for (var c = 0; c < choices.length; c++) {
        var benar = false;
        try { benar = !!choices[c].isCorrectAnswer(); } catch (e3) {}
        if (benar) {
          if (kunciIdx >= 0) kunciGanda = true;
          kunciIdx = c;
        }
      }
      if (kunciIdx < 0) {
        dilewati.push({ judul: judul, alasan: 'Tidak ada kunci jawaban (aktifkan mode kuis di Google Form).' });
        continue;
      }
      if (kunciGanda) {
        dilewati.push({ judul: judul, alasan: 'Lebih dari satu kunci jawaban.' });
        continue;
      }
      var opsi = ['', '', '', '', ''];
      for (var c2 = 0; c2 < choices.length; c2++) {
        try { opsi[c2] = asString(choices[c2].getValue()); } catch (e4) {}
      }
      sheet.appendRow([Utilities.getUuid(), jenjangId, mapelId, judul,
        opsi[0], opsi[1], opsi[2], opsi[3], opsi[4],
        huruf[kunciIdx], 1, '', '', sekarangISODateTime(), user.username]);
      imported++;
    }

    return {
      success: true,
      message: 'Impor selesai: ' + imported + ' soal diimpor, ' +
        dilewati.length + ' dilewati.',
      data: { imported: imported, dilewati: dilewati }
    };
  } catch (err) {
    return { success: false, error: 'importSoalDariForm: ' + err.message };
  }
}

// ============================================================
// PAKET TRY OUT (guru/admin)
// ============================================================
function jumlahSoalBank(ss, jenjangId, mapelId) {
  var rows = readRows(ss.getSheetByName(SHEET_BANKSOAL));
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    if (asString(rows[i][1]) === jenjangId && asString(rows[i][2]) === mapelId) n++;
  }
  return n;
}

function actionSavePaket(ss, user, p) {
  try {
    var nama = asString(p.nama);
    var jenjangId = asString(p.jenjangId);
    var mapelId = asString(p.mapelId);
    var modeSoal = asString(p.modeSoal);
    var durasiMenit = asInt(p.durasiMenit, 0);
    var mulai = asString(p.mulai);
    var selesai = asString(p.selesai);

    if (!nama) return { success: false, message: 'Nama paket wajib diisi.' };
    if (!jenjangId) return { success: false, message: 'Jenjang wajib dipilih.' };
    if (!mapelId) return { success: false, message: 'Mapel wajib dipilih.' };
    if (findRowNum(ss.getSheetByName(SHEET_JENJANG), 1, jenjangId) < 0) {
      return { success: false, message: 'Jenjang tidak ditemukan.' };
    }
    if (findRowNum(ss.getSheetByName(SHEET_MAPEL), 1, mapelId) < 0) {
      return { success: false, message: 'Mapel tidak ditemukan.' };
    }
    if (MODE_SOAL_VALID.indexOf(modeSoal) < 0) {
      return { success: false, message: 'Mode soal tidak valid (manual/acak).' };
    }
    if (!(durasiMenit >= 5 && durasiMenit <= 300)) {
      return { success: false, message: 'Durasi harus 5-300 menit.' };
    }
    var dMulai = parseDatetime(mulai);
    var dSelesai = parseDatetime(selesai);
    if (!dMulai) {
      return { success: false, message: 'Format mulai tidak valid (yyyy-MM-dd HH:mm:ss).' };
    }
    if (!dSelesai) {
      return { success: false, message: 'Format selesai tidak valid (yyyy-MM-dd HH:mm:ss).' };
    }
    if (dSelesai.getTime() <= dMulai.getTime()) {
      return { success: false, message: 'Waktu selesai harus setelah waktu mulai.' };
    }

    var soalIds = [];
    var jumlahAcak = 0;
    if (modeSoal === 'manual') {
      soalIds = p.soalIds;
      if (!Array.isArray(soalIds) || soalIds.length < 1) {
        return { success: false, message: 'Mode manual membutuhkan minimal 1 soal.' };
      }
      var sheetSoal = ss.getSheetByName(SHEET_BANKSOAL);
      for (var s = 0; s < soalIds.length; s++) {
        if (findRowNum(sheetSoal, 1, asString(soalIds[s])) < 0) {
          return { success: false, message: 'Soal tidak ditemukan: ' + asString(soalIds[s]) };
        }
        soalIds[s] = asString(soalIds[s]);
      }
    } else {
      jumlahAcak = asInt(p.jumlahAcak, 0);
      if (jumlahAcak < 1) {
        return { success: false, message: 'Jumlah soal acak minimal 1.' };
      }
      var tersedia = jumlahSoalBank(ss, jenjangId, mapelId);
      if (jumlahAcak > tersedia) {
        return { success: false, message: 'Jumlah soal acak melebihi jumlah soal di bank (' + tersedia + ').' };
      }
    }

    var kelasIds = p.kelasIds === undefined || p.kelasIds === null ? [] : p.kelasIds;
    if (!Array.isArray(kelasIds)) {
      return { success: false, message: 'kelasIds harus berupa array ID kelas.' };
    }
    var sheetKelas = ss.getSheetByName(SHEET_KELAS);
    var kelasBersih = [];
    for (var k = 0; k < kelasIds.length; k++) {
      var kid = asString(kelasIds[k]);
      if (findRowNum(sheetKelas, 1, kid) < 0) {
        return { success: false, message: 'Kelas tidak ditemukan: ' + kid };
      }
      if (kelasBersih.indexOf(kid) < 0) kelasBersih.push(kid);
    }

    var acakSoal = asFlag(p.acakSoal, 1);
    var acakOpsi = asFlag(p.acakOpsi, 1);
    var tampilSkor = asFlag(p.tampilSkor, 1);
    var tampilPembahasan = asFlag(p.tampilPembahasan, 1);
    var aktif = asFlag(p.aktif, 1);

    var sheet = ss.getSheetByName(SHEET_PAKET);
    var id = asString(p.id);
    if (id) {
      var rowNum = findRowNum(sheet, 1, id);
      if (rowNum < 0) return { success: false, message: 'Paket tidak ditemukan.' };
      sheet.getRange(rowNum, 2, 1, 15).setValues([[
        nama, jenjangId, mapelId, JSON.stringify(kelasBersih), modeSoal,
        JSON.stringify(soalIds), jumlahAcak, durasiMenit, mulai, selesai,
        acakSoal, acakOpsi, tampilSkor, tampilPembahasan, aktif
      ]]);
      return { success: true, message: 'Paket berhasil diubah.', data: { id: id } };
    }
    var baru = Utilities.getUuid();
    sheet.appendRow([baru, nama, jenjangId, mapelId, JSON.stringify(kelasBersih),
      modeSoal, JSON.stringify(soalIds), jumlahAcak, durasiMenit, mulai, selesai,
      acakSoal, acakOpsi, tampilSkor, tampilPembahasan, aktif,
      sekarangISODateTime(), user.username]);
    return { success: true, message: 'Paket berhasil disimpan.', data: { id: baru } };
  } catch (err) {
    return { success: false, error: 'savePaket: ' + err.message };
  }
}

function actionDeletePaket(ss, p) {
  try {
    var id = asString(p.id);
    if (!id) return { success: false, message: 'ID paket wajib diisi.' };
    var sheet = ss.getSheetByName(SHEET_PAKET);
    var rowNum = findRowNum(sheet, 1, id);
    if (rowNum < 0) return { success: false, message: 'Paket tidak ditemukan.' };
    sheet.deleteRow(rowNum);
    return { success: true, message: 'Paket berhasil dihapus.', data: { id: id } };
  } catch (err) {
    return { success: false, error: 'deletePaket: ' + err.message };
  }
}

// ============================================================
// SESI UJIAN
// ============================================================
/** Ambil baris paket sebagai objek; null jika tidak ada. */
function ambilPaket(ss, paketId) {
  var r = cariBarisById(ss, SHEET_PAKET, paketId);
  if (!r) return null;
  var soalIds = parseJSONLunak(r[6], []);
  if (!Array.isArray(soalIds)) soalIds = [];
  var kelasIds = parseJSONLunak(r[4], []);
  if (!Array.isArray(kelasIds)) kelasIds = [];
  return {
    id: asString(r[0]), nama: asString(r[1]),
    jenjangId: asString(r[2]), mapelId: asString(r[3]),
    kelasIds: kelasIds, modeSoal: asString(r[5]), soalIds: soalIds,
    jumlahAcak: asInt(r[7], 0), durasiMenit: asInt(r[8], 60),
    mulai: selKeString(r[9]), selesai: selKeString(r[10]),
    acakSoal: asInt(r[11], 1), acakOpsi: asInt(r[12], 1),
    tampilSkor: asInt(r[13], 1), tampilPembahasan: asInt(r[14], 1),
    aktif: asInt(r[15], 1)
  };
}

/** ID soal bank pada jenjang+mapel tertentu. */
function soalIdsBank(ss, jenjangId, mapelId) {
  var rows = readRows(ss.getSheetByName(SHEET_BANKSOAL));
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (asString(rows[i][1]) === jenjangId && asString(rows[i][2]) === mapelId) {
      out.push(asString(rows[i][0]));
    }
  }
  return out;
}

/**
 * Susun daftar soal untuk dikirim ke klien dari snapshot SoalIDsJSON.
 * TIDAK PERNAH menyertakan kunci/pembahasan.
 * Bentuk: [{id, teks, gambarUrl, opsi:[{kode, teks}]}].
 * `kode` = kode asli (A-E) agar penilaian server tetap cocok.
 */
function susunSoalUntukKlien(ss, soalIds, acakOpsi) {
  var bank = readRows(ss.getSheetByName(SHEET_BANKSOAL));
  var peta = {};
  for (var i = 0; i < bank.length; i++) peta[asString(bank[i][0])] = bank[i];
  var out = [];
  for (var s = 0; s < soalIds.length; s++) {
    var r = peta[asString(soalIds[s])];
    if (!r) continue; // soal dihapus setelah sesi dibuat -> lewati
    var opsi = [];
    var teksOpsi = [asString(r[4]), asString(r[5]), asString(r[6]),
      asString(r[7]), asString(r[8])];
    for (var o = 0; o < 5; o++) {
      if (!teksOpsi[o]) continue; // opsi E boleh kosong
      opsi.push({ kode: KUNCI_VALID[o], teks: teksOpsi[o] });
    }
    if (acakOpsi === 1) opsi = acakArray(opsi);
    out.push({
      id: asString(r[0]),
      teks: asString(r[3]),
      gambarUrl: asString(r[12]),
      opsi: opsi
    });
  }
  return out;
}

/** Cari semua sesi milik username pada paketId, urut terbaru dulu. */
function cariSesiUser(ss, username, paketId) {
  var rows = readRows(ss.getSheetByName(SHEET_SESI));
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (asString(rows[i][1]) === paketId && asString(rows[i][2]) === username) {
      out.push({ rowNum: i + 2, row: rows[i] });
    }
  }
  // Terbaru dulu (DibuatPada format sebanding; tie -> baris lebih bawah menang)
  out.sort(function (a, b) {
    var da = selKeString(a.row[8]);
    var db = selKeString(b.row[8]);
    if (db !== da) return db < da ? -1 : 1;
    return b.rowNum - a.rowNum;
  });
  return out;
}

function sesiRingkas(row) {
  return {
    id: asString(row[0]),
    paketId: asString(row[1]),
    waktuMulai: selKeString(row[3]),
    waktuSelesai: selKeString(row[4]),
    status: asString(row[5]),
    peringatan: asInt(row[6], 0)
  };
}

function actionMulaiSesi(ss, user, p) {
  try {
    var paketId = asString(p.paketId);
    if (!paketId) return { success: false, message: 'ID paket wajib diisi.' };
    var paket = ambilPaket(ss, paketId);
    if (!paket) return { success: false, message: 'Paket tidak ditemukan.' };
    if (paket.aktif !== 1) {
      return { success: false, message: 'Paket tidak aktif.' };
    }
    var now = sekarangISODateTime();
    if (!(paket.mulai <= now && now <= paket.selesai)) {
      return { success: false, message: 'Paket belum dibuka atau sudah ditutup.' };
    }
    // Eligibility: jenjang cocok; kelas dibatasi -> kelas siswa harus termasuk
    if (user.jenjangId !== paket.jenjangId) {
      return { success: false, message: 'Paket ini tidak tersedia untuk jenjang Anda.' };
    }
    if (paket.kelasIds.length > 0 && paket.kelasIds.indexOf(user.kelasId) < 0) {
      return { success: false, message: 'Paket ini tidak tersedia untuk kelas Anda.' };
    }

    // Sesi existing: idempotent
    var sesiAda = cariSesiUser(ss, user.username, paketId);
    for (var e = 0; e < sesiAda.length; e++) {
      var st = asString(sesiAda[e].row[5]);
      if (st === 'AKTIF') {
        // Kembalikan sesi AKTIF yang sudah ada — soal yang SAMA
        var soalIdsAktif = parseJSONLunak(sesiAda[e].row[7], []);
        return {
          success: true,
          message: 'Sesi aktif ditemukan, melanjutkan.',
          data: {
            sesi: sesiRingkas(sesiAda[e].row),
            soal: susunSoalUntukKlien(ss, soalIdsAktif, paket.acakOpsi)
          }
        };
      }
    }
    if (sesiAda.length > 0) {
      var terakhir = asString(sesiAda[0].row[5]);
      if (terakhir === 'SELESAI') {
        return { success: false, message: 'Anda sudah mengerjakan paket ini.' };
      }
      // BATAL
      var settings = getSettings(ss);
      if (settings.izinkanUlangSetelahBatal !== 1) {
        return { success: false, message: 'Sesi Anda dibatalkan. Hubungi guru/admin untuk mengulang.' };
      }
      // boleh buat sesi baru
    }

    // Pilih soal
    var soalIdsBaru;
    if (paket.modeSoal === 'manual') {
      soalIdsBaru = paket.soalIds.slice();
    } else {
      var bank = soalIdsBank(ss, paket.jenjangId, paket.mapelId);
      if (bank.length < paket.jumlahAcak) {
        return { success: false, message: 'Soal di bank tidak mencukupi (' + bank.length + ' tersedia).' };
      }
      soalIdsBaru = acakArray(bank).slice(0, paket.jumlahAcak);
    }
    if (paket.acakSoal === 1) soalIdsBaru = acakArray(soalIdsBaru);
    if (soalIdsBaru.length < 1) {
      return { success: false, message: 'Paket ini belum memiliki soal.' };
    }

    var waktuMulai = sekarangISODateTime();
    var dMulai = parseDatetime(waktuMulai);
    var waktuSelesai = formatDatetime(tambahMenit(dMulai, paket.durasiMenit));
    var sesiId = Utilities.getUuid();
    var sheet = ss.getSheetByName(SHEET_SESI);
    sheet.appendRow([sesiId, paketId, user.username, waktuMulai, waktuSelesai,
      'AKTIF', 0, JSON.stringify(soalIdsBaru), waktuMulai]);
    catatLog(ss, user.username, sesiId, 'mulai-sesi', 'Paket: ' + paket.nama);

    return {
      success: true,
      message: 'Sesi ujian dimulai. Selamat mengerjakan!',
      data: {
        sesi: {
          id: sesiId, paketId: paketId, waktuMulai: waktuMulai,
          waktuSelesai: waktuSelesai, status: 'AKTIF', peringatan: 0
        },
        soal: susunSoalUntukKlien(ss, soalIdsBaru, paket.acakOpsi)
      }
    };
  } catch (err) {
    return { success: false, error: 'mulaiSesi: ' + err.message };
  }
}

function actionGetSesi(ss, user, p) {
  try {
    var sesiId = asString(p.sesiId);
    if (!sesiId) return { success: false, message: 'ID sesi wajib diisi.' };
    var row = cariBarisById(ss, SHEET_SESI, sesiId);
    if (!row) return { success: false, message: 'Sesi tidak ditemukan.' };
    // Milik sendiri, atau guru/admin boleh melihat sesi siapa pun
    if (user.peran === 'siswa' && asString(row[2]) !== user.username) {
      return { success: false, message: 'Sesi tidak ditemukan.' };
    }
    var paket = ambilPaket(ss, asString(row[1]));
    var status = asString(row[5]);
    var soal = [];
    if (status === 'AKTIF') {
      var soalIds = parseJSONLunak(row[7], []);
      soal = susunSoalUntukKlien(ss, soalIds, paket ? paket.acakOpsi : 1);
    }
    return {
      success: true,
      data: { sesi: sesiRingkas(row), soal: soal }
    };
  } catch (err) {
    return { success: false, error: 'getSesi: ' + err.message };
  }
}

function actionBatalkanSesi(ss, user, p) {
  try {
    var sesiId = asString(p.sesiId);
    var alasan = asString(p.alasan);
    if (!sesiId) return { success: false, message: 'ID sesi wajib diisi.' };
    var sheet = ss.getSheetByName(SHEET_SESI);
    var rowNum = findRowNum(sheet, 1, sesiId);
    if (rowNum < 0) return { success: false, message: 'Sesi tidak ditemukan.' };
    var row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
    // Milik sendiri, atau guru/admin untuk sesi siapa pun
    if (user.peran === 'siswa' && asString(row[2]) !== user.username) {
      return { success: false, message: 'Sesi tidak ditemukan.' };
    }
    var status = asString(row[5]);
    if (status === 'AKTIF') {
      sheet.getRange(rowNum, 6).setValue('BATAL');
      catatLog(ss, user.username, sesiId, 'batal-sesi',
        'Dibatalkan oleh ' + user.username + (alasan ? ' — ' + alasan : ''));
      status = 'BATAL';
    }
    // SELESAI/BATAL -> tetap sukses (idempotent). Jawaban yang belum
    // disubmit otomatis hilang (tidak ada yang disimpan).
    return {
      success: true,
      message: 'Sesi dibatalkan.',
      data: { status: status }
    };
  } catch (err) {
    return { success: false, error: 'batalkanSesi: ' + err.message };
  }
}

function actionCatatPeringatan(ss, user, p) {
  try {
    var sesiId = asString(p.sesiId);
    var jenis = asString(p.jenis) || 'peringatan';
    if (!sesiId) return { success: false, message: 'ID sesi wajib diisi.' };
    var sheet = ss.getSheetByName(SHEET_SESI);
    var rowNum = findRowNum(sheet, 1, sesiId);
    if (rowNum < 0) return { success: false, message: 'Sesi tidak ditemukan.' };
    var row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
    // Hanya milik sendiri
    if (asString(row[2]) !== user.username) {
      return { success: false, message: 'Sesi tidak ditemukan.' };
    }
    if (asString(row[5]) !== 'AKTIF') {
      return { success: false, message: 'Sesi tidak aktif.' };
    }
    var settings = getSettings(ss);
    var ambang = settings.ambangPeringatan;
    if (!(ambang >= 1)) ambang = 3;
    var peringatan = asInt(row[6], 0) + 1;
    sheet.getRange(rowNum, 7).setValue(peringatan);
    catatLog(ss, user.username, sesiId, 'peringatan', jenis + ' ke-' + peringatan);
    var dibatalkan = false;
    if (peringatan >= ambang) {
      sheet.getRange(rowNum, 6).setValue('BATAL');
      catatLog(ss, user.username, sesiId, 'peringatan-batas',
        'Mencapai ambang ' + ambang + ' — sesi dibatalkan otomatis.');
      dibatalkan = true;
    }
    return {
      success: true,
      data: { peringatan: peringatan, dibatalkan: dibatalkan }
    };
  } catch (err) {
    return { success: false, error: 'catatPeringatan: ' + err.message };
  }
}

function actionSubmitJawaban(ss, user, p) {
  try {
    var sesiId = asString(p.sesiId);
    if (!sesiId) return { success: false, message: 'ID sesi wajib diisi.' };
    var sheet = ss.getSheetByName(SHEET_SESI);
    var rowNum = findRowNum(sheet, 1, sesiId);
    if (rowNum < 0) return { success: false, message: 'Sesi tidak ditemukan.' };
    var row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
    // Hanya milik sendiri
    if (asString(row[2]) !== user.username) {
      return { success: false, message: 'Sesi tidak ditemukan.' };
    }
    var status = asString(row[5]);
    var sheetHasil = ss.getSheetByName(SHEET_HASIL);

    // Idempotent: sesi SELESAI -> kembalikan hasil yang sudah ada
    if (status === 'SELESAI') {
      var rnLama = findRowNum(sheetHasil, 2, sesiId);
      if (rnLama > 0) {
        var rl = sheetHasil.getRange(rnLama, 1, 1, sheetHasil.getLastColumn()).getValues()[0];
        return { success: true, data: { hasil: hasilSubmitKeObjek(rl) } };
      }
    }
    if (status !== 'AKTIF') {
      return { success: false, message: 'Sesi tidak aktif.' };
    }

    var paketId = asString(row[1]);
    var soalIds = parseJSONLunak(row[7], []);
    if (!Array.isArray(soalIds)) soalIds = [];

    // Peta soal: id -> {kunci, bobot}
    var bank = readRows(ss.getSheetByName(SHEET_BANKSOAL));
    var petaSoal = {};
    for (var i = 0; i < bank.length; i++) {
      petaSoal[asString(bank[i][0])] = {
        kunci: asString(bank[i][9]).toUpperCase(),
        bobot: asInt(bank[i][10], 1)
      };
    }

    // Jawaban kiriman klien: hanya kode A-E per soalId (nilai kiriman diabaikan)
    var jawabanKirim = p.jawaban;
    if (!Array.isArray(jawabanKirim)) jawabanKirim = [];
    var petaJawaban = {};
    for (var j = 0; j < jawabanKirim.length; j++) {
      var sid = asString(jawabanKirim[j] && jawabanKirim[j].soalId);
      if (sid) petaJawaban[sid] = asString(jawabanKirim[j].jawaban).toUpperCase();
    }

    // PENILAIAN DIHITUNG DI SERVER dari kunci BankSoal
    var benar = 0, salah = 0, kosong = 0, skor = 0, totalBobot = 0;
    for (var s = 0; s < soalIds.length; s++) {
      var info = petaSoal[asString(soalIds[s])];
      if (!info) continue; // soal dihapus setelah sesi dibuat
      totalBobot += info.bobot;
      var jwb = petaJawaban[asString(soalIds[s])] || '';
      if (KUNCI_VALID.indexOf(jwb) < 0) { kosong++; continue; }
      if (jwb === info.kunci) { benar++; skor += info.bobot; }
      else { salah++; }
    }
    var nilai = totalBobot > 0 ? Math.round(skor / totalBobot * 100) : 0;
    var waktuSubmit = sekarangISODateTime();

    // Nama & kelas siswa dari akun
    var peta = bangunPeta(ss);
    var pg = peta.pengguna[user.username] || {};
    var namaSiswa = user.nama;
    var kelas = peta.kelas[pg.kelasId] || '';

    var hasilId = Utilities.getUuid();
    sheetHasil.appendRow([hasilId, sesiId, paketId, user.username, namaSiswa,
      kelas, JSON.stringify(jawabanKirim), benar, salah, kosong, skor,
      totalBobot, nilai, waktuSubmit]);
    sheet.getRange(rowNum, 6).setValue('SELESAI');
    catatLog(ss, user.username, sesiId, 'submit',
      'Nilai ' + nilai + ' (benar ' + benar + ', salah ' + salah + ', kosong ' + kosong + ')');

    var rBaru = sheetHasil.getRange(
      findRowNum(sheetHasil, 1, hasilId), 1, 1, sheetHasil.getLastColumn()
    ).getValues()[0];
    return {
      success: true,
      message: 'Jawaban berhasil disubmit. Nilai: ' + nilai + '.',
      data: { hasil: hasilSubmitKeObjek(rBaru) }
    };
  } catch (err) {
    return { success: false, error: 'submitJawaban: ' + err.message };
  }
}

function hasilSubmitKeObjek(r) {
  return {
    id: asString(r[0]),
    benar: asInt(r[7], 0), salah: asInt(r[8], 0), kosong: asInt(r[9], 0),
    skor: asInt(r[10], 0), totalBobot: asInt(r[11], 0),
    nilai: asInt(r[12], 0), waktuSubmit: selKeString(r[13])
  };
}

function actionResetSesi(ss, user, p) {
  try {
    var username = asString(p.username);
    var paketId = asString(p.paketId);
    if (!username) return { success: false, message: 'Username wajib diisi.' };
    if (!paketId) return { success: false, message: 'ID paket wajib diisi.' };

    var sheetSesi = ss.getSheetByName(SHEET_SESI);
    var rowsSesi = readRows(sheetSesi);
    var hapusSesi = [];
    for (var i = 0; i < rowsSesi.length; i++) {
      if (asString(rowsSesi[i][1]) === paketId && asString(rowsSesi[i][2]) === username) {
        hapusSesi.push(i + 2);
      }
    }
    var sheetHasil = ss.getSheetByName(SHEET_HASIL);
    var rowsHasil = readRows(sheetHasil);
    var hapusHasil = [];
    for (var j = 0; j < rowsHasil.length; j++) {
      if (asString(rowsHasil[j][2]) === paketId && asString(rowsHasil[j][3]) === username) {
        hapusHasil.push(j + 2);
      }
    }
    hapusBarisList(sheetSesi, hapusSesi);
    hapusBarisList(sheetHasil, hapusHasil);
    catatLog(ss, user.username, '', 'reset-sesi',
      'Reset sesi ' + username + ' pada paket ' + paketId +
      ' (' + hapusSesi.length + ' sesi, ' + hapusHasil.length + ' hasil dihapus)');

    return {
      success: true,
      message: 'Sesi berhasil direset.',
      data: { sesiDihapus: hapusSesi.length, hasilDihapus: hapusHasil.length }
    };
  } catch (err) {
    return { success: false, error: 'resetSesi: ' + err.message };
  }
}

// ============================================================
// HASIL & MONITOR
// ============================================================
function actionRekapHasil(ss, p) {
  try {
    var paketId = asString(p.paketId);
    if (!paketId) return { success: false, message: 'ID paket wajib diisi.' };
    var paket = ambilPaket(ss, paketId);
    if (!paket) return { success: false, message: 'Paket tidak ditemukan.' };
    var peta = bangunPeta(ss);

    var defaultTotal = paket.modeSoal === 'manual'
      ? paket.soalIds.length : paket.jumlahAcak;

    // Sesi per username (terbaru)
    var rowsSesi = readRows(ss.getSheetByName(SHEET_SESI));
    var sesiTerbaru = {}; // username -> row
    for (var i = 0; i < rowsSesi.length; i++) {
      if (asString(rowsSesi[i][1]) !== paketId) continue;
      var un = asString(rowsSesi[i][2]);
      var cur = sesiTerbaru[un];
      var dBaru = selKeString(rowsSesi[i][8]);
      if (!cur || dBaru >= selKeString(cur[8])) sesiTerbaru[un] = rowsSesi[i];
    }

    // Hasil per SesiID
    var rowsHasil = readRows(ss.getSheetByName(SHEET_HASIL));
    var hasilBySesi = {};
    for (var j = 0; j < rowsHasil.length; j++) {
      if (asString(rowsHasil[j][2]) !== paketId) continue;
      hasilBySesi[asString(rowsHasil[j][1])] = rowsHasil[j];
    }

    // Siswa eligible: peran siswa, aktif, jenjang cocok, kelas cocok
    var rowsUser = readRows(ss.getSheetByName(SHEET_PENGGUNA));
    var rows = [];
    for (var u = 0; u < rowsUser.length; u++) {
      var ru = rowsUser[u];
      if (asString(ru[5]) !== 'siswa') continue;
      if (asString(ru[11]) !== '1') continue;
      if (asString(ru[7]) !== paket.jenjangId) continue;
      var kid = asString(ru[8]);
      if (paket.kelasIds.length > 0 && paket.kelasIds.indexOf(kid) < 0) continue;

      var uname = asString(ru[2]);
      var sesi = sesiTerbaru[uname] || null;
      var rec = {
        username: uname,
        nis: asString(ru[6]),
        nama: asString(ru[1]),
        kelas: peta.kelas[kid] || '',
        status: 'Belum mulai',
        nilai: 0, benar: 0, totalSoal: defaultTotal,
        waktuSubmit: '', peringatan: 0
      };
      if (sesi) {
        var h = hasilBySesi[asString(sesi[0])] || null;
        var soalIds = parseJSONLunak(sesi[7], []);
        var totalSesi = Array.isArray(soalIds) && soalIds.length > 0
          ? soalIds.length : defaultTotal;
        rec.peringatan = asInt(sesi[6], 0);
        rec.totalSoal = totalSesi;
        if (h) {
          rec.status = 'Selesai';
          rec.nilai = asInt(h[12], 0);
          rec.benar = asInt(h[7], 0);
          rec.waktuSubmit = selKeString(h[13]);
        } else if (asString(sesi[5]) === 'AKTIF') {
          rec.status = 'Mengerjakan';
        } else if (asString(sesi[5]) === 'BATAL') {
          rec.status = 'Dibatalkan';
        }
      }
      rows.push(rec);
    }
    rows.sort(function (a, b) {
      return a.nama < b.nama ? -1 : (a.nama > b.nama ? 1 : 0);
    });

    return {
      success: true,
      data: { paket: { id: paket.id, nama: paket.nama }, rows: rows }
    };
  } catch (err) {
    return { success: false, error: 'rekapHasil: ' + err.message };
  }
}

/**
 * Rincian per soal untuk getHasilSiswa (hanya bila paket tampilPembahasan=1
 * dan sesi SELESAI): [{soalId, teks, opsi:[{kode,teks}], kunci, pembahasan,
 * jawabanSiswa, benar}].
 */
function susunRincian(ss, sesiRow, hasilRow) {
  var soalIds = parseJSONLunak(sesiRow[7], []);
  if (!Array.isArray(soalIds)) soalIds = [];
  var jawabanKirim = parseJSONLunak(hasilRow[6], []);
  if (!Array.isArray(jawabanKirim)) jawabanKirim = [];
  var petaJawaban = {};
  for (var j = 0; j < jawabanKirim.length; j++) {
    var sid = asString(jawabanKirim[j] && jawabanKirim[j].soalId);
    if (sid && petaJawaban[sid] === undefined) {
      petaJawaban[sid] = asString(jawabanKirim[j].jawaban).toUpperCase();
    }
  }
  var bank = readRows(ss.getSheetByName(SHEET_BANKSOAL));
  var petaSoal = {};
  for (var i = 0; i < bank.length; i++) petaSoal[asString(bank[i][0])] = bank[i];

  var out = [];
  for (var s = 0; s < soalIds.length; s++) {
    var r = petaSoal[asString(soalIds[s])];
    if (!r) continue;
    var teksOpsi = [asString(r[4]), asString(r[5]), asString(r[6]),
      asString(r[7]), asString(r[8])];
    var opsi = [];
    for (var o = 0; o < 5; o++) {
      if (!teksOpsi[o]) continue;
      opsi.push({ kode: KUNCI_VALID[o], teks: teksOpsi[o] });
    }
    var kunci = asString(r[9]).toUpperCase();
    var jwb = petaJawaban[asString(soalIds[s])] || '';
    out.push({
      soalId: asString(r[0]),
      teks: asString(r[3]),
      opsi: opsi,
      kunci: kunci,
      pembahasan: asString(r[11]),
      jawabanSiswa: jwb,
      benar: jwb === kunci
    });
  }
  return out;
}

function actionGetHasilSiswa(ss, user, p) {
  try {
    var paketId = asString(p.paketId);
    var peta = bangunPeta(ss);
    var rowsHasil = readRows(ss.getSheetByName(SHEET_HASIL));
    var sheetSesi = ss.getSheetByName(SHEET_SESI);
    var out = [];
    for (var i = 0; i < rowsHasil.length; i++) {
      var rh = rowsHasil[i];
      if (asString(rh[3]) !== user.username) continue;
      if (paketId && asString(rh[2]) !== paketId) continue;
      var obj = hasilKeObjek(rh, peta.paket, peta.pengguna, peta.kelas);
      // Rincian + pembahasan hanya jika paket mengizinkan & sesi SELESAI
      var paket = ambilPaket(ss, asString(rh[2]));
      if (paket && paket.tampilPembahasan === 1) {
        var sesiRow = cariBarisById(ss, SHEET_SESI, asString(rh[1]));
        if (sesiRow && asString(sesiRow[5]) === 'SELESAI') {
          obj.rincian = susunRincian(ss, sesiRow, rh);
        }
      }
      out.push(obj);
    }
    // Terbaru dulu
    out.sort(function (a, b) {
      return a.waktuSubmit < b.waktuSubmit ? 1 : (a.waktuSubmit > b.waktuSubmit ? -1 : 0);
    });
    return { success: true, data: out };
  } catch (err) {
    return { success: false, error: 'getHasilSiswa: ' + err.message };
  }
}

function actionMonitorSesi(ss, p) {
  try {
    var paketId = asString(p.paketId);
    var peta = bangunPeta(ss);
    var rows = readRows(ss.getSheetByName(SHEET_SESI));
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      if (paketId && asString(rows[i][1]) !== paketId) continue;
      out.push(sesiKeObjek(rows[i], peta.paket, peta.pengguna, peta.kelas));
    }
    // AKTIF dulu, lalu waktuMulai terbaru
    out.sort(function (a, b) {
      var aa = a.status === 'AKTIF' ? 0 : 1;
      var bb = b.status === 'AKTIF' ? 0 : 1;
      if (aa !== bb) return aa - bb;
      return a.waktuMulai < b.waktuMulai ? 1 : (a.waktuMulai > b.waktuMulai ? -1 : 0);
    });
    return { success: true, data: out };
  } catch (err) {
    return { success: false, error: 'monitorSesi: ' + err.message };
  }
}

// ============================================================
// PENGATURAN & UPLOAD (admin; upload gambar soal: guru/admin)
// ============================================================
function actionSavePengaturan(ss, p) {
  try {
    var input = (p && p.pengaturan) || {};
    var simpan = {};
    for (var i = 0; i < KUNCI_PENGATURAN.length; i++) {
      var k = KUNCI_PENGATURAN[i];
      if (input[k] === undefined || input[k] === null) continue; // kunci tak dikenal diabaikan
      simpan[k] = input[k];
    }

    if (simpan.ambangPeringatan !== undefined) {
      var amb = asInt(simpan.ambangPeringatan, -1);
      if (!(amb >= 1 && amb <= 10)) {
        return { success: false, message: 'Ambang peringatan harus angka 1-10.' };
      }
      simpan.ambangPeringatan = amb;
    }
    if (simpan.wajibFullscreen !== undefined) {
      var wf = asInt(simpan.wajibFullscreen, -1);
      if (wf !== 0 && wf !== 1) {
        return { success: false, message: 'wajibFullscreen harus 0 atau 1.' };
      }
      simpan.wajibFullscreen = wf;
    }
    if (simpan.izinkanUlangSetelahBatal !== undefined) {
      var iu = asInt(simpan.izinkanUlangSetelahBatal, -1);
      if (iu !== 0 && iu !== 1) {
        return { success: false, message: 'izinkanUlangSetelahBatal harus 0 atau 1.' };
      }
      simpan.izinkanUlangSetelahBatal = iu;
    }

    for (var j in simpan) {
      if (simpan.hasOwnProperty(j)) setSetting(ss, j, String(simpan[j]));
    }
    return { success: true, message: 'Pengaturan berhasil disimpan.' };
  } catch (err) {
    return { success: false, error: 'savePengaturan: ' + err.message };
  }
}

/**
 * Upload gambar (validasi umum). Mengembalikan {ok, url, fileId} atau
 * {ok:false, message}.
 */
function uploadGambarKeDrive(ss, dataBase64, mimeType, namaFolder, namaFile) {
  var base64Data = asString(dataBase64);
  mimeType = asString(mimeType);
  if (!base64Data) {
    return { ok: false, message: 'Data gambar kosong.' };
  }
  if (!/^image\//.test(mimeType)) {
    return { ok: false, message: 'File harus berupa gambar (PNG/JPG).' };
  }
  if (base64Data.length > MAX_GAMBAR_BASE64) {
    return { ok: false, message: 'Ukuran gambar maksimal 2 MB.' };
  }
  var folder;
  try {
    var folders = DriveApp.getFoldersByName(namaFolder);
    folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(namaFolder);
  } catch (permErr) {
    return {
      ok: false,
      message: 'Izin Google Drive belum diberikan. Buka editor Apps Script, jalankan fungsi "authorizeDriveAccess", lalu setujui izinnya.'
    };
  }
  try { folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e1) {}

  // Dukung data-URL ("data:image/png;base64,...") maupun base64 murni
  var cleanBase64 = base64Data.indexOf(',') > -1 ? base64Data.split(',')[1] : base64Data;
  var blob = Utilities.newBlob(
    Utilities.base64Decode(cleanBase64), mimeType, namaFile
  );
  var file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e2) {}

  var fileId = file.getId();
  var url = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w800';
  return { ok: true, url: url, fileId: fileId };
}

function actionUploadLogo(ss, p) {
  try {
    var up = uploadGambarKeDrive(ss, p.dataBase64, p.mimeType,
      NAMA_FOLDER_LOGO, 'logo_' + Date.now() + '.png');
    if (!up.ok) return { success: false, message: up.message };
    setSetting(ss, 'logoUrl', up.url);
    return {
      success: true,
      message: 'Logo berhasil diunggah.',
      data: { url: up.url, fileId: up.fileId }
    };
  } catch (err) {
    return { success: false, message: 'Gagal mengunggah logo: ' + err.message };
  }
}

function actionUploadGambarSoal(ss, p) {
  try {
    var namaFile = asString(p.namaFile) || ('soal_' + Date.now() + '.png');
    var up = uploadGambarKeDrive(ss, p.dataBase64, p.mimeType,
      NAMA_FOLDER_GAMBAR_SOAL, namaFile);
    if (!up.ok) return { success: false, message: up.message };
    return {
      success: true,
      message: 'Gambar soal berhasil diunggah.',
      data: { url: up.url, fileId: up.fileId }
    };
  } catch (err) {
    return { success: false, message: 'Gagal mengunggah gambar soal: ' + err.message };
  }
}
