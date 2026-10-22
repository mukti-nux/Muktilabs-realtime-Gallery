# Mukti Gallery × Immich v3 — backend starter

Starter implementasi Next.js App Router (TypeScript) yang **tidak mengganti NAS/Immich**, hanya memakai API resmi Immich. Saat ini berisi adapter Immich, database Prisma, album sync, BullMQ+Sharp 2MP watermark worker, galeri publik sederhana, original-download proxy, QRIS opsional, dan operasi Admin awal berbasis CLI. **Belum sistem produksi/3-role lengkap**: login RBAC, dashboard upload/CRUD, rate limiting, webhook, audit, dan observability belum tersedia.

## 1. Persyaratan

- Node.js 22+, npm, Docker + Compose untuk PostgreSQL/Redis.
- Immich **v3.x** dapat dijangkau dari VM/host aplikasi (prefer alamat LAN `http://...:2283`, bukan public Cloudflare Tunnel untuk beban internal).
- Account Immich khusus `gallery-service` (bukan admin/pribadi) dengan API key yang diizinkan membaca/menulis aset dan album. Permission utama: `album.create`, `album.read`, `albumAsset.create`, `asset.read`, `asset.view`, `asset.download`, `asset.upload`, `server.about` (nama opsi cek pada UI versi Immich). Hindari key Full Access jika tidak diperlukan.
- Disk untuk `GALLERY_CACHE_ROOT` (folder preview ber-watermark; **jangan mount ke dalam volume internal Immich**).
- **Jangan gunakan database PostgreSQL Immich** untuk aplikasi ini. Container `gallery-postgres` membuat database tersendiri.

## 2. Setup cepat (pengembangan)

```bash
cp .env.example .env
# Ubah DATABASE_URL, IMMICH_URL, IMMICH_API_KEY, GALLERY_CACHE_ROOT, dll.
# Saat memakai compose lokal, set GALLERY_DB_PASSWORD di .env; samakan dengan DATABASE_URL.
echo 'GALLERY_DB_PASSWORD=CHANGE_ME' >> .env

docker compose --env-file .env -f compose.yml up -d
npm install
npx prisma migrate dev --name init
npm run immich:check
```

Cara pertama kali mengetes: **buka tiga terminal**:

```bash
# Terminal 1 — Next.js
npm run dev

# Terminal 2 — pemroses preview
npm run worker

# Terminal 3 — membuat event dan sinkronisasi
npm run create:event -- popda-panahan-2026 'POPDA Panahan 2026'
npm run watermark:set -- popda-panahan-2026 /path/watermark-transparan.png
# Dari Immich web, masukkan foto ke album baru [MG:UUID] POPDA Panahan 2026,
# lalu sinkronkan:
npm run sync:album -- popda-panahan-2026
```

Setelah status foto menjadi `READY` (lihat worker log dan Prisma Studio), publish:

```bash
npm run publish:event -- popda-panahan-2026
# Buka http://localhost:3000/gallery/popda-panahan-2026
```

Ubah QRIS tanpa redeploy:

```bash
npm run donation:set -- /path/qris-resmi.png
```

**Perhatian:** QRIS donasi harus asli dari penyedia pembayaran. Script hanya mengunggah PNG untuk ditampilkan; tidak membuat QRIS pembayaran baru dan tidak memverifikasi donasi.

## 3. ImmichAdapter kompatibilitas v3

`src/lib/immich-adapter.ts` menyediakan:

- `getVersion()`: `GET /api/server/version`
- `createAlbum()`, `listAlbums()`, `getAlbum()`
- `addAssetsToAlbum()`: `PUT /api/albums/assets` dengan `albumIds` + `assetIds`
- `albumAssets()`: generator async menggunakan `POST /api/search/metadata`
- `getAsset()`, `getPreview()`, `getOriginal()`, `uploadPhoto()`

**Versi 3.0–3.1**: body `albumIds: [uuid]`, `page`, `size`.
**Versi 3.2+**: body `filter: {albumIds:{any:[uuid]}}`, `size`, `cursor`.
`IMMICH_SEARCH_MODE=auto` menggunakan versi dari server. Paksa `legacy` atau `modern` bila deteksi tidak cocok dengan deployment.

**Defensive pagination:** jika halaman/ID/cursor berulang, adapter melempar error dan operasi sinkronisasi tidak melakukan prune. Ada laporan masalah pencarian album pada Immich 3.1.0; pengujian real tetap perlu.

## 4. Algoritma sync

`npm run sync:album -- <slug>`:

1. Cari `Event` berdasarkan slug.
2. Jika belum punya album, `ensureAlbum()` cari album berlabel deterministik `[MG:EVENT_UUID]`, membuat bila tidak ditemukan, kemudian menyimpan `immichAlbumId`.
3. Iterasi hasil pencarian API Immich; hanya `IMAGE` yang dipetakan (video diabaikan).
4. Upsert menggunakan unique `(eventId, immichAssetId)`; simpan filename, dimensi, EXIF privat.
5. Jika preview untuk watermark version saat ini belum ada, masukkan job ke BullMQ.
6. Update `lastSyncedAt`.
7. Secara default **tidak menghapus** foto yang hilang. Flag `--prune` menandai `REMOVED` lokal, tidak memanggil Immich delete. Gunakan hanya setelah API teruji pada album tersebut.

**Crash recovery:** Nama album berisi UUID event agar jika pembuatan album di Immich sukses tetapi write PostgreSQL gagal, proses berikutnya menemukan album lama. Jangan menjalankan dua proses `create:event` untuk event sama sekaligus tanpa locking/distributed transaction di produksi.

## 5. Algoritma worker

- `GALLERY_CACHE_ROOT/watermarks/{eventUUID}/vN.png`: watermark event (PNG transparan).
- Worker mengambil `size=preview` dari Immich. Jika lebih kecil dari 2 MP, mencoba original; jika original RAW tidak bisa diproses, menggunakan preview tanpa upscale.
- Sharp menghormati rotasi EXIF; output JPEG ukuran maksimal **2.000.000 piksel**, bukan selalu tepat 2 MP.
- Watermark event ditempel pada kanan bawah. File `preview.jpg` dan `thumbnail.jpg` disimpan **atomically** ke cache terpisah.
- Prisma `photoVariant` disimpan setelah file selesai; hanya variant dengan watermark versi event saat ini yang boleh dipublikasi.
- Worker concurrency=2, max input pixels 120 juta; untuk foto RAW besar disarankan atur kembali batas RAM dan format aslinya.
- Jika watermark diubah, `npm run sync:album -- <slug>` lagi untuk antre generasi baru. Old versions tidak dihapus otomatis.

Struktur cache:

```text
.gallery-cache/
  watermarks/{eventUUID}/v1.png
  variants/{eventUUID}/{photoUUID}/v1/preview.jpg
  variants/{eventUUID}/{photoUUID}/v1/thumbnail.jpg
  donation/qris-*.png
```

## 6. Endpoint untuk pengunjung

| Route | Kegunaan |
| --- | --- |
| `GET /api/events/{slug}/photos` | Daftar maksimal 100 foto siap, event publik |
| `GET /api/photos/{id}/preview` | Preview 2 MP + watermark |
| `GET /api/photos/{id}/thumbnail` | Thumbnail cache |
| `GET /api/photos/{id}/download?quality=social` | JPEG 2 MP + watermark |
| `GET /api/photos/{id}/download?quality=original` | Streaming original dari Immich server-side |
| `GET /api/donation` | Pengaturan donasi tanpa file-system path |
| `GET /api/donation/qr` | PNG QRIS dari cache |

Akses original hanya jika foto berada dalam **event `PUBLISHED` dan status `READY`**, serta variant watermark terbaru tersedia. API key Immich tidak pernah dikirim ke browser. Saat ini galeri publik **tanpa PIN**: jangan publish foto privat; implementasikan per-event PIN/session terlebih dahulu untuk event tertutup.

File original di-stream tanpa menyalin ke NAS kedua; log dibuat saat request diterima (tidak memverifikasi transfer sampai selesai). Next.js Node runtime wajib untuk streaming. Bila original sangat besar dan memakai Tunnel/reverse proxy, lakukan uji timeout, bandwidth, dan limit yang berlaku.

## 7. Model keamanan dan pekerjaan tersisa

Sebelum produksi, tambahkan:

- Better Auth dan RBAC nyata untuk Admin/Fotografer. **Jangan expose script CLI atau mengubah event berdasarkan user input tanpa pemeriksaan role.** Untuk starter, administrasi via CLI SSH operator tepercaya.
- Rate limiting untuk API publik; mekanisme abuse/bot protection khusus download original.
- Sesi dan PIN event privat, serta kebijakan consent untuk foto pelajar dan dokumentasi sensitif.
- Endpoint upload bertahap/resumable (opsi Immich `uploadPhoto` disediakan adapter; antarmuka fotografer dan otorisasi belum dibuat).
- Background orchestration/locking saat album create dan sync. Job queue dedup+concurrency test saat worker crash.
- Uji integration dengan API Immich minor version yang benar-benar terpasang. API Immich bisa berubah setelah update.
- Sistem pembersihan cache versi lama, storage quota, observability, backup, HTTPS.
- Validasi MIME lebih ketat untuk original; keamanan endpoint streaming dan CDN.
- Statistik `downloadLog` menunjukkan upaya unduh, bukan kepastian sukses seluruh transfer.
- Jika jumlah foto di atas 100, implementasikan pagination UI/API; starter hanya menampilkan 100 terbaru.

## 8. Sumber rujukan API

- https://api.immich.app/
- https://github.com/immich-app/immich/blob/main/open-api/immich-openapi-specs.json
- https://immich.app/blog/v3-migration
- https://immich.app/blog/v3.2.0-release
- https://github.com/immich-app/immich/issues/31311

Kode ini belum diuji live ke servermu karena tidak ada akses ke instance Immich dan kunci API. Syntax TS/TSX sudah divalidasi, tetapi `npm install`, typecheck dependensi, dan integration test tetap wajib dilakukan pada environment pengguna.
