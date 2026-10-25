export const metadata = {
  title: 'FORGE — AI Video Engine',
  description: 'Turn any topic into a cinematic AI-generated video. Every frame is code.',
};
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔥</text></svg>" />
      </head>
      <body style={{margin:0,padding:0,background:'#080B10',color:'#EDF2F4',fontFamily:"'Inter',-apple-system,sans-serif",minHeight:'100vh'}}>
        <style>{`
          *,*::before,*::after{box-sizing:border-box}
          input,textarea,button{font-family:inherit}
          @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
          @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
          @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
          @keyframes glow{0%,100%{box-shadow:0 0 20px rgba(0,245,160,0.3)}50%{box-shadow:0 0 40px rgba(0,245,160,0.7)}}
          ::-webkit-scrollbar{width:5px}
          ::-webkit-scrollbar-track{background:#0D1117}
          ::-webkit-scrollbar-thumb{background:#30363D;border-radius:3px}
        `}</style>
        {children}
      </body>
    </html>
  );
}
