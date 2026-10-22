import type { ReactNode } from 'react';
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="id"><body style={{fontFamily:'system-ui, sans-serif',margin:0,background:'#0e1118',color:'#f7f8fa'}}>{children}</body></html>;
}
