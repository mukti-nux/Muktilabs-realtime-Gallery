import Link from 'next/link';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const events = await prisma.event.findMany({ where: { status: 'PUBLISHED' }, select: { id: true, title: true, slug: true }, orderBy: { createdAt: 'desc' }, take: 40 });
  return <main style={{maxWidth:900,margin:'auto',padding:'52px 22px'}}>
    <h1 style={{fontSize:'2.4rem'}}>📸 Mukti Gallery</h1>
    <p style={{color:'#afb7c5'}}>Dokumentasi event • terintegrasi dengan Immich v3</p>
    <h2>Event publik</h2>
    {events.length ? <ul style={{padding:0,listStyle:'none',display:'grid',gap:12}}>
      {events.map(e => <li key={e.id} style={{background:'#1b212c',padding:18,borderRadius:14}}>
        <Link style={{color:'#bfe1ff'}} href={`/gallery/${e.slug}`}>{e.title} →</Link>
      </li>)}
    </ul> : <p>Belum ada event yang dipublikasikan.</p>}
  </main>;
}
