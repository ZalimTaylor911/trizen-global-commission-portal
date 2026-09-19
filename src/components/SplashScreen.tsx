import splashLogo from '@/assets/brand/oglogo.png';
import './SplashScreen.css';

type SplashScreenProps = { label?: string; tagline?: string };

const SIGN_ROWS = ['LOADS', 'GROWTH', 'COMMISSIONS', 'SUCCESS'];

function Wheel({ cx, cy }: { cx: number; cy: number }) {
  return <g transform={`translate(${cx} ${cy})`}>
    <g className="app-splash-wheel">
      <circle r="16" className="sp-tire" />
      <circle r="9.5" fill="url(#splash-chrome)" />
      <circle r="3.4" className="sp-hub" />
      {[0, 72, 144, 216, 288].map((angle) => <circle key={angle} cx={(6.2 * Math.cos(angle * Math.PI / 180)).toFixed(2)} cy={(6.2 * Math.sin(angle * Math.PI / 180)).toFixed(2)} r="1.1" className="sp-lug" />)}
    </g>
  </g>;
}

export default function SplashScreen({ label = 'Loading...', tagline = 'Driving opportunities together' }: SplashScreenProps) {
  return (
    <main className="app-splash" role="status" aria-live="polite">
      <div className="app-splash-panel">
        <header className="app-splash-header">
          <img className="app-splash-logo" src={splashLogo} alt="Trizen Global" />
          <div className="app-splash-product">Commission Portal</div>
          <p className="app-splash-tagline">{tagline}</p>
        </header>
        <div className="app-splash-scene" aria-hidden="true">
          <svg viewBox="0 0 440 300" xmlns="http://www.w3.org/2000/svg" focusable="false">
            <defs>
              <radialGradient id="splash-sun"><stop offset="0" stopColor="#ffe3a3" stopOpacity=".95" /><stop offset=".45" stopColor="#ffe3a3" stopOpacity=".35" /><stop offset="1" stopColor="#ffe3a3" stopOpacity="0" /></radialGradient>
              <linearGradient id="splash-trailer" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#dde6ee" /></linearGradient>
              <linearGradient id="splash-cab" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="sp-stop-navy-light" /><stop offset="1" className="sp-stop-navy" /></linearGradient>
              <linearGradient id="splash-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d6f0fb" /><stop offset="1" stopColor="#8fc3de" /></linearGradient>
              <linearGradient id="splash-chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f5f8fb" /><stop offset=".5" stopColor="#a9b6c4" /><stop offset="1" stopColor="#eef2f6" /></linearGradient>
              <linearGradient id="splash-road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a4c63" /><stop offset="1" stopColor="#1c2b3f" /></linearGradient>
              <radialGradient id="splash-headlight"><stop offset="0" stopColor="#fff3b0" stopOpacity=".7" /><stop offset="1" stopColor="#fff3b0" stopOpacity="0" /></radialGradient>
              <clipPath id="splash-bump-clip"><path d="M-50 0 C-42 -18 -24 -24 0 -24 C24 -24 42 -18 50 0 Z" /></clipPath>
            </defs>
            <circle cx="92" cy="74" r="62" fill="url(#splash-sun)" />
            <g className="app-splash-clouds"><g className="app-splash-cloud app-splash-cloud-a" fill="#fff" opacity=".8"><ellipse cx="238" cy="52" rx="26" ry="8" /><ellipse cx="256" cy="46" rx="16" ry="8" /></g><g className="app-splash-cloud app-splash-cloud-b" fill="#fff" opacity=".65"><ellipse cx="150" cy="104" rx="20" ry="6" /><ellipse cx="164" cy="99" rx="12" ry="6" /></g></g>
            <g className="sp-fill-navy" opacity=".1">{[14, 44, 70, 104, 128, 166, 190, 218, 254, 284, 316, 342, 374, 404].map((x, i) => <rect key={x} x={x} y={[150, 120, 160, 138, 170, 90, 146, 158, 136, 170, 150, 128, 160, 140][i]} width={i % 3 === 0 ? 26 : 22} height={68 + (i % 4) * 10} />)}</g>
            <g className="sp-fill-navy" opacity=".18"><rect x="0" y="176" width="30" height="42" /><rect x="34" y="164" width="24" height="54" /><rect x="62" y="184" width="36" height="34" /><rect x="102" y="170" width="22" height="48" /><rect x="150" y="182" width="30" height="36" /><rect x="230" y="172" width="26" height="46" /><rect x="300" y="186" width="34" height="32" /><rect x="378" y="178" width="28" height="40" /><rect x="414" y="168" width="26" height="50" /></g>
            <g className="sp-fill-green" opacity=".55"><ellipse cx="24" cy="212" rx="22" ry="10" /><ellipse cx="52" cy="214" rx="16" ry="8" /><ellipse cx="426" cy="213" rx="20" ry="9" /></g>
            <g>{Array.from({ length: 12 }).map((_, i) => <rect key={i} x={i * 40 + 12} y="204" width="3" height="16" fill="#9aa8b6" />)}<rect x="0" y="203" width="440" height="7" fill="#e2e9f0" /><rect x="0" y="206" width="440" height="1.4" fill="#b7c4d1" /></g>
            <rect x="376" y="108" width="5" height="112" fill="#8c99a8" /><rect x="326" y="24" width="108" height="84" rx="5" className="sp-fill-green" /><rect x="329.5" y="27.5" width="101" height="77" rx="3" fill="none" stroke="#fff" strokeOpacity=".55" />
            {SIGN_ROWS.map((row, i) => { const y = 45 + i * 17; return <g key={row}><text x="337" y={y} className="app-splash-sign-text">{row}</text><path d={`M411 ${y - 3} H422 M418.5 ${y - 6} L422 ${y - 3} L418.5 ${y}`} fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />{i < 3 && <line x1="334" x2="426" y1={y + 6.5} y2={y + 6.5} stroke="#fff" strokeOpacity=".28" />}</g>; })}
            <rect x="0" y="218" width="440" height="82" fill="url(#splash-road)" /><rect x="0" y="218" width="440" height="3" fill="#fff" opacity=".22" /><line x1="0" x2="440" y1="230" y2="230" stroke="#f5b921" strokeWidth="2" opacity=".85" /><line className="app-splash-dashes" x1="-60" x2="500" y1="292" y2="292" stroke="#fff" strokeOpacity=".6" strokeWidth="3" strokeDasharray="28 20" />
            <ellipse className="app-splash-shadow" cx="215" cy="272" rx="176" ry="5" fill="#000" />
            <g transform="translate(0 270)"><g className="app-splash-bump" clipPath="url(#splash-bump-clip)"><rect x="-50" y="-26" width="20" height="27" fill="#14202f" /><rect x="-30" y="-26" width="20" height="27" fill="#f5b921" /><rect x="-10" y="-26" width="20" height="27" fill="#14202f" /><rect x="10" y="-26" width="20" height="27" fill="#f5b921" /><rect x="30" y="-26" width="20" height="27" fill="#14202f" /></g></g>
            <g transform="translate(40 136)"><g className="app-splash-truck"><rect x="236" y="4" width="6" height="60" rx="2" fill="url(#splash-chrome)" /><rect x="8" y="104" width="336" height="7" rx="2" fill="#1b2b40" /><rect x="8" y="18" width="224" height="86" rx="5" fill="url(#splash-trailer)" stroke="#c3cfda" />{[36, 64, 92, 120, 148, 176, 204].map((x) => <line key={x} x1={x} x2={x} y1="22" y2="100" stroke="#b6c3d0" strokeOpacity=".55" />)}<text x="120" y="50" textAnchor="middle" className="app-splash-trailer-text">MORE LOADS</text><text x="120" y="70" textAnchor="middle" className="app-splash-trailer-text">BRIGHTER COMMISSIONS</text><path d="M46 84 Q120 72 196 82" fill="none" className="sp-stroke-green" strokeWidth="3.2" strokeLinecap="round" />
              <rect x="266" y="90" width="26" height="15" rx="7" fill="url(#splash-chrome)" /><path d="M232 104 V40 Q232 30 242 30 H284 Q292 30 297 38 L316 70 H336 Q344 70 344 78 V104 Z" fill="url(#splash-cab)" /><path d="M246 40 H283 L300 68 H246 Z" fill="url(#splash-glass)" /><rect x="232" y="88" width="112" height="6" className="sp-fill-green" /><circle cx="346" cy="84" r="11" fill="url(#splash-headlight)" /><rect x="340" y="80" width="6" height="9" rx="2" fill="#fff3b0" />
              <Wheel cx={70} cy={118} /><Wheel cx={104} cy={118} /><Wheel cx={248} cy={118} /><Wheel cx={312} cy={118} /></g></g>
            <g className="app-splash-shake app-splash-shake-front" fill="none" strokeLinecap="round"><path d="M388 212 q8 10 0 20" /><path d="M397 204 q10 14 0 28" /><path d="M405 218 q8 8 0 16" /></g><g className="app-splash-shake app-splash-shake-rear" fill="none" strokeLinecap="round"><path d="M84 238 q-8 10 0 20" /><path d="M76 232 q-10 14 0 28" /><path d="M68 244 q-8 8 0 16" /></g>
          </svg>
        </div>
        <div className="app-splash-progress" aria-hidden="true"><span className="app-splash-progress-fill" /></div>
        <p className="app-splash-label">{label}</p>
      </div>
    </main>
  );
}
