'use client';
import { useEffect, useState, type CSSProperties } from 'react';

type Photo = { id: string; name: string; photographer: string };
type Donation = { enabled: boolean; message: string; qrisUrl: string | null };
export default function GalleryClient({ title, photos }: { title: string; photos: Photo[] }) {
  const [selected, setSelected] = useState<Photo | null>(null);
  const [donate, setDonate] = useState<{ photo: Photo; quality: 'social'|'original' } | null>(null);
  const [settings, setSettings] = useState<Donation>({enabled:false,message:'',qrisUrl:null});
  useEffect(() => {
    fetch('/api/donation', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSettings(d); }).catch(() => {});
  }, []);
  const download = (photo: Photo, quality: 'social'|'original') => {
    const url = `/api/photos/${photo.id}/download?quality=${quality}`;
    // Navigation begins a browser download when the endpoint returns Content-Disposition: attachment.
    window.location.assign(url);
  };
  const startDownload = (quality: 'social'|'original') => {
    if (!selected) return;
    if (settings.enabled && settings.qrisUrl) setDonate({ photo: selected, quality });
    else download(selected, quality);
  };
  return <main style={{maxWidth:1100,margin:'auto',padding:'30px 16px 70px'}}>
    <a style={{color:'#80c4ff'}} href="/">← Semua event</a>
    <h1>{title}</h1><p style={{color:'#9eabc3'}}>{photos.length} foto terbaru • klik foto untuk melihat dan mengunduh</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(155px,1fr))',gap:12}}>
      {photos.map(p => <button type="button" onClick={()=>setSelected(p)} key={p.id}
        style={{padding:0,border:'1px solid #374254',borderRadius:12,overflow:'hidden',background:'#1f2733',cursor:'pointer',color:'white',textAlign:'left'}}>
        {/* Thumbnails are watermarked JPEG variants served by Next.js, never raw Immich URLs. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/photos/${p.id}/thumbnail`} alt={p.name} style={{width:'100%',aspectRatio:'3 / 4',objectFit:'cover'}}/>
        <span style={{display:'block',padding:9,fontSize:12}}>{p.name}</span>
      </button>)}
    </div>
    {selected && <div role="dialog" aria-modal="true" aria-label="Detail foto" style={overlay}>
      <div style={panel}>
        <button style={closeStyle} onClick={()=>setSelected(null)} aria-label="Tutup">✕</button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/photos/${selected.id}/preview`} alt={selected.name} style={{maxWidth:'100%',maxHeight:'52vh',objectFit:'contain'}} />
        <h3>{selected.name}</h3><p>Fotografer: {selected.photographer}</p>
        <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
          <button style={buttonStyle} onClick={()=>startDownload('social')}>Unduh 2 MP + watermark</button>
          <button style={buttonStyle} onClick={()=>startDownload('original')}>Unduh original</button>
        </div>
      </div>
    </div>}
    {donate && <div role="dialog" aria-modal="true" aria-label="Donasi sukarela" style={overlay}>
      <div style={{...panel,maxWidth:360,textAlign:'center'}}>
        <h2>❤️ Dukung dokumentasi</h2><p>{settings.message}</p>
        {settings.qrisUrl && <a href={settings.qrisUrl} download="qris-donasi.png" title="Buka atau simpan QRIS">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={settings.qrisUrl} alt="QRIS donasi sukarela" style={{width:230,maxWidth:'100%',background:'white',borderRadius:12,padding:12}}/>
        </a>}
        <p style={{fontSize:13,color:'#b7c1d0'}}>Donasi tidak wajib. Di HP, QRIS bisa dibuka atau disimpan terlebih dahulu.</p>
        <button style={{...buttonStyle,width:'100%',marginTop:10}} onClick={()=>{ const next = donate; setDonate(null); download(next.photo,next.quality); }}>
          Lanjutkan unduhan tanpa kewajiban donasi
        </button>
        <button onClick={()=>setDonate(null)} style={{...closeStyle,position:'static',marginTop:14}}>Batal</button>
      </div>
    </div>}
  </main>;
}
const overlay: CSSProperties={position:'fixed',inset:0,background:'rgba(0,0,0,.84)',display:'flex',alignItems:'center',justifyContent:'center',padding:15,zIndex:100};
const panel: CSSProperties={position:'relative',maxWidth:800,width:'100%',background:'#1b2430',border:'1px solid #33435b',borderRadius:16,padding:24,maxHeight:'94vh',overflowY:'auto'};
const buttonStyle: CSSProperties={padding:'12px 16px',border:0,borderRadius:9,background:'#78b8ef',color:'#071522',fontWeight:700,cursor:'pointer'};
const closeStyle: CSSProperties={position:'absolute',right:14,top:14,border:'none',background:'transparent',color:'#fff',cursor:'pointer',fontSize:19};
