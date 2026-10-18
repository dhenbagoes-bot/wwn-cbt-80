# Kontrak API — Backend wwn-cbt-80 (CBT Try Out TKA)

Backend: Google Apps Script + Google Sheets + Google Drive.
Versi: `1.0.0` (`APP_VERSION` di `backend/Kode.gs`).

Semua request dikirim sebagai **POST** dengan body JSON `{ action, ...params }`
ke URL `/exec` Web App. Respons SELALU memakai envelope:

```json
{ "success": true, "message": "...", "data": { ... } }
{ "success": false, "message": "..." }
{ "success": false, "error": "..." }
```

`doGet` (GET biasa, tanpa parameter) hanya mengembalikan info service:

```json
{ "success": true, "data": { "service": "wwn-cbt-80", "version": "1.0.0" } }
```

**Pengecualian beacon**: `batalkanSesi` juga dipanggil via
`navigator.sendBeacon(url, JSON.stringify({ action:'batalkanSesi', token, sesiId }))`
(Content-Type text/plain). `doPost` WAJIB membaca `e.postData.contents`
(tanpa mengasumsikan content-type JSON) lalu `JSON.parse`.

## Konvensi umum

- **Tanggal di wire: ISO `yyyy-MM-dd`; datetime: `yyyy-MM-dd HH:mm:ss`.**
  Tampilan `dd/mm/yyyy` diurus frontend. Semua timestamp server memakai
  zona waktu script (Asia/Jakarta).
- **Token**: field `token` di body setiap aksi bertanda 🔒. Token kedaluwarsa 7 hari.
- **Peran**: `admin` | `guru` | `siswa`. Hirarki: admin > guru > siswa.
  Aksi bertanda 🔒 butuh token valid dengan peran minimum yang disebut
  (mis. "🔒 guru" = guru ATAU admin; "🔒🔒" = admin saja).
- **Hash password**: SHA-256 hex dari `salt + password`, salt acak per akun.
  Hash/salt/token **tidak pernah** dikirim ke frontend.
- **ID baris baru**: `Utilities.getUuid()`.
- **Konkurensi**: seluruh isi `doPost` dibungkus
  `LockService.getScriptLock().waitLock(10000)` + `releaseLock()` di `finally`.
- **Idempotent**: `initDatabase`, `batalkanSesi`, `submitJawaban`,
  `mulaiSesi` (sesi AKTIF yang sudah ada dikembalikan, bukan dibuat baru).

## Sheet (10)

| Sheet | Header |
|---|---|
| Pengaturan | Kunci, Nilai |
| Pengguna | ID, Nama, Username, PasswordHash, PasswordSalt, Peran, NIS, JenjangID, KelasID, Token, TokenKedaluwarsa, Aktif |
| Jenjang | ID, Nama, DibuatPada |
| Mapel | ID, JenjangID, Nama, DibuatPada |
| Kelas | ID, JenjangID, Nama, DibuatPada |
| BankSoal | ID, JenjangID, MapelID, Soal, OpsiA, OpsiB, OpsiC, OpsiD, OpsiE, Kunci, Bobot, Pembahasan, GambarUrl, DibuatPada, DibuatOleh |
| Paket | ID, Nama, JenjangID, MapelID, KelasIDsJSON, ModeSoal, SoalIDsJSON, JumlahAcak, DurasiMenit, Mulai, Selesai, AcakSoal, AcakOpsi, TampilSkor, TampilPembahasan, Aktif, DibuatPada, DibuatOleh |
| SesiUjian | ID, PaketID, Username, WaktuMulai, WaktuSelesai, Status, Peringatan, SoalIDsJSON, DibuatPada |
| Hasil | ID, SesiID, PaketID, Username, NamaSiswa, Kelas, JawabanJSON, Benar, Salah, Kosong, Skor, TotalBobot, Nilai, WaktuSubmit |
| LogAktivitas | ID, Waktu, Username, SesiID, Jenis, Detail |

- `Status` SesiUjian: `AKTIF` | `SELESAI` | `BATAL`.
- `ModeSoal` Paket: `manual` | `acak`.
- `Kunci`: satu huruf `A`–`E`. `Bobot`: integer ≥ 1.
- `KelasIDsJSON`: array ID kelas; kosong = semua kelas pada jenjang itu.
- `SoalIDsJSON` (SesiUjian): snapshot urutan soal sesi ini (hasil acak per siswa).

## Seed `initDatabase` (publik, idempotent)

- Pengaturan: `namaSekolah:'Madrasah Contoh'`, `alamatSekolah:''`,
  `telepon:''`, `namaKepala:''`, `logoUrl:''`,
  `ambangPeringatan:'3'`, `wajibFullscreen:'1'`, `izinkanUlangSetelahBatal:'0'`
- Jenjang: `MTs/SMP`, `MA/SMA/SMK`
- Mapel contoh per jenjang: `Literasi Bahasa Indonesia`,
  `Literasi Bahasa Inggris`, `Penalaran Matematika`
- Akun: `admin`/`admin123` (admin), `guru`/`guru123` (guru), Aktif=1.
  (Siswa dibuat via impor; password bawaan = NIS.)

→ `{ success:true, data:{ sheets:[...10 nama...] } }`

## Daftar action

### `ping` (publik)
→ `{ success:true, data:{ version:"1.0.0", waktu:"yyyy-MM-dd HH:mm:ss" } }`

### `login` (publik) `{ username, password }`
Username case-insensitive; tolak jika `Aktif != 1`.  
→ sukses: `{ success:true, data:{ token, nama, username, peran, nis, jenjangId, kelasId } }`  
→ gagal: `{ success:false, message:'Username atau kata sandi salah' }`

### `logout` (publik) `{ token }` → `{ success:true }`

### `getAllData` 🔒 siswa (semua peran login)
Respons difilter menurut peran — **kunci/pembahasan soal TIDAK PERNAH
dikirim ke siswa**:

```json
{ "success": true, "data": {
  "pengaturan": { "namaSekolah":"", "alamatSekolah":"", "telepon":"", "namaKepala":"", "logoUrl":"", "ambangPeringatan":3, "wajibFullscreen":1, "izinkanUlangSetelahBatal":0 },
  "jenjang": [{ "id":"", "nama":"" }],
  "mapel": [{ "id":"", "jenjangId":"", "nama":"" }],
  "kelas": [{ "id":"", "jenjangId":"", "nama":"" }],
  "pengguna": [{ "id":"", "nama":"", "username":"", "peran":"", "nis":"", "jenjangId":"", "kelasId":"", "aktif":1 }],
  "bankSoal": [{ "id":"", "jenjangId":"", "mapelId":"", "soal":"", "opsiA":"", "opsiB":"", "opsiC":"", "opsiD":"", "opsiE":"", "kunci":"B", "bobot":1, "pembahasan":"", "gambarUrl":"", "dibuatPada":"" }],
  "paket": [{ "id":"", "nama":"", "jenjangId":"", "mapelId":"", "kelasIds":[], "modeSoal":"manual", "soalIds":[], "jumlahAcak":0, "durasiMenit":60, "mulai":"", "selesai":"", "acakSoal":1, "acakOpsi":1, "tampilSkor":1, "tampilPembahasan":1, "aktif":1, "jumlahSoal":40 }],
  "sesi": [{ "id":"", "paketId":"", "namaPaket":"", "username":"", "namaSiswa":"", "kelas":"", "waktuMulai":"", "waktuSelesai":"", "status":"AKTIF", "peringatan":0 }],
  "hasil": [{ "id":"", "sesiId":"", "paketId":"", "namaPaket":"", "username":"", "namaSiswa":"", "kelas":"", "benar":0, "salah":0, "kosong":0, "skor":0, "totalBobot":0, "nilai":0, "waktuSubmit":"" }]
} }
```

Aturan filter:
- `pengguna`: admin → semua; guru → peran `guru`/`siswa`; siswa → `[]`.
- `bankSoal`: siswa → `[]` (kunci tidak boleh bocor).
- `paket`: admin/guru → semua (+`jumlahSoal` terhitung). siswa → hanya
  `aktif=1` DAN `mulai <= now <= selesai` DAN jenjang cocok DAN
  (`kelasIds` kosong ATAU memuat `kelasId` siswa); field sensitif
  (`soalIds`, `dibuatOleh`) dibuang; `jumlahSoal` tetap dikirim.
- `sesi`: admin/guru → semua sesi (untuk monitor); siswa → sesi miliknya saja.
- `hasil`: admin/guru → semua; siswa → miliknya saja.

### Master — 🔒🔒 khusus admin
`saveJenjang { id?, nama }`, `deleteJenjang { id }` (tolak jika dipakai
Mapel/Kelas/BankSoal/Paket),
`saveMapel { id?, jenjangId, nama }`, `deleteMapel { id }` (tolak jika dipakai),
`saveKelas { id?, jenjangId, nama }`, `deleteKelas { id }` (tolak jika dipakai
Pengguna/Paket).  
→ simpan: `{ success:true, data:{ id } }` · hapus: `{ success:true }`

### Pengguna — 🔒🔒 khusus admin
`savePengguna { id?, nama, username, peran, password?, nis?, jenjangId?, kelasId?, aktif? }`
- `username` unik (case-insensitive); `peran` ∈ admin/guru/siswa.
- `password` kosong saat tambah → default: peran siswa → = NIS;
  admin/guru → tolak ("password wajib diisi").
- Saat ubah tanpa `password` → password lama dipertahankan.
- `nis` wajib untuk peran siswa; `jenjangId`+`kelasId` wajib untuk siswa.

`deletePengguna { id }` (tolak hapus akun sendiri / admin terakhir),
`resetPassword { id, passwordBaru }` 🔒🔒.  
→ `{ success:true, data:{ id } }`

`importSiswa` 🔒🔒 `{ rows:[{ nama, nis, kelas, jenjang?, username?, password? }] }`
- `nama`, `nis`, `kelas` (nama kelas) wajib per baris → selain itu `errors`.
- Duplikat = `nis` sama (case-insensitive) → UPDATE (nama/kelas/akun).
- Kelas dicocokkan by nama (case-insensitive) pada jenjang yang disebut
  (atau jenjang pertama yang punya kelas tsb); tak ketemu → error baris.
- Akun: `username` = `username` atau NIS; password = `password` atau NIS.

→ `{ success:true, data:{ imported, updated, errors:[{ baris, pesan }] } }`

### Bank soal — 🔒 guru (guru atau admin)
`saveSoal { id?, jenjangId, mapelId, soal, opsiA, opsiB, opsiC, opsiD, opsiE, kunci, bobot?, pembahasan?, gambarUrl? }`
- Validasi: `soal` & opsi A–D wajib; E opsional (boleh kosong);
  `kunci` ∈ A–E dan opsinya tidak kosong; `bobot` int ≥ 1 (default 1).

`deleteSoal` 🔒 guru `{ id }` (tolak jika dipakai Paket mode manual).  
`importSoal` 🔒 guru `{ jenjangId, mapelId, items:[{ soal, opsiA, opsiB, opsiC, opsiD, opsiE?, kunci, bobot?, pembahasan? }] }`
- Validasi per item sama seperti `saveSoal`; item tak valid → `errors`,
  item valid tetap diimpor.

→ `{ success:true, data:{ imported, errors:[{ baris, pesan }] } }`

`importSoalDariForm` 🔒 guru `{ formIdOrUrl, jenjangId, mapelId }`
- Ambil ID form dari URL (`/d/<ID>/`) atau ID mentah.
- **Jika `FormsApp` tidak tersedia** (mis. diuji di node) →
  `{ success:false, message:'Impor Google Form hanya bisa dijalankan di Apps Script.' }`.
- Baca item: `MULTIPLE_CHOICE` → opsi + kunci dari
  `choice.isCorrectAnswer()` (mode kuis); item lain → `dilewati`.
- Soal tanpa kunci yang jelas → `dilewati` (tidak diimpor diam-diam).
- Bobot default 1; opsi E boleh kosong.

→ `{ success:true, data:{ imported, dilewati:[{ judul, alasan }] } }`

### Paket — 🔒 guru (guru atau admin)
`savePaket { id?, nama, jenjangId, mapelId, kelasIds?, modeSoal, soalIds?, jumlahAcak?, durasiMenit, mulai, selesai, acakSoal?, acakOpsi?, tampilSkor?, tampilPembahasan?, aktif? }`
- `nama`, `jenjangId`, `mapelId`, `durasiMenit` (5–300), `mulai`, `selesai` wajib;
  `selesai > mulai` (format `yyyy-MM-dd HH:mm:ss`).
- `modeSoal='manual'` → `soalIds` array ≥ 1 & semua ada di BankSoal.
- `modeSoal='acak'` → `jumlahAcak` ≥ 1 dan ≤ jumlah soal bank (jenjang+mapel).

`deletePaket` 🔒 guru `{ id }`.  
→ `{ success:true, data:{ id } }`

### Sesi ujian
`mulaiSesi` 🔒 siswa `{ paketId }`
- Validasi: paket ada, `aktif=1`, `mulai <= now <= selesai`;
  siswa eligible (jenjang cocok; `kelasIds` kosong ATAU memuat kelas siswa).
- Sesi existing user+paket: AKTIF → kembalikan sesi itu (beserta soal yang
  SAMA, dari `SoalIDsJSON`); SELESAI → error "Anda sudah mengerjakan paket ini";
  BATAL → error "Sesi Anda dibatalkan..." kecuali
  `izinkanUlangSetelahBatal=1` → boleh buat sesi baru.
- Buat sesi: pilih soal (manual: `soalIds`; acak: `jumlahAcak` dari bank
  jenjang+mapel), acak urutan jika `acakSoal=1`; simpan `SoalIDsJSON`;
  `waktuSelesai = waktuMulai + durasiMenit`.

→ `{ success:true, data:{ sesi:{ id, paketId, waktuMulai, waktuSelesai, status, peringatan }, soal:[{ id, teks, gambarUrl, opsi:[{ kode, teks }] }] } }`
- `opsi` diacak jika `acakOpsi=1`; `kode` = kode asli (A–E) untuk penilaian.
- **TIDAK PERNAH** mengirim `kunci`/`pembahasan`.

`getSesi` 🔒 siswa `{ sesiId }`
- Milik sendiri (atau guru/admin): → `{ success:true, data:{ sesi:{...}, soal:[...] } }`
  (`soal` hanya jika status AKTIF; format sama seperti `mulaiSesi`).

`batalkanSesi` 🔒 siswa `{ sesiId, alasan? }`
- Sesi milik sendiri (atau guru/admin untuk sesi siapa pun).
- Jika status AKTIF → BATAL + catat log. SELESAI/BATAL → tetap sukses
  (idempotent). **Jawaban yang belum disubmit otomatis hilang**
  (tidak ada yang disimpan).

→ `{ success:true, data:{ status } }`

`catatPeringatan` 🔒 siswa `{ sesiId, jenis }`
- Hanya jika AKTIF & milik sendiri. `peringatan+1`; jika
  `peringatan >= ambangPeringatan` (Pengaturan, default 3) → status BATAL
  + log `peringatan-batas`.

→ `{ success:true, data:{ peringatan, dibatalkan } }`

`submitJawaban` 🔒 siswa `{ sesiId, jawaban:[{ soalId, jawaban }] }`
- Sesi milik sendiri & AKTIF (idempotent: jika SELESAI → kembalikan hasil
  yang sudah ada).
- **Penilaian DIHITUNG DI SERVER** dari kunci BankSoal (jawaban kiriman
  klien hanya berisi kode A–E per soalId; nilai kiriman klien diabaikan —
  memang tidak ada field nilai di request).
- `jawaban` kosong/null → dihitung `kosong`; kode selain A–E → `kosong`.
- `nilai = Math.round(skor / totalBobot * 100)` (totalBobot>0).
- Simpan Hasil; status sesi → SELESAI; catat log.

→ `{ success:true, data:{ hasil:{ id, benar, salah, kosong, skor, totalBobot, nilai, waktuSubmit } } }`

`resetSesi` 🔒 guru `{ username, paketId }`
- Hapus SEMUA baris SesiUjian + Hasil milik `username` pada `paketId`
  (agar siswa bisa mengulang dari nol).

→ `{ success:true, data:{ sesiDihapus, hasilDihapus } }`

### Hasil & monitor
`rekapHasil` 🔒 guru `{ paketId }`
→ `{ success:true, data:{ paket:{ id, nama }, rows:[{ username, nis, nama, kelas, status, nilai, benar, totalSoal, waktuSubmit, peringatan }] } }`
- `status`: `Selesai` | `Mengerjakan` | `Dibatalkan` | `Belum mulai`
  (digabung dari SesiUjian+Hasil untuk semua siswa eligible).

`getHasilSiswa` 🔒 siswa `{ paketId? }`
- Siswa: hasil miliknya (semua paket atau satu paket), terbaru dulu.
- BENTUK RESPONS (perhatikan: `data` adalah **array** objek hasil,
  bukan `{ hasil:[...] }`; `rincian` menempel **per item** hasil):

```json
{ "success": true, "data": [
  { "id":"", "sesiId":"", "paketId":"", "namaPaket":"", "username":"", "namaSiswa":"",
    "kelas":"", "benar":0, "salah":0, "kosong":0, "skor":0, "totalBobot":0,
    "nilai":0, "waktuSubmit":"",
    "rincian": [{ "soalId":"", "teks":"", "opsi":[{"kode":"A","teks":""}],
                 "kunci":"B", "pembahasan":"", "jawabanSiswa":"A", "benar":false }] }
] }
```

- `rincian` hanya disertakan bila paket `tampilPembahasan=1` DAN sesi
  SELESAI; jika tidak → item hasil tanpa field `rincian` (kunci tidak bocor).

`monitorSesi` 🔒 guru `{ paketId? }`
→ `{ success:true, data:[{ id, paketId, namaPaket, username, namaSiswa, kelas, waktuMulai, waktuSelesai, status, peringatan }] }`
- Urut: AKTIF dulu, lalu waktuMulai terbaru.

### Pengaturan & upload
`savePengaturan` 🔒🔒 `{ pengaturan:{...} }` — kunci yang diizinkan:
`namaSekolah`, `alamatSekolah`, `telepon`, `namaKepala`, `logoUrl`,
`ambangPeringatan` (int 1–10), `wajibFullscreen` (0/1),
`izinkanUlangSetelahBatal` (0/1).  
→ `{ success:true }`

`uploadLogo` 🔒🔒 `{ dataBase64, mimeType }` — sama seperti pola jurnal:
tolak jika kosong / bukan `image/*` / base64 > 2.800.000 char;
folder Drive `Logo wwn-cbt-80`; sharing ANYONE_WITH_LINK/VIEW.  
→ `{ success:true, data:{ url, fileId } }`

`uploadGambarSoal` 🔒 guru `{ dataBase64, mimeType, namaFile? }`
- Validasi sama seperti uploadLogo; folder `Gambar Soal wwn-cbt-80`.  
→ `{ success:true, data:{ url, fileId } }`

Fungsi manual (jalankan dari editor, bukan via web):
`authorizeDriveAccess()`, `authorizeFormsAccess()` — memicu izin OAuth.

## Pesan error standar

- Token tidak valid/kedaluwarsa:
  `{ "success": false, "message": "Sesi berakhir, silakan login ulang" }`
- Peran kurang (mis. guru memanggil aksi 🔒🔒):
  `{ "success": false, "message": "Aksi ini hanya boleh dilakukan oleh admin." }`
- Aksi tak dikenal: `{ "success": false, "message": "Aksi tidak dikenal: <action>" }`
